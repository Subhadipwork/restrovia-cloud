import { createHmac } from 'node:crypto';
import {
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  ForbiddenException,
  GoneException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { Request } from 'express';
import { CryptoService } from '../crypto/crypto.service.js';
import { DB, type Database } from '../db/database.module.js';
import { currentBlock } from '../common/store-block.js';
import { posDevices, requestNonces } from '../db/schema/index.js';

export type PosDevice = typeof posDevices.$inferSelect;
export type PosRequest = Request & { rawBody?: Buffer; posDevice?: PosDevice };

export const CLOCK_SKEW_MS = 5 * 60_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The parts of a signed request that the signature check reads, from Express or a raw upgrade. */
export interface SignedRequest {
  method: string;
  url: string;
  header(name: string): string | undefined;
  rawBody?: Buffer;
}

/**
 * Checks the HMAC signature the POS puts on every request after registration
 * (buildSignedHeaders in the POS cloud-sync service):
 * HMAC-SHA256(api_key, METHOD \n path?query \n timestamp \n nonce \n sha256(body)).
 */
@Injectable()
export class PosSignatureVerifier {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly crypto: CryptoService,
  ) {}

  async verify(req: SignedRequest): Promise<PosDevice> {
    const deny = (reason: string): never => {
      throw new UnauthorizedException({ error: 'invalid_signature', reason });
    };

    const auth = req.header('authorization') ?? '';
    const apiKey = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    const posHash = req.header('x-flo-pos-hash') ?? '';
    const timestamp = req.header('x-flo-timestamp') ?? '';
    const nonce = req.header('x-flo-nonce') ?? '';
    const bodyHash = (req.header('x-flo-body-sha256') ?? '').toLowerCase();
    const signature = (req.header('x-flo-signature') ?? '').replace(/^sha256=/, '').toLowerCase();
    if (!apiKey || !posHash || !timestamp || !nonce || !bodyHash || !signature) {
      deny('missing_headers');
    }

    const device = await this.db.query.posDevices.findFirst({
      where: eq(posDevices.apiKeyLookup, this.crypto.sha256(apiKey)),
    });
    if (!device) deny('unknown_key');
    if (device!.revokedAt) throw new GoneException({ error: 'device_revoked' });
    if (device!.posHash !== posHash) deny('pos_hash_mismatch');

    const sentAt = Date.parse(timestamp);
    if (Number.isNaN(sentAt) || Math.abs(Date.now() - sentAt) > CLOCK_SKEW_MS) deny('clock_skew');
    if (!UUID_RE.test(nonce)) deny('bad_nonce');

    const body = req.rawBody ?? Buffer.alloc(0);
    if (this.crypto.sha256(body).toString('hex') !== bodyHash) deny('body_hash_mismatch');

    const secret = this.crypto.decrypt(device!.apiKeyEnc).toString();
    const base = [req.method.toUpperCase(), req.url, timestamp, nonce, bodyHash].join('\n');
    const expected = createHmac('sha256', secret).update(base).digest();
    if (!/^[0-9a-f]{64}$/.test(signature)) deny('bad_signature');
    if (!this.crypto.safeEqual(expected, Buffer.from(signature, 'hex'))) deny('bad_signature');

    const fresh = await this.db
      .insert(requestNonces)
      .values({ deviceId: device!.id, nonce })
      .onConflictDoNothing()
      .returning({ nonce: requestNonces.nonce });
    if (fresh.length === 0) deny('replayed_nonce');

    return device!;
  }
}

@Injectable()
export class PosSignatureGuard implements CanActivate {
  constructor(private readonly verifier: PosSignatureVerifier) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<PosRequest>();
    req.posDevice = await this.verifier.verify({
      method: req.method,
      url: req.originalUrl,
      header: (name) => req.header(name),
      rawBody: req.rawBody,
    });
    return true;
  }
}

/**
 * Runs after PosSignatureGuard on routes that move store data. A store Restrovia has blocked keeps
 * its heartbeat, licence check-in and support tickets, so it can learn it was unblocked.
 */
@Injectable()
export class PosStoreActiveGuard implements CanActivate {
  constructor(@Inject(DB) private readonly db: Database) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const device = context.switchToHttp().getRequest<PosRequest>().posDevice!;
    const block = await currentBlock(this.db, device.storeId);
    if (block) throw new ForbiddenException({ error: 'store_blocked', reason: block.reason });
    return true;
  }
}

/** The authenticated POS device; only valid behind PosSignatureGuard. */
export const CurrentDevice = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): PosDevice =>
    ctx.switchToHttp().getRequest<PosRequest>().posDevice!,
);
