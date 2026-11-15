import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { z } from 'zod';
import { ZodPipe } from '../common/zod.pipe.js';
import { limit } from '../owner/owner-auth.controller.js';
import type { OwnerRow } from '../owner/owner-sessions.js';
import { CurrentOwner, OwnerGuard } from '../owner/owner.guard.js';
import {
  OwnerMenuChangesService,
  menuBulkInput,
  menuDraftInput,
  menuDuplicateInput,
  menuImportInput,
} from './owner-menu-changes.service.js';
import {
  OwnerChannelMenusService,
  menuCreateInput,
  menuItemInput,
} from './owner-channel-menus.service.js';
import { OwnerMenuService } from './owner-menu.service.js';
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
const availabilityBody = z.object({ available: z.boolean() });
const itemId = z.string().trim().min(1).max(64);
const ordersQuery = z.object({
  from: day.optional(),
  to: day.optional(),
  type: z.string().trim().min(1).max(64).optional(),
  status: z.enum(['open', 'completed', 'cancelled']).optional(),
  q: z.string().trim().min(1).max(64).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
});

/** The owner's stores (app.restrovia.shop/api/owner/stores); routes with :storeId need membership. */
@Controller('api/owner/stores')
@UseGuards(OwnerGuard)
export class OwnerStoresController {
  constructor(
    private readonly stores: OwnerStoresService,
    private readonly menu: OwnerMenuService,
    private readonly menuChanges: OwnerMenuChangesService,
    private readonly channelMenus: OwnerChannelMenusService,
  ) {}

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

  @Get(':storeId/menu')
  @UseGuards(StoreMemberGuard)
  menuOf(@CurrentStore() store: StoreRow, @CurrentStoreRole() role: StoreMemberRole) {
    return this.menu.menu(store, role);
  }

  @Post(':storeId/menu/items/:itemId/availability')
  @UseGuards(StoreMemberGuard, ThrottlerGuard)
  @Throttle({ default: { limit: limit(30), ttl: 60_000 } })
  setAvailability(
    @CurrentStore() store: StoreRow,
    @CurrentOwner() owner: OwnerRow,
    @Param('itemId', new ZodPipe(itemId)) id: string,
    @Body(new ZodPipe(availabilityBody)) body: z.infer<typeof availabilityBody>,
  ) {
    return this.menu.setAvailability(store, owner.id, id, body.available);
  }

  @Get(':storeId/menu/changes')
  @UseGuards(StoreMemberGuard)
  menuChangeList(@CurrentStore() store: StoreRow) {
    return this.menuChanges.list(store);
  }

  @Post(':storeId/menu/changes')
  @UseGuards(StoreMemberGuard, ThrottlerGuard)
  @Throttle({ default: { limit: limit(60), ttl: 60_000 } })
  menuDraft(
    @CurrentStore() store: StoreRow,
    @CurrentOwner() owner: OwnerRow,
    @CurrentStoreRole() role: StoreMemberRole,
    @Body(new ZodPipe(menuDraftInput)) body: z.infer<typeof menuDraftInput>,
  ) {
    return this.menuChanges.addDraft(store, { id: owner.id, name: owner.name }, role, body);
  }

  @Post(':storeId/menu/changes/publish')
  @UseGuards(StoreMemberGuard, ThrottlerGuard)
  @Throttle({ default: { limit: limit(12), ttl: 60_000 } })
  menuPublish(
    @CurrentStore() store: StoreRow,
    @CurrentOwner() owner: OwnerRow,
    @CurrentStoreRole() role: StoreMemberRole,
  ) {
    return this.menuChanges.publish(store, { id: owner.id, name: owner.name }, role);
  }

  @Post(':storeId/menu/changes/bulk')
  @UseGuards(StoreMemberGuard, ThrottlerGuard)
  @Throttle({ default: { limit: limit(20), ttl: 60_000 } })
  menuBulk(
    @CurrentStore() store: StoreRow,
    @CurrentOwner() owner: OwnerRow,
    @CurrentStoreRole() role: StoreMemberRole,
    @Body(new ZodPipe(menuBulkInput)) body: z.infer<typeof menuBulkInput>,
  ) {
    return this.menuChanges.bulk(store, { id: owner.id, name: owner.name }, role, body);
  }

  @Post(':storeId/menu/changes/duplicate')
  @UseGuards(StoreMemberGuard, ThrottlerGuard)
  @Throttle({ default: { limit: limit(30), ttl: 60_000 } })
  menuDuplicate(
    @CurrentStore() store: StoreRow,
    @CurrentOwner() owner: OwnerRow,
    @CurrentStoreRole() role: StoreMemberRole,
    @Body(new ZodPipe(menuDuplicateInput)) body: z.infer<typeof menuDuplicateInput>,
  ) {
    return this.menuChanges.duplicate(store, { id: owner.id, name: owner.name }, role, body.item_id, body.name);
  }

  @Post(':storeId/menu/changes/import')
  @UseGuards(StoreMemberGuard, ThrottlerGuard)
  @Throttle({ default: { limit: limit(6), ttl: 60_000 } })
  menuImport(
    @CurrentStore() store: StoreRow,
    @CurrentOwner() owner: OwnerRow,
    @CurrentStoreRole() role: StoreMemberRole,
    @Body(new ZodPipe(menuImportInput)) body: z.infer<typeof menuImportInput>,
  ) {
    return this.menuChanges.importRows(store, { id: owner.id, name: owner.name }, role, body.rows);
  }

  @Post(':storeId/menu/changes/:changeId/revert')
  @UseGuards(StoreMemberGuard, ThrottlerGuard)
  @Throttle({ default: { limit: limit(30), ttl: 60_000 } })
  menuRevert(
    @CurrentStore() store: StoreRow,
    @CurrentOwner() owner: OwnerRow,
    @CurrentStoreRole() role: StoreMemberRole,
    @Param('changeId', ParseUUIDPipe) changeId: string,
  ) {
    return this.menuChanges.revert(store, { id: owner.id, name: owner.name }, role, changeId);
  }

  @Delete(':storeId/menu/changes/:changeId')
  @UseGuards(StoreMemberGuard)
  menuDiscard(
    @CurrentStore() store: StoreRow,
    @Param('changeId', ParseUUIDPipe) changeId: string,
  ) {
    return this.menuChanges.discard(store, changeId);
  }

  @Get(':storeId/menus')
  @UseGuards(StoreMemberGuard)
  menusList(@CurrentStore() store: StoreRow) {
    return this.channelMenus.list(store);
  }

  @Post(':storeId/menus')
  @UseGuards(StoreMemberGuard, ThrottlerGuard)
  @Throttle({ default: { limit: limit(20), ttl: 60_000 } })
  menusCreate(
    @CurrentStore() store: StoreRow,
    @Body(new ZodPipe(menuCreateInput)) body: z.infer<typeof menuCreateInput>,
  ) {
    return this.channelMenus.create(store, body.name);
  }

  @Get(':storeId/menus/:menuId')
  @UseGuards(StoreMemberGuard)
  menusGet(@CurrentStore() store: StoreRow, @Param('menuId', ParseUUIDPipe) menuId: string) {
    return this.channelMenus.get(store, menuId);
  }

  @Delete(':storeId/menus/:menuId')
  @UseGuards(StoreMemberGuard)
  menusRemove(@CurrentStore() store: StoreRow, @Param('menuId', ParseUUIDPipe) menuId: string) {
    return this.channelMenus.remove(store, menuId);
  }

  @Post(':storeId/menus/:menuId/reset')
  @UseGuards(StoreMemberGuard)
  menusReset(@CurrentStore() store: StoreRow, @Param('menuId', ParseUUIDPipe) menuId: string) {
    return this.channelMenus.reset(store, menuId);
  }

  @Put(':storeId/menus/:menuId/items/:itemId')
  @UseGuards(StoreMemberGuard, ThrottlerGuard)
  @Throttle({ default: { limit: limit(120), ttl: 60_000 } })
  menusSetItem(
    @CurrentStore() store: StoreRow,
    @Param('menuId', ParseUUIDPipe) menuId: string,
    @Param('itemId', new ZodPipe(z.string().trim().min(1).max(64))) itemId: string,
    @Body(new ZodPipe(menuItemInput)) body: z.infer<typeof menuItemInput>,
  ) {
    return this.channelMenus.setItem(store, menuId, itemId, body);
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
