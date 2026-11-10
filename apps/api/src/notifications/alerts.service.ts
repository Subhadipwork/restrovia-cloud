import { ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, lt, ne, sql } from 'drizzle-orm';
import type { NotificationKind } from '@restrovia/shared';
import type { Env } from '../config/env.js';
import { DB, type Database } from '../db/database.module.js';
import {
  dailyStoreStats,
  notificationLog,
  notificationPrefs,
  owners,
  posDevices,
  storeMembers,
  stores,
} from '../db/schema/index.js';
import { EmailService, type EmailMessage } from '../email/email.service.js';
import type { OwnerRow } from '../owner/owner-sessions.js';
import { OwnerReportsService } from '../owner-reports/owner-reports.service.js';
import { addDays } from '../owner-stores/owner-stores.service.js';
import type { StoreRow } from '../owner-stores/store-member.guard.js';
import { deviceLastSeen } from '../pos/device-status.js';
import { LicensingService } from '../pos/licensing.service.js';
import { businessDate } from '../sales/business-date.js';
import { alertEmails, type DailySummary } from './alert-emails.js';
import { NotificationPrefsService } from './notification-prefs.service.js';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
/** A summary goes out this long after the business day ends, so late bills are in it. */
const SUMMARY_DELAY_MS = 30 * MINUTE;
/** After an outage of the API itself, a summary this late is no longer sent. */
const SUMMARY_WINDOW_MS = 6 * HOUR;
const OFFLINE_AFTER_MS = 60 * MINUTE;
/** Same weekday in earlier weeks, and how many of them must show sales at this time of day. */
const USUAL_WEEKS = 4;
const USUAL_WEEKS_NEEDED = 2;
const SUMMARY_TOP_ITEMS = 5;
const LOG_DAYS = 90;

type Recipient = { ownerId: string; email: string };
type StoreRecipients = { store: StoreRow; people: Recipient[] };

/** Alert emails for owners: yesterday's summary, and a POS that went quiet during selling hours. */
@Injectable()
export class AlertsService {
  private readonly log = new Logger(AlertsService.name);
  private readonly appUrl: string;

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly email: EmailService,
    private readonly reports: OwnerReportsService,
    private readonly licensing: LicensingService,
    private readonly prefs: NotificationPrefsService,
    config: ConfigService<Env, true>,
  ) {
    this.appUrl = config.get('OWNER_APP_URL', { infer: true }).replace(/\/$/, '');
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async run(): Promise<void> {
    for (const job of [() => this.sendDailySummaries(), () => this.sendOfflineAlerts()]) {
      try {
        await job();
      } catch (err) {
        this.log.error(`Alert run failed: ${(err as Error).message}`);
      }
    }
  }

  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async purgeLog(): Promise<void> {
    await this.db
      .delete(notificationLog)
      .where(lt(notificationLog.sentAt, new Date(Date.now() - LOG_DAYS * 24 * HOUR)));
  }

  /** One email per café for the business day that just ended; returns how many were sent. */
  async sendDailySummaries(now = new Date()): Promise<number> {
    let sent = 0;
    for (const { store, people } of await this.recipients('daily_summary')) {
      const day = this.endedDay(store, now);
      if (!day) continue;
      const summary = await this.summaryFor(store, day);
      if (!summary) continue;
      for (const person of people) {
        sent += await this.deliver(store.id, person, 'daily_summary', day, () =>
          alertEmails.dailySummary(person.email, summary, this.summaryLinks(store, day, person)),
        );
      }
    }
    return sent;
  }

  /** One email per outage: the POS has been quiet for an hour at a time the café usually sells. */
  async sendOfflineAlerts(now = new Date()): Promise<number> {
    const targets = await this.recipients('store_offline');
    if (targets.length === 0) return 0;
    const seen = await this.db
      .select({ storeId: posDevices.storeId, at: sql<Date | null>`max(${deviceLastSeen})` })
      .from(posDevices)
      .where(
        and(
          inArray(
            posDevices.storeId,
            targets.map((t) => t.store.id),
          ),
          isNull(posDevices.revokedAt),
        ),
      )
      .groupBy(posDevices.storeId);
    const lastSeen = new Map(seen.map((s) => [s.storeId, s.at ? new Date(s.at) : null]));

    let sent = 0;
    for (const { store, people } of targets) {
      const at = lastSeen.get(store.id);
      if (!at || now.getTime() - at.getTime() < OFFLINE_AFTER_MS) continue;
      if (!(await this.usuallySelling(store, now))) continue;
      if (await this.licenceEnded(store.id)) continue;
      const since = new Intl.DateTimeFormat('en-IN', {
        timeZone: store.timezone,
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        hour: 'numeric',
        minute: '2-digit',
      }).format(at);
      for (const person of people) {
        // The last-seen time names the outage, so it is reported once however long it lasts.
        sent += await this.deliver(store.id, person, 'store_offline', at.toISOString(), () =>
          alertEmails.storeOffline(person.email, store.name || 'Your café', since, {
            status: `${this.appUrl}/dashboard/${store.id}/status`,
            turnOff: this.prefs.turnOffUrl(person.ownerId, 'store_offline'),
          }),
        );
      }
    }
    return sent;
  }

  /** The newest day with sales at the owner's first café, sent now so they can see what arrives. */
  async sendSample(owner: OwnerRow): Promise<{ store: string; day: string }> {
    const mine = await this.db
      .select({ store: stores })
      .from(storeMembers)
      .innerJoin(stores, eq(stores.id, storeMembers.storeId))
      .where(and(eq(storeMembers.ownerId, owner.id), ne(stores.status, 'deleted')))
      .orderBy(asc(stores.name));
    for (const { store } of mine) {
      const today = businessDate(new Date(), store.timezone, store.businessDayStart);
      const [latest] = await this.db
        .select({ day: dailyStoreStats.businessDate })
        .from(dailyStoreStats)
        .where(
          and(
            eq(dailyStoreStats.storeId, store.id),
            lt(dailyStoreStats.businessDate, today),
            gt(dailyStoreStats.billsCount, 0),
          ),
        )
        .orderBy(desc(dailyStoreStats.businessDate))
        .limit(1);
      const summary = latest && (await this.summaryFor(store, latest.day, false));
      if (!summary) continue;
      const person = { ownerId: owner.id, email: owner.email };
      await this.email.send(
        alertEmails.dailySummary(
          owner.email,
          summary,
          this.summaryLinks(store, latest.day, person),
          true,
        ),
      );
      return { store: summary.storeName, day: latest.day };
    }
    throw new ConflictException({ error: 'nothing_to_send' });
  }

  /** Active cafés and the people linked to them who want this alert and have a verified email. */
  private async recipients(kind: NotificationKind): Promise<StoreRecipients[]> {
    const wanted =
      kind === 'daily_summary'
        ? eq(notificationPrefs.dailySummaryEmail, true)
        : sql`coalesce(${notificationPrefs.offlineAlert}, true)`;
    const rows = await this.db
      .select({ store: stores, ownerId: owners.id, email: owners.email })
      .from(storeMembers)
      .innerJoin(stores, eq(stores.id, storeMembers.storeId))
      .innerJoin(owners, eq(owners.id, storeMembers.ownerId))
      .leftJoin(notificationPrefs, eq(notificationPrefs.ownerId, owners.id))
      .where(
        and(
          eq(stores.status, 'active'),
          eq(owners.status, 'active'),
          isNotNull(owners.emailVerifiedAt),
          wanted,
        ),
      );
    const byStore = new Map<string, StoreRecipients>();
    for (const row of rows) {
      const entry = byStore.get(row.store.id) ?? { store: row.store, people: [] };
      entry.people.push({ ownerId: row.ownerId, email: row.email });
      byStore.set(row.store.id, entry);
    }
    return [...byStore.values()];
  }

  /** The business day that ended between SUMMARY_DELAY_MS and the end of the send window ago. */
  private endedDay(store: StoreRow, now: Date): string | null {
    const dateAt = (msAgo: number) =>
      businessDate(new Date(now.getTime() - msAgo), store.timezone, store.businessDayStart);
    const ended = addDays(dateAt(SUMMARY_DELAY_MS), -1);
    return dateAt(SUMMARY_DELAY_MS + SUMMARY_WINDOW_MS) === ended ? ended : null;
  }

  /** Null when the licence has ended or, with `skipQuietDays`, nothing happened that day. */
  private async summaryFor(
    store: StoreRow,
    day: string,
    skipQuietDays = true,
  ): Promise<DailySummary | null> {
    if (await this.licenceEnded(store.id)) return null;
    const range = { from: day, to: day };
    const sales = await this.reports.sales(store, range);
    const t = sales.totals;
    if (skipQuietDays && t.bills_count + t.orders_count + t.cancelled_count === 0) return null;
    const lastWeekDay = addDays(day, -7);
    const [lastWeek, items, checks] = await Promise.all([
      this.reports.sales(store, { from: lastWeekDay, to: lastWeekDay }),
      this.reports.items(store, range),
      this.reports.checks(store, range, 1),
    ]);
    return {
      storeName: store.name || 'Your café',
      currency: store.currency ?? 'INR',
      day,
      totals: t,
      lastWeek: lastWeek.totals,
      byType: sales.by_type,
      topItems: items.items.slice(0, SUMMARY_TOP_ITEMS),
      cancelled: { count: checks.cancelled.count, value: checks.cancelled.value },
      discounts: { count: checks.discounts.count, total: checks.discounts.total },
    };
  }

  private summaryLinks(store: StoreRow, day: string, person: Recipient) {
    return {
      day: `${this.appUrl}/dashboard/${store.id}?date=${day}`,
      turnOff: this.prefs.turnOffUrl(person.ownerId, 'daily_summary'),
    };
  }

  /**
   * True when the café had sales in this clock hour and the one before on the same weekday in
   * enough recent weeks. The hour before keeps a café that opens a little late from being reported.
   */
  private async usuallySelling(store: StoreRow, now: Date): Promise<boolean> {
    const today = businessDate(now, store.timezone, store.businessDayStart);
    const hour =
      Number(
        new Intl.DateTimeFormat('en-GB', {
          timeZone: store.timezone,
          hour: '2-digit',
          hourCycle: 'h23',
        }).format(now),
      ) % 24;
    const before = (hour + 23) % 24;
    const rows = await this.db
      .select({ byHour: dailyStoreStats.byHour })
      .from(dailyStoreStats)
      .where(
        and(
          eq(dailyStoreStats.storeId, store.id),
          inArray(
            dailyStoreStats.businessDate,
            Array.from({ length: USUAL_WEEKS }, (_, i) => addDays(today, -7 * (i + 1))),
          ),
        ),
      );
    const selling = rows.filter((r) => Number(r.byHour[hour]) > 0 && Number(r.byHour[before]) > 0);
    return selling.length >= USUAL_WEEKS_NEEDED;
  }

  private async licenceEnded(storeId: string): Promise<boolean> {
    const licence = await this.licensing.stateFor(storeId);
    return licence.status === 'inactive' && licence.graceEndsAt.getTime() < Date.now();
  }

  /**
   * Sends once per (café, person, kind, key): the log row is taken first, and given back if the
   * email fails so the next run tries again.
   */
  private async deliver(
    storeId: string,
    person: Recipient,
    kind: NotificationKind,
    key: string,
    build: () => EmailMessage,
  ): Promise<number> {
    const [claimed] = await this.db
      .insert(notificationLog)
      .values({ storeId, ownerId: person.ownerId, kind, key })
      .onConflictDoNothing()
      .returning({ id: notificationLog.id });
    if (!claimed) return 0;
    try {
      await this.email.send(build());
      return 1;
    } catch (err) {
      this.log.error(`${kind} email for store ${storeId} failed: ${(err as Error).message}`);
      await this.db.delete(notificationLog).where(eq(notificationLog.id, claimed.id));
      return 0;
    }
  }
}
