import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq, gt, gte, isNull } from 'drizzle-orm';
import { CryptoService } from '../crypto/crypto.service.js';
import { DB, type Database } from '../db/database.module.js';
import { owners, ownerSecurityEvents, ownerSessions } from '../db/schema/index.js';
import { EmailService } from '../email/email.service.js';
import { OwnerAuthService, toPublic } from './owner-auth.service.js';
import { ownerEmails } from './owner-emails.js';
import {
  createSession,
  recordEvent,
  revokeSessions,
  type OwnerRow,
  type RequestContext,
} from './owner-sessions.js';
import { OwnerTwoFactorService, type SecondFactor } from './owner-two-factor.service.js';

const SECURITY_EVENTS_SHOWN = 20;

/** The signed-in owner's own account: profile, password, email, sessions and activity. */
@Injectable()
export class OwnerAccountService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly crypto: CryptoService,
    private readonly email: EmailService,
    private readonly auth: OwnerAuthService,
    private readonly twoFactor: OwnerTwoFactorService,
  ) {}

  async me(owner: OwnerRow) {
    return {
      owner: {
        ...toPublic(owner),
        recovery_codes_left: owner.totpSecretEnc
          ? await this.twoFactor.recoveryCodesLeft(owner.id)
          : 0,
      },
    };
  }

  async updateProfile(owner: OwnerRow, input: { name?: string; phone?: string | null }) {
    try {
      const [updated] = await this.db
        .update(owners)
        .set({
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.phone !== undefined ? { phoneE164: input.phone, phoneVerifiedAt: null } : {}),
          updatedAt: new Date(),
        })
        .where(eq(owners.id, owner.id))
        .returning();
      return this.me(updated);
    } catch (err) {
      if ((err as { cause?: { code?: string } }).cause?.code === '23505') {
        throw new ConflictException({ error: 'phone_taken' });
      }
      throw err;
    }
  }

  /** Signs out every session and returns a new one for this device, for the cookie. */
  async changePassword(
    owner: OwnerRow,
    input: { current_password: string; new_password: string } & SecondFactor,
    ctx: RequestContext,
  ): Promise<string> {
    await this.twoFactor.requirePassword(owner, input.current_password);
    if (input.new_password === input.current_password) {
      throw new BadRequestException({ error: 'same_password' });
    }
    this.auth.assertPasswordAllowed(input.new_password, owner.email);
    const passwordHash = await this.crypto.hashPassword(input.new_password);
    const token = await this.db.transaction(async (tx) => {
      await this.twoFactor.requireFactor(tx, owner, input);
      const now = new Date();
      await tx
        .update(owners)
        .set({ passwordHash, passwordChangedAt: now, mustChangePassword: false, updatedAt: now })
        .where(eq(owners.id, owner.id));
      await revokeSessions(tx, owner.id);
      await recordEvent(tx, owner.id, 'owner.password_changed', ctx);
      return createSession(tx, this.crypto, owner.id, ctx);
    });
    this.email.queue(ownerEmails.passwordChanged(owner.email));
    return token;
  }

  /**
   * Sends a confirmation link to the new address and a notice to the old one; the address changes
   * when the link is opened. An address already in use gets nothing, without saying so.
   */
  async changeEmail(owner: OwnerRow, password: string, newEmail: string) {
    await this.twoFactor.requirePassword(owner, password);
    if (newEmail.toLowerCase() === owner.email.toLowerCase()) {
      throw new BadRequestException({ error: 'same_email' });
    }
    const taken = await this.db.query.owners.findFirst({ where: eq(owners.email, newEmail) });
    this.email.queue(ownerEmails.changeEmailNotice(owner.email, newEmail));
    if (taken) return;
    const url = await this.db.transaction((tx) =>
      this.auth.emailLink(tx, owner.id, 'change_email', newEmail),
    );
    this.email.queue(ownerEmails.changeEmailConfirm(newEmail, url));
  }

  async sessions(owner: OwnerRow, currentSessionId: string) {
    const rows = await this.db
      .select()
      .from(ownerSessions)
      .where(
        and(
          eq(ownerSessions.ownerId, owner.id),
          isNull(ownerSessions.revokedAt),
          gt(ownerSessions.expiresAt, new Date()),
          owner.passwordChangedAt
            ? gte(ownerSessions.createdAt, owner.passwordChangedAt)
            : undefined,
        ),
      )
      .orderBy(desc(ownerSessions.lastUsedAt));
    return {
      sessions: rows.map((s) => ({
        id: s.id,
        user_agent: s.userAgent,
        ip: s.ip,
        created_at: s.createdAt.toISOString(),
        last_used_at: s.lastUsedAt.toISOString(),
        current: s.id === currentSessionId,
      })),
    };
  }

  async revokeSession(owner: OwnerRow, id: string) {
    const [row] = await this.db
      .update(ownerSessions)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(ownerSessions.id, id),
          eq(ownerSessions.ownerId, owner.id),
          isNull(ownerSessions.revokedAt),
        ),
      )
      .returning({ id: ownerSessions.id });
    if (!row) throw new NotFoundException({ error: 'session_not_found' });
  }

  async revokeOtherSessions(owner: OwnerRow, currentSessionId: string) {
    await revokeSessions(this.db, owner.id, currentSessionId);
  }

  async securityEvents(owner: OwnerRow) {
    const rows = await this.db
      .select()
      .from(ownerSecurityEvents)
      .where(eq(ownerSecurityEvents.ownerId, owner.id))
      .orderBy(desc(ownerSecurityEvents.id))
      .limit(SECURITY_EVENTS_SHOWN);
    return {
      events: rows.map((e) => ({
        action: e.action,
        ip: e.ip,
        user_agent: e.userAgent,
        at: e.createdAt.toISOString(),
      })),
    };
  }
}
