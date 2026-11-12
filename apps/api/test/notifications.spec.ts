/** Owner alert emails: the switches, the daily summary, the store-offline alert and "turn off" links. */
import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';
import request from 'supertest';
import { CryptoService } from '../src/crypto/crypto.service.js';
import * as schema from '../src/db/schema/index.js';
import { EmailService } from '../src/email/email.service.js';
import { AlertsService } from '../src/notifications/alerts.service.js';
import { NotificationPrefsService } from '../src/notifications/notification-prefs.service.js';
import {
  createTestApp,
  eventsBody,
  orderEvent,
  orderSnapshot,
  posCall,
  registerPos,
  resetDatabase,
  testDatabaseUrl,
  type PosIdentity,
} from './helpers.js';

const url = testDatabaseUrl();
let pool: Pool;
let db: NodePgDatabase<typeof schema>;
let app: NestExpressApplication;
let alerts: AlertsService;
let outbox: EmailService['outbox'];

const CSRF = { 'X-Restrovia-Owner': '1' };
const PASSWORD = 'tea garden 42';
const ist = (day: string, time: string) => new Date(`${day}T${time}:00+05:30`);
/** Monday 19 October 2026 is the day the summaries below are about. */
const MONDAY = '2026-10-19';

type Pos = PosIdentity & { storeId: string };
type Snapshot = ReturnType<typeof orderSnapshot>;

beforeAll(async () => {
  ({ pool, db } = await resetDatabase(url));
  process.env.OWNER_AUTH_LIMIT = '1000';
  app = await createTestApp(url);
  alerts = app.get(AlertsService);
  outbox = app.get(EmailService).outbox;
});

afterAll(async () => {
  await app?.close();
  await pool?.end();
});

beforeEach(() => {
  outbox.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

const at = (when: Date) => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(when);
};

async function memberOf(
  storeId: string,
  opts: { verified?: boolean; role?: 'owner' | 'manager' } = {},
) {
  const crypto = app.get(CryptoService);
  const [owner] = await db
    .insert(schema.owners)
    .values({
      name: 'Asha',
      email: `owner-${randomUUID().slice(0, 8)}@restrovia.test`,
      passwordHash: await crypto.hashPassword(PASSWORD),
      emailVerifiedAt: opts.verified === false ? null : new Date(),
    })
    .returning();
  await db
    .insert(schema.storeMembers)
    .values({ storeId, ownerId: owner.id, role: opts.role ?? 'owner' });
  return owner;
}

async function signIn(email: string) {
  const agent = request.agent(app.getHttpServer());
  await agent
    .post('/api/owner/auth/login')
    .set(CSRF)
    .send({ email, password: PASSWORD })
    .expect(200);
  return agent;
}

const wants = (ownerId: string, prefs: { summary?: boolean; offline?: boolean }) =>
  db
    .insert(schema.notificationPrefs)
    .values({
      ownerId,
      dailySummaryEmail: prefs.summary ?? false,
      offlineAlert: prefs.offline ?? true,
    })
    .onConflictDoUpdate({
      target: schema.notificationPrefs.ownerId,
      set: { dailySummaryEmail: prefs.summary ?? false, offlineAlert: prefs.offline ?? true },
    });

async function sendOrders(pos: Pos, snapshots: unknown[]) {
  await posCall(
    app,
    pos,
    'POST',
    '/api/pos/events',
    eventsBody(
      pos,
      snapshots.map((s) => orderEvent(s as Snapshot)),
    ),
  ).expect(200);
}

async function lastSeen(storeId: string, when: Date) {
  await db
    .update(schema.posDevices)
    .set({ lastHeartbeatAt: when, lastLicenceAt: null })
    .where(eq(schema.posDevices.storeId, storeId));
}

const endLicence = (storeId: string) =>
  db
    .update(schema.subscriptions)
    .set({ status: 'suspended', updatedAt: new Date(Date.now() - 30 * 86_400_000) })
    .where(eq(schema.subscriptions.storeId, storeId));

describe('alert switches', () => {
  it('start with offline alerts on, and save what the owner picks', async () => {
    const pos = await registerPos(app);
    const owner = await memberOf(pos.storeId, { verified: false });
    const agent = await signIn(owner.email);

    const first = await agent.get('/api/owner/me/notification-prefs').expect(200);
    expect(first.body).toEqual({
      daily_summary_email: false,
      offline_alert: true,
      email_verified: false,
    });

    const saved = await agent
      .put('/api/owner/me/notification-prefs')
      .set(CSRF)
      .send({ daily_summary_email: true })
      .expect(200);
    expect(saved.body).toMatchObject({ daily_summary_email: true, offline_alert: true });
    const events = await db
      .select()
      .from(schema.ownerSecurityEvents)
      .where(eq(schema.ownerSecurityEvents.ownerId, owner.id));
    expect(events.map((e) => e.action)).toContain('owner.alerts_changed');

    await agent.put('/api/owner/me/notification-prefs').set(CSRF).send({}).expect(400);
    await agent
      .put('/api/owner/me/notification-prefs')
      .set(CSRF)
      .send({ offline_alert: 'no' })
      .expect(400);
    await request(app.getHttpServer()).get('/api/owner/me/notification-prefs').expect(401);
  });

  it('turns one kind off from the link in an email, without signing in', async () => {
    const pos = await registerPos(app);
    const owner = await memberOf(pos.storeId);
    await wants(owner.id, { summary: true, offline: true });
    const link = app.get(NotificationPrefsService).turnOffUrl(owner.id, 'daily_summary');
    const token = new URL(link).searchParams.get('token')!;
    const turnOff = (body: unknown, headers: Record<string, string> = CSRF) =>
      request(app.getHttpServer())
        .post('/api/owner/notifications/unsubscribe')
        .set(headers)
        .send(body as object);

    await turnOff({ token }, {}).expect(403);
    await turnOff({ token: `${token.slice(0, -4)}AAAA` }).expect(400, /invalid_token/);
    await turnOff({ token }).expect(200, { kind: 'daily_summary' });

    const [row] = await db
      .select()
      .from(schema.notificationPrefs)
      .where(eq(schema.notificationPrefs.ownerId, owner.id));
    expect(row).toMatchObject({ dailySummaryEmail: false, offlineAlert: true });
  });
});

describe('daily summary', () => {
  async function storeWithMonday() {
    const pos = await registerPos(app);
    await sendOrders(pos, [
      orderSnapshot(1, { createdAt: ist(MONDAY, '12:00'), total: 315 }),
      orderSnapshot(2, { createdAt: ist(MONDAY, '13:00'), total: 500, type: 'takeaway' }),
      {
        ...orderSnapshot(3, { createdAt: ist(MONDAY, '14:00'), total: 0, paidAt: null }),
        status: 'cancelled',
        cancelled_at: '2026-10-19 08:30:00',
        total: 120,
        bill: null,
        bills: [],
      },
      // The Monday before, to compare with.
      orderSnapshot(4, { createdAt: ist('2026-10-12', '12:00'), total: 250 }),
    ]);
    return pos;
  }

  it('goes out once, half an hour after the business day ends, to those who asked', async () => {
    at(ist('2026-10-20', '00:10'));
    const pos = await storeWithMonday();
    const owner = await memberOf(pos.storeId);
    await wants(owner.id, { summary: true });
    const manager = await memberOf(pos.storeId, { role: 'manager' });
    await wants(manager.id, { summary: false });
    const unverified = await memberOf(pos.storeId, { verified: false });
    await wants(unverified.id, { summary: true });

    // Ten minutes after midnight is too early: late bills may still arrive.
    expect(await alerts.sendDailySummaries()).toBe(0);

    at(ist('2026-10-20', '00:35'));
    expect(await alerts.sendDailySummaries()).toBe(1);
    expect(outbox).toHaveLength(1);
    const [mail] = outbox;
    expect(mail.to).toBe(owner.email);
    expect(mail.subject).toBe('Blue Door Café: ₹815 on Mon, 19 Oct');
    expect(mail.text).toContain('Sales: ₹815 (▲ 226% vs last Monday)');
    expect(mail.text).toContain('Paid bills: 2 (▲ 100% vs last Monday)');
    expect(mail.text).toContain('By order type: Takeaway ₹500, Dine-in ₹315');
    expect(mail.text).toContain('4 × Cappuccino: ₹815');
    expect(mail.text).toContain('Cancelled orders: 1 (₹120)');
    expect(mail.text).toContain(
      `Open this day: http://localhost:3200/dashboard/${pos.storeId}?date=${MONDAY}`,
    );
    expect(mail.text).toMatch(
      /Turn off daily summaries: http:\/\/localhost:3200\/unsubscribe\?token=\S+/,
    );
    expect(mail.html).toContain('Sales: ₹815');

    // The next runs find it already sent.
    expect(await alerts.sendDailySummaries()).toBe(0);
    at(ist('2026-10-20', '03:00'));
    expect(await alerts.sendDailySummaries()).toBe(0);
    expect(outbox).toHaveLength(1);
  });

  it('is skipped when it would be hours late, the day was empty, or the licence ended', async () => {
    at(ist('2026-10-20', '00:35'));
    const late = await storeWithMonday();
    await wants((await memberOf(late.storeId)).id, { summary: true });
    const empty = await registerPos(app);
    await wants((await memberOf(empty.storeId)).id, { summary: true });
    const ended = await storeWithMonday();
    await wants((await memberOf(ended.storeId)).id, { summary: true });
    await endLicence(ended.storeId);

    // Only `late` has something to send, and seven hours on it is no longer sent.
    at(ist('2026-10-20', '07:00'));
    expect(await alerts.sendDailySummaries()).toBe(0);
    at(ist('2026-10-20', '00:35'));
    expect(await alerts.sendDailySummaries()).toBe(1);
  });

  it('follows the store’s business day start', async () => {
    at(ist('2026-10-20', '00:35'));
    const pos = await storeWithMonday();
    await db
      .update(schema.stores)
      .set({ businessDayStart: '04:00' })
      .where(eq(schema.stores.id, pos.storeId));
    await wants((await memberOf(pos.storeId)).id, { summary: true });

    // Monday is still running until 04:00 on Tuesday.
    expect(await alerts.sendDailySummaries()).toBe(0);
    at(ist('2026-10-20', '04:35'));
    expect(await alerts.sendDailySummaries()).toBe(1);
    expect(outbox[0].subject).toContain('Mon, 19 Oct');
  });

  it('sends a sample of the newest day with sales when asked', async () => {
    at(ist('2026-10-20', '10:00'));
    const pos = await storeWithMonday();
    const owner = await memberOf(pos.storeId);
    const agent = await signIn(owner.email);

    const res = await agent
      .post('/api/owner/me/notification-prefs/sample')
      .set(CSRF)
      .send({})
      .expect(200);
    expect(res.body).toEqual({ store: 'Blue Door Café', day: MONDAY });
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({
      to: owner.email,
      subject: 'Sample: Blue Door Café: ₹815 on Mon, 19 Oct',
    });

    const empty = await registerPos(app);
    const other = await signIn((await memberOf(empty.storeId)).email);
    await other
      .post('/api/owner/me/notification-prefs/sample')
      .set(CSRF)
      .send({})
      .expect(409, /nothing_to_send/);
  });
});

describe('store-offline alert', () => {
  /** A café that sold from 12:00 to 14:00 on each of the two Mondays before 19 October. */
  async function storeSellingAtLunch() {
    const pos = await registerPos(app);
    let id = 1;
    const snapshots = [];
    for (const day of ['2026-10-12', '2026-10-05']) {
      for (const time of ['12:10', '13:10']) {
        snapshots.push(orderSnapshot(id++, { createdAt: ist(day, time), total: 200 }));
      }
    }
    await sendOrders(pos, snapshots);
    return pos;
  }

  it('is sent once per outage, an hour into a time the café usually sells', async () => {
    at(ist(MONDAY, '13:30'));
    const pos = await storeSellingAtLunch();
    const owner = await memberOf(pos.storeId);
    const muted = await memberOf(pos.storeId, { role: 'manager' });
    await wants(muted.id, { offline: false });
    await memberOf(pos.storeId, { verified: false });

    await lastSeen(pos.storeId, ist(MONDAY, '12:50'));
    expect(await alerts.sendOfflineAlerts()).toBe(0);

    await lastSeen(pos.storeId, ist(MONDAY, '12:05'));
    expect(await alerts.sendOfflineAlerts()).toBe(1);
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({
      to: owner.email,
      subject: 'Blue Door Café: the POS is offline',
    });
    expect(outbox[0].text).toContain('12:05 pm');
    expect(outbox[0].text).toContain(
      `See POS status: http://localhost:3200/dashboard/${pos.storeId}/status`,
    );
    expect(outbox[0].text).toContain('Turn off offline alerts: ');

    // Still the same outage five minutes later.
    at(ist(MONDAY, '13:35'));
    expect(await alerts.sendOfflineAlerts()).toBe(0);

    // It came back, then went quiet again: a new outage.
    await lastSeen(pos.storeId, ist(MONDAY, '12:30'));
    at(ist(MONDAY, '13:40'));
    expect(await alerts.sendOfflineAlerts()).toBe(1);
    expect(outbox).toHaveLength(2);
  });

  it('stays quiet outside usual selling hours and after the licence ends', async () => {
    at(ist(MONDAY, '03:00'));
    const closed = await storeSellingAtLunch();
    await memberOf(closed.storeId);
    await lastSeen(closed.storeId, ist('2026-10-18', '23:00'));
    expect(await alerts.sendOfflineAlerts()).toBe(0);

    // 12:30 is in a selling hour, but the hour before it (11:00) never has sales: just opening.
    at(ist(MONDAY, '12:30'));
    expect(await alerts.sendOfflineAlerts()).toBe(0);

    at(ist(MONDAY, '13:30'));
    await endLicence(closed.storeId);
    expect(await alerts.sendOfflineAlerts()).toBe(0);
    expect(outbox).toHaveLength(0);
  });
});
