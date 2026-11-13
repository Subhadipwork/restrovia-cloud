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
import { AdminRolesService } from './admin-roles.service.js';

const uuid = new ParseUUIDPipe({ errorHttpStatusCode: 404 });

const roleSchema = z.object({
  name: z.string().trim().min(2).max(60),
  description: z.string().trim().max(300).default(''),
  permissions: z.array(z.string().max(64)).max(100),
});
const roleUpdateSchema = roleSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'nothing to change');

/** Admin roles. Anyone who can see the team can see roles; changing them needs roles.manage. */
@Controller('api/admin')
@UseGuards(AdminGuard)
export class AdminRolesController {
  constructor(private readonly roles: AdminRolesService) {}

  @Get('admin-roles')
  @Can('users.view')
  list(@CurrentAdmin() admin: AdminRow) {
    return this.roles.list(admin);
  }

  @Get('admin-roles/:id')
  @Can('users.view')
  detail(@Param('id', uuid) id: string, @CurrentAdmin() admin: AdminRow) {
    return this.roles.detail(id, admin);
  }

  @Post('admin-roles')
  @Can('roles.manage')
  create(
    @Body(new ZodPipe(roleSchema)) body: z.infer<typeof roleSchema>,
    @CurrentAdmin() admin: AdminRow,
    @Req() req: AdminRequest,
  ) {
    return this.roles.create(body, admin, req.ip ?? null);
  }

  @Patch('admin-roles/:id')
  @Can('roles.manage')
  update(
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(roleUpdateSchema)) body: z.infer<typeof roleUpdateSchema>,
    @CurrentAdmin() admin: AdminRow,
    @Req() req: AdminRequest,
  ) {
    return this.roles.update(id, body, admin, req.ip ?? null);
  }

  @Delete('admin-roles/:id')
  @Can('roles.manage')
  remove(@Param('id', uuid) id: string, @CurrentAdmin() admin: AdminRow, @Req() req: AdminRequest) {
    return this.roles.remove(id, admin, req.ip ?? null);
  }

  @Post('admin-roles/:id/reset')
  @HttpCode(200)
  @Can('roles.manage')
  reset(@Param('id', uuid) id: string, @CurrentAdmin() admin: AdminRow, @Req() req: AdminRequest) {
    return this.roles.reset(id, admin, req.ip ?? null);
  }
}
