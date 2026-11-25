import {
  All,
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Response } from 'express';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  posCommandResultSchema,
  posEventsBodySchema,
  posHeartbeatSchema,
  posLicenceRequestSchema,
  posLinkCodeRequestSchema,
  posRegisterSchema,
  type PosCommandResult,
  type PosLicenceRequest,
  type PosLinkCodeRequest,
  type PosEventsBody,
  type PosHeartbeatBody,
  type PosRegisterBody,
} from '@restrovia/shared';
import { ZodPipe } from '../common/zod.pipe.js';
import { CommandsService } from '../commands/commands.service.js';
import { DB, type Database } from '../db/database.module.js';
import { stores } from '../db/schema/index.js';
import { IngestService } from '../ingest/ingest.service.js';
import { HeartbeatService } from './heartbeat.service.js';
import { DeviceLinkService } from './device-link.service.js';
import { LicensingService } from './licensing.service.js';
import { PairingService } from './pairing.service.js';
import {
  CurrentDevice,
  type PosDevice,
  PosSignatureGuard,
  PosStoreActiveGuard,
  type PosRequest,
} from './pos-auth.guard.js';
import { RegisterService } from './register.service.js';
import { StoreEmailService } from './store-email.service.js';
import { SupportService, type SupportTicketBody } from './support.service.js';

const pairingBodySchema = z.object({ revoke_devices: z.boolean().optional().default(false) });
const emailPreferencesSchema = z.object({
  product_updates: z.boolean().optional(),
  marketing: z.boolean().optional(),
});
const verificationRequestSchema = z.looseObject({
  product_updates: z.boolean().optional(),
  marketing: z.boolean().optional(),
});
const supportTicketSchema = z.looseObject({
  client_ticket_id: z.string().min(1).max(100),
  subject: z.string().max(500).optional(),
  message: z.string().max(20_000).optional(),
  event_code: z.string().max(64).optional(),
});

/** Registrations allowed per hour from one IP address; REGISTER_LIMIT_PER_HOUR overrides it in tests. */
const registerLimitPerHour = () => Number(process.env.REGISTER_LIMIT_PER_HOUR) || 10;

/** The API the Restrovia POS calls (main/services/cloud-sync.ts in restrovia-pos). */
@Controller('api/pos')
export class PosController {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly registration: RegisterService,
    private readonly ingest: IngestService,
    private readonly commands: CommandsService,
    private readonly heartbeats: HeartbeatService,
    private readonly pairing: PairingService,
    private readonly support: SupportService,
    private readonly licensing: LicensingService,
    private readonly storeEmail: StoreEmailService,
    private readonly deviceLinks: DeviceLinkService,
  ) {}

  @Post('register')
  @HttpCode(200)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: () => registerLimitPerHour(), ttl: 60 * 60_000 } })
  register(@Body(new ZodPipe(posRegisterSchema)) body: PosRegisterBody, @Req() req: PosRequest) {
    return this.registration.register(body, req.ip ?? null);
  }

  @Post('heartbeat')
  @HttpCode(200)
  @UseGuards(PosSignatureGuard)
  heartbeat(
    @CurrentDevice() device: PosDevice,
    @Body(new ZodPipe(posHeartbeatSchema)) body: PosHeartbeatBody,
    @Req() req: PosRequest,
  ) {
    return this.heartbeats.record(device, body, req.ip ?? null);
  }

  @Post('connection-test')
  @HttpCode(200)
  @UseGuards(PosSignatureGuard)
  connectionTest(@CurrentDevice() device: PosDevice) {
    return { ok: true, pos_id: device.id, store_id: device.storeId };
  }

  @Post('events')
  @HttpCode(200)
  @UseGuards(PosSignatureGuard, PosStoreActiveGuard)
  async events(
    @CurrentDevice() device: PosDevice,
    @Body(new ZodPipe(posEventsBodySchema)) body: PosEventsBody,
  ) {
    if (body.pos_hash !== device.posHash) {
      throw new BadRequestException({ error: 'pos_hash_mismatch' });
    }
    return { ok: true, ...(await this.ingest.ingest(device, body.events)) };
  }

  @Get('commands')
  @UseGuards(PosSignatureGuard, PosStoreActiveGuard)
  async takeCommands(@CurrentDevice() device: PosDevice, @Query('limit') limit?: string) {
    return { commands: await this.commands.take(device.id, Number(limit) || 5) };
  }

  @Post('commands/:id/result')
  @HttpCode(200)
  @UseGuards(PosSignatureGuard, PosStoreActiveGuard)
  async commandResult(
    @CurrentDevice() device: PosDevice,
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) id: string,
    @Body(new ZodPipe(posCommandResultSchema)) body: PosCommandResult,
  ) {
    await this.commands.complete(device.id, id, body);
    return { ok: true };
  }

  @Post('pairing-code')
  @HttpCode(200)
  @UseGuards(PosSignatureGuard, PosStoreActiveGuard)
  pairingCode(
    @CurrentDevice() device: PosDevice,
    @Body(new ZodPipe(pairingBodySchema)) body: z.infer<typeof pairingBodySchema>,
  ) {
    return this.pairing.createCode(device, body.revoke_devices);
  }

  @Get('devices')
  @UseGuards(PosSignatureGuard, PosStoreActiveGuard)
  async devices(@CurrentDevice() device: PosDevice) {
    return { devices: await this.pairing.listDevices(device.storeId) };
  }

  /** Signed licence token for offline checks (restrovia-licence service in the POS). */
  @Post('licence')
  @HttpCode(200)
  @UseGuards(PosSignatureGuard)
  async licenceToken(
    @CurrentDevice() device: PosDevice,
    @Body(new ZodPipe(posLicenceRequestSchema)) body: PosLicenceRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (body.pos_hash !== device.posHash) {
      throw new BadRequestException({ error: 'pos_hash_mismatch' });
    }
    const result = await this.licensing.issue(
      device,
      body.machine_id_hash,
      body.app_version,
      new Date(),
      body.enabled_features,
    );
    if ('pending' in result) {
      res.status(202);
      return result.pending;
    }
    return { token: result.token, claims: result.claims };
  }

  /** A code the owner types in the owner portal to move this POS to their store. */
  @Post('link-code')
  @HttpCode(200)
  @UseGuards(ThrottlerGuard, PosSignatureGuard)
  @Throttle({ default: { limit: 10, ttl: 15 * 60_000 } })
  linkCode(
    @CurrentDevice() device: PosDevice,
    @Body(new ZodPipe(posLinkCodeRequestSchema)) body: PosLinkCodeRequest,
  ) {
    return this.deviceLinks.createCode(device, body.machine_id_hash);
  }

  @Post('support-ticket')
  @HttpCode(200)
  @UseGuards(PosSignatureGuard)
  supportTicket(
    @CurrentDevice() device: PosDevice,
    @Body(new ZodPipe(supportTicketSchema)) body: SupportTicketBody,
  ) {
    return this.support.receive(device, body);
  }

  /** The store's email and what it agreed to receive, shown on the POS cloud account card. */
  @Get('email-preferences')
  @UseGuards(PosSignatureGuard)
  emailPreferences(@CurrentDevice() device: PosDevice) {
    return this.storeEmail.preferences(device.storeId);
  }

  /** Emails the store a link to confirm its address; the POS shows the answer as the new status. */
  @Post('email/verification')
  @HttpCode(200)
  @UseGuards(PosSignatureGuard)
  requestEmailVerification(
    @CurrentDevice() device: PosDevice,
    @Body(new ZodPipe(verificationRequestSchema)) body: z.infer<typeof verificationRequestSchema>,
  ) {
    return this.storeEmail.requestVerification(device.storeId, body);
  }

  @Put('email-preferences')
  @UseGuards(PosSignatureGuard)
  async updateEmailPreferences(
    @CurrentDevice() device: PosDevice,
    @Body(new ZodPipe(emailPreferencesSchema)) body: z.infer<typeof emailPreferencesSchema>,
  ) {
    await this.db
      .update(stores)
      .set({
        ...(body.product_updates === undefined
          ? {}
          : { emailProductUpdates: body.product_updates }),
        ...(body.marketing === undefined ? {} : { emailMarketing: body.marketing }),
        updatedAt: new Date(),
      })
      .where(eq(stores.id, device.storeId));
    return { ok: true };
  }

  /**
   * Endpoints the POS knows about that Restrovia Cloud doesn't offer yet. A 404 makes the POS show
   * "not available" (diagnostic reports are dropped, not retried), instead of retrying in a loop.
   */
  @All([
    'diagnostics/v2',
    'diagnostics-consent',
    'cloud-data/delete',
    'cloud-data/deletion-request/cancel',
    'password-reset/request',
    'password-reset/:id',
    'password-reset/:id/redeem',
  ])
  notAvailable() {
    throw new NotFoundException({
      error: 'not_available',
      message: 'This feature is not available on Restrovia Cloud yet',
    });
  }
}
