import { Body, Controller, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { OWNER_AUTH } from '@restrovia/shared';
import { ZodPipe } from '../common/zod.pipe.js';
import { OwnerAuthService } from './owner-auth.service.js';
import {
  AllowedBeforeOwnPassword,
  OWNER_COOKIE,
  OwnerCsrfGuard,
  OwnerGuard,
  requestContext,
  type OwnerRequest,
} from './owner.guard.js';

const MINUTE = 60_000;
/** Tests raise every limit with OWNER_AUTH_LIMIT. */
export const limit = (n: number) => () => Number(process.env.OWNER_AUTH_LIMIT) || n;

export const emailField = z.email().trim().max(255);
export const passwordField = z.string().min(1).max(OWNER_AUTH.passwordMax);
const tokenField = z.string().min(16).max(200);
export const secondFactorFields = {
  code: z
    .string()
    .regex(/^\d{6}$/)
    .optional(),
  recovery_code: z.string().trim().min(8).max(20).optional(),
};

const loginSchema = z.object({ email: emailField, password: passwordField });
const twoFactorSchema = z
  .object({ challenge_token: z.string().min(1).max(2000), ...secondFactorFields })
  .refine((v) => !v.code !== !v.recovery_code, 'send either code or recovery_code');
const tokenSchema = z.object({ token: tokenField });
const emailSchema = z.object({ email: emailField });
const passwordLinkSchema = z.object({ token: tokenField, password: passwordField });

export function setOwnerCookie(res: Response, token: string) {
  res.cookie(OWNER_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    // Lax, so opening the portal from a link in an email keeps the owner signed in.
    sameSite: 'lax',
    path: '/api/owner',
    maxAge: OWNER_AUTH.sessionDays * 24 * 60 * MINUTE,
  });
}

/** Owner portal sign-in (app.restrovia.shop/api/owner/auth). */
@Controller('api/owner/auth')
export class OwnerAuthController {
  constructor(private readonly auth: OwnerAuthService) {}

  @Post('login')
  @HttpCode(200)
  @UseGuards(OwnerCsrfGuard, ThrottlerGuard)
  @Throttle({ default: { limit: limit(10), ttl: 15 * MINUTE } })
  async login(
    @Body(new ZodPipe(loginSchema)) body: z.infer<typeof loginSchema>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.login(body.email, body.password, requestContext(req));
    if (result.status === '2fa_required') return result;
    setOwnerCookie(res, result.token);
    return { status: 'ok', owner: result.owner };
  }

  @Post('2fa')
  @HttpCode(200)
  @UseGuards(OwnerCsrfGuard, ThrottlerGuard)
  @Throttle({ default: { limit: limit(10), ttl: 15 * MINUTE } })
  async twoFactor(
    @Body(new ZodPipe(twoFactorSchema)) body: z.infer<typeof twoFactorSchema>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { owner, token } = await this.auth.completeTwoFactor(
      body.challenge_token,
      { code: body.code, recovery_code: body.recovery_code },
      requestContext(req),
    );
    setOwnerCookie(res, token);
    return { status: 'ok', owner };
  }

  @Post('logout')
  @AllowedBeforeOwnPassword()
  @HttpCode(200)
  @UseGuards(OwnerGuard)
  async logout(@Req() req: OwnerRequest, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(req.ownerSessionId!, req.owner!.id, requestContext(req));
    res.clearCookie(OWNER_COOKIE, { path: '/api/owner' });
    return { ok: true };
  }

  @Post('verify-email')
  @HttpCode(200)
  @UseGuards(OwnerCsrfGuard, ThrottlerGuard)
  @Throttle({ default: { limit: limit(20), ttl: 15 * MINUTE } })
  verifyEmail(
    @Body(new ZodPipe(tokenSchema)) body: z.infer<typeof tokenSchema>,
    @Req() req: Request,
  ) {
    return this.auth.verifyEmail(body.token, requestContext(req));
  }

  /** The link in the invite email from the Restrovia team: first password, then signed in. */
  @Post('set-password')
  @HttpCode(200)
  @UseGuards(OwnerCsrfGuard, ThrottlerGuard)
  @Throttle({ default: { limit: limit(10), ttl: 15 * MINUTE } })
  async setPassword(
    @Body(new ZodPipe(passwordLinkSchema)) body: z.infer<typeof passwordLinkSchema>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { owner, token } = await this.auth.acceptInvite(
      body.token,
      body.password,
      requestContext(req),
    );
    setOwnerCookie(res, token);
    return { status: 'ok', owner };
  }

  @Post('password/forgot')
  @HttpCode(200)
  @UseGuards(OwnerCsrfGuard, ThrottlerGuard)
  @Throttle({ default: { limit: limit(10), ttl: 60 * MINUTE } })
  async forgotPassword(@Body(new ZodPipe(emailSchema)) body: z.infer<typeof emailSchema>) {
    await this.auth.forgotPassword(body.email);
    return { ok: true };
  }

  @Post('password/reset')
  @HttpCode(200)
  @UseGuards(OwnerCsrfGuard, ThrottlerGuard)
  @Throttle({ default: { limit: limit(10), ttl: 15 * MINUTE } })
  async resetPassword(
    @Body(new ZodPipe(passwordLinkSchema)) body: z.infer<typeof passwordLinkSchema>,
    @Req() req: Request,
  ) {
    await this.auth.resetPassword(body.token, body.password, requestContext(req));
    return { ok: true };
  }
}
