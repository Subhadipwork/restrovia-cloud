import { Body, Controller, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
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
import { StoreLinkService } from './store-link.service.js';

const linkSchema = z.object({ code: z.string().regex(/^\d{6}$/, 'code: 6 digits') });

/** Adds a café with the code from its POS (app.restrovia.shop/api/owner/stores/link). */
@Controller('api/owner/stores')
@UseGuards(OwnerGuard)
export class StoreLinkController {
  constructor(private readonly links: StoreLinkService) {}

  @Post('link')
  @HttpCode(200)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: limit(10), ttl: 15 * 60_000 } })
  link(
    @CurrentOwner() me: OwnerRow,
    @Body(new ZodPipe(linkSchema)) body: z.infer<typeof linkSchema>,
    @Req() req: OwnerRequest,
  ) {
    return this.links.link(me, body.code, requestContext(req));
  }
}
