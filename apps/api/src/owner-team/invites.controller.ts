import { Body, Controller, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { ZodPipe } from '../common/zod.pipe.js';
import { limit, passwordField, setOwnerCookie } from '../owner/owner-auth.controller.js';
import type { OwnerRow } from '../owner/owner-sessions.js';
import {
  CurrentOwner,
  OwnerCsrfGuard,
  OwnerGuard,
  requestContext,
  type OwnerRequest,
} from '../owner/owner.guard.js';
import { TeamService } from './team.service.js';

const MINUTE = 60_000;
const tokenField = z.string().min(16).max(200);
const tokenSchema = z.object({ token: tokenField });
const newAccountSchema = z.object({
  token: tokenField,
  name: z.string().trim().min(1).max(80),
  password: passwordField,
});

/** The link in an invite email (app.restrovia.in/join), before and after signing in. */
@Controller('api/owner/invites')
export class InvitesController {
  constructor(private readonly team: TeamService) {}

  @Post('preview')
  @HttpCode(200)
  @UseGuards(OwnerCsrfGuard, ThrottlerGuard)
  @Throttle({ default: { limit: limit(30), ttl: 15 * MINUTE } })
  preview(@Body(new ZodPipe(tokenSchema)) body: z.infer<typeof tokenSchema>) {
    return this.team.preview(body.token);
  }

  /** No password yet: choose one here, and be signed in. */
  @Post('accept-new')
  @HttpCode(200)
  @UseGuards(OwnerCsrfGuard, ThrottlerGuard)
  @Throttle({ default: { limit: limit(10), ttl: 15 * MINUTE } })
  async acceptNew(
    @Body(new ZodPipe(newAccountSchema)) body: z.infer<typeof newAccountSchema>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.team.acceptNew(
      body.token,
      body.name,
      body.password,
      requestContext(req),
    );
    setOwnerCookie(res, result.token);
    return { status: 'ok', owner: result.owner, store_id: result.store_id };
  }

  /** Already signed in with the invited email. */
  @Post('accept')
  @HttpCode(200)
  @UseGuards(OwnerGuard, ThrottlerGuard)
  @Throttle({ default: { limit: limit(10), ttl: 15 * MINUTE } })
  accept(
    @Body(new ZodPipe(tokenSchema)) body: z.infer<typeof tokenSchema>,
    @CurrentOwner() me: OwnerRow,
    @Req() req: OwnerRequest,
  ) {
    return this.team.acceptSignedIn(body.token, me, requestContext(req));
  }
}
