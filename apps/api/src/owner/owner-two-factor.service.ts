import { randomInt } from 'node:crypto';
import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { and, count, eq, isNull, lt, or } from 'drizzle-orm';
import { OWNER_AUTH } from '@restrovia/shared';
import { CryptoService } from '../crypto/crypto.service.js';
import { generateTotpSecret, otpauthUrl, verifyTotp } from '../crypto/totp.js';
import { DB, type Database } from '../db/database.module.js';
import { ownerRecoveryCodes, owners } from '../db/schema/index.js';
import { EmailService } from '../email/email.service.js';
import { ownerEmails } from './owner-emails.js';
import {
  recordEvent,
  revokeSessions,
  type OwnerRow,
  type RequestContext,
  type Tx,
} from './owner-sessions.js';

/** An authenticator code or a recovery code; exactly one is set. */
export type SecondFactor = { code?: string; recovery_code?: string };

/** No 0/o, 1/i/l: recovery codes are often read off paper. */
const RECOVERY_ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz';

const normalizeRecoveryCode = (code: string) => code.toLowerCase().replace(/[\s-]/g, '');

@Injectable()
export class OwnerTwoFactorService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly crypto: CryptoService,
    private readonly email: EmailService,
  ) {}

  /**
   * Uses up the code atomically: an authenticator step must be newer than the last one accepted,
   * and a recovery code must be unused. Returns which kind matched, or null.
   */
  async consume(
    tx: Tx | Database,
    owner: OwnerRow,
    input: SecondFactor,
  ): Promise<'totp' | 'recovery' | null> {
    if (!owner.totpSecretEnc) return null;
    if (input.code) {
      const step = verifyTotp(this.crypto.decrypt(owner.totpSecretEnc).toString(), input.code);
      if (step === null) return null;
      const [updated] = await tx
        .update(owners)
        .set({ totpLastStep: step })
        .where(
          and(
            eq(owners.id, owner.id),
            or(isNull(owners.totpLastStep), lt(owners.totpLastStep, step)),
          ),
        )
        .returning({ id: owners.id });
      return updated ? 'totp' : null;
    }
    if (input.recovery_code) {
      const hash = this.crypto.sha256(normalizeRecoveryCode(input.recovery_code));
      const [used] = await tx
        .update(ownerRecoveryCodes)
        .set({ usedAt: new Date() })
        .where(
          and(
            eq(ownerRecoveryCodes.ownerId, owner.id),
            eq(ownerRecoveryCodes.codeHash, hash),
            isNull(ownerRecoveryCodes.usedAt),
          ),
        )
        .returning({ id: ownerRecoveryCodes.id });
      return used ? 'recovery' : null;
    }
    return null;
  }

  async recoveryCodesLeft(ownerId: string): Promise<number> {
    const [row] = await this.db
      .select({ n: count() })
      .from(ownerRecoveryCodes)
      .where(and(eq(ownerRecoveryCodes.ownerId, ownerId), isNull(ownerRecoveryCodes.usedAt)));
    return row?.n ?? 0;
  }

  async setup(owner: OwnerRow, password: string) {
    await this.requirePassword(owner, password);
    if (owner.totpSecretEnc) throw new ConflictException({ error: 'two_factor_already_on' });
    const secret = generateTotpSecret();
    const setupToken = this.crypto
      .encrypt(
        JSON.stringify({
          ownerId: owner.id,
          secret,
          exp: Date.now() + OWNER_AUTH.setupTokenMinutes * 60_000,
        }),
      )
      .toString('base64url');
    return {
      secret,
      otpauth_url: otpauthUrl(secret, owner.email, 'Restrovia'),
      setup_token: setupToken,
    };
  }

  /** Saves the secret once a code from it is confirmed; returns the recovery codes, shown once. */
  async enable(
    owner: OwnerRow,
    sessionId: string,
    setupToken: string,
    code: string,
    ctx: RequestContext,
  ) {
    let payload: { ownerId: string; secret: string; exp: number };
    try {
      payload = JSON.parse(this.crypto.decrypt(Buffer.from(setupToken, 'base64url')).toString());
    } catch {
      throw new UnauthorizedException({ error: 'invalid_setup_token' });
    }
    if (payload.ownerId !== owner.id) {
      throw new UnauthorizedException({ error: 'invalid_setup_token' });
    }
    if (payload.exp < Date.now()) throw new UnauthorizedException({ error: 'setup_expired' });
    const step = verifyTotp(payload.secret, code);
    if (step === null) throw new UnauthorizedException({ error: 'invalid_code' });

    const codes = makeRecoveryCodes();
    await this.db.transaction(async (tx) => {
      const [updated] = await tx
        .update(owners)
        .set({
          totpSecretEnc: this.crypto.encrypt(payload.secret),
          totpLastStep: step,
          totpEnabledAt: new Date(),
        })
        .where(and(eq(owners.id, owner.id), isNull(owners.totpSecretEnc)))
        .returning({ id: owners.id });
      if (!updated) throw new ConflictException({ error: 'two_factor_already_on' });
      await this.replaceRecoveryCodes(tx, owner.id, codes);
      await revokeSessions(tx, owner.id, sessionId);
      await recordEvent(tx, owner.id, 'owner.2fa_enabled', ctx);
    });
    this.email.queue(ownerEmails.twoFactorOn(owner.email));
    return { recovery_codes: codes };
  }

  async disable(
    owner: OwnerRow,
    sessionId: string,
    password: string,
    factor: SecondFactor,
    ctx: RequestContext,
  ) {
    await this.requirePassword(owner, password);
    if (!owner.totpSecretEnc) throw new ConflictException({ error: 'two_factor_off' });
    await this.db.transaction(async (tx) => {
      await this.requireFactor(tx, owner, factor);
      await clearTwoFactor(tx, owner.id);
      await revokeSessions(tx, owner.id, sessionId);
      await recordEvent(tx, owner.id, 'owner.2fa_disabled', ctx);
    });
    this.email.queue(ownerEmails.twoFactorOff(owner.email));
  }

  async regenerateRecoveryCodes(
    owner: OwnerRow,
    password: string,
    factor: SecondFactor,
    ctx: RequestContext,
  ) {
    await this.requirePassword(owner, password);
    if (!owner.totpSecretEnc) throw new ConflictException({ error: 'two_factor_off' });
    const codes = makeRecoveryCodes();
    await this.db.transaction(async (tx) => {
      await this.requireFactor(tx, owner, factor);
      await this.replaceRecoveryCodes(tx, owner.id, codes);
      await recordEvent(tx, owner.id, 'owner.recovery_codes_regenerated', ctx);
    });
    return { recovery_codes: codes };
  }

  /** For changes that need 2FA when it is on (password change). */
  async requireFactor(tx: Tx | Database, owner: OwnerRow, factor: SecondFactor) {
    if (!owner.totpSecretEnc) return;
    if (!factor.code && !factor.recovery_code) {
      throw new ForbiddenException({ error: 'code_required' });
    }
    if (!(await this.consume(tx, owner, factor))) {
      throw new ForbiddenException({ error: 'invalid_code' });
    }
  }

  async requirePassword(owner: OwnerRow, password: string) {
    if (!owner.passwordHash || !(await this.crypto.verifyPassword(owner.passwordHash, password))) {
      throw new ForbiddenException({ error: 'wrong_password' });
    }
  }

  private async replaceRecoveryCodes(tx: Tx, ownerId: string, codes: string[]) {
    await tx.delete(ownerRecoveryCodes).where(eq(ownerRecoveryCodes.ownerId, ownerId));
    await tx.insert(ownerRecoveryCodes).values(
      codes.map((code) => ({
        ownerId,
        codeHash: this.crypto.sha256(normalizeRecoveryCode(code)),
      })),
    );
  }
}

/** Turns 2FA off and deletes the recovery codes; used by the owner and by admin support. */
export async function clearTwoFactor(tx: Tx, ownerId: string) {
  await tx
    .update(owners)
    .set({ totpSecretEnc: null, totpLastStep: null, totpEnabledAt: null })
    .where(eq(owners.id, ownerId));
  await tx.delete(ownerRecoveryCodes).where(eq(ownerRecoveryCodes.ownerId, ownerId));
}

function makeRecoveryCodes(): string[] {
  const part = () =>
    Array.from({ length: 4 }, () => RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)]).join(
      '',
    );
  return Array.from({ length: OWNER_AUTH.recoveryCodeCount }, () => `${part()}-${part()}`);
}
