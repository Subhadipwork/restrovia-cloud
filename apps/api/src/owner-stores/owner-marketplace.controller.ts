import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { StoreMemberRole } from '@restrovia/shared';
import { z } from 'zod';
import { OwnerAddonsService } from '../addons/owner-addons.service.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { limit } from '../owner/owner-auth.controller.js';
import type { OwnerRow } from '../owner/owner-sessions.js';
import { CurrentOwner, OwnerGuard } from '../owner/owner.guard.js';
import {
  CurrentStore,
  CurrentStoreRole,
  StoreMemberGuard,
  StoreOwnerOnlyGuard,
  type StoreRow,
} from './store-member.guard.js';

const codeSchema = z.string().regex(/^[a-z][a-z0-9_]{1,62}$/);
const addSchema = z.object({ mode: z.enum(['free', 'trial']) });
const requestSchema = z.object({
  quantity: z.number().int().min(1).max(100).default(1),
  note: z.string().trim().max(500).default(''),
});

/**
 * The café's Marketplace (app.restrovia.in/api/owner/stores/:storeId/marketplace). Owners and
 * managers see it and can ask to buy; only owners add, start trials or cancel.
 */
@Controller('api/owner/stores/:storeId/marketplace')
@UseGuards(OwnerGuard, StoreMemberGuard)
export class OwnerMarketplaceController {
  constructor(private readonly addons: OwnerAddonsService) {}

  @Get()
  list(@CurrentStore() store: StoreRow, @CurrentStoreRole() role: StoreMemberRole) {
    return this.addons.marketplace(store, role);
  }

  @Post('addons/:code/add')
  @HttpCode(200)
  @UseGuards(StoreOwnerOnlyGuard, ThrottlerGuard)
  @Throttle({ default: { limit: limit(20), ttl: 15 * 60_000 } })
  add(
    @CurrentStore() store: StoreRow,
    @CurrentOwner() owner: OwnerRow,
    @Param('code', new ZodPipe(codeSchema)) code: z.infer<typeof codeSchema>,
    @Body(new ZodPipe(addSchema)) body: z.infer<typeof addSchema>,
  ) {
    return this.addons.add(store, owner, code, body.mode);
  }

  @Post('addons/:code/request')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: limit(10), ttl: 60 * 60_000 } })
  request(
    @CurrentStore() store: StoreRow,
    @CurrentOwner() owner: OwnerRow,
    @Param('code', new ZodPipe(codeSchema)) code: z.infer<typeof codeSchema>,
    @Body(new ZodPipe(requestSchema)) body: z.infer<typeof requestSchema>,
  ) {
    return this.addons.request(store, owner, code, body.quantity, body.note);
  }

  @Post('requests/:requestId/cancel')
  @HttpCode(200)
  cancelRequest(
    @CurrentStore() store: StoreRow,
    @CurrentOwner() owner: OwnerRow,
    @Param('requestId', ParseUUIDPipe) requestId: string,
  ) {
    return this.addons.cancelRequest(store, owner, requestId);
  }

  @Post('mine/:storeAddonId/cancel')
  @HttpCode(200)
  @UseGuards(StoreOwnerOnlyGuard)
  cancel(
    @CurrentStore() store: StoreRow,
    @CurrentOwner() owner: OwnerRow,
    @Param('storeAddonId', ParseUUIDPipe) storeAddonId: string,
  ) {
    return this.addons.cancel(store, owner, storeAddonId);
  }
}
