import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { ZodPipe } from '../common/zod.pipe.js';
import type { AdminRow } from './admin-auth.service.js';
import { AdminGuard, Can, CurrentAdmin, type AdminRequest } from './admin.guard.js';
import { AdminUsersService } from './admin-users.service.js';

const uuid = new ParseUUIDPipe({ errorHttpStatusCode: 404 });

const inviteSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.email().max(255),
  role: z.string().trim().min(1).max(40),
  /** Leave out to send an emailed invite; set it only for scripts and local setup. */
  password: z.string().min(1).max(200).optional(),
});
const updateSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    role: z.string().trim().min(1).max(40).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'nothing to change');

/** Restrovia staff accounts (admin.restrovia.shop/api/admin/admins). */
@Controller('api/admin')
@UseGuards(AdminGuard)
export class AdminUsersController {
  constructor(private readonly users: AdminUsersService) {}

  @Get('admins')
  @Can('users.view')
  list(@CurrentAdmin() admin: AdminRow) {
    return this.users.list(admin);
  }

  @Get('admins/:id')
  @Can('users.view')
  detail(@Param('id', uuid) id: string, @CurrentAdmin() admin: AdminRow) {
    return this.users.detail(id, admin);
  }

  @Post('admins')
  @Can('users.manage')
  invite(
    @Body(new ZodPipe(inviteSchema)) body: z.infer<typeof inviteSchema>,
    @CurrentAdmin() admin: AdminRow,
    @Req() req: AdminRequest,
  ) {
    return this.users.invite(body, admin, req.ip ?? null);
  }

  @Patch('admins/:id')
  @Can('users.manage')
  update(
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(updateSchema)) body: z.infer<typeof updateSchema>,
    @CurrentAdmin() admin: AdminRow,
    @Req() req: AdminRequest,
  ) {
    return this.users.update(id, body, admin, req.ip ?? null);
  }

  @Post('admins/:id/disable')
  @HttpCode(200)
  @Can('users.manage')
  disable(
    @Param('id', uuid) id: string,
    @CurrentAdmin() admin: AdminRow,
    @Req() req: AdminRequest,
  ) {
    return this.users.setStatus(id, 'disabled', admin, req.ip ?? null);
  }

  @Post('admins/:id/enable')
  @HttpCode(200)
  @Can('users.manage')
  enable(@Param('id', uuid) id: string, @CurrentAdmin() admin: AdminRow, @Req() req: AdminRequest) {
    return this.users.setStatus(id, 'active', admin, req.ip ?? null);
  }

  @Post('admins/:id/reset-2fa')
  @HttpCode(200)
  @Can('users.manage')
  resetTwoFactor(
    @Param('id', uuid) id: string,
    @CurrentAdmin() admin: AdminRow,
    @Req() req: AdminRequest,
  ) {
    return this.users.resetTwoFactor(id, admin, req.ip ?? null);
  }

  @Post('admins/:id/resend-invite')
  @HttpCode(200)
  @Can('users.manage')
  resendInvite(
    @Param('id', uuid) id: string,
    @CurrentAdmin() admin: AdminRow,
    @Req() req: AdminRequest,
  ) {
    return this.users.resendInvite(id, admin, req.ip ?? null);
  }

  @Post('admins/:id/cancel-invite')
  @HttpCode(200)
  @Can('users.manage')
  cancelInvite(
    @Param('id', uuid) id: string,
    @CurrentAdmin() admin: AdminRow,
    @Req() req: AdminRequest,
  ) {
    return this.users.cancelInvite(id, admin, req.ip ?? null);
  }

  @Post('admins/:id/send-password-reset')
  @HttpCode(200)
  @Can('users.manage')
  sendPasswordReset(
    @Param('id', uuid) id: string,
    @CurrentAdmin() admin: AdminRow,
    @Req() req: AdminRequest,
  ) {
    return this.users.sendPasswordReset(id, admin, req.ip ?? null);
  }

  @Post('admins/:id/end-sessions')
  @HttpCode(200)
  @Can('users.manage')
  endSessions(
    @Param('id', uuid) id: string,
    @CurrentAdmin() admin: AdminRow,
    @Req() req: AdminRequest,
  ) {
    return this.users.endAllSessions(id, admin, req.ip ?? null);
  }

  @Delete('admins/:id/sessions/:sessionId')
  @Can('users.manage')
  endSession(
    @Param('id', uuid) id: string,
    @Param('sessionId', uuid) sessionId: string,
    @CurrentAdmin() admin: AdminRow,
    @Req() req: AdminRequest,
  ) {
    return this.users.endSession(id, sessionId, admin, req.ip ?? null);
  }
}
