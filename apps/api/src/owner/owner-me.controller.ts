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
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Response } from 'express';
import { z } from 'zod';
import { ZodPipe } from '../common/zod.pipe.js';
import {
  emailField,
  limit,
  passwordField,
  secondFactorFields,
  setOwnerCookie,
} from './owner-auth.controller.js';
import { OwnerAccountService } from './owner-account.service.js';
import type { OwnerRow } from './owner-sessions.js';
import { OwnerTwoFactorService } from './owner-two-factor.service.js';
import {
  AllowedBeforeOwnPassword,
  CurrentOwner,
  OwnerGuard,
  requestContext,
  type OwnerRequest,
} from './owner.guard.js';

const MINUTE = 60_000;
const uuid = new ParseUUIDPipe({ errorHttpStatusCode: 404 });

const profileSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    phone: z
      .string()
      .regex(/^\+[1-9]\d{7,14}$/, 'phone: international format, e.g. +919800000000')
      .nullable()
      .optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'nothing to change');
const passwordSchema = z.object({
  current_password: passwordField,
  new_password: passwordField,
  ...secondFactorFields,
});
const emailSchema = z.object({ password: passwordField, new_email: emailField });
const setupSchema = z.object({ password: passwordField });
const enableSchema = z.object({
  setup_token: z.string().min(1).max(2000),
  code: z.string().regex(/^\d{6}$/),
});
const confirmSchema = z
  .object({ password: passwordField, ...secondFactorFields })
  .refine((v) => !v.code !== !v.recovery_code, 'send either code or recovery_code');

/** The signed-in owner's account (app.restrovia.in/api/owner/me). */
@Controller('api/owner/me')
@UseGuards(OwnerGuard)
export class OwnerMeController {
  constructor(
    private readonly account: OwnerAccountService,
    private readonly twoFactor: OwnerTwoFactorService,
  ) {}

  @Get()
  @AllowedBeforeOwnPassword()
  me(@CurrentOwner() owner: OwnerRow) {
    return this.account.me(owner);
  }

  @Patch()
  update(
    @CurrentOwner() owner: OwnerRow,
    @Body(new ZodPipe(profileSchema)) body: z.infer<typeof profileSchema>,
  ) {
    return this.account.updateProfile(owner, body);
  }

  @Post('password')
  @AllowedBeforeOwnPassword()
  @HttpCode(200)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: limit(10), ttl: 15 * MINUTE } })
  async changePassword(
    @CurrentOwner() owner: OwnerRow,
    @Body(new ZodPipe(passwordSchema)) body: z.infer<typeof passwordSchema>,
    @Req() req: OwnerRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const token = await this.account.changePassword(owner, body, requestContext(req));
    setOwnerCookie(res, token);
    return { ok: true };
  }

  @Post('email')
  @HttpCode(200)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: limit(5), ttl: 60 * MINUTE } })
  async changeEmail(
    @CurrentOwner() owner: OwnerRow,
    @Body(new ZodPipe(emailSchema)) body: z.infer<typeof emailSchema>,
  ) {
    await this.account.changeEmail(owner, body.password, body.new_email);
    return { status: 'check_email' };
  }

  @Post('2fa/setup')
  @HttpCode(200)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: limit(10), ttl: 15 * MINUTE } })
  setupTwoFactor(
    @CurrentOwner() owner: OwnerRow,
    @Body(new ZodPipe(setupSchema)) body: z.infer<typeof setupSchema>,
  ) {
    return this.twoFactor.setup(owner, body.password);
  }

  @Post('2fa/enable')
  @HttpCode(200)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: limit(10), ttl: 15 * MINUTE } })
  enableTwoFactor(
    @CurrentOwner() owner: OwnerRow,
    @Body(new ZodPipe(enableSchema)) body: z.infer<typeof enableSchema>,
    @Req() req: OwnerRequest,
  ) {
    return this.twoFactor.enable(
      owner,
      req.ownerSessionId!,
      body.setup_token,
      body.code,
      requestContext(req),
    );
  }

  @Post('2fa/disable')
  @HttpCode(200)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: limit(10), ttl: 15 * MINUTE } })
  async disableTwoFactor(
    @CurrentOwner() owner: OwnerRow,
    @Body(new ZodPipe(confirmSchema)) body: z.infer<typeof confirmSchema>,
    @Req() req: OwnerRequest,
  ) {
    await this.twoFactor.disable(
      owner,
      req.ownerSessionId!,
      body.password,
      body,
      requestContext(req),
    );
    return { ok: true };
  }

  @Post('2fa/recovery-codes')
  @HttpCode(200)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: limit(10), ttl: 15 * MINUTE } })
  regenerateRecoveryCodes(
    @CurrentOwner() owner: OwnerRow,
    @Body(new ZodPipe(confirmSchema)) body: z.infer<typeof confirmSchema>,
    @Req() req: OwnerRequest,
  ) {
    return this.twoFactor.regenerateRecoveryCodes(owner, body.password, body, requestContext(req));
  }

  @Get('sessions')
  sessions(@CurrentOwner() owner: OwnerRow, @Req() req: OwnerRequest) {
    return this.account.sessions(owner, req.ownerSessionId!);
  }

  @Delete('sessions/:id')
  async revokeSession(@CurrentOwner() owner: OwnerRow, @Param('id', uuid) id: string) {
    await this.account.revokeSession(owner, id);
    return { ok: true };
  }

  @Post('sessions/revoke-others')
  @HttpCode(200)
  async revokeOthers(@CurrentOwner() owner: OwnerRow, @Req() req: OwnerRequest) {
    await this.account.revokeOtherSessions(owner, req.ownerSessionId!);
    return { ok: true };
  }

  @Get('security-events')
  securityEvents(@CurrentOwner() owner: OwnerRow) {
    return this.account.securityEvents(owner);
  }
}
