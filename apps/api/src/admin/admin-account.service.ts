import { BadRequestException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { eq } from 'drizzle-orm';
import { ADMIN_AUTH } from '@restrovia/shared';
import type { Env } from '../config/env.js';
import { CryptoService } from '../crypto/crypto.service.js';
import { verifyTotp } from '../crypto/totp.js';
import { DB, type Database } from '../db/database.module.js';
import { admins } from '../db/schema/index.js';
import { EmailService } from '../email/email.service.js';
import { type AdminRow, loadAdmin, toPublic } from './admin-auth.service.js';
import { adminEmails, assertAdminPassword } from './admin-emails.js';
import {
  endSessions,
  invalidLink,
  issueLink,
  linkOwner,
  linksSentLastHour,
  useLink,
} from './admin-tokens.js';
import { AdminUsersService } from './admin-users.service.js';
import { writeAudit } from './audit.js';

/** What an admin does for themselves: accept an invite, reset a password, manage their account. */
@Injectable()
export class AdminAccountService {
  private readonly appUrl: string;
  private readonly dummyHash: Promise<string>;

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly crypto: CryptoService,
    private readonly email: EmailService,
    private readonly users: AdminUsersService,
    config: ConfigService<Env, true>,
  ) {
    this.appUrl = config.get('ADMIN_APP_URL', { infer: true }).replace(/\/$/, '');
    this.dummyHash = crypto.hashPassword(crypto.randomToken());
  }

  /** Name and email shown on the accept-invite page. */
  async inviteInfo(token: string) {
    const { admin } = await linkOwner(this.db, this.crypto, token, 'invite');
    if (admin.status !== 'invited') throw invalidLink();
    return { name: admin.name, email: admin.email };
  }

  /** Sets the first password; the admin then signs in and sets up 2FA as usual. */
  async acceptInvite(token: string, password: string, ip: string | null) {
    const { admin } = await linkOwner(this.db, this.crypto, token, 'invite');
    if (admin.status !== 'invited') throw invalidLink();
    // Checked before the link is used, so a refused password doesn't cost the invite.
    assertAdminPassword(password, admin.email);
    const passwordHash = await this.crypto.hashPassword(password);
    await this.db.transaction(async (tx) => {
      await useLink(tx, this.crypto, token, 'invite');
      await tx
        .update(admins)
        .set({ passwordHash, status: 'active', passwordChangedAt: new Date() })
        .where(eq(admins.id, admin.id));
      await writeAudit(tx, {
        adminId: admin.id,
        action: 'admin.invite_accepted',
        targetType: 'admin',
        targetId: admin.id,
        ip,
      });
    });
    return { ok: true, email: admin.email };
  }

  /** Always answers the same way, so it never shows whether an email belongs to an admin. */
  async forgotPassword(email: string, ip: string | null) {
    const admin = await this.db.query.admins.findFirst({ where: eq(admins.email, email) });
    if (!admin || admin.status !== 'active') {
      await this.dummyHash;
      return;
    }
    if (
      (await linksSentLastHour(this.db, admin.id, 'password_reset')) >= ADMIN_AUTH.emailsPerHour
    ) {
      return;
    }
    const url = await this.db.transaction(async (tx) => {
      const url = await issueLink(tx, this.crypto, this.appUrl, admin.id, 'password_reset', null);
      await writeAudit(tx, {
        adminId: admin.id,
        action: 'admin.password_reset_requested',
        targetType: 'admin',
        targetId: admin.id,
        ip,
      });
      return url;
    });
    this.email.queue(adminEmails.resetPassword(admin.email, url));
  }

  /** New password from an emailed link; every session ends. 2FA stays as it was. */
  async resetPassword(token: string, password: string, ip: string | null) {
    const { admin } = await linkOwner(this.db, this.crypto, token, 'password_reset');
    if (admin.status !== 'active') throw invalidLink();
    assertAdminPassword(password, admin.email);
    const passwordHash = await this.crypto.hashPassword(password);
    await this.db.transaction(async (tx) => {
      await useLink(tx, this.crypto, token, 'password_reset');
      await tx
        .update(admins)
        .set({ passwordHash, passwordChangedAt: new Date() })
        .where(eq(admins.id, admin.id));
      await endSessions(tx, admin.id);
      await writeAudit(tx, {
        adminId: admin.id,
        action: 'admin.password_reset',
        targetType: 'admin',
        targetId: admin.id,
        ip,
      });
    });
    this.email.queue(adminEmails.passwordChanged(admin.email));
    return { ok: true };
  }

  async account(me: AdminRow, sessionId: string) {
    const sessions = await this.users.sessionRows(me.id);
    return {
      admin: {
        ...toPublic(me),
        two_factor: Boolean(me.totpSecretEnc),
        last_login_at: me.lastLoginAt,
        password_changed_at: me.passwordChangedAt,
        created_at: me.createdAt,
      },
      sessions: sessions.map((s) => ({ ...s, current: s.id === sessionId })),
    };
  }

  async rename(me: AdminRow, name: string, ip: string | null) {
    await this.db.transaction(async (tx) => {
      await tx.update(admins).set({ name }).where(eq(admins.id, me.id));
      await writeAudit(tx, {
        adminId: me.id,
        action: 'admin.update',
        targetType: 'admin',
        targetId: me.id,
        details: { name: { from: me.name, to: name } },
        ip,
      });
    });
    return toPublic((await loadAdmin(this.db, me.id))!);
  }

  /** Needs the current password; other sessions end, this one stays signed in. */
  async changePassword(
    me: AdminRow,
    sessionId: string,
    current: string,
    next: string,
    ip: string | null,
  ) {
    await this.assertPassword(me, current, ip);
    if (current === next) throw new BadRequestException({ error: 'same_password' });
    assertAdminPassword(next, me.email);
    const passwordHash = await this.crypto.hashPassword(next);
    const ended = await this.db.transaction(async (tx) => {
      await tx
        .update(admins)
        .set({ passwordHash, passwordChangedAt: new Date() })
        .where(eq(admins.id, me.id));
      const ended = await endSessions(tx, me.id, sessionId);
      await writeAudit(tx, {
        adminId: me.id,
        action: 'admin.password_changed',
        targetType: 'admin',
        targetId: me.id,
        details: { other_sessions_ended: ended },
        ip,
      });
      return ended;
    });
    this.email.queue(adminEmails.passwordChanged(me.email));
    return { ok: true, other_sessions_ended: ended };
  }

  /** Turns 2FA off; needs the current password and a code from the authenticator. */
  async disableTwoFactor(me: AdminRow, password: string, code: string, ip: string | null) {
    await this.assertPassword(me, password, ip);
    const secret = me.totpSecretEnc ? this.crypto.decrypt(me.totpSecretEnc).toString() : null;
    if (!secret || verifyTotp(secret, code) === null) {
      throw new UnauthorizedException({ error: 'invalid_code' });
    }
    await this.db.transaction(async (tx) => {
      await tx
        .update(admins)
        .set({ totpSecretEnc: null, totpLastStep: null })
        .where(eq(admins.id, me.id));
      await writeAudit(tx, {
        adminId: me.id,
        action: 'admin.2fa_disabled',
        targetType: 'admin',
        targetId: me.id,
        ip,
      });
    });
    return { ok: true };
  }

  private async assertPassword(me: AdminRow, password: string, ip: string | null) {
    if (me.passwordHash && (await this.crypto.verifyPassword(me.passwordHash, password))) return;
    await writeAudit(this.db, {
      adminId: me.id,
      action: 'admin.password_check_failed',
      targetType: 'admin',
      targetId: me.id,
      ip,
    });
    throw new UnauthorizedException({ error: 'wrong_password' });
  }
}
