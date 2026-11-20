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
import {
  machineTrials,
  posDevices,
  plans,
  stores,
  subscriptionPayments,
  subscriptions,
} from '../db/schema/index.js';
import { storeCode } from '../common/store-code.js';
import { recordPresence } from './device-status.js';
import type { PosDevice } from './pos-auth.guard.js';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** What a check-in answers: a signed token, or the store waits for activation (HTTP 202). */
export type IssueResult =
  | { token: string; claims: LicenceClaims }
  | { pending: { status: 'activation_pending'; store_code: string } };

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
    return (await this.stateForMany([storeId], now)).get(storeId)!;
  }

  /** `stateFor` for many stores in three queries, whatever their number. */
  async stateForMany(storeIds: string[], now = new Date()): Promise<Map<string, LicenceState>> {
    const grace = (endsAt: Date) => new Date(endsAt.getTime() + LICENCE.graceHours * HOUR_MS);
    const ids = [...new Set(storeIds)];
    const result = new Map<string, LicenceState>();
    if (ids.length === 0) return result;

    const [storeRows, currentRows, latestRows] = await Promise.all([
      this.db.select().from(stores).where(inArray(stores.id, ids)),
      this.db
        .select({ sub: subscriptions, planCode: plans.code })
        .from(subscriptions)
        .leftJoin(plans, eq(plans.id, subscriptions.planId))
        .where(
          and(
            inArray(subscriptions.storeId, ids),
            inArray(subscriptions.status, [...CURRENT_SUBSCRIPTION_STATUSES]),
          ),
        ),
      this.db
        .selectDistinctOn([subscriptions.storeId])
        .from(subscriptions)
        .where(inArray(subscriptions.storeId, ids))
        .orderBy(subscriptions.storeId, desc(subscriptions.createdAt)),
    ]);
    const storeById = new Map(storeRows.map((s) => [s.id, s]));
    // At most one current subscription per store (subscriptions_one_current_per_store).
    const currentByStore = new Map(currentRows.map((r) => [r.sub.storeId, r]));
    const latestByStore = new Map(latestRows.map((r) => [r.storeId, r]));

    for (const id of ids) {
      const store = storeById.get(id);
      // A blocked (suspended) store keeps billing; only its cloud access stops.
      if (!store || store.status === 'deleted') {
        const endsAt = store?.updatedAt ?? now;
        result.set(id, { status: 'inactive', plan: null, endsAt, graceEndsAt: grace(endsAt) });
        continue;
      }
      const current = currentByStore.get(id);
      if (current) {
        const { sub, planCode } = current;
        const endsAt =
          (sub.status === 'trial' ? sub.trialEndsAt : sub.currentPeriodEnd) ??
          new Date(now.getTime() + 365 * DAY_MS);
        const status: LicenceStatus =
          endsAt <= now ? 'inactive' : sub.status === 'trial' ? 'trial' : 'active';
        result.set(id, { status, plan: planCode, endsAt, graceEndsAt: grace(endsAt) });
        continue;
      }
      const latest = latestByStore.get(id);
      const endsAt =
        latest?.status === 'suspended'
          ? latest.updatedAt
          : (latest?.currentPeriodEnd ?? latest?.trialEndsAt ?? latest?.updatedAt ?? now);
      // Never end in the future for an inactive licence: grace counts from now at the latest.
      const ended = endsAt > now ? now : endsAt;
      const stoppedNow = latest?.status === 'suspended' && latest.graceWaived;
      result.set(id, {
        status: 'inactive',
        plan: null,
        endsAt: ended,
        graceEndsAt: stoppedNow ? ended : grace(ended),
      });
    }
    return result;
  }

  /**
   * Binds the device to its computer on the first check-in and refuses any other computer, so a
   * copied POS database can't run a second till on one subscription.
   */
  async issue(
    device: PosDevice,
    machineIdHash: string,
    appVersion: string,
    now = new Date(),
  ): Promise<IssueResult> {
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
    await recordPresence(this.db, device, now);
    if (!device.machineIdHash) await this.claimTrial(device.storeId, machineIdHash, now);
    if (await this.awaitingActivation(device.storeId)) {
      return { pending: { status: 'activation_pending', store_code: storeCode(device.storeId) } };
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

  /**
   * Records the first store that ran on this computer. A later store on the same computer loses
   * the trial it got at registration and waits for activation, so reinstalling never restarts a
   * trial. Trials or plans an admin set up are never touched.
   */
  private async claimTrial(storeId: string, machineIdHash: string, now: Date): Promise<void> {
    await this.db.transaction(async (tx) => {
      const claimed = await tx
        .insert(machineTrials)
        .values({ machineIdHash, storeId, firstSeenAt: now })
        .onConflictDoNothing()
        .returning({ storeId: machineTrials.storeId });
      if (claimed.length > 0) return;

      const [first] = await tx
        .select({ storeId: machineTrials.storeId, status: stores.status })
        .from(machineTrials)
        .leftJoin(stores, eq(stores.id, machineTrials.storeId))
        .where(eq(machineTrials.machineIdHash, machineIdHash));
      if (first?.storeId === storeId) return;

      const current = await tx.query.subscriptions.findFirst({
        where: and(
          eq(subscriptions.storeId, storeId),
          inArray(subscriptions.status, [...CURRENT_SUBSCRIPTION_STATUSES]),
        ),
      });
      if (current) {
        const automaticTrial =
          current.status === 'trial' && !current.createdByAdmin && !current.planId;
        if (!automaticTrial) return;
        const paid = await tx.query.subscriptionPayments.findFirst({
          where: eq(subscriptionPayments.subscriptionId, current.id),
        });
        if (paid) return;
        await tx
          .update(subscriptions)
          .set({
            status: 'cancelled',
            cancelledAt: now,
            updatedAt: now,
            notes: 'This computer already had a trial with another store',
          })
          .where(eq(subscriptions.id, current.id));
      } else {
        const anyBefore = await tx.query.subscriptions.findFirst({
          where: eq(subscriptions.storeId, storeId),
        });
        if (anyBefore) return;
      }
      await tx
        .update(stores)
        .set({
          activation: 'pending',
          suggestedStoreId: first?.storeId && first.status !== 'deleted' ? first.storeId : null,
          updatedAt: now,
        })
        .where(eq(stores.id, storeId));
    });
  }

  /** A pending store with no current subscription gets no licence until it is activated. */
  private async awaitingActivation(storeId: string): Promise<boolean> {
    const store = await this.db.query.stores.findFirst({ where: eq(stores.id, storeId) });
    if (store?.activation !== 'pending') return false;
    const current = await this.db.query.subscriptions.findFirst({
      where: and(
        eq(subscriptions.storeId, storeId),
        inArray(subscriptions.status, [...CURRENT_SUBSCRIPTION_STATUSES]),
      ),
    });
    return !current;
  }

  /** `base64url(claims JSON) . base64url(Ed25519 signature of the first part)`. */
  private sign(claims: LicenceClaims): string {
    const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
    const signature = sign(null, Buffer.from(body), this.key!).toString('base64url');
    return `${body}.${signature}`;
  }
}
