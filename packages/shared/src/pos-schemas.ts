/**
 * Request bodies the Restrovia POS sends, matching main/services/cloud-sync.ts in restrovia-pos.
 * Schemas accept unknown extra fields so newer POS versions keep working.
 */
import { z } from 'zod';

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
  business: z.looseObject({
    name: z.string().default(''),
    contact_name: z.string().default(''),
    email: z.string().default(''),
    phone: z.string().default(''),
    country: z.string().nullish(),
    currency: z.string().optional(),
    timezone: z.string().default(''),
    address: z.string().default(''),
  }),
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

export const posHeartbeatSchema = z.looseObject({
  pos_hash: z.string().min(1),
  pos_id: z.string().nullable().optional(),
  app_version: z.string().default(''),
  device_name: z.string().default(''),
  active_orders: z.number().int().nonnegative().default(0),
  today_sales: z.number().default(0),
  today_bills: z.number().int().nonnegative().default(0),
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
