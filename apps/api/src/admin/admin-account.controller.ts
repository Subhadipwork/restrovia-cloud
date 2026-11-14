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
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { z } from 'zod';
import { ZodPipe } from '../common/zod.pipe.js';
import { AdminAuthService, type AdminRow } from './admin-auth.service.js';
import { AdminAccountService } from './admin-account.service.js';
import {
  AdminCsrfGuard,
  AdminGuard,
  CurrentAdmin,
  SignedIn,
  type AdminRequest,
} from './admin.guard.js';
import { AdminUsersService } from './admin-users.service.js';

const token = z.string().min(20).max(200);
const password = z.string().min(1).max(200);
/** Per IP: links and password guesses are both worth slowing down. */
const LINK_LIMIT = {
  default: { limit: () => Number(process.env.ADMIN_LOGIN_LIMIT) || 10, ttl: 15 * 60_000 },
};

const tokenQuery = z.object({ token });
const acceptSchema = z.object({ token, password });
const forgotSchema = z.object({ email: z.email().max(255) });
const renameSchema = z.object({ name: z.string().trim().min(1).max(100) });
const passwordSchema = z.object({ current_password: password, new_password: password });
const twoFactorSchema = z.object({ password, code: z.string().regex(/^\d{6}$/) });
const enableSchema = z.object({
  setup_token: z.string().min(1).max(2000),
  code: z.string().regex(/^\d{6}$/),
});

/** Links from emails (no session yet) and each admin's own account. */
@Controller('api/admin')
export class AdminAccountController {
  constructor(
    private readonly account: AdminAccountService,
    private readonly users: AdminUsersService,
    private readonly auth: AdminAuthService,
  ) {}

  @Get('auth/invite')
  @UseGuards(ThrottlerGuard)
  @Throttle(LINK_LIMIT)
  inviteInfo(@Query(new ZodPipe(tokenQuery)) q: z.infer<typeof tokenQuery>) {
    return this.account.inviteInfo(q.token);
  }

  @Post('auth/accept-invite')
  @HttpCode(200)
  @UseGuards(AdminCsrfGuard, ThrottlerGuard)
  @Throttle(LINK_LIMIT)
  acceptInvite(
    @Body(new ZodPipe(acceptSchema)) body: z.infer<typeof acceptSchema>,
    @Req() req: AdminRequest,
  ) {
    return this.account.acceptInvite(body.token, body.password, req.ip ?? null);
  }

  @Post('auth/forgot-password')
  @HttpCode(200)
  @UseGuards(AdminCsrfGuard, ThrottlerGuard)
  @Throttle(LINK_LIMIT)
  async forgotPassword(
    @Body(new ZodPipe(forgotSchema)) body: z.infer<typeof forgotSchema>,
    @Req() req: AdminRequest,
  ) {
    await this.account.forgotPassword(body.email, req.ip ?? null);
    return { ok: true };
  }

  @Post('auth/reset-password')
  @HttpCode(200)
  @UseGuards(AdminCsrfGuard, ThrottlerGuard)
  @Throttle(LINK_LIMIT)
  resetPassword(
    @Body(new ZodPipe(acceptSchema)) body: z.infer<typeof acceptSchema>,
    @Req() req: AdminRequest,
  ) {
    return this.account.resetPassword(body.token, body.password, req.ip ?? null);
  }

  @Get('account')
  @UseGuards(AdminGuard)
  @SignedIn()
  get(@CurrentAdmin() admin: AdminRow, @Req() req: AdminRequest) {
    return this.account.account(admin, req.adminSessionId!);
  }

  @Patch('account')
  @UseGuards(AdminGuard)
  @SignedIn()
  rename(
    @Body(new ZodPipe(renameSchema)) body: z.infer<typeof renameSchema>,
    @CurrentAdmin() admin: AdminRow,
    @Req() req: AdminRequest,
  ) {
    return this.account.rename(admin, body.name, req.ip ?? null);
  }

  @Post('account/password')
  @HttpCode(200)
  @UseGuards(AdminGuard, ThrottlerGuard)
  @Throttle(LINK_LIMIT)
  @SignedIn()
  changePassword(
    @Body(new ZodPipe(passwordSchema)) body: z.infer<typeof passwordSchema>,
    @CurrentAdmin() admin: AdminRow,
    @Req() req: AdminRequest,
  ) {
    return this.account.changePassword(
      admin,
      req.adminSessionId!,
      body.current_password,
      body.new_password,
      req.ip ?? null,
    );
  }

  @Post('account/2fa/setup')
  @HttpCode(200)
  @UseGuards(AdminGuard)
  @SignedIn()
  startTwoFactor(@CurrentAdmin() admin: AdminRow) {
    return this.auth.startTwoFactor(admin);
  }

  @Post('account/2fa/enable')
  @HttpCode(200)
  @UseGuards(AdminGuard, ThrottlerGuard)
  @Throttle(LINK_LIMIT)
  @SignedIn()
  enableTwoFactor(
    @Body(new ZodPipe(enableSchema)) body: z.infer<typeof enableSchema>,
    @CurrentAdmin() admin: AdminRow,
    @Req() req: AdminRequest,
  ) {
    return this.auth.enableTwoFactor(admin, body.setup_token, body.code, req.ip ?? null);
  }

  @Post('account/2fa/disable')
  @HttpCode(200)
  @UseGuards(AdminGuard, ThrottlerGuard)
  @Throttle(LINK_LIMIT)
  @SignedIn()
  disableTwoFactor(
    @Body(new ZodPipe(twoFactorSchema)) body: z.infer<typeof twoFactorSchema>,
    @CurrentAdmin() admin: AdminRow,
    @Req() req: AdminRequest,
  ) {
    return this.account.disableTwoFactor(admin, body.password, body.code, req.ip ?? null);
  }

  @Delete('account/sessions/:id')
  @UseGuards(AdminGuard)
  @SignedIn()
  endSession(
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) id: string,
    @CurrentAdmin() admin: AdminRow,
    @Req() req: AdminRequest,
  ) {
    return this.users.endSession(admin.id, id, admin, req.ip ?? null);
  }
}
