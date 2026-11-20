import { Controller, Get, Header, HttpCode, Post, Query, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { StoreEmailService } from './store-email.service.js';

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const page = (title: string, body: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escape(title)}</title></head><body style="font-family:system-ui,sans-serif;max-width:420px;margin:15vh auto;padding:0 20px;line-height:1.5;color:#111"><h1 style="font-size:20px">${escape(title)}</h1>${body}</body></html>`;

const INVALID = page(
  'This link no longer works',
  '<p>It may have expired or been used already. Ask for a new email from Restrovia POS under Settings, Cloud account.</p>',
);

/**
 * The page behind the link in a store's verification email. Opening it only shows a button, so a
 * mail scanner that fetches the link can't confirm the address on the owner's behalf.
 */
@Controller('api/email')
@UseGuards(ThrottlerGuard)
@Throttle({ default: { limit: 30, ttl: 60_000 } })
export class StoreEmailController {
  constructor(private readonly storeEmail: StoreEmailService) {}

  @Get('verify')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  @Header('Referrer-Policy', 'no-referrer')
  async show(@Query('token') token?: string) {
    const address = token ? await this.storeEmail.pendingAddress(token) : null;
    if (!token || !address) return INVALID;
    return page(
      'Confirm your email address',
      `<p>Confirm <strong>${escape(address)}</strong> for Restrovia.</p><form method="post" action="/api/email/verify?token=${encodeURIComponent(token)}"><button type="submit" style="padding:10px 18px;background:#111;color:#fff;border:0;border-radius:6px;font-size:15px;cursor:pointer">Confirm email address</button></form>`,
    );
  }

  @Post('verify')
  @HttpCode(200)
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  async confirm(@Query('token') token?: string) {
    if (!token || !(await this.storeEmail.confirm(token))) return INVALID;
    return page(
      'Email address confirmed',
      '<p>Thank you. You can close this page and go back to Restrovia POS.</p>',
    );
  }
}
