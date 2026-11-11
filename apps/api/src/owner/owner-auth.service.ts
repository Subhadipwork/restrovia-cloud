import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, count, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import { OWNER_AUTH, type OwnerEmailTokenPurpose } from '@restrovia/shared';
import type { Env } from '../config/env.js';
import { CryptoService } from '../crypto/crypto.service.js';
import { DB, type Database } from '../db/database.module.js';
import { ownerEmailTokens, owners, ownerSessions } from '../db/schema/index.js';
import { EmailService } from '../email/email.service.js';
import { COMMON_PASSWORDS } from './common-passwords.js';
import { ownerEmails } from './owner-emails.js';
import {
  createSession,
  isLocked,
  recordEvent,
  revokeSessions,
  type OwnerRow,
  type RequestContext,
  type Tx,
} from './owner-sessions.js';
import { OwnerTwoFactorService, type SecondFactor } from './owner-two-factor.service.js';

export type OwnerPublic = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  email_verified: boolean;
  two_factor_enabled: boolean;
  two_factor_enabled_at: string | null;
  /** The password was set by a Restrovia admin; the portal asks for a new one first. */
  must_change_password: boolean;
  created_at: string;
};

export const toPublic = (o: OwnerRow): OwnerPublic => ({
  id: o.id,
  name: o.name,
  email: o.email,
  phone: o.phoneE164,
  email_verified: o.emailVerifiedAt !== null,
  two_factor_enabled: o.totpSecretEnc !== null,
  two_factor_enabled_at: o.totpEnabledAt?.toISOString() ?? null,
  must_change_password: o.mustChangePassword,
  created_at: o.createdAt.toISOString(),
});

export type LoginResult =
  | { status: 'ok'; owner: OwnerPublic; token: string }
  | { status: '2fa_required'; challenge_token: string };

type Challenge = { ownerId: string; exp: number; iat: number; failedAtStart: number };

const HOUR = 3_600_000;
const SESSION_TOUCH_MS = HOUR;
const invalidCredentials = () => new UnauthorizedException({ error: 'invalid_credentials' });
const challengeExpired = () => new UnauthorizedException({ error: 'challenge_expired' });
const invalidToken = () => new BadRequestException({ error: 'invalid_token' });

const sameEmail = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Owner sign-up, sign-in (with optional 2FA), sessions, email verification and password reset. */
@Injectable()
export class OwnerAuthService {
  private readonly log = new Logger(OwnerAuthService.name);
  private readonly dummyHash: Promise<string>;
  /** The owner portal, for links in emails. */
  readonly appUrl: string;

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly crypto: CryptoService,
    private readonly email: EmailService,
    private readonly twoFactor: OwnerTwoFactorService,
    config: ConfigService<Env, true>,
  ) {
    // Used when the email is unknown, so a wrong email takes as long as a wrong password.
    this.dummyHash = crypto.hashPassword(crypto.randomToken());
    this.appUrl = config.get('OWNER_APP_URL', { infer: true }).replace(/\/$/, '');
  }

  assertPasswordAllowed(password: string, email: string) {
    const lower = password.toLowerCase();
    if (password.length < OWNER_AUTH.passwordMin || password.length > OWNER_AUTH.passwordMax) {
      throw new BadRequestException({ error: 'weak_password', reason: 'length' });
    }
    if (sameEmail(password, email) || lower === email.toLowerCase().split('@')[0]) {
      throw new BadRequestException({ error: 'weak_password', reason: 'email' });
    }
    if (COMMON_PASSWORDS.has(lower)) {
      throw new BadRequestException({ error: 'weak_password', reason: 'common' });
    }
  }

  async login(email: string, password: string, ctx: RequestContext): Promise<LoginResult> {
    const owner = await this.db.query.owners.findFirst({ where: eq(owners.email, email) });
    // A locked account answers like a wrong password, so guessing can't continue during the lock.
    // An invited owner who hasn't chosen a password yet can't sign in either.
    if (!owner || !owner.passwordHash || owner.status !== 'active' || isLocked(owner)) {
      await this.crypto.verifyPassword(await this.dummyHash, password);
      throw invalidCredentials();
    }
    if (!(await this.crypto.verifyPassword(owner.passwordHash, password))) {
      await this.recordFailure(owner, ctx);
      throw invalidCredentials();
    }
    if (owner.totpSecretEnc) {
      const challenge: Challenge = {
        ownerId: owner.id,
        iat: Date.now(),
        exp: Date.now() + OWNER_AUTH.challengeMinutes * 60_000,
        failedAtStart: owner.failedLogins,
      };
      return {
        status: '2fa_required',
        challenge_token: this.crypto.encrypt(JSON.stringify(challenge)).toString('base64url'),
      };
    }
    const token = await this.db.transaction((tx) => this.signedIn(tx, owner, ctx));
    return { status: 'ok', owner: toPublic(owner), token };
  }

  /**
   * Second sign-in step. Wrong codes are counted on the owner row (towards the lockout too), so
   * sending an old challenge token again doesn't give more tries.
   */
  async completeTwoFactor(challengeToken: string, factor: SecondFactor, ctx: RequestContext) {
    let challenge: Challenge;
    try {
      challenge = JSON.parse(
        this.crypto.decrypt(Buffer.from(challengeToken, 'base64url')).toString(),
      );
    } catch {
      throw challengeExpired();
    }
    if (challenge.exp < Date.now()) throw challengeExpired();
    const owner = await this.db.query.owners.findFirst({
      where: eq(owners.id, challenge.ownerId),
    });
    if (
      !owner ||
      owner.status !== 'active' ||
      !owner.totpSecretEnc ||
      isLocked(owner) ||
      (owner.passwordChangedAt && owner.passwordChangedAt.getTime() > challenge.iat) ||
      owner.failedLogins - challenge.failedAtStart >= OWNER_AUTH.challengeAttempts
    ) {
      throw challengeExpired();
    }

    const result = await this.db.transaction(async (tx) => {
      const kind = await this.twoFactor.consume(tx, owner, factor);
      if (!kind) return null;
      if (kind === 'recovery') await recordEvent(tx, owner.id, 'owner.recovery_code_used', ctx);
      return { kind, token: await this.signedIn(tx, owner, ctx) };
    });
    if (!result) {
      await this.recordFailure(owner, ctx);
      throw new UnauthorizedException({ error: 'invalid_code' });
    }
    if (result.kind === 'recovery') {
      const left = await this.twoFactor.recoveryCodesLeft(owner.id);
      this.email.queue(ownerEmails.recoveryCodeUsed(owner.email, left));
    }
    return { owner: toPublic(owner), token: result.token };
  }

  async sessionOwner(token: string): Promise<{ owner: OwnerRow; sessionId: string } | null> {
    if (!token) return null;
    const session = await this.db.query.ownerSessions.findFirst({
      where: and(
        eq(ownerSessions.tokenHash, this.crypto.sha256(token)),
        isNull(ownerSessions.revokedAt),
        gt(ownerSessions.expiresAt, new Date()),
      ),
    });
    if (!session) return null;
    const owner = await this.db.query.owners.findFirst({ where: eq(owners.id, session.ownerId) });
    if (!owner || owner.status !== 'active') return null;
    if (owner.passwordChangedAt && session.createdAt < owner.passwordChangedAt) return null;
    if (Date.now() - session.lastUsedAt.getTime() > SESSION_TOUCH_MS) {
      await this.db
        .update(ownerSessions)
        .set({ lastUsedAt: new Date() })
        .where(eq(ownerSessions.id, session.id));
    }
    return { owner, sessionId: session.id };
  }

  async logout(sessionId: string, ownerId: string, ctx: RequestContext) {
    await this.db.transaction(async (tx) => {
      await tx
        .update(ownerSessions)
        .set({ revokedAt: new Date() })
        .where(eq(ownerSessions.id, sessionId));
      await recordEvent(tx, ownerId, 'owner.logout', ctx);
    });
  }

  /** Confirms the new address from "change email". */
  async verifyEmail(token: string, ctx: RequestContext) {
    return this.db.transaction(async (tx) => {
      const row = await this.useEmailToken(tx, token, ['change_email']);
      const owner = await tx.query.owners.findFirst({ where: eq(owners.id, row.ownerId) });
      if (!owner || owner.status !== 'active') throw invalidToken();

      const taken = await tx.query.owners.findFirst({ where: eq(owners.email, row.email) });
      if (taken && taken.id !== owner.id) {
        throw new BadRequestException({ error: 'email_taken' });
      }
      await tx
        .update(owners)
        .set({ email: row.email, emailVerifiedAt: new Date(), updatedAt: new Date() })
        .where(eq(owners.id, owner.id));
      await recordEvent(tx, owner.id, 'owner.email_changed', ctx);
      return { email: row.email };
    });
  }

  /** Always answers the same way; at most three links an hour per account. */
  async forgotPassword(email: string) {
    const owner = await this.db.query.owners.findFirst({ where: eq(owners.email, email) });
    if (!owner || owner.status !== 'active') return;
    if ((await this.recentTokens(owner.id, 'reset_password', HOUR)) >= 3) return;
    const url = await this.db.transaction((tx) =>
      this.emailLink(tx, owner.id, 'reset_password', owner.email),
    );
    this.email.queue(ownerEmails.resetPassword(owner.email, url));
  }

  /** Signs out every session and keeps 2FA on; proves the owner reads the email, so verifies it. */
  async resetPassword(token: string, password: string, ctx: RequestContext) {
    const { pending, owner } = await this.pendingLink(token, 'reset_password');
    // Checked before the link is used up, so a refused password doesn't cost the owner the link.
    this.assertPasswordAllowed(password, owner.email);
    const passwordHash = await this.crypto.hashPassword(password);

    await this.db.transaction(async (tx) => {
      await this.useEmailToken(tx, token, ['reset_password']);
      const now = new Date();
      await tx
        .update(owners)
        .set({
          passwordHash,
          passwordChangedAt: now,
          mustChangePassword: false,
          failedLogins: 0,
          lockedUntil: null,
          updatedAt: now,
          ...(sameEmail(owner.email, pending.email) && !owner.emailVerifiedAt
            ? { emailVerifiedAt: now }
            : {}),
        })
        .where(eq(owners.id, owner.id));
      await tx
        .update(ownerEmailTokens)
        .set({ usedAt: now })
        .where(
          and(
            eq(ownerEmailTokens.ownerId, owner.id),
            eq(ownerEmailTokens.purpose, 'reset_password'),
            isNull(ownerEmailTokens.usedAt),
          ),
        );
      await revokeSessions(tx, owner.id);
      await recordEvent(tx, owner.id, 'owner.password_reset', ctx);
    });
    this.email.queue(ownerEmails.passwordChanged(owner.email));
  }

  /**
   * First password, from the invite the Restrovia team sent when they created the account. Opening
   * the link proves the owner reads the email, so it also confirms it and signs the owner in.
   */
  async acceptInvite(token: string, password: string, ctx: RequestContext) {
    const { pending, owner } = await this.pendingLink(token, 'invite');
    if (owner.passwordHash) throw new BadRequestException({ error: 'already_set_up' });
    this.assertPasswordAllowed(password, owner.email);
    const passwordHash = await this.crypto.hashPassword(password);

    const session = await this.db.transaction(async (tx) => {
      await this.useEmailToken(tx, token, ['invite']);
      const now = new Date();
      const [updated] = await tx
        .update(owners)
        .set({
          passwordHash,
          passwordChangedAt: now,
          mustChangePassword: false,
          emailVerifiedAt: sameEmail(owner.email, pending.email) ? now : owner.emailVerifiedAt,
          updatedAt: now,
        })
        .where(and(eq(owners.id, owner.id), isNull(owners.passwordHash)))
        .returning();
      if (!updated) throw new BadRequestException({ error: 'already_set_up' });
      await recordEvent(tx, owner.id, 'owner.account_setup', ctx);
      return { owner: updated, token: await this.signedIn(tx, updated, ctx) };
    });
    return { owner: toPublic(session.owner), token: session.token };
  }

  /** An emailed link that is still usable, and its active owner; the link is not used up yet. */
  private async pendingLink(token: string, purpose: OwnerEmailTokenPurpose) {
    const pending = await this.db.query.ownerEmailTokens.findFirst({
      where: and(
        eq(ownerEmailTokens.tokenHash, this.crypto.sha256(token)),
        eq(ownerEmailTokens.purpose, purpose),
        isNull(ownerEmailTokens.usedAt),
        gt(ownerEmailTokens.expiresAt, new Date()),
      ),
    });
    if (!pending) throw invalidToken();
    const owner = await this.db.query.owners.findFirst({ where: eq(owners.id, pending.ownerId) });
    if (!owner || owner.status !== 'active') throw invalidToken();
    return { pending, owner };
  }

  /** Creates a single-use emailed link and returns its URL. */
  async emailLink(tx: Tx, ownerId: string, purpose: OwnerEmailTokenPurpose, email: string) {
    const token = this.crypto.randomToken(32);
    const ttl = {
      invite: OWNER_AUTH.inviteDays * 24 * HOUR,
      reset_password: OWNER_AUTH.resetPasswordMinutes * 60_000,
      change_email: OWNER_AUTH.changeEmailHours * HOUR,
    }[purpose];
    await tx.insert(ownerEmailTokens).values({
      ownerId,
      purpose,
      email,
      tokenHash: this.crypto.sha256(token),
      expiresAt: new Date(Date.now() + ttl),
    });
    const page = {
      invite: 'set-password',
      reset_password: 'reset-password',
      change_email: 'verify-email',
    }[purpose];
    return `${this.appUrl}/${page}?token=${token}`;
  }

  private async useEmailToken(tx: Tx, token: string, purposes: OwnerEmailTokenPurpose[]) {
    const [row] = await tx
      .update(ownerEmailTokens)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(ownerEmailTokens.tokenHash, this.crypto.sha256(token)),
          inArray(ownerEmailTokens.purpose, purposes),
          isNull(ownerEmailTokens.usedAt),
          gt(ownerEmailTokens.expiresAt, new Date()),
        ),
      )
      .returning();
    if (!row) throw invalidToken();
    return row;
  }

  private async recentTokens(ownerId: string, purpose: OwnerEmailTokenPurpose, withinMs: number) {
    const [row] = await this.db
      .select({ n: count() })
      .from(ownerEmailTokens)
      .where(
        and(
          eq(ownerEmailTokens.ownerId, ownerId),
          eq(ownerEmailTokens.purpose, purpose),
          gt(ownerEmailTokens.createdAt, new Date(Date.now() - withinMs)),
        ),
      );
    return row?.n ?? 0;
  }

  async signedIn(tx: Tx, owner: OwnerRow, ctx: RequestContext) {
    await tx
      .update(owners)
      .set({ failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() })
      .where(eq(owners.id, owner.id));
    await recordEvent(tx, owner.id, 'owner.login', ctx);
    return createSession(tx, this.crypto, owner.id, ctx);
  }

  /** Counts a wrong password or code; the tenth in a row locks the account and emails the owner. */
  private async recordFailure(owner: OwnerRow, ctx: RequestContext) {
    const locked = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(owners)
        .set({ failedLogins: sql`${owners.failedLogins} + 1` })
        .where(eq(owners.id, owner.id))
        .returning({ failedLogins: owners.failedLogins });
      await recordEvent(tx, owner.id, 'owner.login_failed', ctx);
      if (!row || row.failedLogins < OWNER_AUTH.lockoutFailures) return false;
      await tx
        .update(owners)
        .set({
          failedLogins: 0,
          lockedUntil: new Date(Date.now() + OWNER_AUTH.lockoutMinutes * 60_000),
        })
        .where(eq(owners.id, owner.id));
      await recordEvent(tx, owner.id, 'owner.locked', ctx);
      return true;
    });
    if (locked) {
      this.log.warn(`Owner ${owner.id} locked after repeated failed sign-ins`);
      this.email.queue(ownerEmails.locked(owner.email, OWNER_AUTH.lockoutMinutes));
    }
  }
}
