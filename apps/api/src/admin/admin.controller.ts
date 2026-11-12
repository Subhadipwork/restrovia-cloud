import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Response } from 'express';
import { z } from 'zod';
import {
  ADMIN_ROLES,
  PLAN_INTERVALS,
  SUBSCRIPTION_STATUSES,
  STORE_STATUSES,
  TICKET_STATUSES,
} from '@restrovia/shared';
import { ZodPipe } from '../common/zod.pipe.js';
import {
  ADMIN_SESSION_HOURS,
  AdminAuthService,
  toPublic,
  type AdminRow,
} from './admin-auth.service.js';
import {
  ADMIN_COOKIE,
  AdminCsrfGuard,
  AdminGuard,
  CurrentAdmin,
  Roles,
  type AdminRequest,
} from './admin.guard.js';
import {
  AdminService,
  type LicenceAction,
  type PlanInput,
  type PlanUpdate,
  type StoreStatusInput,
} from './admin.service.js';

const uuid = new ParseUUIDPipe({ errorHttpStatusCode: 404 });

const loginSchema = z.object({
  email: z.email().max(255),
  password: z.string().min(1).max(200),
  code: z
    .string()
    .regex(/^\d{6}$/)
    .optional(),
});
const setupSchema = z.object({
  setup_token: z.string().min(1).max(2000),
  code: z.string().regex(/^\d{6}$/),
});
const pageSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(100).default(25),
});
const storesQuery = pageSchema.extend({
  search: z.string().max(100).optional(),
  status: z.enum(STORE_STATUSES).optional(),
  licence: z.enum([...SUBSCRIPTION_STATUSES, 'none']).optional(),
});
const storeStatusSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('block'),
    reason: z.string().trim().min(3).max(500),
    notify_owners: z.boolean().default(true),
  }),
  z.object({ action: z.literal('unblock'), notify_owners: z.boolean().default(true) }),
]);

const licenceSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('extend_trial'),
    days: z.number().int().min(1).max(90),
    note: z.string().max(500).optional(),
  }),
  z.object({
    action: z.literal('activate'),
    plan_code: z.string().min(1).max(64),
    amount: z
      .string()
      .regex(/^\d{1,8}(\.\d{1,2})?$/)
      .optional(),
    note: z.string().max(500).optional(),
  }),
  z.object({ action: z.literal('suspend'), note: z.string().max(500).optional() }),
]);
const ticketsQuery = pageSchema.extend({ status: z.enum(TICKET_STATUSES).optional() });
const ticketUpdateSchema = z.object({
  status: z.enum(TICKET_STATUSES).optional(),
  assigned_admin_id: z.uuid().nullable().optional(),
});
const noteSchema = z.object({ body: z.string().trim().min(1).max(5000) });
const createAdminSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.email().max(255),
  role: z.enum(ADMIN_ROLES),
  password: z.string().min(12).max(200),
});
const auditQuery = pageSchema.extend({
  action: z.string().max(64).optional(),
  target_id: z.string().max(64).optional(),
});

const plansQuery = z.object({ include_inactive: z.enum(['true', 'false']).optional() });
const price = z
  .string()
  .regex(/^\d{1,8}(\.\d{1,2})?$/, 'price must be a number with up to 2 decimals');
const features = z.record(z.string(), z.unknown());
const createPlanSchema = z.object({
  code: z
    .string()
    .regex(
      /^[a-z0-9][a-z0-9_]{1,62}$/,
      'code: lowercase letters, digits and _ (e.g. outlet_monthly)',
    ),
  name: z.string().trim().min(1).max(100),
  price,
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .default('INR'),
  interval: z.enum(PLAN_INTERVALS),
  max_devices: z.number().int().min(1).max(100).default(1),
  features: features.optional(),
});
const updatePlanSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    price: price.optional(),
    max_devices: z.number().int().min(1).max(100).optional(),
    is_active: z.boolean().optional(),
    features: features.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'nothing to change');

const page = (q: { page: number; per_page: number }) => ({ page: q.page, perPage: q.per_page });

/** Admin panel API (admin.restrovia.in/api/admin). Every change is written to the audit log. */
@Controller('api/admin')
export class AdminController {
  constructor(
    private readonly auth: AdminAuthService,
    private readonly admin: AdminService,
  ) {}

  private setSessionCookie(res: Response, token: string) {
    res.cookie(ADMIN_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/api/admin',
      maxAge: ADMIN_SESSION_HOURS * 3_600_000,
    });
  }

  @Post('auth/login')
  @HttpCode(200)
  @UseGuards(AdminCsrfGuard, ThrottlerGuard)
  @Throttle({
    default: { limit: () => Number(process.env.ADMIN_LOGIN_LIMIT) || 10, ttl: 15 * 60_000 },
  })
  async login(
    @Body(new ZodPipe(loginSchema)) body: z.infer<typeof loginSchema>,
    @Req() req: AdminRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.login(body.email, body.password, body.code, req.ip ?? null);
    if (result.status === 'setup_required') return result;
    this.setSessionCookie(res, result.token);
    return { status: 'ok', admin: result.admin };
  }

  @Post('auth/setup-2fa')
  @HttpCode(200)
  @UseGuards(AdminCsrfGuard, ThrottlerGuard)
  @Throttle({
    default: { limit: () => Number(process.env.ADMIN_LOGIN_LIMIT) || 10, ttl: 15 * 60_000 },
  })
  async setupTwoFactor(
    @Body(new ZodPipe(setupSchema)) body: z.infer<typeof setupSchema>,
    @Req() req: AdminRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { admin, token } = await this.auth.completeSetup(
      body.setup_token,
      body.code,
      req.ip ?? null,
    );
    this.setSessionCookie(res, token);
    return { status: 'ok', admin };
  }

  @Post('auth/logout')
  @HttpCode(200)
  @UseGuards(AdminGuard)
  async logout(@Req() req: AdminRequest, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(req.adminSessionId!, req.admin!.id, req.ip ?? null);
    res.clearCookie(ADMIN_COOKIE, { path: '/api/admin' });
    return { ok: true };
  }

  @Get('auth/me')
  @UseGuards(AdminGuard)
  me(@CurrentAdmin() admin: AdminRow) {
    return { admin: toPublic(admin) };
  }

  @Get('overview')
  @UseGuards(AdminGuard)
  overview() {
    return this.admin.overview();
  }

  @Get('stores')
  @UseGuards(AdminGuard)
  stores(@Query(new ZodPipe(storesQuery)) q: z.infer<typeof storesQuery>) {
    return this.admin.listStores(q, page(q));
  }

  @Get('stores/:id')
  @UseGuards(AdminGuard)
  store(@Param('id', uuid) id: string) {
    return this.admin.storeDetail(id);
  }

  @Get('plans')
  @UseGuards(AdminGuard)
  plans(@Query(new ZodPipe(plansQuery)) q: z.infer<typeof plansQuery>) {
    return this.admin.listPlans(q.include_inactive === 'true');
  }

  @Post('plans')
  @UseGuards(AdminGuard)
  @Roles('super_admin')
  createPlan(
    @Body(new ZodPipe(createPlanSchema)) body: PlanInput,
    @CurrentAdmin() admin: AdminRow,
    @Req() req: AdminRequest,
  ) {
    return this.admin.createPlan(body, admin, req.ip ?? null);
  }

  @Patch('plans/:id')
  @UseGuards(AdminGuard)
  @Roles('super_admin')
  updatePlan(
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(updatePlanSchema)) body: PlanUpdate,
    @CurrentAdmin() admin: AdminRow,
    @Req() req: AdminRequest,
  ) {
    return this.admin.updatePlan(id, body, admin, req.ip ?? null);
  }

  @Post('stores/:id/status')
  @HttpCode(200)
  @UseGuards(AdminGuard)
  @Roles('super_admin', 'sales')
  storeStatus(
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(storeStatusSchema)) body: StoreStatusInput,
    @CurrentAdmin() admin: AdminRow,
    @Req() req: AdminRequest,
  ) {
    return this.admin.changeStoreStatus(id, body, admin, req.ip ?? null);
  }

  @Post('stores/:id/licence')
  @HttpCode(200)
  @UseGuards(AdminGuard)
  @Roles('super_admin', 'sales')
  licence(
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(licenceSchema)) body: LicenceAction,
    @CurrentAdmin() admin: AdminRow,
    @Req() req: AdminRequest,
  ) {
    return this.admin.changeLicence(id, body, admin, req.ip ?? null);
  }

  @Get('tickets')
  @UseGuards(AdminGuard)
  @Roles('super_admin', 'support')
  tickets(@Query(new ZodPipe(ticketsQuery)) q: z.infer<typeof ticketsQuery>) {
    return this.admin.listTickets(q.status, page(q));
  }

  @Get('tickets/:id')
  @UseGuards(AdminGuard)
  @Roles('super_admin', 'support')
  ticket(@Param('id', uuid) id: string) {
    return this.admin.ticketDetail(id);
  }

  @Patch('tickets/:id')
  @UseGuards(AdminGuard)
  @Roles('super_admin', 'support')
  updateTicket(
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(ticketUpdateSchema)) body: z.infer<typeof ticketUpdateSchema>,
    @CurrentAdmin() admin: AdminRow,
    @Req() req: AdminRequest,
  ) {
    return this.admin.updateTicket(id, body, admin, req.ip ?? null);
  }

  @Post('tickets/:id/notes')
  @UseGuards(AdminGuard)
  @Roles('super_admin', 'support')
  addNote(
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(noteSchema)) body: z.infer<typeof noteSchema>,
    @CurrentAdmin() admin: AdminRow,
    @Req() req: AdminRequest,
  ) {
    return this.admin.addTicketNote(id, body.body, admin, req.ip ?? null);
  }

  @Get('admins')
  @UseGuards(AdminGuard)
  @Roles('super_admin')
  admins() {
    return this.admin.listAdmins();
  }

  @Post('admins')
  @UseGuards(AdminGuard)
  @Roles('super_admin')
  createAdmin(
    @Body(new ZodPipe(createAdminSchema)) body: z.infer<typeof createAdminSchema>,
    @CurrentAdmin() admin: AdminRow,
    @Req() req: AdminRequest,
  ) {
    return this.admin.createAdmin(body, admin, req.ip ?? null);
  }

  @Post('admins/:id/disable')
  @HttpCode(200)
  @UseGuards(AdminGuard)
  @Roles('super_admin')
  disableAdmin(
    @Param('id', uuid) id: string,
    @CurrentAdmin() admin: AdminRow,
    @Req() req: AdminRequest,
  ) {
    return this.admin.setAdminStatus(id, 'disabled', admin, req.ip ?? null);
  }

  @Post('admins/:id/enable')
  @HttpCode(200)
  @UseGuards(AdminGuard)
  @Roles('super_admin')
  enableAdmin(
    @Param('id', uuid) id: string,
    @CurrentAdmin() admin: AdminRow,
    @Req() req: AdminRequest,
  ) {
    return this.admin.setAdminStatus(id, 'active', admin, req.ip ?? null);
  }

  @Post('stores/:id/devices/:deviceId/reset-binding')
  @HttpCode(200)
  @UseGuards(AdminGuard)
  @Roles('super_admin', 'support')
  resetDeviceBinding(
    @Param('id', uuid) id: string,
    @Param('deviceId', uuid) deviceId: string,
    @CurrentAdmin() admin: AdminRow,
    @Req() req: AdminRequest,
  ) {
    return this.admin.resetDeviceBinding(id, deviceId, admin, req.ip ?? null);
  }

  @Post('admins/:id/reset-2fa')
  @HttpCode(200)
  @UseGuards(AdminGuard)
  @Roles('super_admin')
  resetTwoFactor(
    @Param('id', uuid) id: string,
    @CurrentAdmin() admin: AdminRow,
    @Req() req: AdminRequest,
  ) {
    return this.admin.resetTwoFactor(id, admin, req.ip ?? null);
  }

  @Get('audit-log')
  @UseGuards(AdminGuard)
  @Roles('super_admin')
  auditLog(@Query(new ZodPipe(auditQuery)) q: z.infer<typeof auditQuery>) {
    return this.admin.auditLog(q, page(q));
  }
}
