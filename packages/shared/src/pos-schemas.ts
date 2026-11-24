/**
 * Request bodies the Restrovia POS sends, matching main/services/cloud-sync.ts in restrovia-pos.
 * Schemas accept unknown extra fields so newer POS versions keep working.
 */
import { z } from 'zod';
import { BACKUP_DESTINATIONS } from './constants.js';

/** The café's details, sent at registration and, when they change, in the heartbeat. */
export const posBusinessSchema = z.looseObject({
  name: z.string().default(''),
  contact_name: z.string().default(''),
  email: z.string().default(''),
  phone: z.string().default(''),
  country: z.string().nullish(),
  currency: z.string().optional(),
  timezone: z.string().default(''),
  address: z.string().default(''),
  /** `HH:MM`; the POS sends it only in the heartbeat. */
  business_day_start: z.string().optional(),
});
export type PosBusiness = z.infer<typeof posBusinessSchema>;

export const posRegisterSchema = z.looseObject({
  pos_hash: z.string().min(1),
  device_secret_hash: z.string().min(1),
  device_name: z.string().default(''),
  platform: z.string().default(''),
  arch: z.string().default(''),
  app_version: z.string().default(''),
  run_mode: z.string().default(''),
  install_source: z.string().default(''),
  store_type: z.string().default('cafe'),
  business: posBusinessSchema,
  requested_at: z.string(),
});
export type PosRegisterBody = z.infer<typeof posRegisterSchema>;

export const posRegisterResponseSchema = z.object({
  api_key: z.string(),
  pos_id: z.string(),
  store_id: z.string(),
});
export type PosRegisterResponse = z.infer<typeof posRegisterResponseSchema>;

export const posEventSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  entity_type: z.string().min(1),
  entity_id: z.string().min(1),
  payload: z.unknown(),
});
export type PosEvent = z.infer<typeof posEventSchema>;

export const posEventsBodySchema = z.object({
  pos_hash: z.string().min(1),
  events: z.array(posEventSchema).max(50),
  sent_at: z.string(),
});
export type PosEventsBody = z.infer<typeof posEventsBodySchema>;

/** Payload of a `backup.completed` / `backup.failed` event (entity_type `backup`). */
export const posBackupPayloadSchema = z.object({
  destination: z.enum(BACKUP_DESTINATIONS).catch('other'),
  file_name: z.string().max(255).nullish(),
  size_bytes: z.number().int().nonnegative().nullish(),
  error: z.string().max(500).nullish(),
  occurred_at: z.iso.datetime({ offset: true }),
});
export type PosBackupPayload = z.infer<typeof posBackupPayloadSchema>;

export const posHeartbeatSchema = z.looseObject({
  pos_hash: z.string().min(1),
  pos_id: z.string().nullable().optional(),
  app_version: z.string().default(''),
  device_name: z.string().default(''),
  active_orders: z.number().int().nonnegative().default(0),
  today_sales: z.number().default(0),
  today_bills: z.number().int().nonnegative().default(0),
  /** Only when the details changed; POS versions before this field never send it. */
  business: posBusinessSchema.optional().catch(undefined),
  sent_at: z.string(),
});
export type PosHeartbeatBody = z.infer<typeof posHeartbeatSchema>;

export const posCommandResultSchema = z.object({
  version: z.number().int(),
  correlation_id: z.string(),
  ok: z.boolean(),
  result: z.unknown().optional(),
  error: z.string().optional(),
  completed_at: z.string(),
});
export type PosCommandResult = z.infer<typeof posCommandResultSchema>;

export const posLicenceRequestSchema = z.object({
  pos_hash: z.string().min(1),
  /** sha256 hex of the computer's hardware ID, salted by the POS. */
  machine_id_hash: z.string().regex(/^[0-9a-f]{64}$/),
  app_version: z.string().max(40).default(''),
  /** Paid features switched on at this POS, so ones in use before add-ons are kept for free. */
  enabled_features: z.array(z.string().max(64)).max(20).optional(),
});
export type PosLicenceRequest = z.infer<typeof posLicenceRequestSchema>;

/** `202` answer to a licence check-in from a store waiting for activation; there is no token. */
export const posLicencePendingSchema = z.object({
  status: z.literal('activation_pending'),
  store_code: z.string(),
});
export type PosLicencePending = z.infer<typeof posLicencePendingSchema>;

/** Asks for a code the owner types in the owner portal to move this POS to their store. */
export const posLinkCodeRequestSchema = z.object({
  machine_id_hash: z.string().regex(/^[0-9a-f]{64}$/),
});
export type PosLinkCodeRequest = z.infer<typeof posLinkCodeRequestSchema>;

const menuRow = z.record(z.string(), z.unknown());

/** Payload of a `menu.snapshot` event (entity_type `menu`): the POS menu as the counter has it. */
export const posMenuSnapshotSchema = z.object({
  version: z.literal(1),
  generated_at: z.iso.datetime({ offset: true }),
  sync_enabled: z.boolean(),
  portal_editing: z.boolean(),
  hash: z.string().regex(/^[0-9a-f]{64}$/),
  categories: z.array(menuRow).max(2_000),
  products: z.array(menuRow).max(10_000),
  variants: z.array(menuRow).max(30_000),
  addon_groups: z.array(menuRow).max(2_000),
  addons: z.array(menuRow).max(20_000),
  addon_group_products: z.array(menuRow).max(60_000),
  category_addon_groups: z.array(menuRow).max(10_000),
  /** Hours an item or category is offered; older POS versions don't send it. */
  schedules: z.array(menuRow).max(5_000).default([]),
});
export type PosMenuSnapshot = z.infer<typeof posMenuSnapshotSchema>;

/** Payload of a `menu.sync_state` event: the café turned menu sync or portal editing on or off. */
export const posMenuSyncStateSchema = z.object({
  sync_enabled: z.boolean(),
  portal_editing: z.boolean(),
  occurred_at: z.iso.datetime({ offset: true }),
});
export type PosMenuSyncState = z.infer<typeof posMenuSyncStateSchema>;

/** Payload of the `menu.set_availability` command. */
export const menuAvailabilityCommandSchema = z.object({
  product_id: z.string().min(1).max(64),
  available: z.boolean(),
});
export type MenuAvailabilityCommand = z.infer<typeof menuAvailabilityCommandSchema>;
