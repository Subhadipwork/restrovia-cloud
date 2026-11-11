import {
  Body,
  Controller,
  Delete,
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
import { emailField, limit } from '../owner/owner-auth.controller.js';
import type { OwnerRow } from '../owner/owner-sessions.js';
import {
  CurrentOwner,
  OwnerGuard,
  requestContext,
  type OwnerRequest,
} from '../owner/owner.guard.js';
import {
  CurrentStore,
  StoreMemberGuard,
  StoreOwnerOnlyGuard,
  type StoreRow,
} from '../owner-stores/store-member.guard.js';
import { TeamService } from './team.service.js';

const inviteSchema = z.object({ email: emailField });

/** A café's team (app.restrovia.in/api/owner/stores/:storeId/team), for its owners only. */
@Controller('api/owner/stores/:storeId/team')
@UseGuards(OwnerGuard, StoreMemberGuard, StoreOwnerOnlyGuard)
export class TeamController {
  constructor(private readonly team: TeamService) {}

  @Get()
  list(@CurrentStore() store: StoreRow, @CurrentOwner() me: OwnerRow) {
    return this.team.team(store, me);
  }

  @Post('invites')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: limit(20), ttl: 60 * 60_000 } })
  invite(
    @CurrentStore() store: StoreRow,
    @CurrentOwner() me: OwnerRow,
    @Body(new ZodPipe(inviteSchema)) body: z.infer<typeof inviteSchema>,
    @Req() req: OwnerRequest,
  ) {
    return this.team.invite(store, me, body.email.toLowerCase(), requestContext(req));
  }

  @Post('invites/:inviteId/resend')
  @HttpCode(200)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: limit(20), ttl: 60 * 60_000 } })
  resend(
    @CurrentStore() store: StoreRow,
    @CurrentOwner() me: OwnerRow,
    @Param('inviteId', ParseUUIDPipe) inviteId: string,
    @Req() req: OwnerRequest,
  ) {
    return this.team.resend(store, me, inviteId, requestContext(req));
  }

  @Delete('invites/:inviteId')
  cancel(
    @CurrentStore() store: StoreRow,
    @CurrentOwner() me: OwnerRow,
    @Param('inviteId', ParseUUIDPipe) inviteId: string,
    @Req() req: OwnerRequest,
  ) {
    return this.team.cancel(store, me, inviteId, requestContext(req));
  }

  @Delete('members/:ownerId')
  remove(
    @CurrentStore() store: StoreRow,
    @CurrentOwner() me: OwnerRow,
    @Param('ownerId', ParseUUIDPipe) ownerId: string,
    @Req() req: OwnerRequest,
  ) {
    return this.team.removeMember(store, me, ownerId, requestContext(req));
  }
}
