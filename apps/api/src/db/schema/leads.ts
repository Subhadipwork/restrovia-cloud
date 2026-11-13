import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  LEAD_ACTIVITY_TYPES,
  LEAD_BUSINESS_TYPES,
  LEAD_CALL_OUTCOMES,
  LEAD_LOST_REASONS,
  LEAD_SOURCES,
  LEAD_STAGES,
  LEAD_TASK_TYPES,
  LEAD_TEMPERATURES,
} from '@restrovia/shared';
import { admins } from './admin.js';
import { plans } from './billing.js';
import { citext, createdAt, oneOf, tstz, updatedAt } from './columns.js';
import { stores } from './stores.js';

/** A café or restaurant Restrovia is trying to sign up. Soft-deleted rows are hidden everywhere. */
export const leads = pgTable(
  'leads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    businessName: text('business_name').notNull(),
    contactName: text('contact_name'),
    phoneE164: text('phone_e164'),
    altPhoneE164: text('alt_phone_e164'),
    email: citext('email'),
    city: text('city'),
    area: text('area'),
    address: text('address'),
    businessType: text('business_type'),
    outletCount: integer('outlet_count').notNull().default(1),
    currentPos: text('current_pos'),
    source: text('source').notNull(),
    sourceDetail: text('source_detail'),
    utm: jsonb('utm').$type<Record<string, string>>().notNull().default({}),
    stage: text('stage').notNull().default('new'),
    temperature: text('temperature').notNull().default('warm'),
    assignedAdminId: uuid('assigned_admin_id').references(() => admins.id, {
      onDelete: 'set null',
    }),
    interestedPlanId: uuid('interested_plan_id').references(() => plans.id, {
      onDelete: 'set null',
    }),
    /** Expected monthly value in INR. */
    expectedValue: numeric('expected_value', { precision: 10, scale: 2 }),
    expectedCloseOn: date('expected_close_on'),
    /** Earliest open task's due time, kept in step by the leads service. */
    nextFollowUpAt: tstz('next_follow_up_at'),
    lastActivityAt: tstz('last_activity_at'),
    storeId: uuid('store_id').references(() => stores.id, { onDelete: 'set null' }),
    lostReason: text('lost_reason'),
    wonAt: tstz('won_at'),
    lostAt: tstz('lost_at'),
    tags: text('tags')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    consentAt: tstz('consent_at'),
    createdByAdmin: uuid('created_by_admin').references(() => admins.id, {
      onDelete: 'set null',
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: tstz('deleted_at'),
  },
  (t) => [
    check('leads_stage_check', oneOf(t.stage, LEAD_STAGES)),
    check('leads_source_check', oneOf(t.source, LEAD_SOURCES)),
    check('leads_temperature_check', oneOf(t.temperature, LEAD_TEMPERATURES)),
    check(
      'leads_business_type_check',
      sql`${t.businessType} is null or ${oneOf(t.businessType, LEAD_BUSINESS_TYPES)}`,
    ),
    check(
      'leads_lost_reason_check',
      sql`${t.lostReason} is null or ${oneOf(t.lostReason, LEAD_LOST_REASONS)}`,
    ),
    check('leads_outlet_count_check', sql`${t.outletCount} >= 1`),
    check('leads_lost_needs_reason', sql`${t.stage} <> 'lost' or ${t.lostReason} is not null`),
    index('leads_stage_idx').on(t.stage, t.updatedAt),
    index('leads_assigned_idx').on(t.assignedAdminId, t.stage),
    index('leads_follow_up_idx')
      .on(t.nextFollowUpAt)
      .where(sql`${t.deletedAt} is null`),
    index('leads_phone_idx').on(t.phoneE164),
    index('leads_alt_phone_idx').on(t.altPhoneE164),
    index('leads_email_idx').on(t.email),
    index('leads_store_idx').on(t.storeId),
    index('leads_name_lower_idx').on(sql`lower(${t.businessName})`),
    index('leads_city_lower_idx').on(sql`lower(${t.city})`),
    index('leads_tags_idx').using('gin', t.tags),
  ],
);

/** The lead's timeline. Rows are never edited; a wrong note is corrected by a new one. */
export const leadActivities = pgTable(
  'lead_activities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    leadId: uuid('lead_id')
      .notNull()
      .references(() => leads.id, { onDelete: 'cascade' }),
    adminId: uuid('admin_id').references(() => admins.id, { onDelete: 'set null' }),
    type: text('type').notNull(),
    outcome: text('outcome'),
    body: text('body').notNull().default(''),
    meta: jsonb('meta').$type<Record<string, unknown>>().notNull().default({}),
    occurredAt: tstz('occurred_at').notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [
    check('lead_activities_type_check', oneOf(t.type, LEAD_ACTIVITY_TYPES)),
    check(
      'lead_activities_outcome_check',
      sql`${t.outcome} is null or ${oneOf(t.outcome, LEAD_CALL_OUTCOMES)}`,
    ),
    index('lead_activities_lead_idx').on(t.leadId, t.occurredAt),
  ],
);

export const leadTasks = pgTable(
  'lead_tasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    leadId: uuid('lead_id')
      .notNull()
      .references(() => leads.id, { onDelete: 'cascade' }),
    assignedAdminId: uuid('assigned_admin_id').references(() => admins.id, {
      onDelete: 'set null',
    }),
    type: text('type').notNull(),
    title: text('title').notNull(),
    dueAt: tstz('due_at').notNull(),
    doneAt: tstz('done_at'),
    doneByAdmin: uuid('done_by_admin').references(() => admins.id, { onDelete: 'set null' }),
    createdByAdmin: uuid('created_by_admin').references(() => admins.id, {
      onDelete: 'set null',
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('lead_tasks_type_check', oneOf(t.type, LEAD_TASK_TYPES)),
    index('lead_tasks_assigned_idx').on(t.assignedAdminId, t.doneAt, t.dueAt),
    index('lead_tasks_lead_idx').on(t.leadId),
  ],
);
