import { z } from 'zod';
import {
  LEAD_BUSINESS_TYPES,
  LEAD_CALL_OUTCOMES,
  LEAD_LOST_REASONS,
  LEAD_MANUAL_ACTIVITY_TYPES,
  LEAD_SOURCES,
  LEAD_STAGES,
  LEAD_TASK_TYPES,
  LEAD_TEMPERATURES,
} from '@restrovia/shared';

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v || null)
    .nullable();
export const phone = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{7,14}$/, 'phone: international format, e.g. +919800000000')
  .nullable();

export const leadFields = z.object({
  business_name: z.string().trim().min(1, 'required').max(200),
  contact_name: text(120).optional(),
  phone: phone.optional(),
  alt_phone: phone.optional(),
  email: z.email().max(255).nullable().optional(),
  city: text(100).optional(),
  area: text(100).optional(),
  address: text(500).optional(),
  location: z
    .object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) })
    .nullable()
    .optional(),
  business_type: z.enum(LEAD_BUSINESS_TYPES).nullable().optional(),
  outlet_count: z.number().int().min(1).max(10_000).optional(),
  current_pos: text(100).optional(),
  source: z.enum(LEAD_SOURCES),
  source_detail: text(200).optional(),
  temperature: z.enum(LEAD_TEMPERATURES).optional(),
  interested_plan_id: z.uuid().nullable().optional(),
  expected_value: z
    .string()
    .regex(/^\d{1,8}(\.\d{1,2})?$/, 'expected_value: amount like 1499.00')
    .nullable()
    .optional(),
  expected_close_on: z.iso.date().nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
});

export const createSchema = leadFields.extend({
  assigned_admin_id: z.uuid().nullable().optional(),
  force: z.boolean().optional(),
});
export const updateSchema = leadFields
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'nothing to change');

export const pageSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(100).default(25),
});
export const filterSchema = z.object({
  q: z.string().trim().max(100).optional(),
  stage: z.enum([...LEAD_STAGES, 'open']).optional(),
  assigned: z.union([z.enum(['me', 'none']), z.uuid()]).optional(),
  source: z.enum(LEAD_SOURCES).optional(),
  temperature: z.enum(LEAD_TEMPERATURES).optional(),
  city: z.string().trim().max(100).optional(),
  tag: z.string().trim().max(40).optional(),
  follow_up: z.enum(['overdue', 'today', 'week', 'none']).optional(),
});
export const listQuery = pageSchema.extend(filterSchema.shape);
export const boardQuery = filterSchema.pick({ assigned: true, source: true, temperature: true });

export const stageSchema = z.object({
  stage: z.enum(LEAD_STAGES),
  lost_reason: z.enum(LEAD_LOST_REASONS).optional(),
  note: z.string().trim().max(2000).optional(),
});
export const assignSchema = z.object({ admin_id: z.uuid().nullable() });
export const linkSchema = z.object({ store_id: z.uuid().nullable() });
export const mergeSchema = z.object({ duplicate_id: z.uuid() });
export const activitySchema = z.object({
  type: z.enum(LEAD_MANUAL_ACTIVITY_TYPES),
  body: z.string().trim().max(5000).default(''),
  outcome: z.enum(LEAD_CALL_OUTCOMES).optional(),
  duration_min: z.number().int().min(0).max(600).optional(),
  occurred_at: z.iso.datetime({ offset: true }).optional(),
});
export const taskSchema = z.object({
  type: z.enum(LEAD_TASK_TYPES),
  title: z.string().trim().min(1).max(200),
  due_at: z.iso.datetime({ offset: true }),
  assigned_admin_id: z.uuid().nullable().optional(),
});
export const taskUpdateSchema = taskSchema
  .partial()
  .extend({
    done: z.boolean().optional(),
    log: z
      .object({
        body: z.string().trim().max(5000).default(''),
        outcome: z.enum(LEAD_CALL_OUTCOMES).optional(),
      })
      .optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'nothing to change');
export const tasksQuery = z.object({
  assigned: z.union([z.enum(['me', 'none', 'all']), z.uuid()]).optional(),
  due: z.enum(['overdue', 'today', 'week', 'open']).optional(),
});

export const BULK_LIMIT = 200;
const ids = z.array(z.uuid()).min(1).max(BULK_LIMIT);
export const bulkSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('assign'), ids, admin_id: z.uuid().nullable() }),
  z.object({
    action: z.literal('stage'),
    ids,
    stage: z.enum(LEAD_STAGES).exclude(['won']),
    lost_reason: z.enum(LEAD_LOST_REASONS).optional(),
  }),
  z.object({ action: z.literal('tag'), ids, tag: z.string().trim().min(1).max(40) }),
  z.object({ action: z.literal('delete'), ids }),
]);
export type BulkInput = z.infer<typeof bulkSchema>;

export const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const MAX_PHOTO_BYTES = 1_500_000;
export const MAX_PHOTOS_PER_LEAD = 8;
export const photoSchema = z.object({
  content_type: z.enum(PHOTO_TYPES),
  data: z.base64().max(Math.ceil(MAX_PHOTO_BYTES / 3) * 4, 'photo: too large'),
});

export const IMPORT_ROW_LIMIT = 2_000;
export const importSchema = z.object({
  csv: z.string().min(1).max(2_000_000),
  dry_run: z.boolean().default(true),
  include_duplicates: z.boolean().default(false),
});

export const reportsQuery = z
  .object({ from: z.iso.date(), to: z.iso.date() })
  .refine((v) => v.from <= v.to, 'from: must be on or before to');
