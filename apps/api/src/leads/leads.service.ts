import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  and,
  arrayContains,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNull,
  lt,
  min,
  ne,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import {
  type LeadBusinessType,
  type LeadCallOutcome,
  type LeadLostReason,
  type LeadManualActivityType,
  type LeadSource,
  type LeadStage,
  type LeadTaskType,
  type LeadTemperature,
} from '@restrovia/shared';
import { type AdminRow, can } from '../admin/admin-auth.service.js';
import type { Page } from '../admin/admin.service.js';
import { writeAudit } from '../admin/audit.js';
import { DB, type Database } from '../db/database.module.js';
import {
  admins,
  leadActivities,
  leadPhotos,
  leads,
  leadTasks,
  plans,
  stores,
  subscriptions,
} from '../db/schema/index.js';
import { toCsv } from './csv.js';
import { prepareImport } from './lead-import.js';
import {
  type BulkInput,
  MAX_PHOTO_BYTES,
  MAX_PHOTOS_PER_LEAD,
  type PHOTO_TYPES,
} from './lead-schemas.js';

export type PhotoInput = { content_type: (typeof PHOTO_TYPES)[number]; data: string };

/** Leading bytes of each accepted image type, so a mislabelled upload is refused. */
const PHOTO_SIGNATURES: Record<PhotoInput['content_type'], (b: Buffer) => boolean> = {
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) =>
    b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/webp': (b) =>
    b.subarray(0, 4).toString('latin1') === 'RIFF' &&
    b.subarray(8, 12).toString('latin1') === 'WEBP',
};

export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

const EXPORT_LIMIT = 10_000;
const EXPORT_COLUMNS = [
  'business_name',
  'contact_name',
  'phone',
  'alt_phone',
  'email',
  'city',
  'area',
  'address',
  'business_type',
  'outlet_count',
  'current_pos',
  'source',
  'source_detail',
  'stage',
  'temperature',
  'owner',
  'plan_interest',
  'expected_value',
  'expected_close_on',
  'next_follow_up_at',
  'last_activity_at',
  'lost_reason',
  'tags',
  'created_at',
  'id',
] as const;

export type LeadFields = {
  business_name: string;
  contact_name?: string | null;
  phone?: string | null;
  alt_phone?: string | null;
  email?: string | null;
  city?: string | null;
  area?: string | null;
  address?: string | null;
  location?: { lat: number; lng: number } | null;
  business_type?: LeadBusinessType | null;
  outlet_count?: number;
  current_pos?: string | null;
  source: LeadSource;
  source_detail?: string | null;
  temperature?: LeadTemperature;
  interested_plan_id?: string | null;
  expected_value?: string | null;
  expected_close_on?: string | null;
  tags?: string[];
};

export type LeadCreate = LeadFields & { assigned_admin_id?: string | null; force?: boolean };
export type LeadUpdate = Partial<LeadFields>;

export type LeadListFilters = {
  q?: string;
  stage?: LeadStage | 'open';
  assigned?: string;
  source?: LeadSource;
  temperature?: LeadTemperature;
  city?: string;
  tag?: string;
  follow_up?: 'overdue' | 'today' | 'week' | 'none';
};

export type StageChange = { stage: LeadStage; lost_reason?: LeadLostReason; note?: string };

export type ActivityInput = {
  type: LeadManualActivityType;
  body: string;
  outcome?: LeadCallOutcome;
  duration_min?: number;
  occurred_at?: string;
};

export type TaskInput = {
  type: LeadTaskType;
  title: string;
  due_at: string;
  assigned_admin_id?: string | null;
};

export type TaskUpdate = Partial<TaskInput> & {
  done?: boolean;
  log?: { body: string; outcome?: LeadCallOutcome };
};

/** Admins who can own leads and be given follow-ups. */
/** Active admins whose role lets them work on leads; only they can own leads and follow-ups. */
export const CAN_OWN_LEADS = sql`"admins"."status" = 'active' and exists (
  select 1 from admin_roles r
  where r.id = "admins"."role_id" and r.permissions && array['*', 'leads.edit']::text[])`;
const OPEN = sql`${leads.stage} not in ('won', 'lost')`;
const offset = (p: Page) => (p.page - 1) * p.perPage;
const likeTerm = (s: string) => `%${s.replace(/[%_\\]/g, '\\$&')}%`;
const notDeleted = isNull(leads.deletedAt);

/** Start of today and of the day after, in IST, where Restrovia's sales team works. */
function istDayBounds(now = new Date()): { start: Date; end: Date } {
  const offsetMs = 330 * 60_000;
  const local = new Date(now.getTime() + offsetMs);
  local.setUTCHours(0, 0, 0, 0);
  const start = new Date(local.getTime() - offsetMs);
  return { start, end: new Date(start.getTime() + 86_400_000) };
}

function columnsFrom(input: LeadUpdate) {
  const out: Partial<typeof leads.$inferInsert> = {};
  const set = <K extends keyof typeof out>(k: K, v: (typeof out)[K] | undefined) => {
    if (v !== undefined) out[k] = v;
  };
  set('businessName', input.business_name);
  set('contactName', input.contact_name);
  set('phoneE164', input.phone);
  set('altPhoneE164', input.alt_phone);
  set('email', input.email);
  set('city', input.city);
  set('area', input.area);
  set('address', input.address);
  if (input.location !== undefined) {
    out.latitude = input.location ? input.location.lat.toFixed(6) : null;
    out.longitude = input.location ? input.location.lng.toFixed(6) : null;
  }
  set('businessType', input.business_type);
  set('outletCount', input.outlet_count);
  set('currentPos', input.current_pos);
  set('source', input.source);
  set('sourceDetail', input.source_detail);
  set('temperature', input.temperature);
  set('interestedPlanId', input.interested_plan_id);
  set('expectedValue', input.expected_value);
  set('expectedCloseOn', input.expected_close_on);
  if (input.tags !== undefined) {
    out.tags = [...new Set(input.tags.map((t) => t.trim().toLowerCase()).filter(Boolean))];
  }
  return out;
}

@Injectable()
export class LeadsService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async assignees() {
    return this.db
      .select({ id: admins.id, name: admins.name })
      .from(admins)
      .where(CAN_OWN_LEADS)
      .orderBy(asc(admins.name));
  }

  async list(filters: LeadListFilters, page: Page, me: AdminRow) {
    const cond = this.listWhere(filters, me);
    const [rows, total] = await Promise.all([
      this.db
        .select({
          id: leads.id,
          business_name: leads.businessName,
          contact_name: leads.contactName,
          phone: leads.phoneE164,
          city: leads.city,
          area: leads.area,
          stage: leads.stage,
          temperature: leads.temperature,
          source: leads.source,
          assigned_admin_id: leads.assignedAdminId,
          assigned_admin_name: admins.name,
          next_follow_up_at: leads.nextFollowUpAt,
          last_activity_at: leads.lastActivityAt,
          expected_value: leads.expectedValue,
          tags: leads.tags,
          created_at: leads.createdAt,
          updated_at: leads.updatedAt,
        })
        .from(leads)
        .leftJoin(admins, eq(admins.id, leads.assignedAdminId))
        .where(cond)
        .orderBy(sql`${leads.nextFollowUpAt} asc nulls last`, desc(leads.updatedAt))
        .limit(page.perPage)
        .offset(offset(page)),
      this.db.select({ n: count() }).from(leads).where(cond),
    ]);
    return { data: rows, total: total[0]?.n ?? 0, page: page.page, per_page: page.perPage };
  }

  /** The list's filters as one condition; deleted leads are always excluded. */
  listWhere(filters: LeadListFilters, me: AdminRow): SQL {
    const where: SQL[] = [notDeleted];
    if (filters.q) {
      const term = likeTerm(filters.q);
      where.push(
        or(
          ilike(leads.businessName, term),
          ilike(leads.contactName, term),
          ilike(leads.phoneE164, term),
          ilike(leads.altPhoneE164, term),
          ilike(sql`${leads.email}::text`, term),
          ilike(leads.city, term),
          ilike(leads.area, term),
        )!,
      );
    }
    if (filters.stage === 'open') where.push(OPEN);
    else if (filters.stage) where.push(eq(leads.stage, filters.stage));
    if (filters.assigned === 'me') where.push(eq(leads.assignedAdminId, me.id));
    else if (filters.assigned === 'none') where.push(isNull(leads.assignedAdminId));
    else if (filters.assigned) where.push(eq(leads.assignedAdminId, filters.assigned));
    if (filters.source) where.push(eq(leads.source, filters.source));
    if (filters.temperature) where.push(eq(leads.temperature, filters.temperature));
    if (filters.city) where.push(sql`lower(${leads.city}) = lower(${filters.city})`);
    if (filters.tag) where.push(arrayContains(leads.tags, [filters.tag.toLowerCase()]));
    if (filters.follow_up) {
      const { start, end } = istDayBounds();
      const now = new Date();
      if (filters.follow_up === 'overdue') where.push(lt(leads.nextFollowUpAt, now));
      if (filters.follow_up === 'today') {
        where.push(gte(leads.nextFollowUpAt, start), lt(leads.nextFollowUpAt, end));
      }
      if (filters.follow_up === 'week') {
        where.push(
          gte(leads.nextFollowUpAt, start),
          lt(leads.nextFollowUpAt, new Date(start.getTime() + 7 * 86_400_000)),
        );
      }
      if (filters.follow_up === 'none') where.push(isNull(leads.nextFollowUpAt), OPEN);
    }
    return and(...where)!;
  }

  /** Other leads and existing stores that look like the same business. */
  async findDuplicates(
    input: Pick<LeadFields, 'business_name' | 'phone' | 'alt_phone' | 'email' | 'city'>,
    excludeId?: string,
  ) {
    const phones = [input.phone, input.alt_phone].filter((p): p is string => !!p);
    const leadMatch: SQL[] = [];
    if (phones.length) {
      leadMatch.push(inArray(leads.phoneE164, phones), inArray(leads.altPhoneE164, phones));
    }
    if (input.email) leadMatch.push(eq(leads.email, input.email));
    if (input.business_name && input.city) {
      leadMatch.push(
        and(
          sql`lower(${leads.businessName}) = lower(${input.business_name.trim()})`,
          sql`lower(${leads.city}) = lower(${input.city.trim()})`,
        )!,
      );
    }
    const storeMatch: SQL[] = [];
    if (phones.length) storeMatch.push(inArray(stores.phone, phones));
    if (input.email) storeMatch.push(eq(stores.email, input.email));

    const [leadRows, storeRows] = await Promise.all([
      leadMatch.length
        ? this.db
            .select({
              id: leads.id,
              business_name: leads.businessName,
              city: leads.city,
              phone: leads.phoneE164,
              email: leads.email,
              stage: leads.stage,
            })
            .from(leads)
            .where(
              and(notDeleted, or(...leadMatch), excludeId ? ne(leads.id, excludeId) : undefined),
            )
            .limit(10)
        : [],
      storeMatch.length
        ? this.db
            .select({ id: stores.id, name: stores.name, phone: stores.phone, email: stores.email })
            .from(stores)
            .where(and(isNull(stores.deletedAt), or(...storeMatch)))
            .limit(10)
        : [],
    ]);
    return { leads: leadRows, stores: storeRows };
  }

  async create(input: LeadCreate, admin: AdminRow, ip: string | null) {
    if (!input.force) {
      const dupes = await this.findDuplicates(input);
      if (dupes.leads.length || dupes.stores.length) {
        throw new ConflictException({ error: 'possible_duplicates', matches: dupes });
      }
    }
    if (input.assigned_admin_id) await this.assertAssignee(this.db, input.assigned_admin_id);
    if (input.interested_plan_id) await this.assertPlan(input.interested_plan_id);
    return this.db.transaction(async (tx) => {
      const now = new Date();
      const [lead] = await tx
        .insert(leads)
        .values({
          ...columnsFrom(input),
          businessName: input.business_name,
          source: input.source,
          assignedAdminId: input.assigned_admin_id ?? null,
          createdByAdmin: admin.id,
          lastActivityAt: now,
        })
        .returning({ id: leads.id });
      await tx.insert(leadActivities).values({
        leadId: lead!.id,
        adminId: admin.id,
        type: 'created',
        meta: { source: input.source },
        occurredAt: now,
      });
      await writeAudit(tx, {
        adminId: admin.id,
        action: 'lead.create',
        targetType: 'lead',
        targetId: lead!.id,
        details: {
          business_name: input.business_name,
          source: input.source,
          forced: !!input.force,
        },
        ip,
      });
      return { id: lead!.id };
    });
  }

  async detail(id: string) {
    const [row] = await this.db
      .select({ lead: leads, assigned_admin_name: admins.name, plan_name: plans.name })
      .from(leads)
      .leftJoin(admins, eq(admins.id, leads.assignedAdminId))
      .leftJoin(plans, eq(plans.id, leads.interestedPlanId))
      .where(and(eq(leads.id, id), notDeleted));
    if (!row) throw new NotFoundException({ error: 'lead_not_found' });
    const { lead } = row;
    const [tasks, store, createdBy, duplicates, photos] = await Promise.all([
      this.taskRows(and(eq(leadTasks.leadId, id), isNull(leadTasks.doneAt))!),
      lead.storeId ? this.storeSummary(lead.storeId) : null,
      lead.createdByAdmin
        ? this.db.query.admins.findFirst({
            where: eq(admins.id, lead.createdByAdmin),
            columns: { name: true },
          })
        : undefined,
      this.findDuplicates(
        {
          business_name: lead.businessName,
          phone: lead.phoneE164,
          alt_phone: lead.altPhoneE164,
          email: lead.email,
          city: lead.city,
        },
        id,
      ),
      this.photoList(id),
    ]);
    return {
      lead,
      photos,
      assigned_admin_name: row.assigned_admin_name,
      plan_name: row.plan_name,
      created_by_name: createdBy?.name ?? null,
      open_tasks: tasks,
      store,
      duplicates: {
        leads: duplicates.leads,
        stores: duplicates.stores.filter((s) => s.id !== lead.storeId),
      },
    };
  }

  async update(id: string, input: LeadUpdate, admin: AdminRow, ip: string | null) {
    if (input.interested_plan_id) await this.assertPlan(input.interested_plan_id);
    return this.db.transaction(async (tx) => {
      await this.lockLead(tx, id);
      await tx
        .update(leads)
        .set({ ...columnsFrom(input), updatedAt: new Date() })
        .where(eq(leads.id, id));
      await writeAudit(tx, {
        adminId: admin.id,
        action: 'lead.update',
        targetType: 'lead',
        targetId: id,
        details: { fields: Object.keys(input) },
        ip,
      });
      return { ok: true };
    });
  }

  async changeStage(id: string, input: StageChange, admin: AdminRow, ip: string | null) {
    if (input.stage === 'lost' && !input.lost_reason) {
      throw new BadRequestException({ error: 'lost_reason_required' });
    }
    return this.db.transaction((tx) => this.stageIn(tx, id, input, admin, ip));
  }

  private async stageIn(
    tx: Tx,
    id: string,
    input: StageChange,
    admin: AdminRow,
    ip: string | null,
  ) {
    const lead = await this.lockLead(tx, id);
    if (lead.stage === input.stage) return { ok: true, stage: lead.stage, changed: false };
    if (input.stage === 'won' && !lead.storeId && !can(admin, 'leads.win_override')) {
      throw new ConflictException({ error: 'won_needs_store' });
    }
    const now = new Date();
    await tx
      .update(leads)
      .set({
        stage: input.stage,
        lostReason: input.stage === 'lost' ? input.lost_reason! : null,
        lostAt: input.stage === 'lost' ? now : null,
        wonAt: input.stage === 'won' ? now : null,
        lastActivityAt: now,
        updatedAt: now,
      })
      .where(eq(leads.id, id));
    await tx.insert(leadActivities).values({
      leadId: id,
      adminId: admin.id,
      type: 'stage_change',
      body: input.note ?? '',
      meta: {
        from: lead.stage,
        to: input.stage,
        ...(input.lost_reason && input.stage === 'lost' ? { lost_reason: input.lost_reason } : {}),
      },
      occurredAt: now,
    });
    await writeAudit(tx, {
      adminId: admin.id,
      action: 'lead.stage',
      targetType: 'lead',
      targetId: id,
      details: { from: lead.stage, to: input.stage, lost_reason: input.lost_reason ?? null },
      ip,
    });
    return { ok: true, stage: input.stage, changed: true };
  }

  async assign(id: string, adminId: string | null, admin: AdminRow, ip: string | null) {
    return this.db.transaction(async (tx) => {
      const to = adminId ? await this.assertAssignee(tx, adminId) : null;
      return this.assignIn(tx, id, adminId, to?.name ?? null, admin, ip);
    });
  }

  private async assignIn(
    tx: Tx,
    id: string,
    adminId: string | null,
    toName: string | null,
    admin: AdminRow,
    ip: string | null,
  ) {
    const lead = await this.lockLead(tx, id);
    if (lead.assignedAdminId === adminId) return { ok: true, changed: false };
    const now = new Date();
    await tx
      .update(leads)
      .set({ assignedAdminId: adminId, updatedAt: now })
      .where(eq(leads.id, id));
    await tx.insert(leadActivities).values({
      leadId: id,
      adminId: admin.id,
      type: 'assignment',
      meta: { from: lead.assignedAdminId, to: adminId, to_name: toName },
      occurredAt: now,
    });
    await writeAudit(tx, {
      adminId: admin.id,
      action: 'lead.assign',
      targetType: 'lead',
      targetId: id,
      details: { from: lead.assignedAdminId, to: adminId },
      ip,
    });
    return { ok: true, changed: true };
  }

  /** Folds `duplicateId` into `id`: timeline and follow-ups move, empty fields are filled in. */
  async merge(id: string, duplicateId: string, admin: AdminRow, ip: string | null) {
    if (id === duplicateId) throw new BadRequestException({ error: 'cannot_merge_itself' });
    return this.db.transaction(async (tx) => {
      // Lock in id order so two opposite merges can't deadlock.
      const [first, second] = [id, duplicateId].toSorted();
      const a = await this.lockLead(tx, first!);
      const b = await this.lockLead(tx, second!);
      const keep = a.id === id ? a : b;
      const dup = a.id === id ? b : a;
      if (keep.storeId && dup.storeId && keep.storeId !== dup.storeId) {
        throw new ConflictException({ error: 'both_have_stores' });
      }
      const fill = <T>(mine: T | null, theirs: T | null) => mine ?? theirs;
      const phones = [keep.phoneE164, keep.altPhoneE164, dup.phoneE164, dup.altPhoneE164].filter(
        (p, i, all): p is string => !!p && all.indexOf(p) === i,
      );
      const now = new Date();
      await tx
        .update(leads)
        .set({ storeId: null, deletedAt: now, nextFollowUpAt: null })
        .where(eq(leads.id, dup.id));
      await tx
        .update(leads)
        .set({
          contactName: fill(keep.contactName, dup.contactName),
          phoneE164: phones[0] ?? null,
          altPhoneE164: phones[1] ?? null,
          email: fill(keep.email, dup.email),
          city: fill(keep.city, dup.city),
          area: fill(keep.area, dup.area),
          address: fill(keep.address, dup.address),
          latitude: keep.latitude ?? dup.latitude,
          longitude: keep.latitude ? keep.longitude : dup.longitude,
          businessType: fill(keep.businessType, dup.businessType),
          currentPos: fill(keep.currentPos, dup.currentPos),
          sourceDetail: fill(keep.sourceDetail, dup.sourceDetail),
          interestedPlanId: fill(keep.interestedPlanId, dup.interestedPlanId),
          expectedValue: fill(keep.expectedValue, dup.expectedValue),
          expectedCloseOn: fill(keep.expectedCloseOn, dup.expectedCloseOn),
          assignedAdminId: fill(keep.assignedAdminId, dup.assignedAdminId),
          storeId: fill(keep.storeId, dup.storeId),
          consentAt: fill(keep.consentAt, dup.consentAt),
          outletCount: Math.max(keep.outletCount, dup.outletCount),
          tags: [...new Set([...keep.tags, ...dup.tags])],
          lastActivityAt: now,
          updatedAt: now,
        })
        .where(eq(leads.id, keep.id));
      await tx
        .update(leadActivities)
        .set({ leadId: keep.id })
        .where(eq(leadActivities.leadId, dup.id));
      await tx.update(leadTasks).set({ leadId: keep.id }).where(eq(leadTasks.leadId, dup.id));
      await tx.update(leadPhotos).set({ leadId: keep.id }).where(eq(leadPhotos.leadId, dup.id));
      await tx.insert(leadActivities).values({
        leadId: keep.id,
        adminId: admin.id,
        type: 'merged',
        meta: { duplicate_id: dup.id, duplicate_name: dup.businessName },
        occurredAt: now,
      });
      await this.syncFollowUp(tx, keep.id);
      await writeAudit(tx, {
        adminId: admin.id,
        action: 'lead.merge',
        targetType: 'lead',
        targetId: keep.id,
        details: { duplicate_id: dup.id, duplicate_name: dup.businessName },
        ip,
      });
      return { ok: true, id: keep.id };
    });
  }

  async bulk(input: BulkInput, admin: AdminRow, ip: string | null) {
    if (input.action === 'delete' && !can(admin, 'leads.delete')) {
      throw new ForbiddenException({ error: 'permission_denied', needed: ['leads.delete'] });
    }
    if (input.action === 'stage' && input.stage === 'lost' && !input.lost_reason) {
      throw new BadRequestException({ error: 'lost_reason_required' });
    }
    const ids = [...new Set(input.ids)].toSorted();
    return this.db.transaction(async (tx) => {
      const to =
        input.action === 'assign' && input.admin_id
          ? await this.assertAssignee(tx, input.admin_id)
          : null;
      let changed = 0;
      for (const id of ids) {
        let result: { changed: boolean };
        if (input.action === 'assign') {
          result = await this.assignIn(tx, id, input.admin_id, to?.name ?? null, admin, ip);
        } else if (input.action === 'stage') {
          result = await this.stageIn(
            tx,
            id,
            { stage: input.stage, lost_reason: input.lost_reason },
            admin,
            ip,
          );
        } else if (input.action === 'tag') {
          result = await this.tagIn(tx, id, input.tag.toLowerCase(), admin, ip);
        } else {
          result = await this.removeIn(tx, id, admin, ip);
        }
        if (result.changed) changed++;
      }
      return { ok: true, changed };
    });
  }

  private async tagIn(tx: Tx, id: string, tag: string, admin: AdminRow, ip: string | null) {
    const lead = await this.lockLead(tx, id);
    if (lead.tags.includes(tag)) return { changed: false };
    await tx
      .update(leads)
      .set({ tags: [...lead.tags, tag], updatedAt: new Date() })
      .where(eq(leads.id, id));
    await writeAudit(tx, {
      adminId: admin.id,
      action: 'lead.update',
      targetType: 'lead',
      targetId: id,
      details: { fields: ['tags'], added_tag: tag },
      ip,
    });
    return { changed: true };
  }

  async importCsv(
    input: { csv: string; dry_run: boolean; include_duplicates: boolean },
    admin: AdminRow,
    ip: string | null,
  ) {
    const plan = await prepareImport(this.db, input.csv);
    const toInsert = plan.rows.filter((r) => input.include_duplicates || !r.duplicate_of);
    const summary = {
      total: plan.total,
      valid: plan.rows.length,
      invalid: plan.invalid,
      duplicates: plan.rows
        .filter((r) => r.duplicate_of)
        .map((r) => ({ row: r.row, business_name: r.input.business_name, of: r.duplicate_of })),
      unknown_columns: plan.unknownColumns,
      will_import: toInsert.length,
    };
    if (input.dry_run || toInsert.length === 0) return { ...summary, imported: 0 };
    await this.db.transaction(async (tx) => {
      const now = new Date();
      const created = await tx
        .insert(leads)
        .values(
          toInsert.map((r) => ({
            ...columnsFrom(r.input),
            businessName: r.input.business_name,
            source: r.input.source,
            assignedAdminId: r.input.assigned_admin_id ?? null,
            createdByAdmin: admin.id,
            lastActivityAt: now,
          })),
        )
        .returning({ id: leads.id, source: leads.source });
      await tx.insert(leadActivities).values(
        created.map((c) => ({
          leadId: c.id,
          adminId: admin.id,
          type: 'created',
          meta: { source: c.source, imported: true },
          occurredAt: now,
        })),
      );
      await writeAudit(tx, {
        adminId: admin.id,
        action: 'lead.import',
        targetType: 'lead',
        details: {
          rows: plan.total,
          imported: created.length,
          invalid: plan.invalid.length,
          duplicates: summary.duplicates.length,
          duplicates_included: input.include_duplicates,
        },
        ip,
      });
    });
    return { ...summary, imported: toInsert.length };
  }

  async exportCsv(filters: LeadListFilters, admin: AdminRow, ip: string | null) {
    const rows = await this.db
      .select({
        lead: leads,
        owner: admins.name,
        plan: plans.name,
      })
      .from(leads)
      .leftJoin(admins, eq(admins.id, leads.assignedAdminId))
      .leftJoin(plans, eq(plans.id, leads.interestedPlanId))
      .where(this.listWhere(filters, admin))
      .orderBy(desc(leads.createdAt))
      .limit(EXPORT_LIMIT);
    await writeAudit(this.db, {
      adminId: admin.id,
      action: 'lead.export',
      targetType: 'lead',
      details: { filters, rows: rows.length },
      ip,
    });
    return toCsv(
      EXPORT_COLUMNS,
      rows.map(({ lead: l, owner, plan }) => [
        l.businessName,
        l.contactName,
        l.phoneE164,
        l.altPhoneE164,
        l.email,
        l.city,
        l.area,
        l.address,
        l.businessType,
        l.outletCount,
        l.currentPos,
        l.source,
        l.sourceDetail,
        l.stage,
        l.temperature,
        owner,
        plan,
        l.expectedValue,
        l.expectedCloseOn,
        l.nextFollowUpAt,
        l.lastActivityAt,
        l.lostReason,
        l.tags.join(';'),
        l.createdAt,
        l.id,
      ]),
    );
  }

  async linkStore(id: string, storeId: string | null, admin: AdminRow, ip: string | null) {
    if (!storeId && !can(admin, 'leads.delete')) {
      throw new ForbiddenException({ error: 'permission_denied', needed: ['leads.delete'] });
    }
    return this.db.transaction(async (tx) => {
      const lead = await this.lockLead(tx, id);
      if (storeId) {
        const store = await tx.query.stores.findFirst({
          where: and(eq(stores.id, storeId), isNull(stores.deletedAt)),
          columns: { id: true },
        });
        if (!store) throw new NotFoundException({ error: 'store_not_found' });
        const taken = await tx.query.leads.findFirst({
          where: and(eq(leads.storeId, storeId), ne(leads.id, id), notDeleted),
          columns: { id: true },
        });
        if (taken) throw new ConflictException({ error: 'store_has_lead', lead_id: taken.id });
      }
      await tx.update(leads).set({ storeId, updatedAt: new Date() }).where(eq(leads.id, id));
      await writeAudit(tx, {
        adminId: admin.id,
        action: storeId ? 'lead.link_store' : 'lead.unlink_store',
        targetType: 'lead',
        targetId: id,
        details: { store_id: storeId ?? lead.storeId },
        ip,
      });
      return { ok: true };
    });
  }

  async remove(id: string, admin: AdminRow, ip: string | null) {
    return this.db.transaction((tx) => this.removeIn(tx, id, admin, ip));
  }

  private async removeIn(tx: Tx, id: string, admin: AdminRow, ip: string | null) {
    const lead = await this.lockLead(tx, id);
    await tx
      .update(leads)
      .set({ deletedAt: new Date(), nextFollowUpAt: null })
      .where(eq(leads.id, id));
    await writeAudit(tx, {
      adminId: admin.id,
      action: 'lead.delete',
      targetType: 'lead',
      targetId: id,
      details: { business_name: lead.businessName },
      ip,
    });
    return { ok: true, changed: true };
  }

  async activities(id: string, page: Page) {
    await this.assertExists(id);
    const cond = eq(leadActivities.leadId, id);
    const [rows, total] = await Promise.all([
      this.db
        .select({
          id: leadActivities.id,
          type: leadActivities.type,
          outcome: leadActivities.outcome,
          body: leadActivities.body,
          meta: leadActivities.meta,
          occurred_at: leadActivities.occurredAt,
          admin_name: admins.name,
        })
        .from(leadActivities)
        .leftJoin(admins, eq(admins.id, leadActivities.adminId))
        .where(cond)
        .orderBy(desc(leadActivities.occurredAt), desc(leadActivities.createdAt))
        .limit(page.perPage)
        .offset(offset(page)),
      this.db.select({ n: count() }).from(leadActivities).where(cond),
    ]);
    return { data: rows, total: total[0]?.n ?? 0, page: page.page, per_page: page.perPage };
  }

  async addActivity(id: string, input: ActivityInput, admin: AdminRow, ip: string | null) {
    const occurredAt = input.occurred_at ? new Date(input.occurred_at) : new Date();
    if (occurredAt.getTime() > Date.now() + 5 * 60_000) {
      throw new BadRequestException({ error: 'activity_in_future' });
    }
    return this.db.transaction(async (tx) => {
      const lead = await this.lockLead(tx, id);
      const [row] = await tx
        .insert(leadActivities)
        .values({
          leadId: id,
          adminId: admin.id,
          type: input.type,
          body: input.body,
          outcome: input.type === 'call' ? (input.outcome ?? null) : null,
          meta: input.duration_min ? { duration_min: input.duration_min } : {},
          occurredAt,
        })
        .returning({ id: leadActivities.id });
      await this.touch(tx, id, lead.lastActivityAt, occurredAt);
      await writeAudit(tx, {
        adminId: admin.id,
        action: 'lead.activity',
        targetType: 'lead',
        targetId: id,
        details: { type: input.type, activity_id: row!.id },
        ip,
      });
      return { id: row!.id };
    });
  }

  async listTasks(
    filters: { assigned?: string; due?: 'overdue' | 'today' | 'week' | 'open' },
    me: AdminRow,
  ) {
    const where: SQL[] = [isNull(leadTasks.doneAt), notDeleted];
    const assigned = filters.assigned ?? 'me';
    if (assigned === 'me') where.push(eq(leadTasks.assignedAdminId, me.id));
    else if (assigned === 'none') where.push(isNull(leadTasks.assignedAdminId));
    else if (assigned !== 'all') where.push(eq(leadTasks.assignedAdminId, assigned));
    const { start, end } = istDayBounds();
    if (filters.due === 'overdue') where.push(lt(leadTasks.dueAt, new Date()));
    if (filters.due === 'today') where.push(lt(leadTasks.dueAt, end));
    if (filters.due === 'week') {
      where.push(lt(leadTasks.dueAt, new Date(start.getTime() + 7 * 86_400_000)));
    }
    return this.taskRows(and(...where)!, 500);
  }

  async addTask(id: string, input: TaskInput, admin: AdminRow, ip: string | null) {
    return this.db.transaction(async (tx) => {
      const lead = await this.lockLead(tx, id);
      if (input.assigned_admin_id) await this.assertAssignee(tx, input.assigned_admin_id);
      const [task] = await tx
        .insert(leadTasks)
        .values({
          leadId: id,
          type: input.type,
          title: input.title,
          dueAt: new Date(input.due_at),
          assignedAdminId:
            input.assigned_admin_id === undefined
              ? (lead.assignedAdminId ?? admin.id)
              : input.assigned_admin_id,
          createdByAdmin: admin.id,
        })
        .returning({ id: leadTasks.id });
      await this.syncFollowUp(tx, id);
      await writeAudit(tx, {
        adminId: admin.id,
        action: 'lead.task_add',
        targetType: 'lead',
        targetId: id,
        details: { task_id: task!.id, type: input.type, due_at: input.due_at },
        ip,
      });
      return { id: task!.id };
    });
  }

  async updateTask(taskId: string, input: TaskUpdate, admin: AdminRow, ip: string | null) {
    return this.db.transaction(async (tx) => {
      const task = await this.lockTask(tx, taskId);
      const lead = await this.lockLead(tx, task.leadId);
      if (input.assigned_admin_id) await this.assertAssignee(tx, input.assigned_admin_id);
      const now = new Date();
      const completing = input.done === true && !task.doneAt;
      await tx
        .update(leadTasks)
        .set({
          ...(input.type ? { type: input.type } : {}),
          ...(input.title ? { title: input.title } : {}),
          ...(input.due_at ? { dueAt: new Date(input.due_at) } : {}),
          ...(input.assigned_admin_id !== undefined
            ? { assignedAdminId: input.assigned_admin_id }
            : {}),
          ...(completing ? { doneAt: now, doneByAdmin: admin.id } : {}),
          ...(input.done === false ? { doneAt: null, doneByAdmin: null } : {}),
          updatedAt: now,
        })
        .where(eq(leadTasks.id, taskId));
      if (completing) {
        const logType = input.log ? taskActivityType(input.type ?? task.type) : 'task_done';
        await tx.insert(leadActivities).values({
          leadId: task.leadId,
          adminId: admin.id,
          type: logType,
          body: input.log?.body ?? '',
          outcome: logType === 'call' ? (input.log?.outcome ?? null) : null,
          meta: { task_id: taskId, task_title: input.title ?? task.title },
          occurredAt: now,
        });
        await this.touch(tx, task.leadId, lead.lastActivityAt, now);
      }
      await this.syncFollowUp(tx, task.leadId);
      await writeAudit(tx, {
        adminId: admin.id,
        action: completing ? 'lead.task_done' : 'lead.task_update',
        targetType: 'lead',
        targetId: task.leadId,
        details: { task_id: taskId, fields: Object.keys(input) },
        ip,
      });
      return { ok: true };
    });
  }

  async removeTask(taskId: string, admin: AdminRow, ip: string | null) {
    return this.db.transaction(async (tx) => {
      const task = await this.lockTask(tx, taskId);
      await this.lockLead(tx, task.leadId);
      await tx.delete(leadTasks).where(eq(leadTasks.id, taskId));
      await this.syncFollowUp(tx, task.leadId);
      await writeAudit(tx, {
        adminId: admin.id,
        action: 'lead.task_delete',
        targetType: 'lead',
        targetId: task.leadId,
        details: { task_id: taskId, title: task.title },
        ip,
      });
      return { ok: true };
    });
  }

  private taskRows(where: SQL, limit = 100) {
    return this.db
      .select({
        id: leadTasks.id,
        lead_id: leadTasks.leadId,
        lead_name: leads.businessName,
        lead_phone: leads.phoneE164,
        lead_stage: leads.stage,
        type: leadTasks.type,
        title: leadTasks.title,
        due_at: leadTasks.dueAt,
        assigned_admin_id: leadTasks.assignedAdminId,
        assigned_admin_name: admins.name,
        done_at: leadTasks.doneAt,
      })
      .from(leadTasks)
      .innerJoin(leads, eq(leads.id, leadTasks.leadId))
      .leftJoin(admins, eq(admins.id, leadTasks.assignedAdminId))
      .where(where)
      .orderBy(asc(leadTasks.dueAt))
      .limit(limit);
  }

  async addPhoto(id: string, input: PhotoInput, admin: AdminRow, ip: string | null) {
    const bytes = Buffer.from(input.data, 'base64');
    if (bytes.length === 0 || bytes.length > MAX_PHOTO_BYTES) {
      throw new BadRequestException({ error: 'photo_too_large' });
    }
    if (!PHOTO_SIGNATURES[input.content_type](bytes)) {
      throw new BadRequestException({ error: 'photo_not_image' });
    }
    return this.db.transaction(async (tx) => {
      await this.lockLead(tx, id);
      const [{ n } = { n: 0 }] = await tx
        .select({ n: count() })
        .from(leadPhotos)
        .where(eq(leadPhotos.leadId, id));
      if (n >= MAX_PHOTOS_PER_LEAD) throw new ConflictException({ error: 'too_many_photos' });
      const [photo] = await tx
        .insert(leadPhotos)
        .values({
          leadId: id,
          contentType: input.content_type,
          bytes,
          sizeBytes: bytes.length,
          createdByAdmin: admin.id,
        })
        .returning({ id: leadPhotos.id });
      await writeAudit(tx, {
        adminId: admin.id,
        action: 'lead.photo_add',
        targetType: 'lead',
        targetId: id,
        details: { photo_id: photo!.id, size_bytes: bytes.length },
        ip,
      });
      return { id: photo!.id };
    });
  }

  async photo(id: string, photoId: string) {
    const [row] = await this.db
      .select({ contentType: leadPhotos.contentType, bytes: leadPhotos.bytes })
      .from(leadPhotos)
      .innerJoin(leads, eq(leads.id, leadPhotos.leadId))
      .where(and(eq(leadPhotos.id, photoId), eq(leadPhotos.leadId, id), notDeleted));
    if (!row) throw new NotFoundException({ error: 'photo_not_found' });
    return row;
  }

  async removePhoto(id: string, photoId: string, admin: AdminRow, ip: string | null) {
    return this.db.transaction(async (tx) => {
      await this.lockLead(tx, id);
      const removed = await tx
        .delete(leadPhotos)
        .where(and(eq(leadPhotos.id, photoId), eq(leadPhotos.leadId, id)))
        .returning({ id: leadPhotos.id });
      if (!removed.length) throw new NotFoundException({ error: 'photo_not_found' });
      await writeAudit(tx, {
        adminId: admin.id,
        action: 'lead.photo_remove',
        targetType: 'lead',
        targetId: id,
        details: { photo_id: photoId },
        ip,
      });
      return { ok: true };
    });
  }

  private photoList(leadId: string) {
    return this.db
      .select({
        id: leadPhotos.id,
        content_type: leadPhotos.contentType,
        size_bytes: leadPhotos.sizeBytes,
        created_at: leadPhotos.createdAt,
      })
      .from(leadPhotos)
      .where(eq(leadPhotos.leadId, leadId))
      .orderBy(asc(leadPhotos.createdAt));
  }

  private async storeSummary(storeId: string) {
    const store = await this.db.query.stores.findFirst({
      where: eq(stores.id, storeId),
      columns: { id: true, name: true, status: true, phone: true },
    });
    if (!store) return null;
    const sub = await this.db.query.subscriptions.findFirst({
      where: eq(subscriptions.storeId, storeId),
      orderBy: desc(subscriptions.createdAt),
      columns: { status: true },
    });
    return { ...store, licence_status: sub?.status ?? null };
  }

  /** Row-locks the lead for the rest of the transaction; 404 when missing or deleted. */
  private async lockLead(tx: Tx, id: string) {
    const [lead] = await tx
      .select()
      .from(leads)
      .where(and(eq(leads.id, id), notDeleted))
      .for('update');
    if (!lead) throw new NotFoundException({ error: 'lead_not_found' });
    return lead;
  }

  private async lockTask(tx: Tx, id: string) {
    const [task] = await tx.select().from(leadTasks).where(eq(leadTasks.id, id)).for('update');
    if (!task) throw new NotFoundException({ error: 'task_not_found' });
    return task;
  }

  private async assertExists(id: string) {
    const found = await this.db.query.leads.findFirst({
      where: and(eq(leads.id, id), notDeleted),
      columns: { id: true },
    });
    if (!found) throw new NotFoundException({ error: 'lead_not_found' });
  }

  private async assertAssignee(tx: Tx | Database, adminId: string) {
    const [found] = await tx
      .select({ id: admins.id, name: admins.name })
      .from(admins)
      .where(and(eq(admins.id, adminId), CAN_OWN_LEADS));
    if (!found) throw new BadRequestException({ error: 'invalid_assignee' });
    return found;
  }

  private async assertPlan(planId: string) {
    const found = await this.db.query.plans.findFirst({
      where: eq(plans.id, planId),
      columns: { id: true },
    });
    if (!found) throw new BadRequestException({ error: 'unknown_plan' });
  }

  private async touch(tx: Tx, leadId: string, last: Date | null, at: Date) {
    const next = !last || at > last ? at : last;
    await tx
      .update(leads)
      .set({ lastActivityAt: next, updatedAt: new Date() })
      .where(eq(leads.id, leadId));
  }

  private async syncFollowUp(tx: Tx, leadId: string) {
    const [row] = await tx
      .select({ next: min(leadTasks.dueAt) })
      .from(leadTasks)
      .where(and(eq(leadTasks.leadId, leadId), isNull(leadTasks.doneAt)));
    await tx
      .update(leads)
      .set({ nextFollowUpAt: row?.next ?? null })
      .where(eq(leads.id, leadId));
  }
}

/** The timeline type for a completed task that the admin chose to log. */
function taskActivityType(type: string): LeadManualActivityType {
  return type === 'other' ? 'note' : (type as LeadManualActivityType);
}
