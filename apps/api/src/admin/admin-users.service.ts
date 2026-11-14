import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { alias } from 'drizzle-orm/pg-core';
import { and, asc, count, desc, eq, gt, isNull, ne, sql } from 'drizzle-orm';
import { ADMIN_AUTH, SYSTEM_ROLE_IDS } from '@restrovia/shared';
import type { Env } from '../config/env.js';
import { CryptoService } from '../crypto/crypto.service.js';
import { DB, type Database } from '../db/database.module.js';
import { adminAuditLog, adminRoles, admins, adminSessions } from '../db/schema/index.js';
import { EmailService } from '../email/email.service.js';
import { isUniqueViolation } from '../pos/register.service.js';
import { type AdminRow, grantsNoMoreThan, loadAdmin, toPublic } from './admin-auth.service.js';
import { adminEmails, assertAdminPassword } from './admin-emails.js';
import { endSessions, issueLink, linksSentLastHour } from './admin-tokens.js';
import { writeAudit } from './audit.js';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

export type InviteInput = { name: string; email: string; role: string; password?: string };
export type UserUpdate = { name?: string; role?: string };

const ACTIVITY_SHOWN = 50;
const isSuperAdmin = (a: Pick<AdminRow, 'role'>) => a.role.id === SYSTEM_ROLE_IDS.super_admin;

/** Restrovia staff accounts: invite, edit, change role, disable, reset, sign out. */
@Injectable()
export class AdminUsersService {
  private readonly appUrl: string;

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly crypto: CryptoService,
    private readonly email: EmailService,
    config: ConfigService<Env, true>,
  ) {
    this.appUrl = config.get('ADMIN_APP_URL', { infer: true }).replace(/\/$/, '');
  }

  async list(by: AdminRow) {
    const now = new Date();
    const rows = await this.db
      .select({
        admin: admins,
        role: adminRoles,
        sessions: sql<number>`(select count(*)::int from admin_sessions s
          where s.admin_id = "admins"."id" and s.revoked_at is null and s.expires_at > ${now})`,
      })
      .from(admins)
      .innerJoin(adminRoles, eq(adminRoles.id, admins.roleId))
      .orderBy(asc(admins.createdAt));
    return rows.map(({ admin: a, role, sessions }) => ({
      id: a.id,
      name: a.name,
      email: a.email,
      role: role.key,
      role_id: role.id,
      role_name: role.name,
      status: a.status,
      two_factor: Boolean(a.totpSecretEnc),
      last_login_at: a.lastLoginAt,
      invited_at: a.invitedAt,
      created_at: a.createdAt,
      open_sessions: sessions,
      /** False for yourself and for anyone whose role allows something you can't do. */
      manageable: a.id !== by.id && grantsNoMoreThan(role.permissions, by),
    }));
  }

  async detail(id: string, by: AdminRow) {
    const target = await loadAdmin(this.db, id);
    if (!target) throw new NotFoundException({ error: 'admin_not_found' });
    const inviter = alias(admins, 'inviter');
    const [extra, sessions, activity] = await Promise.all([
      target.invitedByAdmin
        ? this.db
            .select({ name: inviter.name })
            .from(inviter)
            .where(eq(inviter.id, target.invitedByAdmin))
        : [],
      this.sessionRows(id),
      this.db
        .select({
          id: adminAuditLog.id,
          action: adminAuditLog.action,
          target_type: adminAuditLog.targetType,
          target_id: adminAuditLog.targetId,
          details: adminAuditLog.details,
          created_at: adminAuditLog.createdAt,
        })
        .from(adminAuditLog)
        .where(eq(adminAuditLog.adminId, id))
        .orderBy(desc(adminAuditLog.id))
        .limit(ACTIVITY_SHOWN),
    ]);
    return {
      admin: {
        ...toPublic(target),
        role_id: target.role.id,
        status: target.status,
        two_factor: Boolean(target.totpSecretEnc),
        last_login_at: target.lastLoginAt,
        invited_at: target.invitedAt,
        invited_by_name: extra[0]?.name ?? null,
        password_changed_at: target.passwordChangedAt,
        created_at: target.createdAt,
      },
      manageable: target.id !== by.id && grantsNoMoreThan([...target.permissions], by),
      sessions,
      activity,
    };
  }

  /**
   * Adds someone. Without a password they get an emailed invite and stay `invited` until they
   * choose one; with a password (scripts, local setup) they can sign in straight away.
   */
  async invite(input: InviteInput, by: AdminRow, ip: string | null) {
    const role = await this.assignableRole(input.role, by);
    if (input.password) assertAdminPassword(input.password, input.email);
    const passwordHash = input.password ? await this.crypto.hashPassword(input.password) : null;
    let url: string | null = null;
    try {
      const created = await this.db.transaction(async (tx) => {
        const now = new Date();
        const [row] = await tx
          .insert(admins)
          .values({
            name: input.name,
            email: input.email,
            roleId: role.id,
            status: passwordHash ? 'active' : 'invited',
            passwordHash,
            invitedAt: passwordHash ? null : now,
            invitedByAdmin: by.id,
            passwordChangedAt: passwordHash ? now : null,
          })
          .returning({ id: admins.id });
        if (!passwordHash) {
          url = await issueLink(tx, this.crypto, this.appUrl, row!.id, 'invite', by.id);
        }
        await writeAudit(tx, {
          adminId: by.id,
          action: passwordHash ? 'admin.create' : 'admin.invite',
          targetType: 'admin',
          targetId: row!.id,
          details: { email: input.email, role: role.key },
          ip,
        });
        return (await loadAdmin(tx, row!.id))!;
      });
      if (url) {
        this.email.queue(adminEmails.invite(input.email, input.name, by.name, role.name, url));
      }
      return { ...toPublic(created), status: created.status };
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException({ error: 'email_in_use' });
      throw err;
    }
  }

  async update(id: string, input: UserUpdate, by: AdminRow, ip: string | null) {
    if (input.role !== undefined && id === by.id) {
      throw new BadRequestException({ error: 'cannot_change_own_role' });
    }
    const role = input.role !== undefined ? await this.assignableRole(input.role, by) : null;
    return this.db.transaction(async (tx) => {
      const target = await this.manageable(tx, id, by, { allowSelf: input.role === undefined });
      const changesRole = role && role.id !== target.role.id;
      if (changesRole) await this.assertKeepsSuperAdmin(tx, target);
      await tx
        .update(admins)
        .set({
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(changesRole ? { roleId: role.id } : {}),
        })
        .where(eq(admins.id, id));
      await writeAudit(tx, {
        adminId: by.id,
        action: changesRole ? 'admin.role_change' : 'admin.update',
        targetType: 'admin',
        targetId: id,
        details: {
          ...(input.name !== undefined && input.name !== target.name
            ? { name: { from: target.name, to: input.name } }
            : {}),
          ...(changesRole ? { role: { from: target.role.key, to: role.key } } : {}),
        },
        ip,
      });
      return toPublic((await loadAdmin(tx, id))!);
    });
  }

  async setStatus(id: string, status: 'active' | 'disabled', by: AdminRow, ip: string | null) {
    if (id === by.id) throw new BadRequestException({ error: 'cannot_change_own_status' });
    return this.db.transaction(async (tx) => {
      const target = await this.manageable(tx, id, by);
      if (target.status === 'invited') throw new BadRequestException({ error: 'still_invited' });
      if (status === 'disabled') {
        await this.assertKeepsSuperAdmin(tx, target);
        await endSessions(tx, id);
      }
      await tx.update(admins).set({ status }).where(eq(admins.id, id));
      await writeAudit(tx, {
        adminId: by.id,
        action: status === 'active' ? 'admin.enable' : 'admin.disable',
        targetType: 'admin',
        targetId: id,
        ip,
      });
      return toPublic((await loadAdmin(tx, id))!);
    });
  }

  async resetTwoFactor(id: string, by: AdminRow, ip: string | null) {
    return this.db.transaction(async (tx) => {
      await this.manageable(tx, id, by);
      await tx
        .update(admins)
        .set({ totpSecretEnc: null, totpLastStep: null })
        .where(eq(admins.id, id));
      await endSessions(tx, id);
      await writeAudit(tx, {
        adminId: by.id,
        action: 'admin.reset_2fa',
        targetType: 'admin',
        targetId: id,
        ip,
      });
      return toPublic((await loadAdmin(tx, id))!);
    });
  }

  async resendInvite(id: string, by: AdminRow, ip: string | null) {
    const { target, url } = await this.db.transaction(async (tx) => {
      const target = await this.manageable(tx, id, by);
      if (target.status !== 'invited') throw new BadRequestException({ error: 'not_invited' });
      if ((await linksSentLastHour(tx, id, 'invite')) >= ADMIN_AUTH.emailsPerHour) {
        throw new ConflictException({ error: 'too_many_emails' });
      }
      const url = await issueLink(tx, this.crypto, this.appUrl, id, 'invite', by.id);
      await tx.update(admins).set({ invitedAt: new Date() }).where(eq(admins.id, id));
      await writeAudit(tx, {
        adminId: by.id,
        action: 'admin.invite_resent',
        targetType: 'admin',
        targetId: id,
        ip,
      });
      return { target, url };
    });
    this.email.queue(adminEmails.invite(target.email, target.name, by.name, target.role.name, url));
    return { ok: true };
  }

  /** An invite nobody accepted leaves no trace but the audit log, and frees the email. */
  async cancelInvite(id: string, by: AdminRow, ip: string | null) {
    return this.db.transaction(async (tx) => {
      const target = await this.manageable(tx, id, by);
      if (target.status !== 'invited') throw new BadRequestException({ error: 'not_invited' });
      await tx.delete(admins).where(eq(admins.id, id));
      await writeAudit(tx, {
        adminId: by.id,
        action: 'admin.invite_cancelled',
        targetType: 'admin',
        targetId: id,
        details: { email: target.email, role: target.role.key },
        ip,
      });
      return { ok: true };
    });
  }

  async sendPasswordReset(id: string, by: AdminRow, ip: string | null) {
    const { target, url } = await this.db.transaction(async (tx) => {
      const target = await this.manageable(tx, id, by);
      if (target.status !== 'active') throw new BadRequestException({ error: 'not_active' });
      if ((await linksSentLastHour(tx, id, 'password_reset')) >= ADMIN_AUTH.emailsPerHour) {
        throw new ConflictException({ error: 'too_many_emails' });
      }
      const url = await issueLink(tx, this.crypto, this.appUrl, id, 'password_reset', by.id);
      await writeAudit(tx, {
        adminId: by.id,
        action: 'admin.password_reset_sent',
        targetType: 'admin',
        targetId: id,
        ip,
      });
      return { target, url };
    });
    this.email.queue(adminEmails.resetPassword(target.email, url));
    return { ok: true };
  }

  async endAllSessions(id: string, by: AdminRow, ip: string | null) {
    return this.db.transaction(async (tx) => {
      await this.manageable(tx, id, by);
      const ended = await endSessions(tx, id);
      await writeAudit(tx, {
        adminId: by.id,
        action: 'admin.sessions_ended',
        targetType: 'admin',
        targetId: id,
        details: { sessions: ended },
        ip,
      });
      return { ok: true, ended };
    });
  }

  async endSession(adminId: string, sessionId: string, by: AdminRow, ip: string | null) {
    return this.db.transaction(async (tx) => {
      if (adminId !== by.id) await this.manageable(tx, adminId, by);
      const [row] = await tx
        .update(adminSessions)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(adminSessions.id, sessionId),
            eq(adminSessions.adminId, adminId),
            isNull(adminSessions.revokedAt),
          ),
        )
        .returning({ id: adminSessions.id });
      if (!row) throw new NotFoundException({ error: 'session_not_found' });
      await writeAudit(tx, {
        adminId: by.id,
        action: 'admin.session_ended',
        targetType: 'admin',
        targetId: adminId,
        details: { session_id: sessionId },
        ip,
      });
      return { ok: true };
    });
  }

  sessionRows(adminId: string) {
    return this.db
      .select({
        id: adminSessions.id,
        ip: adminSessions.ip,
        user_agent: adminSessions.userAgent,
        created_at: adminSessions.createdAt,
        last_seen_at: adminSessions.lastSeenAt,
        expires_at: adminSessions.expiresAt,
      })
      .from(adminSessions)
      .where(
        and(
          eq(adminSessions.adminId, adminId),
          isNull(adminSessions.revokedAt),
          gt(adminSessions.expiresAt, new Date()),
        ),
      )
      .orderBy(desc(sql`coalesce(${adminSessions.lastSeenAt}, ${adminSessions.createdAt})`));
  }

  private async assignableRole(key: string, by: AdminRow) {
    const role = await this.db.query.adminRoles.findFirst({ where: eq(adminRoles.key, key) });
    if (!role) throw new BadRequestException({ error: 'unknown_role' });
    if (!grantsNoMoreThan(role.permissions, by)) {
      throw new ForbiddenException({ error: 'role_above_yours' });
    }
    return role;
  }

  /** Locks and returns someone `by` may change: not themselves, not above them. */
  private async manageable(tx: Tx, id: string, by: AdminRow, opts: { allowSelf?: boolean } = {}) {
    await tx.select({ id: admins.id }).from(admins).where(eq(admins.id, id)).for('update');
    const target = await loadAdmin(tx, id);
    if (!target) throw new NotFoundException({ error: 'admin_not_found' });
    if (target.id === by.id && !opts.allowSelf) {
      throw new BadRequestException({ error: 'use_my_account' });
    }
    if (target.id !== by.id && !grantsNoMoreThan([...target.permissions], by)) {
      throw new ForbiddenException({ error: 'admin_above_yours' });
    }
    return target;
  }

  /**
   * Refuses a change that would leave no active Super admin, so the team can never lock itself
   * out of roles and users.
   */
  private async assertKeepsSuperAdmin(tx: Tx, target: AdminRow) {
    if (!isSuperAdmin(target) || target.status !== 'active') return;
    // Lock every Super admin row so two simultaneous changes can't both pass this check.
    await tx
      .select({ id: admins.id })
      .from(admins)
      .where(eq(admins.roleId, SYSTEM_ROLE_IDS.super_admin))
      .for('update');
    const [others] = await tx
      .select({ n: count() })
      .from(admins)
      .where(
        and(
          eq(admins.roleId, SYSTEM_ROLE_IDS.super_admin),
          eq(admins.status, 'active'),
          ne(admins.id, target.id),
        ),
      );
    if ((others?.n ?? 0) === 0) throw new ConflictException({ error: 'last_super_admin' });
  }
}
