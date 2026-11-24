import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import {
  ADDON_CATEGORIES,
  ADDON_INTERVALS,
  ADDON_KINDS,
  ADDON_SCOPES,
  ADDON_STATUSES,
  ADDON_UNITS,
  STORE_ADDON_SOURCES,
} from '@restrovia/shared';
import { ZodPipe } from '../common/zod.pipe.js';
import type { AdminRow } from './admin-auth.service.js';
import {
  AdminAddonsService,
  type AddonInput,
  type AddonPaymentInput,
  type AddonUpdate,
  type StoreAddonAction,
} from './admin-addons.service.js';
import { AdminGuard, Can, CurrentAdmin, type AdminRequest } from './admin.guard.js';

const uuid = new ParseUUIDPipe({ errorHttpStatusCode: 404 });
const money = z.string().regex(/^\d{1,8}(\.\d{1,2})?$/, 'a number with up to 2 decimals');
const addonCode = z
  .string()
  .regex(/^[a-z][a-z0-9_]{1,62}$/, 'code: lowercase letters, digits and _ (e.g. whatsapp)');
const note = z.string().trim().min(3).max(500);

const listQuery = z.object({ include_retired: z.enum(['true', 'false']).optional() });
const addonFields = {
  name: z.string().trim().min(1).max(100),
  tagline: z.string().trim().max(200).optional(),
  description: z.string().trim().max(5000).optional(),
  category: z.enum(ADDON_CATEGORIES),
  kind: z.enum(ADDON_KINDS),
  price: money,
  currency: z.string().regex(/^[A-Z]{3}$/),
  interval: z.enum(ADDON_INTERVALS),
  unit: z.enum(ADDON_UNITS),
  trial_days: z.number().int().min(0).max(90),
  requires: z.array(addonCode).max(10),
  min_pos_version: z
    .string()
    .regex(/^\d+\.\d+\.\d+$/, 'min_pos_version: like 3.15.0')
    .nullable()
    .optional(),
  scope: z.enum(ADDON_SCOPES),
  status: z.enum(ADDON_STATUSES),
  sort_order: z.number().int().min(0).max(10_000),
  is_featured: z.boolean(),
};
const createAddonSchema = z.object({
  code: addonCode,
  ...addonFields,
  price: money.default('0'),
  currency: addonFields.currency.default('INR'),
  interval: addonFields.interval.default('none'),
  unit: addonFields.unit.default('outlet'),
  trial_days: addonFields.trial_days.default(0),
  requires: addonFields.requires.default([]),
  scope: addonFields.scope.default('pos'),
  status: addonFields.status.default('draft'),
  sort_order: addonFields.sort_order.default(0),
  is_featured: addonFields.is_featured.default(false),
});
const updateAddonSchema = z
  .object(addonFields)
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'nothing to change');

const storeAddonSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('grant'),
    addon_code: addonCode,
    source: z.enum(STORE_ADDON_SOURCES).default('admin_grant'),
    quantity: z.number().int().min(1).max(100).default(1),
    months: z.number().int().min(1).max(36).nullable().optional(),
    price: money.optional(),
    amount: money.optional(),
    note,
  }),
  z.object({ action: z.literal('trial'), addon_code: addonCode, note: note.optional() }),
]);
const paymentSchema = z.object({
  amount: money,
  months: z.number().int().min(1).max(36).optional(),
  note: z.string().trim().max(500).optional(),
});
const revokeSchema = z.object({ immediate: z.boolean().default(false), note });

/** Marketplace add-ons in the admin panel: the catalogue, and what each store has. */
@Controller('api/admin')
@UseGuards(AdminGuard)
export class AdminAddonsController {
  constructor(private readonly addons: AdminAddonsService) {}

  @Get('addons')
  @Can('plans.view')
  list(@Query(new ZodPipe(listQuery)) q: z.infer<typeof listQuery>) {
    return this.addons.listAddons(q.include_retired === 'true');
  }

  @Post('addons')
  @Can('plans.manage')
  create(
    @Body(new ZodPipe(createAddonSchema)) body: AddonInput,
    @CurrentAdmin() admin: AdminRow,
    @Req() req: AdminRequest,
  ) {
    return this.addons.createAddon(body, admin, req.ip ?? null);
  }

  @Patch('addons/:id')
  @Can('plans.manage')
  update(
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(updateAddonSchema)) body: AddonUpdate,
    @CurrentAdmin() admin: AdminRow,
    @Req() req: AdminRequest,
  ) {
    return this.addons.updateAddon(id, body, admin, req.ip ?? null);
  }

  @Get('stores/:id/addons')
  @Can('stores.view')
  storeAddons(@Param('id', uuid) id: string) {
    return this.addons.listStoreAddons(id);
  }

  @Post('stores/:id/addons')
  @Can('stores.licence')
  addToStore(
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(storeAddonSchema)) body: StoreAddonAction,
    @CurrentAdmin() admin: AdminRow,
    @Req() req: AdminRequest,
  ) {
    return this.addons.addToStore(id, body, admin, req.ip ?? null);
  }

  @Post('stores/:id/addons/:storeAddonId/payments')
  @Can('stores.licence')
  payment(
    @Param('id', uuid) id: string,
    @Param('storeAddonId', uuid) storeAddonId: string,
    @Body(new ZodPipe(paymentSchema)) body: AddonPaymentInput,
    @CurrentAdmin() admin: AdminRow,
    @Req() req: AdminRequest,
  ) {
    return this.addons.recordPayment(id, storeAddonId, body, admin, req.ip ?? null);
  }

  @Post('stores/:id/addons/:storeAddonId/revoke')
  @HttpCode(200)
  @Can('stores.licence')
  revoke(
    @Param('id', uuid) id: string,
    @Param('storeAddonId', uuid) storeAddonId: string,
    @Body(new ZodPipe(revokeSchema)) body: z.infer<typeof revokeSchema>,
    @CurrentAdmin() admin: AdminRow,
    @Req() req: AdminRequest,
  ) {
    return this.addons.revoke(id, storeAddonId, body, admin, req.ip ?? null);
  }
}
