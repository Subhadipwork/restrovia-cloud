import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, count, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { CryptoService } from '../crypto/crypto.service.js';
import { DB, type Database } from '../db/database.module.js';
import {
  ownerEmailTokens,
  owners,
  ownerSecurityEvents,
  storeMembers,
  stores,
} from '../db/schema/index.js';
import { EmailService } from '../email/email.service.js';
import { isUniqueViolation } from '../pos/register.service.js';
import { OwnerAuthService } from '../owner/owner-auth.service.js';
import { ownerEmails } from '../owner/owner-emails.js';
import { recordEvent, revokeSessions, type Tx } from '../owner/owner-sessions.js';
import { clearTwoFactor } from '../owner/owner-two-factor.service.js';
import type { AdminRow } from './admin-auth.service.js';
import type { Page } from './admin.service.js';
import { writeAudit } from './audit.js';

const ownerFields = {
  id: owners.id,
  name: owners.name,
  email: owners.email,
  phone: owners.phoneE164,
  status: owners.status,
  /** Created by the Restrovia team, password not chosen yet. */
  invited: sql<boolean>`${owners.passwordHash} is null`,
  must_change_password: owners.mustChangePassword,
  email_verified: sql<boolean>`${owners.emailVerifiedAt} is not null`,
  two_factor_enabled: sql<boolean>`${owners.totpSecretEnc} is not null`,
  locked: sql<boolean>`coalesce(${owners.lockedUntil} > now(), false)`,
  last_login_at: owners.lastLoginAt,
  created_at: owners.createdAt,
};

const SYSTEM = { ip: null, userAgent: null };

/** Without a password the owner is emailed an invite to choose one. */
export type NewOwner = { name: string; email: string; phone?: string; password?: string };

/** Owner accounts as support sees them; every change is audited. */
@Injectable()
export class AdminOwnersService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly crypto: CryptoService,
    private readonly email: EmailService,
    private readonly ownerAuth: OwnerAuthService,
  ) {}

  /**
   * Gives a store its owner account. A new email gets an account with the password the admin set
   * (changed by the owner at first sign-in) or, without one, an invite to choose a password. An
   * email that already has an account (an owner with a second café) is linked instead, and its
   * password is left as it is.
   */
  async addToStore(storeId: string, input: NewOwner, by: AdminRow, ip: string | null) {
    const store = await this.db.query.stores.findFirst({ where: eq(stores.id, storeId) });
    if (!store || store.status === 'deleted') {
      throw new NotFoundException({ error: 'store_not_found' });
    }
    const storeName = store.name || 'your café';
    const passwordHash = input.password
      ? await this.adminPasswordHash(input.password, input.email)
      : null;
    let result: {
      ownerId: string;
      email: string;
      name: string;
      created: boolean;
      invite: string | null;
    };
    try {
      result = await this.db.transaction(async (tx) => {
        const existing = await tx.query.owners.findFirst({ where: eq(owners.email, input.email) });
        if (existing) {
          const [member] = await tx
            .insert(storeMembers)
            .values({ storeId, ownerId: existing.id, role: 'owner' })
            .onConflictDoNothing()
            .returning();
          if (!member) throw new ConflictException({ error: 'already_linked' });
          await writeAudit(tx, {
            adminId: by.id,
            action: 'owner.link_store',
            targetType: 'owner',
            targetId: existing.id,
            details: { store_id: storeId },
            ip,
          });
          // Not set up yet: a fresh invite, since the first one may be lost or expired.
          const invite = existing.passwordHash
            ? null
            : await this.newInvite(tx, existing.id, existing.email);
          return {
            ownerId: existing.id,
            email: existing.email,
            name: existing.name,
            created: false,
            invite,
          };
        }
        const [owner] = await tx
          .insert(owners)
          .values({
            name: input.name,
            email: input.email,
            phoneE164: input.phone ?? null,
            createdByAdminId: by.id,
            ...(passwordHash
              ? { passwordHash, passwordChangedAt: new Date(), mustChangePassword: true }
              : {}),
          })
          .returning();
        await tx.insert(storeMembers).values({ storeId, ownerId: owner.id, role: 'owner' });
        await recordEvent(tx, owner.id, 'owner.created', SYSTEM);
        await writeAudit(tx, {
          adminId: by.id,
          action: 'owner.create',
          targetType: 'owner',
          targetId: owner.id,
          details: { store_id: storeId, password_set: !!passwordHash },
          ip,
        });
        const invite = passwordHash ? null : await this.newInvite(tx, owner.id, owner.email);
        return { ownerId: owner.id, email: owner.email, name: owner.name, created: true, invite };
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException({ error: 'phone_taken' });
      throw err;
    }
    const signInUrl = `${this.ownerAuth.appUrl}/sign-in`;
    this.email.queue(
      result.invite
        ? ownerEmails.invite(result.email, result.name, storeName, result.invite)
        : result.created
          ? ownerEmails.accountReady(result.email, result.name, storeName, signInUrl)
          : ownerEmails.storeAdded(result.email, storeName, signInUrl),
    );
    return {
      owner_id: result.ownerId,
      created: result.created,
      password_set: result.created && !!passwordHash,
    };
  }

  /**
   * A new password chosen by support, for an owner who is locked out or never received the invite.
   * Every session ends and the owner chooses their own password at the next sign-in; 2FA stays on.
   */
  async setPassword(id: string, password: string, by: AdminRow, ip: string | null) {
    const owner = await this.db.query.owners.findFirst({ where: eq(owners.id, id) });
    if (!owner) throw new NotFoundException({ error: 'owner_not_found' });
    const passwordHash = await this.adminPasswordHash(password, owner.email);
    await this.db.transaction(async (tx) => {
      const now = new Date();
      await tx
        .update(owners)
        .set({
          passwordHash,
          passwordChangedAt: now,
          mustChangePassword: true,
          failedLogins: 0,
          lockedUntil: null,
          updatedAt: now,
        })
        .where(eq(owners.id, id));
      // Links already emailed would otherwise replace the password support just set.
      await tx
        .update(ownerEmailTokens)
        .set({ usedAt: now })
        .where(
          and(
            eq(ownerEmailTokens.ownerId, id),
            inArray(ownerEmailTokens.purpose, ['invite', 'reset_password']),
            isNull(ownerEmailTokens.usedAt),
          ),
        );
      await revokeSessions(tx, id);
      await recordEvent(tx, id, 'owner.password_set_by_support', SYSTEM);
      await writeAudit(tx, {
        adminId: by.id,
        action: 'owner.set_password',
        targetType: 'owner',
        targetId: id,
        ip,
      });
    });
    this.email.queue(
      ownerEmails.passwordSetBySupport(owner.email, `${this.ownerAuth.appUrl}/sign-in`),
    );
    return this.detail(id);
  }

  private async adminPasswordHash(password: string, email: string) {
    this.ownerAuth.assertPasswordAllowed(password, email);
    return this.crypto.hashPassword(password);
  }

  /** A new invite link for an owner who hasn't chosen a password yet; older links stop working. */
  async resendInvite(id: string, by: AdminRow, ip: string | null) {
    const owner = await this.db.query.owners.findFirst({ where: eq(owners.id, id) });
    if (!owner) throw new NotFoundException({ error: 'owner_not_found' });
    if (owner.passwordHash) throw new ConflictException({ error: 'already_set_up' });
    if (owner.status !== 'active') throw new ConflictException({ error: 'owner_disabled' });
    const [first] = await this.db
      .select({ name: stores.name })
      .from(storeMembers)
      .innerJoin(stores, eq(stores.id, storeMembers.storeId))
      .where(eq(storeMembers.ownerId, id))
      .orderBy(asc(storeMembers.createdAt))
      .limit(1);
    const url = await this.db.transaction(async (tx) => {
      await writeAudit(tx, {
        adminId: by.id,
        action: 'owner.resend_invite',
        targetType: 'owner',
        targetId: id,
        ip,
      });
      return this.newInvite(tx, id, owner.email);
    });
    this.email.queue(ownerEmails.invite(owner.email, owner.name, first?.name || 'your café', url));
    return this.detail(id);
  }

  async removeFromStore(storeId: string, ownerId: string, by: AdminRow, ip: string | null) {
    await this.db.transaction(async (tx) => {
      const [row] = await tx
        .delete(storeMembers)
        .where(and(eq(storeMembers.storeId, storeId), eq(storeMembers.ownerId, ownerId)))
        .returning({ ownerId: storeMembers.ownerId });
      if (!row) throw new NotFoundException({ error: 'member_not_found' });
      await writeAudit(tx, {
        adminId: by.id,
        action: 'owner.unlink_store',
        targetType: 'owner',
        targetId: ownerId,
        details: { store_id: storeId },
        ip,
      });
    });
    return { ok: true };
  }

  private async newInvite(tx: Tx, ownerId: string, email: string) {
    await tx
      .update(ownerEmailTokens)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(ownerEmailTokens.ownerId, ownerId),
          eq(ownerEmailTokens.purpose, 'invite'),
          isNull(ownerEmailTokens.usedAt),
        ),
      );
    return this.ownerAuth.emailLink(tx, ownerId, 'invite', email);
  }

  async list(search: string | undefined, page: Page) {
    const where: SQL[] = [];
    if (search) {
      const term = `%${search.replace(/[%_]/g, '\\$&')}%`;
      where.push(
        or(
          ilike(owners.name, term),
          ilike(sql`${owners.email}::text`, term),
          ilike(owners.phoneE164, term),
        )!,
      );
    }
    const cond = where.length ? and(...where) : undefined;
    const [rows, total] = await Promise.all([
      this.db
        .select({
          ...ownerFields,
          stores_count: sql<number>`(select count(*)::int from store_members where owner_id = "owners"."id")`,
        })
        .from(owners)
        .where(cond)
        .orderBy(desc(owners.createdAt))
        .limit(page.perPage)
        .offset((page.page - 1) * page.perPage),
      this.db.select({ n: count() }).from(owners).where(cond),
    ]);
    return { data: rows, total: total[0]?.n ?? 0, page: page.page, per_page: page.perPage };
  }

  async detail(id: string) {
    const [owner] = await this.db.select(ownerFields).from(owners).where(eq(owners.id, id));
    if (!owner) throw new NotFoundException({ error: 'owner_not_found' });
    const [linked, events] = await Promise.all([
      this.db
        .select({
          id: stores.id,
          name: stores.name,
          role: storeMembers.role,
          since: storeMembers.createdAt,
        })
        .from(storeMembers)
        .innerJoin(stores, eq(stores.id, storeMembers.storeId))
        .where(eq(storeMembers.ownerId, id)),
      this.db
        .select({
          action: ownerSecurityEvents.action,
          ip: ownerSecurityEvents.ip,
          user_agent: ownerSecurityEvents.userAgent,
          at: ownerSecurityEvents.createdAt,
        })
        .from(ownerSecurityEvents)
        .where(eq(ownerSecurityEvents.ownerId, id))
        .orderBy(desc(ownerSecurityEvents.id))
        .limit(20),
    ]);
    return { owner, stores: linked, security_events: events };
  }

  /** For an owner who lost the authenticator and the recovery codes; support checks identity first. */
  async resetTwoFactor(id: string, reason: string, by: AdminRow, ip: string | null) {
    const email = await this.db.transaction(async (tx) => {
      const owner = await tx.query.owners.findFirst({ where: eq(owners.id, id) });
      if (!owner) throw new NotFoundException({ error: 'owner_not_found' });
      if (!owner.totpSecretEnc) throw new ConflictException({ error: 'two_factor_off' });
      await clearTwoFactor(tx, id);
      await revokeSessions(tx, id);
      await recordEvent(tx, id, 'owner.2fa_reset_by_support', { ip: null, userAgent: null });
      await writeAudit(tx, {
        adminId: by.id,
        action: 'owner.2fa_reset',
        targetType: 'owner',
        targetId: id,
        details: { reason },
        ip,
      });
      return owner.email;
    });
    this.email.queue(ownerEmails.twoFactorReset(email));
    return this.detail(id);
  }

  async setStatus(
    id: string,
    status: 'active' | 'disabled',
    reason: string | undefined,
    by: AdminRow,
    ip: string | null,
  ) {
    await this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(owners)
        .set({ status, updatedAt: new Date() })
        .where(eq(owners.id, id))
        .returning({ id: owners.id });
      if (!row) throw new NotFoundException({ error: 'owner_not_found' });
      if (status === 'disabled') await revokeSessions(tx, id);
      await writeAudit(tx, {
        adminId: by.id,
        action: status === 'disabled' ? 'owner.disable' : 'owner.enable',
        targetType: 'owner',
        targetId: id,
        details: reason ? { reason } : {},
        ip,
      });
    });
    return this.detail(id);
  }
}
