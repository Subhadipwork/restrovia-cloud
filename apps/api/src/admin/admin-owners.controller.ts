import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { OWNER_AUTH } from '@restrovia/shared';
import { ZodPipe } from '../common/zod.pipe.js';
import type { AdminRow } from './admin-auth.service.js';
import { AdminGuard, Can, CurrentAdmin, type AdminRequest } from './admin.guard.js';
import { AdminOwnersService, type NewOwner } from './admin-owners.service.js';

const uuid = new ParseUUIDPipe({ errorHttpStatusCode: 404 });
const listQuery = z.object({
  search: z.string().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(100).default(25),
});
const reasonSchema = z.object({ reason: z.string().trim().min(3).max(500) });
const optionalReasonSchema = z.object({ reason: z.string().trim().max(500).optional() });
const newOwnerSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.email().trim().max(255),
  phone: z
    .string()
    .regex(/^\+[1-9]\d{7,14}$/, 'phone: international format, e.g. +919800000000')
    .optional(),
  password: z.string().min(1).max(OWNER_AUTH.passwordMax).optional(),
});
const passwordSchema = z.object({ password: z.string().min(1).max(OWNER_AUTH.passwordMax) });

/** Owner accounts in the admin panel (admin.restrovia.shop/api/admin). */
@Controller('api/admin')
@UseGuards(AdminGuard)
export class AdminOwnersController {
  constructor(private readonly owners: AdminOwnersService) {}

  @Get('owners')
  @Can('owners.view')
  list(@Query(new ZodPipe(listQuery)) q: z.infer<typeof listQuery>) {
    return this.owners.list(q.search, { page: q.page, perPage: q.per_page });
  }

  @Get('owners/:id')
  @Can('owners.view')
  detail(@Param('id', uuid) id: string) {
    return this.owners.detail(id);
  }

  @Post('owners/:id/reset-2fa')
  @HttpCode(200)
  @Can('owners.manage')
  resetTwoFactor(
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(reasonSchema)) body: z.infer<typeof reasonSchema>,
    @CurrentAdmin() admin: AdminRow,
    @Req() req: AdminRequest,
  ) {
    return this.owners.resetTwoFactor(id, body.reason, admin, req.ip ?? null);
  }

  @Post('owners/:id/disable')
  @HttpCode(200)
  @Can('owners.manage')
  disable(
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(optionalReasonSchema)) body: z.infer<typeof optionalReasonSchema>,
    @CurrentAdmin() admin: AdminRow,
    @Req() req: AdminRequest,
  ) {
    return this.owners.setStatus(id, 'disabled', body.reason, admin, req.ip ?? null);
  }

  @Post('owners/:id/enable')
  @HttpCode(200)
  @Can('owners.manage')
  enable(
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(optionalReasonSchema)) body: z.infer<typeof optionalReasonSchema>,
    @CurrentAdmin() admin: AdminRow,
    @Req() req: AdminRequest,
  ) {
    return this.owners.setStatus(id, 'active', body.reason, admin, req.ip ?? null);
  }

  @Post('owners/:id/resend-invite')
  @HttpCode(200)
  @Can('owners.invite')
  resendInvite(
    @Param('id', uuid) id: string,
    @CurrentAdmin() admin: AdminRow,
    @Req() req: AdminRequest,
  ) {
    return this.owners.resendInvite(id, admin, req.ip ?? null);
  }

  /** For an owner who can't sign in; they choose their own password at the next sign-in. */
  @Post('owners/:id/password')
  @HttpCode(200)
  @Can('owners.manage')
  setPassword(
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(passwordSchema)) body: z.infer<typeof passwordSchema>,
    @CurrentAdmin() admin: AdminRow,
    @Req() req: AdminRequest,
  ) {
    return this.owners.setPassword(id, body.password, admin, req.ip ?? null);
  }

  /** Creates the store's owner account (with a password, or an emailed invite) or links an existing one. */
  @Post('stores/:id/owners')
  @Can('owners.invite')
  addToStore(
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(newOwnerSchema)) body: NewOwner,
    @CurrentAdmin() admin: AdminRow,
    @Req() req: AdminRequest,
  ) {
    return this.owners.addToStore(id, body, admin, req.ip ?? null);
  }

  @Delete('stores/:id/owners/:ownerId')
  @Can('owners.manage')
  removeFromStore(
    @Param('id', uuid) id: string,
    @Param('ownerId', uuid) ownerId: string,
    @CurrentAdmin() admin: AdminRow,
    @Req() req: AdminRequest,
  ) {
    return this.owners.removeFromStore(id, ownerId, admin, req.ip ?? null);
  }
}
