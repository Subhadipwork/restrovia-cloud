import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { and, eq, gt, isNull } from 'drizzle-orm';
import type { AdminRole } from '@restrovia/shared';
import { CryptoService } from '../crypto/crypto.service.js';
import { DB, type Database } from '../db/database.module.js';
import { admins, adminSessions } from '../db/schema/index.js';
import { writeAudit } from './audit.js';
import { generateTotpSecret, otpauthUrl, verifyTotp } from '../crypto/totp.js';

export const ADMIN_SESSION_HOURS = 12;
const SETUP_TOKEN_MINUTES = 10;

export type AdminRow = typeof admins.$inferSelect;
export type AdminPublic = { id: string; name: string; email: string; role: AdminRole };

export type LoginResult =
  | { status: 'ok'; admin: AdminPublic; token: string }
  | { status: 'setup_required'; setup_token: string; secret: string; otpauth_url: string };

export const toPublic = (a: AdminRow): AdminPublic => ({
  id: a.id,
  name: a.name,
  email: a.email,
  role: a.role as AdminRole,
});

const invalid = () => new UnauthorizedException({ error: 'invalid_credentials' });

/**
 * Admin sign-in: email + password + authenticator code. An admin without 2FA is sent through
 * setup first and gets no session until a code from the new secret is confirmed.
 */
@Injectable()
export class AdminAuthService {
  private readonly dummyHash: Promise<string>;

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly crypto: CryptoService,
  ) {
    // Used when the email is unknown, so a wrong email takes as long as a wrong password.
    this.dummyHash = crypto.hashPassword(crypto.randomToken());
  }

  async login(
    email: string,
    password: string,
    code: string | undefined,
    ip: string | null,
  ): Promise<LoginResult> {
    const admin = await this.db.query.admins.findFirst({ where: eq(admins.email, email) });
    if (!admin || admin.status !== 'active') {
      await this.crypto.verifyPassword(await this.dummyHash, password);
      throw invalid();
    }
    if (!(await this.crypto.verifyPassword(admin.passwordHash, password))) {
      await writeAudit(this.db, { adminId: admin.id, action: 'admin.login_failed', ip });
      throw invalid();
    }

    if (!admin.totpSecretEnc) {
      const secret = generateTotpSecret();
      const setupToken = this.crypto
        .encrypt(
          JSON.stringify({
            adminId: admin.id,
            secret,
            exp: Date.now() + SETUP_TOKEN_MINUTES * 60_000,
          }),
        )
        .toString('base64url');
      return {
        status: 'setup_required',
        setup_token: setupToken,
        secret,
        otpauth_url: otpauthUrl(secret, admin.email),
      };
    }

    if (!code) throw new UnauthorizedException({ error: 'code_required' });
    const secret = this.crypto.decrypt(admin.totpSecretEnc).toString();
    const step = verifyTotp(secret, code);
    if (step === null || (admin.totpLastStep !== null && step <= admin.totpLastStep)) {
      await writeAudit(this.db, {
        adminId: admin.id,
        action: 'admin.login_failed',
        details: { reason: 'code' },
        ip,
      });
      throw new UnauthorizedException({ error: 'invalid_code' });
    }

    const token = await this.db.transaction(async (tx) => {
      await tx
        .update(admins)
        .set({ totpLastStep: step, lastLoginAt: new Date() })
        .where(eq(admins.id, admin.id));
      await writeAudit(tx, { adminId: admin.id, action: 'admin.login', ip });
      return this.createSession(tx, admin.id, ip);
    });
    return { status: 'ok', admin: toPublic(admin), token };
  }

  /** Confirms the first authenticator code, saves the secret and signs the admin in. */
  async completeSetup(setupToken: string, code: string, ip: string | null) {
    let payload: { adminId: string; secret: string; exp: number };
    try {
      payload = JSON.parse(this.crypto.decrypt(Buffer.from(setupToken, 'base64url')).toString());
    } catch {
      throw new UnauthorizedException({ error: 'invalid_setup_token' });
    }
    if (payload.exp < Date.now()) throw new UnauthorizedException({ error: 'setup_expired' });
    const admin = await this.db.query.admins.findFirst({ where: eq(admins.id, payload.adminId) });
    if (!admin || admin.status !== 'active' || admin.totpSecretEnc) {
      throw new UnauthorizedException({ error: 'invalid_setup_token' });
    }
    const step = verifyTotp(payload.secret, code);
    if (step === null) throw new UnauthorizedException({ error: 'invalid_code' });

    const token = await this.db.transaction(async (tx) => {
      await tx
        .update(admins)
        .set({
          totpSecretEnc: this.crypto.encrypt(payload.secret),
          totpLastStep: step,
          lastLoginAt: new Date(),
        })
        .where(eq(admins.id, admin.id));
      await writeAudit(tx, { adminId: admin.id, action: 'admin.2fa_enabled', ip });
      await writeAudit(tx, { adminId: admin.id, action: 'admin.login', ip });
      return this.createSession(tx, admin.id, ip);
    });
    return { admin: toPublic(admin), token };
  }

  async sessionAdmin(token: string): Promise<{ admin: AdminRow; sessionId: string } | null> {
    if (!token) return null;
    const session = await this.db.query.adminSessions.findFirst({
      where: and(
        eq(adminSessions.tokenHash, this.crypto.sha256(token)),
        isNull(adminSessions.revokedAt),
        gt(adminSessions.expiresAt, new Date()),
      ),
    });
    if (!session) return null;
    const admin = await this.db.query.admins.findFirst({ where: eq(admins.id, session.adminId) });
    if (!admin || admin.status !== 'active') return null;
    return { admin, sessionId: session.id };
  }

  async logout(sessionId: string, adminId: string, ip: string | null) {
    await this.db.transaction(async (tx) => {
      await tx
        .update(adminSessions)
        .set({ revokedAt: new Date() })
        .where(eq(adminSessions.id, sessionId));
      await writeAudit(tx, { adminId, action: 'admin.logout', ip });
    });
  }

  private async createSession(
    tx: Parameters<Parameters<Database['transaction']>[0]>[0],
    adminId: string,
    ip: string | null,
  ) {
    const token = this.crypto.randomToken(32);
    await tx.insert(adminSessions).values({
      adminId,
      tokenHash: this.crypto.sha256(token),
      ip,
      expiresAt: new Date(Date.now() + ADMIN_SESSION_HOURS * 3_600_000),
    });
    return token;
  }
}
