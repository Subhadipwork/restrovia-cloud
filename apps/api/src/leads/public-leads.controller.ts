import {
  Body,
  Controller,
  HttpCode,
  Logger,
  Options,
  PayloadTooLargeException,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import type { Env } from '../config/env.js';
import { EmailService } from '../email/email.service.js';
import { message } from '../owner/owner-emails.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { LeadsService } from './leads.service.js';
import { publicLeadSchema, type PublicLead } from './public-lead-schema.js';

const MINUTE = 60_000;
const MAX_BODY_BYTES = 4096;
const limit = (n: number) => () => Number(process.env.PUBLIC_FORM_LIMIT) || n;

/** The marketing site's enquiry form. No sign-in; the throttle, honeypot and CORS list protect it. */
@Controller('api/public')
export class PublicLeadsController {
  private readonly log = new Logger(PublicLeadsController.name);
  private readonly origins: Set<string>;
  private readonly notifyTo?: string;
  private readonly adminUrl: string;

  constructor(
    private readonly leads: LeadsService,
    private readonly email: EmailService,
    config: ConfigService<Env, true>,
  ) {
    this.origins = new Set(
      config
        .get('PUBLIC_FORM_ORIGINS', { infer: true })
        .split(',')
        .map((o) => o.trim().replace(/\/$/, ''))
        .filter(Boolean),
    );
    this.notifyTo = config.get('LEADS_NOTIFY_EMAIL', { infer: true });
    this.adminUrl = config.get('ADMIN_APP_URL', { infer: true }).replace(/\/$/, '');
  }

  /** Lets a browser on an allowed site read the answer; any other site gets no CORS headers. */
  private cors(req: Request, res: Response): void {
    const origin = req.headers.origin;
    res.setHeader('Vary', 'Origin');
    if (origin && this.origins.has(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  }

  @Options('leads')
  @HttpCode(204)
  preflight(@Req() req: Request, @Res({ passthrough: true }) res: Response): void {
    this.cors(req, res);
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Max-Age', '600');
  }

  @Post('leads')
  @HttpCode(200)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: limit(5), ttl: 10 * MINUTE } })
  async create(
    @Body() raw: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ ok: true }> {
    this.cors(req, res);
    if (Buffer.byteLength(JSON.stringify(raw ?? {})) > MAX_BODY_BYTES) {
      throw new PayloadTooLargeException({ error: 'too_large' });
    }
    // A filled honeypot gets the normal answer so a bot learns nothing.
    if (typeof (raw as { website?: unknown } | null)?.website === 'string') {
      if ((raw as { website: string }).website.trim()) return { ok: true };
    }
    const input = new ZodPipe(publicLeadSchema).transform(raw);
    const { id, repeat } = await this.leads.captureWebsite(input, req.ip ?? null);
    this.notify(input, id, repeat);
    return { ok: true };
  }

  private notify(input: PublicLead, id: string, repeat: boolean): void {
    if (!this.notifyTo) return;
    try {
      this.email.queue(
        message(
          this.notifyTo,
          `${repeat ? 'Repeat enquiry' : 'New enquiry'}: ${input.business_name ?? input.contact_name}`,
          [
            `${input.contact_name}${input.business_name ? ` (${input.business_name})` : ''} sent the website form${repeat ? ' again' : ''}.`,
            `Phone: ${input.phone}`,
            `Email: ${input.email ?? 'not given'}`,
            ...(input.message ? [`Message: ${input.message}`] : []),
          ],
          { url: `${this.adminUrl}/dashboard/leads/${id}`, label: 'Open the lead' },
        ),
      );
    } catch (err) {
      this.log.error(`Enquiry email failed: ${(err as Error).message}`);
    }
  }
}
