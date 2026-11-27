import { createHash, timingSafeEqual } from 'node:crypto';
import {
  Body,
  Controller,
  HttpCode,
  Post,
  Query,
  Req,
  ServiceUnavailableException,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';
import type { Env } from '../config/env.js';
import { newConversationContact } from './chatwoot-payload.js';
import { LeadsService } from './leads.service.js';

const sha256 = (value: string) => createHash('sha256').update(value).digest();

/** Chatwoot's webhook. It cannot send a secret header, so the secret is in the address. */
@Controller('api/public')
export class ChatwootController {
  private readonly token?: Buffer;

  constructor(
    private readonly leads: LeadsService,
    config: ConfigService<Env, true>,
  ) {
    const token = config.get('CHATWOOT_WEBHOOK_TOKEN', { infer: true });
    this.token = token ? sha256(token) : undefined;
  }

  @Post('chatwoot')
  @HttpCode(200)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 300, ttl: 60_000 } })
  async receive(
    @Query('token') token: unknown,
    @Body() body: unknown,
    @Req() req: Request,
  ): Promise<{ status: 'Success!' }> {
    if (!this.token) throw new ServiceUnavailableException({ error: 'not_configured' });
    if (typeof token !== 'string' || !timingSafeEqual(sha256(token), this.token)) {
      throw new UnauthorizedException({ error: 'bad_token' });
    }
    // Ignored events are answered the same way, so Chatwoot does not treat them as failures.
    const contact = newConversationContact(body);
    if (contact) await this.leads.captureChatwoot(contact, req.ip ?? null);
    return { status: 'Success!' };
  }
}
