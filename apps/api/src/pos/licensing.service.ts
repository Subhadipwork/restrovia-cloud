import { createPrivateKey, sign, type KeyObject } from 'node:crypto';
import { ConflictException, Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, desc, eq, inArray, isNull, or } from 'drizzle-orm';
import {
  CURRENT_SUBSCRIPTION_STATUSES,
  LICENCE,
  type LicenceClaims,
  type LicenceStatus,
} from '@restrovia/shared';
import type { Env } from '../config/env.js';
import { DB, type Database } from '../db/database.module.js';
import { posDevices, plans, stores, subscriptions } from '../db/schema/index.js';
import type { PosDevice } from './pos-auth.guard.js';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

export type LicenceState = {
  status: LicenceStatus;
  plan: string | null;
  endsAt: Date;
  graceEndsAt: Date;
};

/**
 * Issues the signed licence tokens that Restrovia POS verifies offline. A token says whether the
 * store may bill, until when, and by when the POS must check in again. The private key never
 * leaves this server; the POS only has the public key, so it can check a token but not make one.
 */
@Injectable()
export class LicensingService {
  private readonly key: KeyObject | null;
  private readonly kid: string;

  constructor(
    @Inject(DB) private readonly db: Database,
    config: ConfigService<Env, true>,
  ) {
    const raw = config.get('LICENCE_SIGNING_KEY', { infer: true });
    this.key = raw
      ? createPrivateKey({ key: Buffer.from(raw, 'base64'), format: 'der', type: 'pkcs8' })
      : null;
    this.kid = config.get('LICENCE_KEY_ID', { infer: true });
  }

  /** Whether the store may bill now, from its subscriptions. Inactive stores get the grace period. */
  async stateFor(storeId: string, now = new Date()): Promise<LicenceState> {
    const grace = (endsAt: Date) => new Date(endsAt.getTime() + LICENCE.graceHours * HOUR_MS);
    const store = await this.db.query.stores.findFirst({ where: eq(stores.id, storeId) });
    if (!store || store.status !== 'active') {
      const endsAt = store?.updatedAt ?? now;
      return { status: 'inactive', plan: null, endsAt, graceEndsAt: grace(endsAt) };
    }

    const current = await this.db
      .select({ sub: subscriptions, planCode: plans.code })
      .from(subscriptions)
      .leftJoin(plans, eq(plans.id, subscriptions.planId))
      .where(
        and(
          eq(subscriptions.storeId, storeId),
          inArray(subscriptions.status, [...CURRENT_SUBSCRIPTION_STATUSES]),
        ),
      )
      .limit(1);
    if (current[0]) {
      const { sub, planCode } = current[0];
      const endsAt =
        (sub.status === 'trial' ? sub.trialEndsAt : sub.currentPeriodEnd) ??
        new Date(now.getTime() + 365 * DAY_MS);
      const status: LicenceStatus =
        endsAt <= now ? 'inactive' : sub.status === 'trial' ? 'trial' : 'active';
      return { status, plan: planCode, endsAt, graceEndsAt: grace(endsAt) };
    }

    const latest = await this.db.query.subscriptions.findFirst({
      where: eq(subscriptions.storeId, storeId),
      orderBy: [desc(subscriptions.createdAt)],
    });
    const endsAt =
      latest?.status === 'suspended'
        ? latest.updatedAt
        : (latest?.currentPeriodEnd ?? latest?.trialEndsAt ?? latest?.updatedAt ?? now);
    // Never end in the future for an inactive licence: grace counts from now at the latest.
    const ended = endsAt > now ? now : endsAt;
    return { status: 'inactive', plan: null, endsAt: ended, graceEndsAt: grace(ended) };
  }

  /**
   * Binds the device to its computer on the first check-in and refuses any other computer, so a
   * copied POS database can't run a second till on one subscription.
   */
  async issue(device: PosDevice, machineIdHash: string, appVersion: string, now = new Date()) {
    if (!this.key) throw new ServiceUnavailableException({ error: 'licensing_not_configured' });
    if (device.machineIdHash && device.machineIdHash !== machineIdHash) {
      throw new ConflictException({ error: 'machine_mismatch' });
    }
    const bind = await this.db
      .update(posDevices)
      .set({
        machineIdHash,
        lastLicenceAt: now,
        ...(appVersion ? { appVersion } : {}),
      })
      // Atomic, so two computers racing for the first check-in can't both win.
      .where(
        and(
          eq(posDevices.id, device.id),
          or(isNull(posDevices.machineIdHash), eq(posDevices.machineIdHash, machineIdHash)),
        ),
      )
      .returning({ id: posDevices.id, machine: posDevices.machineIdHash });
    if (bind.length === 0 || bind[0].machine !== machineIdHash) {
      throw new ConflictException({ error: 'machine_mismatch' });
    }

    const state = await this.stateFor(device.storeId, now);
    const claims: LicenceClaims = {
      v: 1,
      kid: this.kid,
      pos_id: device.id,
      store_id: device.storeId,
      pos_hash: device.posHash,
      machine: machineIdHash,
      status: state.status,
      plan: state.plan,
      ends_at: state.endsAt.toISOString(),
      grace_ends_at: state.graceEndsAt.toISOString(),
      iat: now.toISOString(),
      checkin_by: new Date(now.getTime() + LICENCE.checkinDays * DAY_MS).toISOString(),
    };
    return { token: this.sign(claims), claims };
  }

  /** `base64url(claims JSON) . base64url(Ed25519 signature of the first part)`. */
  private sign(claims: LicenceClaims): string {
    const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
    const signature = sign(null, Buffer.from(body), this.key!).toString('base64url');
    return `${body}.${signature}`;
  }
}
