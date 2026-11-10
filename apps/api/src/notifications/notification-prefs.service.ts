import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { eq } from 'drizzle-orm';
import { NOTIFICATION_KINDS, type NotificationKind } from '@restrovia/shared';
import type { Env } from '../config/env.js';
import { CryptoService } from '../crypto/crypto.service.js';
import { DB, type Database } from '../db/database.module.js';
import { notificationPrefs, owners } from '../db/schema/index.js';
import { recordEvent, type OwnerRow, type RequestContext } from '../owner/owner-sessions.js';

export type AlertPrefs = { daily_summary_email: boolean; offline_alert: boolean };

const COLUMN = {
  daily_summary: 'dailySummaryEmail',
  store_offline: 'offlineAlert',
} as const satisfies Record<NotificationKind, keyof typeof notificationPrefs.$inferInsert>;

/** Which alert emails an owner wants; an owner with no row has the table's defaults. */
@Injectable()
export class NotificationPrefsService {
  private readonly appUrl: string;

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly crypto: CryptoService,
    config: ConfigService<Env, true>,
  ) {
    this.appUrl = config.get('OWNER_APP_URL', { infer: true }).replace(/\/$/, '');
  }

  async get(owner: OwnerRow): Promise<AlertPrefs & { email_verified: boolean }> {
    const row = await this.db.query.notificationPrefs.findFirst({
      where: eq(notificationPrefs.ownerId, owner.id),
    });
    return {
      daily_summary_email: row?.dailySummaryEmail ?? false,
      offline_alert: row?.offlineAlert ?? true,
      email_verified: owner.emailVerifiedAt !== null,
    };
  }

  async update(owner: OwnerRow, input: Partial<AlertPrefs>, ctx: RequestContext) {
    await this.db.transaction(async (tx) => {
      const values = {
        ...(input.daily_summary_email !== undefined
          ? { dailySummaryEmail: input.daily_summary_email }
          : {}),
        ...(input.offline_alert !== undefined ? { offlineAlert: input.offline_alert } : {}),
        updatedAt: new Date(),
      };
      await tx
        .insert(notificationPrefs)
        .values({ ownerId: owner.id, ...values })
        .onConflictDoUpdate({ target: notificationPrefs.ownerId, set: values });
      await recordEvent(tx, owner.id, 'owner.alerts_changed', ctx);
    });
    return this.get(owner);
  }

  /** The link at the bottom of an alert email; it turns that one kind off without signing in. */
  turnOffUrl(ownerId: string, kind: NotificationKind): string {
    const token = this.crypto.encrypt(`${ownerId}:${kind}`).toString('base64url');
    return `${this.appUrl}/unsubscribe?token=${token}`;
  }

  async turnOff(token: string): Promise<{ kind: NotificationKind }> {
    const invalid = () => new BadRequestException({ error: 'invalid_token' });
    let ownerId: string;
    let kind: string;
    try {
      [ownerId, kind] = this.crypto.decrypt(Buffer.from(token, 'base64url')).toString().split(':');
    } catch {
      throw invalid();
    }
    if (!NOTIFICATION_KINDS.includes(kind as NotificationKind)) throw invalid();
    const column = COLUMN[kind as NotificationKind];
    const owner = await this.db.query.owners.findFirst({ where: eq(owners.id, ownerId) });
    if (!owner) throw invalid();
    await this.db
      .insert(notificationPrefs)
      .values({ ownerId, [column]: false })
      .onConflictDoUpdate({
        target: notificationPrefs.ownerId,
        set: { [column]: false, updatedAt: new Date() },
      });
    return { kind: kind as NotificationKind };
  }
}
