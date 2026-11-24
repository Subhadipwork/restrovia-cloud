import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { and, eq, gt, inArray, isNotNull, lte, ne, or, isNull, sql } from 'drizzle-orm';
import type { Env } from '../config/env.js';
import { DB, type Database } from '../db/database.module.js';
import { addons, owners, storeAddons, storeMembers, stores } from '../db/schema/index.js';
import { EmailService } from '../email/email.service.js';
import { addonEmails } from './addon-requests.js';

const DAY_MS = 86_400_000;
/** How long before the end the owners hear about it. */
const TRIAL_NOTICE_DAYS = 3;
const PAID_NOTICE_DAYS = 7;

const endsAt = sql<Date>`case when ${storeAddons.status} = 'trial' then ${storeAddons.trialEndsAt} else ${storeAddons.currentPeriodEnd} end`;

/**
 * Once a day, emails a café's owners when an add-on's trial ends within 3 days or its paid period
 * within 7. Each end date is reminded once (`store_addons.reminded_for`), so a renewal that moves
 * the end date gets its own reminder. Cancelled add-ons are not reminded: the owner chose that.
 */
@Injectable()
export class AddonRemindersService {
  private readonly log = new Logger(AddonRemindersService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly email: EmailService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /** 10:00 in India. */
  @Cron('0 30 4 * * *')
  async run(): Promise<void> {
    try {
      const sent = await this.sendReminders();
      if (sent) this.log.log(`Sent ${sent} add-on reminders`);
    } catch (err) {
      this.log.error(`Add-on reminders failed: ${(err as Error).message}`);
    }
  }

  async sendReminders(now = new Date()): Promise<number> {
    const rows = await this.db
      .select({
        id: storeAddons.id,
        status: storeAddons.status,
        endsAt,
        storeId: stores.id,
        storeName: stores.name,
        timezone: stores.timezone,
        addonName: addons.name,
      })
      .from(storeAddons)
      .innerJoin(addons, eq(addons.id, storeAddons.addonId))
      .innerJoin(stores, eq(stores.id, storeAddons.storeId))
      .where(
        and(
          inArray(storeAddons.status, ['trial', 'active']),
          eq(stores.status, 'active'),
          isNotNull(endsAt),
          gt(endsAt, now),
          lte(endsAt, new Date(now.getTime() + PAID_NOTICE_DAYS * DAY_MS)),
          or(isNull(storeAddons.remindedFor), ne(storeAddons.remindedFor, endsAt)),
        ),
      );
    const due = rows.filter(
      (r) =>
        r.status !== 'trial' ||
        new Date(r.endsAt).getTime() - now.getTime() <= TRIAL_NOTICE_DAYS * DAY_MS,
    );
    if (due.length === 0) return 0;

    const people = await this.db
      .select({ storeId: storeMembers.storeId, email: owners.email })
      .from(storeMembers)
      .innerJoin(owners, eq(owners.id, storeMembers.ownerId))
      .where(
        and(
          inArray(storeMembers.storeId, [...new Set(due.map((r) => r.storeId))]),
          eq(storeMembers.role, 'owner'),
          eq(owners.status, 'active'),
          isNotNull(owners.emailVerifiedAt),
        ),
      );
    const ownerAppUrl = this.config.get('OWNER_APP_URL', { infer: true });
    let sent = 0;
    for (const row of due) {
      const end = new Date(row.endsAt);
      const endsOn = end.toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: row.timezone,
      });
      for (const person of people.filter((p) => p.storeId === row.storeId)) {
        this.email.queue(
          addonEmails.endingSoon(
            person.email,
            {
              storeId: row.storeId,
              storeName: row.storeName,
              addonName: row.addonName,
              trial: row.status === 'trial',
              endsOn,
            },
            ownerAppUrl,
          ),
        );
        sent += 1;
      }
      await this.db.update(storeAddons).set({ remindedFor: end }).where(eq(storeAddons.id, row.id));
    }
    return sent;
  }
}
