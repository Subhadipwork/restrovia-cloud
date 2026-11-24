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
import { z } from 'zod';
import { POLICY_KEYS, POLICY_MODES } from '@restrovia/shared';
import { ZodPipe } from '../common/zod.pipe.js';
import type { AdminRow } from './admin-auth.service.js';
import { AdminPolicyService } from './admin-policy.service.js';
import { AdminGuard, Can, CurrentAdmin, type AdminRequest } from './admin.guard.js';

const uuid = new ParseUUIDPipe({ errorHttpStatusCode: 404 });
const lockSchema = z.object({
  key: z.enum(POLICY_KEYS as [string, ...string[]]),
  mode: z.enum(POLICY_MODES).default('read_only'),
  effect: z.enum(['lock', 'unlock']).default('lock'),
  reason: z.string().trim().min(3).max(500),
  ends_at: z.iso.datetime().nullable().optional(),
  pos_device_id: z.uuid().nullable().optional(),
});
const removeSchema = z.object({ note: z.string().trim().min(3).max(500) });

/** Admin locks on a store's POS pages and settings (RESTROVIA_MARKETPLACE_PLAN.md, 7a). */
@Controller('api/admin')
@UseGuards(AdminGuard)
export class AdminPolicyController {
  constructor(private readonly policy: AdminPolicyService) {}

  @Get('stores/:id/locks')
  @Can('stores.view')
  list(@Param('id', uuid) id: string) {
    return this.policy.storeLocks(id);
  }

  @Post('stores/:id/locks')
  @Can('stores.licence')
  add(
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(lockSchema)) body: z.infer<typeof lockSchema>,
    @CurrentAdmin() admin: AdminRow,
    @Req() req: AdminRequest,
  ) {
    return this.policy.addLock(
      id,
      body as Parameters<AdminPolicyService['addLock']>[1],
      admin,
      req.ip ?? null,
    );
  }

  @Post('stores/:id/locks/:lockId/remove')
  @HttpCode(200)
  @Can('stores.licence')
  remove(
    @Param('id', uuid) id: string,
    @Param('lockId', uuid) lockId: string,
    @Body(new ZodPipe(removeSchema)) body: z.infer<typeof removeSchema>,
    @CurrentAdmin() admin: AdminRow,
    @Req() req: AdminRequest,
  ) {
    return this.policy.removeLock(id, lockId, body.note, admin, req.ip ?? null);
  }
}
