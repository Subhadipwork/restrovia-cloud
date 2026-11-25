import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { z } from 'zod';
import { PosAddonsService } from '../addons/pos-addons.service.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { CurrentDevice, type PosDevice, PosSignatureGuard } from './pos-auth.guard.js';

const codeSchema = z.string().regex(/^[a-z][a-z0-9_]{1,62}$/);
const addSchema = z.object({ mode: z.enum(['free', 'trial']) });

/** The POS Marketplace screen: add-ons with this store's state, and adding free ones or trials. */
@Controller('api/pos/marketplace')
@UseGuards(PosSignatureGuard)
export class PosMarketplaceController {
  constructor(private readonly addons: PosAddonsService) {}

  @Get()
  list(@CurrentDevice() device: PosDevice) {
    return this.addons.catalogue(device.storeId);
  }

  @Post(':code/add')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 20, ttl: 15 * 60_000 } })
  add(
    @CurrentDevice() device: PosDevice,
    @Param('code', new ZodPipe(codeSchema)) code: z.infer<typeof codeSchema>,
    @Body(new ZodPipe(addSchema)) body: z.infer<typeof addSchema>,
  ) {
    return this.addons.add(device.storeId, code, body.mode, {
      by: 'pos',
      posDeviceId: device.id,
    });
  }
}
