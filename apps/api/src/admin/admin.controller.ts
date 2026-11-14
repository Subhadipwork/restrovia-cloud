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
  PLAN_INTERVALS,
  SUBSCRIPTION_STATUSES,
  STORE_STATUSES,
  TICKET_STATUSES,
} from '@restrovia/shared';
import { ZodPipe } from '../common/zod.pipe.js';
import { AdminDashboardService } from './admin-dashboard.service.js';
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
  Can,
  CurrentAdmin,
  SignedIn,
  type AdminRequest,
} from './admin.guard.js';
import {
  AdminService,
  type LicenceAction,
  type PlanInput,
  type PlanUpdate,
  type StoreStatusInput,
} from './admin.service.js';
import {
  AdminStoreHistoryService,
  HISTORY_RANGES,
  type HistoryDays,
} from './admin-store-history.service.js';

const uuid = new ParseUUIDPipe({ errorHttpStatusCode: 404 });

const loginSchema = z.object({
  email: z.email().max(255),
  password: z.string().min(1).max(200),
  code: z
    .string()
    .regex(/^\d{6}$/)
    .optional(),
});
const dashboardQuery = z.object({ from: z.iso.date(), to: z.iso.date() });
const pageSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(100).default(25),
});
const historyQuery = z.object({
  days: z.coerce
    .number()
    .refine((n): n is HistoryDays => (HISTORY_RANGES as readonly number[]).includes(n))
    .default(30),
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
  z.object({
    action: z.literal('suspend'),
    immediate: z.boolean().optional(),
    note: z.string().max(500).optional(),
  }),
]);
const ticketsQuery = pageSchema.extend({ status: z.enum(TICKET_STATUSES).optional() });
const ticketUpdateSchema = z.object({
  status: z.enum(TICKET_STATUSES).optional(),
  assigned_admin_id: z.uuid().nullable().optional(),
});
const noteSchema = z.object({ body: z.string().trim().min(1).max(5000) });
const auditQuery = pageSchema.extend({
  action: z.string().max(64).optional(),
  target_id: z.string().max(64).optional(),
  admin_id: z.uuid().optional(),
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

/** Admin panel API (admin.restrovia.shop/api/admin). Every change is written to the audit log. */
@Controller('api/admin')
export class AdminController {
  constructor(
    private readonly auth: AdminAuthService,
    private readonly admin: AdminService,
    private readonly history: AdminStoreHistoryService,
    private readonly dashboardService: AdminDashboardService,
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
    const result = await this.auth.login(
      body.email,
      body.password,
      body.code,
      req.ip ?? null,
      req.header('user-agent') ?? null,
    );
    this.setSessionCookie(res, result.token);
    return { status: 'ok', admin: result.admin };
  }

  @Post('auth/logout')
  @HttpCode(200)
  @UseGuards(AdminGuard)
  @SignedIn()
  async logout(@Req() req: AdminRequest, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(req.adminSessionId!, req.admin!.id, req.ip ?? null);
    res.clearCookie(ADMIN_COOKIE, { path: '/api/admin' });
    return { ok: true };
  }

  @Get('auth/me')
  @UseGuards(AdminGuard)
  @SignedIn()
  me(@CurrentAdmin() admin: AdminRow) {
    return { admin: toPublic(admin) };
  }

  @Get('overview')
  @UseGuards(AdminGuard)
  @Can('overview.view')
  overview() {
    return this.admin.overview();
  }

  @Get('overview/dashboard')
  @UseGuards(AdminGuard)
  @Can('overview.view')
  dashboard(
    @Query(new ZodPipe(dashboardQuery)) q: z.infer<typeof dashboardQuery>,
    @CurrentAdmin() admin: AdminRow,
  ) {
    return this.dashboardService.dashboard(q.from, q.to, admin);
  }

  @Get('stores')
  @UseGuards(AdminGuard)
  @Can('stores.view')
  stores(@Query(new ZodPipe(storesQuery)) q: z.infer<typeof storesQuery>) {
    return this.admin.listStores(q, page(q));
  }

  @Get('stores/:id')
  @UseGuards(AdminGuard)
  @Can('stores.view')
  store(@Param('id', uuid) id: string) {
    return this.admin.storeDetail(id);
  }

  @Get('stores/:id/history')
  @UseGuards(AdminGuard)
  @Can('stores.view')
  storeHistory(
    @Param('id', uuid) id: string,
    @Query(new ZodPipe(historyQuery)) q: z.infer<typeof historyQuery>,
  ) {
    return this.history.history(id, q.days as HistoryDays);
  }

  @Get('plans')
  @UseGuards(AdminGuard)
  @Can('plans.view')
  plans(@Query(new ZodPipe(plansQuery)) q: z.infer<typeof plansQuery>) {
    return this.admin.listPlans(q.include_inactive === 'true');
  }

  @Post('plans')
  @UseGuards(AdminGuard)
  @Can('plans.manage')
  createPlan(
    @Body(new ZodPipe(createPlanSchema)) body: PlanInput,
    @CurrentAdmin() admin: AdminRow,
    @Req() req: AdminRequest,
  ) {
    return this.admin.createPlan(body, admin, req.ip ?? null);
  }

  @Patch('plans/:id')
  @UseGuards(AdminGuard)
  @Can('plans.manage')
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
  @Can('stores.block')
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
  @Can('stores.licence')
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
  @Can('tickets.view')
  tickets(@Query(new ZodPipe(ticketsQuery)) q: z.infer<typeof ticketsQuery>) {
    return this.admin.listTickets(q.status, page(q));
  }

  @Get('tickets/:id')
  @UseGuards(AdminGuard)
  @Can('tickets.view')
  ticket(@Param('id', uuid) id: string) {
    return this.admin.ticketDetail(id);
  }

  @Patch('tickets/:id')
  @UseGuards(AdminGuard)
  @Can('tickets.manage')
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
  @Can('tickets.manage')
  addNote(
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(noteSchema)) body: z.infer<typeof noteSchema>,
    @CurrentAdmin() admin: AdminRow,
    @Req() req: AdminRequest,
  ) {
    return this.admin.addTicketNote(id, body.body, admin, req.ip ?? null);
  }

  @Post('stores/:id/devices/:deviceId/reset-binding')
  @HttpCode(200)
  @UseGuards(AdminGuard)
  @Can('stores.devices')
  resetDeviceBinding(
    @Param('id', uuid) id: string,
    @Param('deviceId', uuid) deviceId: string,
    @CurrentAdmin() admin: AdminRow,
    @Req() req: AdminRequest,
  ) {
    return this.admin.resetDeviceBinding(id, deviceId, admin, req.ip ?? null);
  }

  @Get('audit-log')
  @UseGuards(AdminGuard)
  @Can('audit.view')
  auditLog(@Query(new ZodPipe(auditQuery)) q: z.infer<typeof auditQuery>) {
    return this.admin.auditLog(q, page(q));
  }
}
