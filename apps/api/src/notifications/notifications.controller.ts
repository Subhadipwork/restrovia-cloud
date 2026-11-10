import { Body, Controller, Get, HttpCode, Post, Put, Req, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { z } from 'zod';
import { ZodPipe } from '../common/zod.pipe.js';
import { limit } from '../owner/owner-auth.controller.js';
import type { OwnerRow } from '../owner/owner-sessions.js';
import {
  CurrentOwner,
  OwnerCsrfGuard,
  OwnerGuard,
  requestContext,
  type OwnerRequest,
} from '../owner/owner.guard.js';
import { AlertsService } from './alerts.service.js';
import { NotificationPrefsService } from './notification-prefs.service.js';

const HOUR = 60 * 60_000;

const prefsSchema = z
  .object({
    daily_summary_email: z.boolean().optional(),
    offline_alert: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'nothing to change');
const turnOffSchema = z.object({ token: z.string().min(16).max(400) });

/** Alert emails: the owner's switches, a sample, and the "turn off" link from an email. */
@Controller('api/owner')
export class NotificationsController {
  constructor(
    private readonly prefs: NotificationPrefsService,
    private readonly alerts: AlertsService,
  ) {}

  @Get('me/notification-prefs')
  @UseGuards(OwnerGuard)
  get(@CurrentOwner() owner: OwnerRow) {
    return this.prefs.get(owner);
  }

  @Put('me/notification-prefs')
  @UseGuards(OwnerGuard)
  update(
    @CurrentOwner() owner: OwnerRow,
    @Body(new ZodPipe(prefsSchema)) body: z.infer<typeof prefsSchema>,
    @Req() req: OwnerRequest,
  ) {
    return this.prefs.update(owner, body, requestContext(req));
  }

  @Post('me/notification-prefs/sample')
  @HttpCode(200)
  @UseGuards(OwnerGuard, ThrottlerGuard)
  @Throttle({ default: { limit: limit(3), ttl: HOUR } })
  sample(@CurrentOwner() owner: OwnerRow) {
    return this.alerts.sendSample(owner);
  }

  /** Reached from an email without signing in; the token says whose alert and which kind. */
  @Post('notifications/unsubscribe')
  @HttpCode(200)
  @UseGuards(OwnerCsrfGuard, ThrottlerGuard)
  @Throttle({ default: { limit: limit(20), ttl: HOUR } })
  turnOff(@Body(new ZodPipe(turnOffSchema)) body: z.infer<typeof turnOffSchema>) {
    return this.prefs.turnOff(body.token);
  }
}
