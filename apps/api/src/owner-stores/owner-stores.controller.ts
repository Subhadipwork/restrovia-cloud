import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { z } from 'zod';
import { ZodPipe } from '../common/zod.pipe.js';
import { limit } from '../owner/owner-auth.controller.js';
import type { OwnerRow } from '../owner/owner-sessions.js';
import { CurrentOwner, OwnerGuard } from '../owner/owner.guard.js';
import { OwnerStoresService } from './owner-stores.service.js';
import type { StoreMemberRole } from '@restrovia/shared';
import {
  CurrentStore,
  CurrentStoreRole,
  StoreMemberGuard,
  type StoreRow,
} from './store-member.guard.js';

export const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'date: YYYY-MM-DD')
  .refine((v) => {
    const t = Date.parse(`${v}T00:00:00Z`);
    // Date.parse rolls 2026-02-30 over to 2 March instead of refusing it.
    return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === v;
  }, 'date: not a real date');
const dashboardQuery = z.object({ date: day.optional() });
const ordersQuery = z.object({
  from: day.optional(),
  to: day.optional(),
  type: z.string().trim().min(1).max(64).optional(),
  status: z.enum(['open', 'completed', 'cancelled']).optional(),
  q: z.string().trim().min(1).max(64).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
});

/** The owner's stores (app.restrovia.in/api/owner/stores); routes with :storeId need membership. */
@Controller('api/owner/stores')
@UseGuards(OwnerGuard)
export class OwnerStoresController {
  constructor(private readonly stores: OwnerStoresService) {}

  @Get()
  list(@CurrentOwner() owner: OwnerRow) {
    return this.stores.list(owner.id);
  }

  @Get(':storeId')
  @UseGuards(StoreMemberGuard)
  details(@CurrentStore() store: StoreRow, @CurrentStoreRole() role: StoreMemberRole) {
    return this.stores.details(store, role);
  }

  @Get(':storeId/status')
  @UseGuards(StoreMemberGuard)
  status(@CurrentStore() store: StoreRow) {
    return this.stores.status(store);
  }

  @Get(':storeId/dashboard')
  @UseGuards(StoreMemberGuard)
  dashboard(
    @CurrentStore() store: StoreRow,
    @Query(new ZodPipe(dashboardQuery)) q: z.infer<typeof dashboardQuery>,
  ) {
    return this.stores.dashboard(store, q.date);
  }

  @Get(':storeId/live')
  @UseGuards(StoreMemberGuard, ThrottlerGuard)
  @Throttle({ default: { limit: limit(12), ttl: 60_000 } })
  live(@CurrentStore() store: StoreRow, @CurrentOwner() owner: OwnerRow) {
    return this.stores.live(store, owner.id);
  }

  @Get(':storeId/orders')
  @UseGuards(StoreMemberGuard)
  orders(
    @CurrentStore() store: StoreRow,
    @Query(new ZodPipe(ordersQuery)) q: z.infer<typeof ordersQuery>,
  ) {
    return this.stores.orders(store, q);
  }

  @Get(':storeId/orders/:orderId')
  @UseGuards(StoreMemberGuard)
  order(
    @CurrentStore() store: StoreRow,
    @Param('orderId', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) orderId: string,
  ) {
    return this.stores.order(store, orderId);
  }
}
