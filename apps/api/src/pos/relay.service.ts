import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import {
  HttpException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { type RawData, WebSocket, WebSocketServer } from 'ws';
import { posCommandResultSchema, posHeartbeatSchema } from '@restrovia/shared';
import { CommandsService } from '../commands/commands.service.js';
import { DB, type Database } from '../db/database.module.js';
import { posDevices } from '../db/schema/index.js';
import { HeartbeatService } from './heartbeat.service.js';
import { type PosDevice, PosSignatureVerifier } from './pos-auth.guard.js';

export const RELAY_PATH = '/api/pos/relay';
const MAX_FRAME_BYTES = 5 * 1024 * 1024;
const SWEEP_INTERVAL_MS = 30_000;
/** The POS pings every 25 s; three missed pings means the connection is gone. */
const IDLE_TIMEOUT_MS = 90_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Connection {
  socket: WebSocket;
  device: PosDevice;
  ip: string | null;
  lastSeenAt: number;
  pushing: boolean;
  pushAgain: boolean;
}

function isPrivateAddress(ip: string): boolean {
  const v4 = ip.replace(/^::ffff:/, '');
  return (
    ip === '::1' ||
    /^(127\.|10\.|192\.168\.|169\.254\.)/.test(v4) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(v4) ||
    /^f[cd]|^fe80:/i.test(ip)
  );
}

/** Same rule as Express's `trust proxy` setting in app.setup.ts: only private proxies are trusted. */
function clientIp(req: IncomingMessage): string | null {
  const remote = req.socket.remoteAddress ?? null;
  const forwarded = req.headers['x-forwarded-for'];
  if (!remote || !isPrivateAddress(remote) || typeof forwarded !== 'string') return remote;
  return (
    forwarded
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
      .at(-1) ?? remote
  );
}

function refuse(socket: Duplex, status: number, reason: string): void {
  socket.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

/**
 * The live channel the POS keeps open (connectRelay in the POS cloud-sync service): it carries
 * heartbeats and command results from the POS, and pushes queued commands to it. HTTP polling
 * keeps working for a POS that can't hold the connection.
 */
@Injectable()
export class PosRelayService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(PosRelayService.name);
  private readonly wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES });
  private readonly connections = new Map<string, Connection>();
  private sweepTimer: NodeJS.Timeout | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly verifier: PosSignatureVerifier,
    private readonly heartbeat: HeartbeatService,
    private readonly commands: CommandsService,
  ) {}

  onModuleInit(): void {
    this.unsubscribe = this.commands.onQueued((deviceId) => {
      const connection = this.connections.get(deviceId);
      if (connection) this.pushCommands(connection);
    });
    this.sweepTimer = setInterval(() => this.sweep(), SWEEP_INTERVAL_MS);
    this.sweepTimer.unref();
  }

  onApplicationShutdown(): void {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.unsubscribe?.();
    for (const { socket } of this.connections.values()) socket.close(1001, 'server_shutdown');
    this.connections.clear();
    this.wss.close();
  }

  attach(server: Server): void {
    server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      void this.handleUpgrade(req, socket, head);
    });
  }

  private async handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    // A client that drops during the signature check must not crash the process.
    socket.on('error', () => socket.destroy());
    const url = req.url ?? '';
    if (url.split('?')[0] !== RELAY_PATH) return refuse(socket, 404, 'Not Found');
    if (req.method !== 'GET') return refuse(socket, 405, 'Method Not Allowed');

    let device: PosDevice;
    try {
      device = await this.verifier.verify({
        method: 'GET',
        url,
        header: (name) => {
          const value = req.headers[name.toLowerCase()];
          return Array.isArray(value) ? value[0] : value;
        },
      });
    } catch (error) {
      if (error instanceof HttpException) {
        const status = error.getStatus();
        return refuse(socket, status, status === 410 ? 'Gone' : 'Unauthorized');
      }
      this.logger.error(`relay sign-in check failed: ${(error as Error).message}`);
      return refuse(socket, 500, 'Internal Server Error');
    }

    this.wss.handleUpgrade(req, socket, head, (ws) => this.onConnection(ws, device, clientIp(req)));
  }

  private onConnection(socket: WebSocket, device: PosDevice, ip: string | null): void {
    this.connections.get(device.id)?.socket.close(4000, 'replaced');
    const connection: Connection = {
      socket,
      device,
      ip,
      lastSeenAt: Date.now(),
      pushing: false,
      pushAgain: false,
    };
    this.connections.set(device.id, connection);

    socket.on('ping', () => {
      connection.lastSeenAt = Date.now();
    });
    socket.on('message', (data) => {
      connection.lastSeenAt = Date.now();
      void this.onMessage(connection, data).catch((error: Error) =>
        this.logger.warn(`relay frame from ${device.id} failed: ${error.message}`),
      );
    });
    socket.on('close', () => {
      if (this.connections.get(device.id) === connection) this.connections.delete(device.id);
    });
    socket.on('error', (error) => this.logger.warn(`relay socket ${device.id}: ${error.message}`));

    this.pushCommands(connection);
  }

  private async onMessage(connection: Connection, data: RawData): Promise<void> {
    let frame: unknown;
    try {
      frame = JSON.parse(data.toString());
    } catch {
      return;
    }
    if (!frame || typeof frame !== 'object') return;
    const { type, id, ...rest } = frame as Record<string, unknown>;

    if (type === 'heartbeat') {
      const parsed = posHeartbeatSchema.safeParse(rest);
      if (!parsed.success) return;
      const current = await this.db.query.posDevices.findFirst({
        where: eq(posDevices.id, connection.device.id),
      });
      if (!current || current.revokedAt) {
        connection.socket.close(4410, 'device_revoked');
        return;
      }
      connection.device = current;
      const ack = await this.heartbeat.record(current, parsed.data, connection.ip);
      this.send(connection, { type: 'heartbeat_ack', ...ack });
      return;
    }

    if (type === 'result') {
      if (typeof id !== 'string' || !UUID_RE.test(id)) return;
      const parsed = posCommandResultSchema.safeParse(rest);
      if (!parsed.success) return;
      try {
        await this.commands.complete(connection.device.id, id, parsed.data);
      } catch (error) {
        if (!(error instanceof NotFoundException)) throw error;
      }
    }
  }

  /** Hands queued commands to the POS; overlapping calls run once more instead of in parallel. */
  private pushCommands(connection: Connection): void {
    if (connection.pushing) {
      connection.pushAgain = true;
      return;
    }
    connection.pushing = true;
    void (async () => {
      try {
        do {
          connection.pushAgain = false;
          while (connection.socket.readyState === WebSocket.OPEN) {
            const batch = await this.commands.take(connection.device.id, 5);
            for (const command of batch) {
              this.send(connection, {
                type: 'command',
                id: command.id,
                cmd: command.type,
                payload: {
                  version: 1,
                  payload: command.payload,
                  correlation_id: command.correlation_id,
                },
              });
            }
            if (batch.length < 5) break;
          }
        } while (connection.pushAgain && connection.socket.readyState === WebSocket.OPEN);
      } catch (error) {
        this.logger.warn(`relay command push failed: ${(error as Error).message}`);
      } finally {
        connection.pushing = false;
      }
    })();
  }

  private sweep(): void {
    const cutoff = Date.now() - IDLE_TIMEOUT_MS;
    for (const connection of this.connections.values()) {
      if (connection.lastSeenAt < cutoff) {
        connection.socket.terminate();
        this.connections.delete(connection.device.id);
      } else {
        this.pushCommands(connection);
      }
    }
  }

  private send(connection: Connection, frame: Record<string, unknown>): void {
    if (connection.socket.readyState === WebSocket.OPEN)
      connection.socket.send(JSON.stringify(frame));
  }
}
