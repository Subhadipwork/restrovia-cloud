/** The live relay WebSocket, opened the way the Restrovia POS opens it. Needs TEST_DATABASE_URL. */
import type { AddressInfo } from 'node:net';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';
import { WebSocket } from 'ws';
import { CommandsService } from '../src/commands/commands.service.js';
import * as schema from '../src/db/schema/index.js';
import {
  createTestApp,
  registerPos,
  resetDatabase,
  signedHeaders,
  testDatabaseUrl,
  type PosIdentity,
} from './helpers.js';

const url = testDatabaseUrl();
let pool: Pool;
let db: NodePgDatabase<typeof schema>;
let app: NestExpressApplication;
let port: number;

beforeAll(async () => {
  ({ pool, db } = await resetDatabase(url));
  app = await createTestApp(url);
  await app.listen(0, '127.0.0.1');
  port = (app.getHttpServer().address() as AddressInfo).port;
});

afterAll(async () => {
  await app?.close();
  await pool?.end();
});

type Frame = Record<string, unknown>;

/** An open relay connection that records every frame the cloud sends. */
class RelayClient {
  readonly frames: Frame[] = [];
  private waiters: (() => void)[] = [];

  constructor(readonly socket: WebSocket) {
    socket.on('message', (data) => {
      this.frames.push(JSON.parse(data.toString()) as Frame);
      for (const wake of this.waiters.splice(0)) wake();
    });
  }

  async next(predicate: (frame: Frame) => boolean, timeoutMs = 5_000): Promise<Frame> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const found = this.frames.find(predicate);
      if (found) return found;
      const left = deadline - Date.now();
      if (left <= 0) throw new Error(`no matching frame; got ${JSON.stringify(this.frames)}`);
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, left);
        this.waiters.push(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
  }

  send(frame: Frame): void {
    this.socket.send(JSON.stringify(frame));
  }

  close(): void {
    this.socket.close();
  }
}

function open(headers: Record<string, string>): Promise<RelayClient> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/api/pos/relay`, { headers });
    socket.once('open', () => resolve(new RelayClient(socket)));
    socket.once('unexpected-response', (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
    socket.once('error', reject);
  });
}

const connect = (pos: Pick<PosIdentity, 'apiKey' | 'posHash'>) =>
  open(signedHeaders(pos, 'GET', '/api/pos/relay', ''));

const heartbeat = {
  pos_hash: '',
  app_version: '3.13.23',
  device_name: 'CAFE-PC',
  active_orders: 2,
  today_bills: 9,
  today_sales: 1234.5,
  sent_at: new Date().toISOString(),
};

describe('relay sign-in', () => {
  it('refuses a connection without a valid signature', async () => {
    const pos = await registerPos(app);
    await expect(open({})).rejects.toThrow('HTTP 401');
    await expect(
      open(signedHeaders({ ...pos, apiKey: 'wrong' }, 'GET', '/api/pos/relay', '')),
    ).rejects.toThrow('HTTP 401');
  });

  it('refuses a replayed handshake', async () => {
    const pos = await registerPos(app);
    const headers = signedHeaders(pos, 'GET', '/api/pos/relay', '');
    (await open(headers)).close();
    await expect(open(headers)).rejects.toThrow('HTTP 401');
  });

  it('refuses a revoked device with 410', async () => {
    const pos = await registerPos(app);
    await db
      .update(schema.posDevices)
      .set({ revokedAt: new Date() })
      .where(eq(schema.posDevices.posHash, pos.posHash));
    await expect(connect(pos)).rejects.toThrow('HTTP 410');
  });

  it('answers 404 for other upgrade paths', async () => {
    const pos = await registerPos(app);
    await expect(
      new Promise((resolve, reject) => {
        const socket = new WebSocket(`ws://127.0.0.1:${port}/api/pos/other`, {
          headers: signedHeaders(pos, 'GET', '/api/pos/other', ''),
        });
        socket.once('open', resolve);
        socket.once('unexpected-response', (_req, res) =>
          reject(new Error(`HTTP ${res.statusCode}`)),
        );
        socket.once('error', reject);
      }),
    ).rejects.toThrow('HTTP 404');
  });
});

describe('relay frames', () => {
  it('records a heartbeat frame and acknowledges it with the store features', async () => {
    const pos = await registerPos(app);
    const client = await connect(pos);
    try {
      client.send({ type: 'heartbeat', ...heartbeat, pos_hash: pos.posHash });
      const ack = await client.next((frame) => frame.type === 'heartbeat_ack');
      expect(ack.ok).toBe(true);
      expect(typeof ack.features).toBe('object');
      const device = await db.query.posDevices.findFirst({
        where: eq(schema.posDevices.posHash, pos.posHash),
      });
      expect(device).toMatchObject({ activeOrders: 2, todayBills: 9, appVersion: '3.13.23' });
      expect(device?.lastHeartbeatAt).toBeInstanceOf(Date);
    } finally {
      client.close();
    }
  });

  it('pushes queued commands on connect and when queued, and saves the results', async () => {
    const pos = await registerPos(app);
    const commands = app.get(CommandsService);
    const early = await commands.create(pos.storeId, 'report.sales', { from: '2026-11-04' });

    const client = await connect(pos);
    try {
      const first = await client.next((frame) => frame.id === early.id);
      expect(first).toEqual({
        type: 'command',
        id: early.id,
        cmd: 'report.sales',
        payload: { version: 1, payload: { from: '2026-11-04' }, correlation_id: early.id },
      });

      const late = await commands.create(pos.storeId, 'health.get');
      await client.next((frame) => frame.id === late.id);

      const waiting = commands.waitForResult(late.id, 5_000, 50);
      client.send({
        type: 'result',
        id: late.id,
        version: 1,
        correlation_id: late.id,
        ok: true,
        result: { healthy: true },
        completed_at: new Date().toISOString(),
      });
      expect(await waiting).toMatchObject({ status: 'done', result: { healthy: true } });
      expect(client.frames.filter((frame) => frame.id === early.id)).toHaveLength(1);
    } finally {
      client.close();
    }
  });

  it('ignores results for another device’s command', async () => {
    const pos = await registerPos(app);
    const other = await registerPos(app);
    const command = await app.get(CommandsService).create(pos.storeId, 'health.get');
    const client = await connect(other);
    try {
      client.send({
        type: 'result',
        id: command.id,
        version: 1,
        correlation_id: command.id,
        ok: true,
        completed_at: new Date().toISOString(),
      });
      client.send({ type: 'heartbeat', ...heartbeat, pos_hash: other.posHash });
      await client.next((frame) => frame.type === 'heartbeat_ack');
      const row = await db.query.commands.findFirst({
        where: eq(schema.commands.id, command.id),
      });
      expect(row?.status).toBe('queued');
    } finally {
      client.close();
    }
  });
});
