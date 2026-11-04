import { ConflictException, GoneException, Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import {
  DEFAULT_STORE_TIMEZONE,
  TRIAL_DAYS,
  type PosRegisterBody,
  type PosRegisterResponse,
} from '@restrovia/shared';
import { isValidTimezone } from '../common/pos-values.js';
import { CryptoService } from '../crypto/crypto.service.js';
import { DB, type Database } from '../db/database.module.js';
import { posDevices, stores, subscriptions } from '../db/schema/index.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } };
  return (e?.cause?.code ?? e?.code) === '23505';
}

const clean = (value: string | null | undefined, max: number) => {
  const trimmed = (value ?? '').trim().slice(0, max);
  return trimmed || null;
};

@Injectable()
export class RegisterService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly crypto: CryptoService,
  ) {}

  /**
   * Creates a store, its first device and a trial on the first call. A repeat call from the same
   * install (same pos_hash and device secret) returns the same ids and key, so a POS that lost its
   * settings can recover them; a repeat call with a different device secret is refused.
   */
  async register(body: PosRegisterBody, ip: string | null): Promise<PosRegisterResponse> {
    const existing = await this.db.query.posDevices.findFirst({
      where: eq(posDevices.posHash, body.pos_hash),
    });
    if (existing) {
      if (existing.revokedAt) throw new GoneException({ error: 'device_revoked' });
      const secretMatches = this.crypto.safeEqual(
        Buffer.from(existing.deviceSecretHash),
        Buffer.from(body.device_secret_hash),
      );
      if (!secretMatches) throw new ConflictException({ error: 'pos_hash_already_registered' });
      return {
        api_key: this.crypto.decrypt(existing.apiKeyEnc).toString(),
        pos_id: existing.id,
        store_id: existing.storeId,
      };
    }

    const business = body.business;
    const timezone =
      business.timezone && isValidTimezone(business.timezone)
        ? business.timezone
        : DEFAULT_STORE_TIMEZONE;
    const country = (business.country ?? '').toUpperCase();
    const currency = (business.currency ?? '').toUpperCase();
    const email = clean(business.email, 255);
    const apiKey = this.crypto.randomToken(32);

    try {
      return await this.createStore(body, apiKey, { timezone, country, currency, email }, ip);
    } catch (err) {
      // Two simultaneous first registrations from one install: the loser returns the winner's ids.
      if (isUniqueViolation(err)) return this.register(body, ip);
      throw err;
    }
  }

  private createStore(
    body: PosRegisterBody,
    apiKey: string,
    fields: { timezone: string; country: string; currency: string; email: string | null },
    ip: string | null,
  ): Promise<PosRegisterResponse> {
    const { business } = body;
    const { timezone, country, currency, email } = fields;
    return this.db.transaction(async (tx) => {
      const [store] = await tx
        .insert(stores)
        .values({
          name: clean(business.name, 200) ?? '',
          contactName: clean(business.contact_name, 200),
          email: email && EMAIL_RE.test(email) ? email : null,
          phone: clean(business.phone, 40),
          country: /^[A-Z]{2}$/.test(country) ? country : null,
          currency: /^[A-Z]{3}$/.test(currency) ? currency : null,
          timezone,
          address: clean(business.address, 500),
          storeType: clean(body.store_type, 40) ?? 'cafe',
        })
        .returning({ id: stores.id });

      const [device] = await tx
        .insert(posDevices)
        .values({
          storeId: store.id,
          posHash: body.pos_hash,
          apiKeyLookup: this.crypto.sha256(apiKey),
          apiKeyEnc: this.crypto.encrypt(apiKey),
          deviceSecretHash: body.device_secret_hash,
          deviceName: clean(body.device_name, 200),
          platform: clean(body.platform, 40),
          arch: clean(body.arch, 40),
          appVersion: clean(body.app_version, 40),
          runMode: clean(body.run_mode, 40),
          installSource: clean(body.install_source, 40),
          lastIp: ip,
        })
        .returning({ id: posDevices.id });

      await tx.insert(subscriptions).values({
        storeId: store.id,
        status: 'trial',
        trialEndsAt: new Date(Date.now() + TRIAL_DAYS * 86_400_000),
      });

      return { api_key: apiKey, pos_id: device.id, store_id: store.id };
    });
  }
}
