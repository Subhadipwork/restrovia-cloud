import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { z } from 'zod';
import { ZodPipe } from '../common/zod.pipe.js';
import { limit } from '../owner/owner-auth.controller.js';
import type { OwnerRow } from '../owner/owner-sessions.js';
import {
  CurrentOwner,
  OwnerGuard,
  requestContext,
  type OwnerRequest,
} from '../owner/owner.guard.js';
import { LINK_CODE_DIGITS } from '../pos/device-link.service.js';
import { OwnerDevicesService } from './owner-devices.service.js';
import {
  CurrentStore,
  StoreMemberGuard,
  StoreOwnerOnlyGuard,
  type StoreRow,
} from './store-member.guard.js';

const codeSchema = z
  .string()
  .trim()
  .regex(new RegExp(`^\\d{${LINK_CODE_DIGITS}}$`), `code: ${LINK_CODE_DIGITS} digits`);
const previewSchema = z.object({ code: codeSchema });
const linkSchema = z.object({ code: codeSchema, retire_device_id: z.uuid().nullable().optional() });

/** The café's POS computers (app.restrovia.in/api/owner/stores/:storeId/devices); owners only. */
@Controller('api/owner/stores/:storeId/devices')
@UseGuards(OwnerGuard, StoreMemberGuard, StoreOwnerOnlyGuard)
export class OwnerDevicesController {
  constructor(private readonly devices: OwnerDevicesService) {}

  @Get()
  list(@CurrentStore() store: StoreRow) {
    return this.devices.list(store);
  }

  @Post('link/preview')
  @HttpCode(200)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: limit(20), ttl: 15 * 60_000 } })
  preview(
    @CurrentOwner() me: OwnerRow,
    @CurrentStore() store: StoreRow,
    @Body(new ZodPipe(previewSchema)) body: z.infer<typeof previewSchema>,
    @Req() req: OwnerRequest,
  ) {
    return this.devices.preview(me, store, body.code, requestContext(req));
  }

  @Post('link')
  @HttpCode(200)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: limit(10), ttl: 15 * 60_000 } })
  link(
    @CurrentOwner() me: OwnerRow,
    @CurrentStore() store: StoreRow,
    @Body(new ZodPipe(linkSchema)) body: z.infer<typeof linkSchema>,
    @Req() req: OwnerRequest,
  ) {
    return this.devices.link(me, store, body, requestContext(req));
  }

  @Post(':deviceId/retire')
  @HttpCode(200)
  retire(
    @CurrentOwner() me: OwnerRow,
    @CurrentStore() store: StoreRow,
    @Param('deviceId', new ParseUUIDPipe()) deviceId: string,
    @Req() req: OwnerRequest,
  ) {
    return this.devices.retire(me, store, deviceId, requestContext(req));
  }
}
