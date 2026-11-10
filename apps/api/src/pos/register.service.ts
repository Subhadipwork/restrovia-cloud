import { ConflictException, GoneException, Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { TRIAL_DAYS, type PosRegisterBody, type PosRegisterResponse } from '@restrovia/shared';
import { CryptoService } from '../crypto/crypto.service.js';
import { DB, type Database } from '../db/database.module.js';
import { posDevices, stores, subscriptions } from '../db/schema/index.js';
import { clean, storeDetailsFrom } from './store-details.js';

export function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } };
  return (e?.cause?.code ?? e?.code) === '23505';
}

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

    const apiKey = this.crypto.randomToken(32);

    try {
      return await this.createStore(body, apiKey, ip);
    } catch (err) {
      // Two simultaneous first registrations from one install: the loser returns the winner's ids.
      if (isUniqueViolation(err)) return this.register(body, ip);
      throw err;
    }
  }

  private createStore(
    body: PosRegisterBody,
    apiKey: string,
    ip: string | null,
  ): Promise<PosRegisterResponse> {
    return this.db.transaction(async (tx) => {
      const [store] = await tx
        .insert(stores)
        .values({
          ...storeDetailsFrom(body.business),
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
