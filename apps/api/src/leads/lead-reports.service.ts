import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, gte, inArray, isNull, lt, sql, sum } from 'drizzle-orm';
import { LEAD_STAGES, type LeadStage } from '@restrovia/shared';
import type { AdminRow } from '../admin/admin-auth.service.js';
import { DB, type Database } from '../db/database.module.js';
import { admins, leadActivities, leads, leadTasks } from '../db/schema/index.js';
import { CAN_OWN_LEADS, LeadsService, type LeadListFilters } from './leads.service.js';

const IST_OFFSET_MS = 330 * 60_000;
const DAY_MS = 86_400_000;
const BOARD_CARDS = 50;
const CLOSED_CARDS = 20;
/** The pipeline in order; `lost` is a way out, not a step. */
const PIPELINE = LEAD_STAGES.filter((s) => s !== 'lost');
const MANUAL_TYPES = ['note', 'call', 'whatsapp', 'email', 'meeting', 'demo'];

/** Midnight IST of the given YYYY-MM-DD, as a UTC instant. */
const istMidnight = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) - IST_OFFSET_MS);

function istMonthStart(now = new Date()): Date {
  const local = new Date(now.getTime() + IST_OFFSET_MS);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1) - IST_OFFSET_MS);
}

@Injectable()
export class LeadReportsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly leads: LeadsService,
  ) {}

  /** Open leads by stage, plus this month's won and lost, for the pipeline board. */
  async board(filters: Pick<LeadListFilters, 'assigned' | 'source' | 'temperature'>, me: AdminRow) {
    const base = this.leads.listWhere(filters, me);
    const monthStart = istMonthStart();
    const card = {
      id: leads.id,
      business_name: leads.businessName,
      city: leads.city,
      area: leads.area,
      stage: leads.stage,
      temperature: leads.temperature,
      expected_value: leads.expectedValue,
      next_follow_up_at: leads.nextFollowUpAt,
      assigned_admin_name: admins.name,
      store_id: leads.storeId,
    };
    const columns = await Promise.all(
      LEAD_STAGES.map(async (stage) => {
        const closedSince =
          stage === 'won'
            ? gte(leads.wonAt, monthStart)
            : stage === 'lost'
              ? gte(leads.lostAt, monthStart)
              : undefined;
        const where = and(base, eq(leads.stage, stage), closedSince);
        const [cards, totals] = await Promise.all([
          this.db
            .select(card)
            .from(leads)
            .leftJoin(admins, eq(admins.id, leads.assignedAdminId))
            .where(where)
            .orderBy(sql`${leads.nextFollowUpAt} asc nulls last`, desc(leads.updatedAt))
            .limit(closedSince ? CLOSED_CARDS : BOARD_CARDS),
          this.db
            .select({ n: count(), value: sum(leads.expectedValue) })
            .from(leads)
            .where(where),
        ]);
        return {
          stage,
          count: totals[0]?.n ?? 0,
          value: totals[0]?.value ?? '0',
          cards,
        };
      }),
    );
    return { columns, closed_since: monthStart };
  }

  /** Numbers for the leads card on the admin overview. */
  async summary() {
    const now = new Date();
    const open = and(isNull(leads.deletedAt), sql`${leads.stage} not in ('won', 'lost')`);
    const [row] = await this.db
      .select({
        open: sql<number>`count(*) filter (where ${open})::int`,
        new_this_week: sql<number>`count(*) filter (where ${leads.createdAt} >= ${new Date(now.getTime() - 7 * DAY_MS)})::int`,
        overdue: sql<number>`count(*) filter (where ${open} and ${leads.nextFollowUpAt} < ${now})::int`,
        won_this_month: sql<number>`count(*) filter (where ${leads.wonAt} >= ${istMonthStart(now)})::int`,
      })
      .from(leads)
      .where(isNull(leads.deletedAt));
    return row ?? { open: 0, new_this_week: 0, overdue: 0, won_this_month: 0 };
  }

  /** Sales numbers for an inclusive range of IST days. */
  async reports(fromDay: string, toDay: string) {
    const from = istMidnight(fromDay);
    const to = new Date(istMidnight(toDay).getTime() + DAY_MS);
    const createdIn = and(
      isNull(leads.deletedAt),
      gte(leads.createdAt, from),
      lt(leads.createdAt, to),
    );
    const pipeline = sql.raw(`ARRAY[${PIPELINE.map((s) => `'${s}'`).join(',')}]::text[]`);

    const [reached, bySource, lostReasons, weekly, wins, people, activity, overdue] =
      await Promise.all([
        this.db.execute<{ reached: number; n: number }>(sql`
          select reached, count(*)::int as n from (
            select l.id, max(array_position(${pipeline}, x.st)) as reached
            from ${leads} l
            cross join lateral (
              select l.stage as st
              union all select 'new'
              union all select a.meta->>'to' from ${leadActivities} a
                where a.lead_id = l.id and a.type = 'stage_change'
            ) x
            where l.deleted_at is null and l.created_at >= ${from} and l.created_at < ${to}
            group by l.id
          ) t group by reached`),
        this.db
          .select({
            source: leads.source,
            total: count(),
            won: sql<number>`count(*) filter (where ${leads.stage} = 'won')::int`,
            lost: sql<number>`count(*) filter (where ${leads.stage} = 'lost')::int`,
          })
          .from(leads)
          .where(createdIn)
          .groupBy(leads.source)
          .orderBy(desc(count())),
        this.db
          .select({ reason: leads.lostReason, n: count() })
          .from(leads)
          .where(and(isNull(leads.deletedAt), gte(leads.lostAt, from), lt(leads.lostAt, to)))
          .groupBy(leads.lostReason)
          .orderBy(desc(count())),
        this.db
          .select({
            week: sql<string>`to_char(date_trunc('week', ${leads.createdAt} at time zone 'Asia/Kolkata'), 'YYYY-MM-DD')`,
            source: leads.source,
            n: count(),
          })
          .from(leads)
          .where(createdIn)
          .groupBy(sql`1`, leads.source)
          .orderBy(sql`1`),
        this.db
          .select({
            won: count(),
            value: sum(leads.expectedValue),
            median_days: sql<
              number | null
            >`percentile_cont(0.5) within group (order by extract(epoch from ${leads.wonAt} - ${leads.createdAt}) / 86400)`,
          })
          .from(leads)
          .where(and(isNull(leads.deletedAt), gte(leads.wonAt, from), lt(leads.wonAt, to))),
        this.db
          .select({
            id: admins.id,
            name: admins.name,
            // Drizzle leaves single-table column names unqualified, so the subqueries spell them out.
            open: sql<number>`(select count(*)::int from leads l where l.assigned_admin_id = "admins"."id" and l.deleted_at is null and l.stage not in ('won', 'lost'))`,
            won: sql<number>`(select count(*)::int from leads l where l.assigned_admin_id = "admins"."id" and l.deleted_at is null and l.won_at >= ${from} and l.won_at < ${to})`,
          })
          .from(admins)
          .where(CAN_OWN_LEADS)
          .orderBy(asc(admins.name)),
        this.db
          .select({
            admin_id: leadActivities.adminId,
            activities: count(),
            demos: sql<number>`count(*) filter (where ${leadActivities.type} = 'demo')::int`,
          })
          .from(leadActivities)
          .where(
            and(
              inArray(leadActivities.type, MANUAL_TYPES),
              gte(leadActivities.occurredAt, from),
              lt(leadActivities.occurredAt, to),
            ),
          )
          .groupBy(leadActivities.adminId),
        this.db
          .select({ admin_id: leadTasks.assignedAdminId, n: count() })
          .from(leadTasks)
          .innerJoin(leads, eq(leads.id, leadTasks.leadId))
          .where(
            and(isNull(leadTasks.doneAt), isNull(leads.deletedAt), lt(leadTasks.dueAt, new Date())),
          )
          .groupBy(leadTasks.assignedAdminId),
      ]);

    const reachedRows = reached.rows.map((r) => ({ reached: Number(r.reached), n: Number(r.n) }));
    const funnel = PIPELINE.map((stage: LeadStage, i) => ({
      stage,
      count: reachedRows.filter((r) => r.reached >= i + 1).reduce((s, r) => s + r.n, 0),
    }));
    const activityBy = new Map(activity.map((a) => [a.admin_id, a]));
    const overdueBy = new Map(overdue.map((o) => [o.admin_id, o.n]));

    return {
      from: fromDay,
      to: toDay,
      totals: {
        created: funnel[0]?.count ?? 0,
        won: wins[0]?.won ?? 0,
        won_value: wins[0]?.value ?? '0',
        median_days_to_win:
          wins[0]?.median_days == null ? null : Math.round(Number(wins[0].median_days) * 10) / 10,
      },
      funnel,
      by_source: bySource,
      lost_reasons: lostReasons,
      weekly,
      by_admin: people.map((p) => ({
        ...p,
        activities: activityBy.get(p.id)?.activities ?? 0,
        demos: activityBy.get(p.id)?.demos ?? 0,
        overdue_tasks: overdueBy.get(p.id) ?? 0,
      })),
    };
  }
}
