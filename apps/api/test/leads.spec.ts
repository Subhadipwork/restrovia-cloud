/** Lead management: CRUD, roles, stage rules, duplicates, timeline, follow-ups and audit. */
import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { and, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';
import request from 'supertest';
import { SYSTEM_ROLE_IDS, type SystemRoleKey } from '@restrovia/shared';
import { currentStep, totpCode } from '../src/crypto/totp.js';
import { CryptoService } from '../src/crypto/crypto.service.js';
import * as schema from '../src/db/schema/index.js';
import { createTestApp, registerPos, resetDatabase, testDatabaseUrl } from './helpers.js';

const url = testDatabaseUrl();
let pool: Pool;
let db: NodePgDatabase<typeof schema>;
let app: NestExpressApplication;

const CSRF = { 'X-Restrovia-Admin': '1' };
type Agent = ReturnType<typeof request.agent>;
let sales: { agent: Agent; id: string };
let sales2: { agent: Agent; id: string };
let support: { agent: Agent; id: string };
let superAdmin: { agent: Agent; id: string };

beforeAll(async () => {
  ({ pool, db } = await resetDatabase(url));
  process.env.ADMIN_LOGIN_LIMIT = '1000';
  app = await createTestApp(url);
  [sales, sales2, support, superAdmin] = await Promise.all([
    signIn('sales'),
    signIn('sales'),
    signIn('support'),
    signIn('super_admin'),
  ]);
});

afterAll(async () => {
  await app?.close();
  await pool?.end();
});

async function signIn(role: SystemRoleKey) {
  const crypto = app.get(CryptoService);
  const password = 'correct horse battery';
  const [admin] = await db
    .insert(schema.admins)
    .values({
      name: `Test ${role} ${randomUUID().slice(0, 4)}`,
      email: `${role}-${randomUUID().slice(0, 8)}@restrovia.test`,
      roleId: SYSTEM_ROLE_IDS[role],
      passwordHash: await crypto.hashPassword(password),
    })
    .returning();
  const agent = request.agent(app.getHttpServer());
  const login = await agent
    .post('/api/admin/auth/login')
    .set(CSRF)
    .send({ email: admin!.email, password })
    .expect(200);
  await agent
    .post('/api/admin/auth/setup-2fa')
    .set(CSRF)
    .send({
      setup_token: login.body.setup_token,
      code: totpCode(login.body.secret, currentStep()),
    })
    .expect(200);
  return { agent, id: admin!.id };
}

let phoneSeq = 9_100_000_000;
const uniquePhone = () => `+91${phoneSeq++}`;

async function createLead(agent: Agent, extra: Record<string, unknown> = {}) {
  const res = await agent
    .post('/api/admin/leads')
    .set(CSRF)
    .send({
      business_name: `Café ${randomUUID().slice(0, 6)}`,
      phone: uniquePhone(),
      city: 'Kolkata',
      source: 'cold_call',
      ...extra,
    })
    .expect(201);
  return res.body.id as string;
}

const auditRows = (leadId: string, action: string) =>
  db
    .select()
    .from(schema.adminAuditLog)
    .where(and(eq(schema.adminAuditLog.targetId, leadId), eq(schema.adminAuditLog.action, action)));

describe('lead CRUD', () => {
  it('creates a lead with a timeline entry and an audit row', async () => {
    const id = await createLead(sales.agent, {
      contact_name: 'Riya',
      email: 'riya@mocha.example',
      tags: ['Chain', 'chain', ' Kolkata '],
      outlet_count: 3,
    });
    const res = await sales.agent.get(`/api/admin/leads/${id}`).expect(200);
    expect(res.body.lead.stage).toBe('new');
    expect(res.body.lead.temperature).toBe('warm');
    expect(res.body.lead.tags).toEqual(['chain', 'kolkata']);
    expect(res.body.lead.outletCount).toBe(3);
    expect(res.body.created_by_name).toMatch(/Test sales/);
    const timeline = await sales.agent.get(`/api/admin/leads/${id}/activities`).expect(200);
    expect(timeline.body.data.map((a: { type: string }) => a.type)).toEqual(['created']);
    expect(await auditRows(id, 'lead.create')).toHaveLength(1);
  });

  it('validates the phone format and required fields', async () => {
    const res = await sales.agent
      .post('/api/admin/leads')
      .set(CSRF)
      .send({ business_name: 'X', phone: '9800000000', source: 'website' })
      .expect(400);
    expect(res.body.issues.join()).toMatch(/phone/);
    await sales.agent
      .post('/api/admin/leads')
      .set(CSRF)
      .send({ phone: uniquePhone(), source: 'website' })
      .expect(400);
  });

  it('edits fields and records which fields changed', async () => {
    const id = await createLead(sales.agent);
    await sales.agent
      .patch(`/api/admin/leads/${id}`)
      .set(CSRF)
      .send({ temperature: 'hot', expected_value: '2998.00', contact_name: '' })
      .expect(200);
    const res = await sales.agent.get(`/api/admin/leads/${id}`).expect(200);
    expect(res.body.lead.temperature).toBe('hot');
    expect(res.body.lead.expectedValue).toBe('2998.00');
    expect(res.body.lead.contactName).toBeNull();
    const [audit] = await auditRows(id, 'lead.update');
    expect((audit!.details.fields as string[]).toSorted()).toEqual([
      'contact_name',
      'expected_value',
      'temperature',
    ]);
  });

  it('lists with search, stage and owner filters', async () => {
    const name = `Searchable ${randomUUID().slice(0, 6)}`;
    const id = await createLead(sales.agent, { business_name: name, city: 'Pune' });
    await sales.agent
      .post(`/api/admin/leads/${id}/assign`)
      .set(CSRF)
      .send({ admin_id: sales2.id })
      .expect(201);

    const byName = await sales.agent
      .get('/api/admin/leads')
      .query({ q: name.slice(0, 14) })
      .expect(200);
    expect(byName.body.data.map((l: { id: string }) => l.id)).toEqual([id]);
    expect(byName.body.data[0].assigned_admin_name).toMatch(/Test sales/);

    const mine = await sales2.agent.get('/api/admin/leads').query({ assigned: 'me' }).expect(200);
    expect(mine.body.data.map((l: { id: string }) => l.id)).toContain(id);
    const notMine = await sales.agent.get('/api/admin/leads').query({ assigned: 'me' }).expect(200);
    expect(notMine.body.data.map((l: { id: string }) => l.id)).not.toContain(id);

    const won = await sales.agent.get('/api/admin/leads').query({ stage: 'won' }).expect(200);
    expect(won.body.data.map((l: { id: string }) => l.id)).not.toContain(id);
    const pune = await sales.agent.get('/api/admin/leads').query({ city: 'pune' }).expect(200);
    expect(pune.body.data.map((l: { id: string }) => l.id)).toEqual([id]);
  });

  it('search treats % and _ as plain characters', async () => {
    const res = await sales.agent.get('/api/admin/leads').query({ q: '%' }).expect(200);
    expect(res.body.total).toBe(0);
  });

  it('soft-deletes for super admins only and hides the lead afterwards', async () => {
    const id = await createLead(sales.agent);
    await sales.agent.delete(`/api/admin/leads/${id}`).set(CSRF).expect(403);
    await superAdmin.agent.delete(`/api/admin/leads/${id}`).set(CSRF).expect(200);
    await sales.agent.get(`/api/admin/leads/${id}`).expect(404);
    const list = await sales.agent.get('/api/admin/leads').query({ per_page: 100 }).expect(200);
    expect(list.body.data.map((l: { id: string }) => l.id)).not.toContain(id);
    expect(await auditRows(id, 'lead.delete')).toHaveLength(1);
  });
});

describe('roles', () => {
  it('lets support read but not change leads', async () => {
    const id = await createLead(sales.agent);
    await support.agent.get('/api/admin/leads').expect(200);
    await support.agent.get(`/api/admin/leads/${id}`).expect(200);
    await support.agent.get(`/api/admin/leads/${id}/activities`).expect(200);
    await support.agent
      .post('/api/admin/leads')
      .set(CSRF)
      .send({ business_name: 'Nope', source: 'website' })
      .expect(403);
    await support.agent.patch(`/api/admin/leads/${id}`).set(CSRF).send({ city: 'X' }).expect(403);
    await support.agent
      .post(`/api/admin/leads/${id}/activities`)
      .set(CSRF)
      .send({ type: 'note', body: 'hi' })
      .expect(403);
    await support.agent.get('/api/admin/lead-tasks').expect(403);
  });

  it('refuses changes without the panel header and without a session', async () => {
    await sales.agent
      .post('/api/admin/leads')
      .send({ business_name: 'No header', source: 'website' })
      .expect(403);
    await request(app.getHttpServer()).get('/api/admin/leads').expect(401);
  });

  it('only offers active sales and super admins as owners', async () => {
    const res = await sales.agent.get('/api/admin/leads/assignees').expect(200);
    const ids = res.body.map((a: { id: string }) => a.id);
    expect(ids).toEqual(expect.arrayContaining([sales.id, sales2.id, superAdmin.id]));
    expect(ids).not.toContain(support.id);
    const id = await createLead(sales.agent);
    const bad = await sales.agent
      .post(`/api/admin/leads/${id}/assign`)
      .set(CSRF)
      .send({ admin_id: support.id })
      .expect(400);
    expect(bad.body.error).toBe('invalid_assignee');
  });
});

describe('duplicates', () => {
  it('warns on the same phone, email or name in the same city, unless forced', async () => {
    const phone = uniquePhone();
    const first = await createLead(sales.agent, {
      business_name: 'Cafe Mocha',
      city: 'Siliguri',
      phone,
      email: 'hello@mocha-sil.example',
    });
    for (const body of [
      { business_name: 'Other', phone, city: 'Delhi' },
      { business_name: 'Other', alt_phone: phone, city: 'Delhi' },
      { business_name: 'Other', email: 'HELLO@mocha-sil.example', city: 'Delhi' },
      { business_name: 'cafe mocha', city: 'siliguri' },
    ]) {
      const res = await sales.agent
        .post('/api/admin/leads')
        .set(CSRF)
        .send({ ...body, source: 'website' })
        .expect(409);
      expect(res.body.error).toBe('possible_duplicates');
      expect(res.body.matches.leads.map((l: { id: string }) => l.id)).toContain(first);
    }
    const forced = await sales.agent
      .post('/api/admin/leads')
      .set(CSRF)
      .send({ business_name: 'Cafe Mocha', city: 'Siliguri', source: 'website', force: true })
      .expect(201);
    const detail = await sales.agent.get(`/api/admin/leads/${forced.body.id}`).expect(200);
    expect(detail.body.duplicates.leads.map((l: { id: string }) => l.id)).toEqual([first]);
  });

  it('warns when the café is already a customer', async () => {
    await registerPos(app); // registers phone +919800000000
    const res = await sales.agent
      .post('/api/admin/leads')
      .set(CSRF)
      .send({ business_name: 'Blue Door', phone: '+919800000000', source: 'referral' })
      .expect(409);
    expect(res.body.matches.stores).toHaveLength(1);
  });
});

describe('stages', () => {
  it('records every change in the timeline and the audit log', async () => {
    const id = await createLead(sales.agent);
    await sales.agent
      .post(`/api/admin/leads/${id}/stage`)
      .set(CSRF)
      .send({ stage: 'contacted', note: 'Spoke to the owner' })
      .expect(201);
    const timeline = await sales.agent.get(`/api/admin/leads/${id}/activities`).expect(200);
    const change = timeline.body.data.find((a: { type: string }) => a.type === 'stage_change');
    expect(change.meta).toEqual({ from: 'new', to: 'contacted' });
    expect(change.body).toBe('Spoke to the owner');
    expect(await auditRows(id, 'lead.stage')).toHaveLength(1);
  });

  it('needs a reason for lost, and reopening clears it', async () => {
    const id = await createLead(sales.agent);
    const bad = await sales.agent
      .post(`/api/admin/leads/${id}/stage`)
      .set(CSRF)
      .send({ stage: 'lost' })
      .expect(400);
    expect(bad.body.error).toBe('lost_reason_required');
    await sales.agent
      .post(`/api/admin/leads/${id}/stage`)
      .set(CSRF)
      .send({ stage: 'lost', lost_reason: 'price' })
      .expect(201);
    let lead = (await sales.agent.get(`/api/admin/leads/${id}`)).body.lead;
    expect(lead.lostReason).toBe('price');
    expect(lead.lostAt).not.toBeNull();
    await sales.agent
      .post(`/api/admin/leads/${id}/stage`)
      .set(CSRF)
      .send({ stage: 'contacted' })
      .expect(201);
    lead = (await sales.agent.get(`/api/admin/leads/${id}`)).body.lead;
    expect(lead.lostReason).toBeNull();
    expect(lead.lostAt).toBeNull();
  });

  it('lets sales mark won only with a linked store; super admins may override', async () => {
    const id = await createLead(sales.agent);
    const refused = await sales.agent
      .post(`/api/admin/leads/${id}/stage`)
      .set(CSRF)
      .send({ stage: 'won' })
      .expect(409);
    expect(refused.body.error).toBe('won_needs_store');

    const { storeId } = await registerPos(app);
    await sales.agent
      .post(`/api/admin/leads/${id}/store`)
      .set(CSRF)
      .send({ store_id: storeId })
      .expect(201);
    await sales.agent
      .post(`/api/admin/leads/${id}/stage`)
      .set(CSRF)
      .send({ stage: 'won' })
      .expect(201);
    const detail = await sales.agent.get(`/api/admin/leads/${id}`).expect(200);
    expect(detail.body.lead.wonAt).not.toBeNull();
    expect(detail.body.store).toMatchObject({ id: storeId, licence_status: 'trial' });

    const other = await createLead(sales.agent);
    const taken = await sales.agent
      .post(`/api/admin/leads/${other}/store`)
      .set(CSRF)
      .send({ store_id: storeId })
      .expect(409);
    expect(taken.body.error).toBe('store_has_lead');
    await superAdmin.agent
      .post(`/api/admin/leads/${other}/stage`)
      .set(CSRF)
      .send({ stage: 'won' })
      .expect(201);
  });
});

describe('activities', () => {
  it('logs a call with its outcome and moves last activity forward only', async () => {
    const id = await createLead(sales.agent);
    await sales.agent
      .post(`/api/admin/leads/${id}/activities`)
      .set(CSRF)
      .send({ type: 'call', body: 'Wants a demo', outcome: 'connected', duration_min: 6 })
      .expect(201);
    const before = (await sales.agent.get(`/api/admin/leads/${id}`)).body.lead.lastActivityAt;
    await sales.agent
      .post(`/api/admin/leads/${id}/activities`)
      .set(CSRF)
      .send({ type: 'note', body: 'Backdated', occurred_at: '2026-01-01T10:00:00+05:30' })
      .expect(201);
    const after = (await sales.agent.get(`/api/admin/leads/${id}`)).body.lead.lastActivityAt;
    expect(after).toBe(before);
    const timeline = await sales.agent.get(`/api/admin/leads/${id}/activities`).expect(200);
    const call = timeline.body.data.find((a: { type: string }) => a.type === 'call');
    expect(call).toMatchObject({ outcome: 'connected', meta: { duration_min: 6 } });
    expect(timeline.body.data.at(-1).body).toBe('Backdated');
  });

  it('refuses activities dated in the future and system types', async () => {
    const id = await createLead(sales.agent);
    const future = new Date(Date.now() + 86_400_000).toISOString();
    await sales.agent
      .post(`/api/admin/leads/${id}/activities`)
      .set(CSRF)
      .send({ type: 'note', body: 'x', occurred_at: future })
      .expect(400);
    await sales.agent
      .post(`/api/admin/leads/${id}/activities`)
      .set(CSRF)
      .send({ type: 'stage_change', body: 'x' })
      .expect(400);
  });
});

describe('follow-ups', () => {
  it('keeps the next follow-up in step with open tasks', async () => {
    const id = await createLead(sales.agent);
    const later = new Date(Date.now() + 3 * 86_400_000).toISOString();
    const sooner = new Date(Date.now() + 86_400_000).toISOString();
    const a = await sales.agent
      .post(`/api/admin/leads/${id}/tasks`)
      .set(CSRF)
      .send({ type: 'call', title: 'Call back', due_at: later })
      .expect(201);
    const b = await sales.agent
      .post(`/api/admin/leads/${id}/tasks`)
      .set(CSRF)
      .send({ type: 'demo', title: 'Demo', due_at: sooner })
      .expect(201);
    const next = async () =>
      (await sales.agent.get(`/api/admin/leads/${id}`)).body.lead.nextFollowUpAt;
    expect(new Date(await next()).toISOString()).toBe(sooner);

    await sales.agent
      .patch(`/api/admin/lead-tasks/${b.body.id}`)
      .set(CSRF)
      .send({ done: true })
      .expect(200);
    expect(new Date(await next()).toISOString()).toBe(later);

    await sales.agent.delete(`/api/admin/lead-tasks/${a.body.id}`).set(CSRF).expect(200);
    expect(await next()).toBeNull();

    const detail = await sales.agent.get(`/api/admin/leads/${id}`).expect(200);
    expect(detail.body.open_tasks).toHaveLength(0);
  });

  it('assigns new tasks to the lead owner and lists them under “my tasks”', async () => {
    const id = await createLead(sales.agent, { assigned_admin_id: sales2.id });
    const overdue = new Date(Date.now() - 3_600_000).toISOString();
    await sales.agent
      .post(`/api/admin/leads/${id}/tasks`)
      .set(CSRF)
      .send({ type: 'whatsapp', title: 'Send price list', due_at: overdue })
      .expect(201);
    const mine = await sales2.agent.get('/api/admin/lead-tasks').query({ due: 'overdue' });
    expect(mine.body.map((t: { lead_id: string }) => t.lead_id)).toContain(id);
    const theirs = await sales.agent.get('/api/admin/lead-tasks').query({ due: 'overdue' });
    expect(theirs.body.map((t: { lead_id: string }) => t.lead_id)).not.toContain(id);

    const overdueLeads = await sales.agent
      .get('/api/admin/leads')
      .query({ follow_up: 'overdue', per_page: 100 });
    expect(overdueLeads.body.data.map((l: { id: string }) => l.id)).toContain(id);
  });

  it('completing a task can log the call in the timeline', async () => {
    const id = await createLead(sales.agent);
    const task = await sales.agent
      .post(`/api/admin/leads/${id}/tasks`)
      .set(CSRF)
      .send({ type: 'call', title: 'First call', due_at: new Date().toISOString() })
      .expect(201);
    await sales.agent
      .patch(`/api/admin/lead-tasks/${task.body.id}`)
      .set(CSRF)
      .send({ done: true, log: { body: 'No answer', outcome: 'no_answer' } })
      .expect(200);
    const timeline = await sales.agent.get(`/api/admin/leads/${id}/activities`).expect(200);
    expect(timeline.body.data[0]).toMatchObject({
      type: 'call',
      outcome: 'no_answer',
      body: 'No answer',
      meta: { task_id: task.body.id, task_title: 'First call' },
    });
    expect(await auditRows(id, 'lead.task_done')).toHaveLength(1);
  });

  it('hides tasks of deleted leads', async () => {
    const id = await createLead(sales.agent);
    await sales.agent
      .post(`/api/admin/leads/${id}/tasks`)
      .set(CSRF)
      .send({ type: 'call', title: 'Ghost', due_at: new Date().toISOString() })
      .expect(201);
    await superAdmin.agent.delete(`/api/admin/leads/${id}`).set(CSRF).expect(200);
    const tasks = await sales.agent.get('/api/admin/lead-tasks').query({ assigned: 'all' });
    expect(tasks.body.map((t: { lead_id: string }) => t.lead_id)).not.toContain(id);
  });
});

describe('pipeline board and summary', () => {
  it('groups open leads by stage with counts and value, and hides deleted ones', async () => {
    const owner = await signIn('sales');
    const a = await createLead(sales.agent, { assigned_admin_id: owner.id, expected_value: '999' });
    const b = await createLead(sales.agent, {
      assigned_admin_id: owner.id,
      expected_value: '1500',
    });
    await sales.agent
      .post(`/api/admin/leads/${b}/stage`)
      .set(CSRF)
      .send({ stage: 'qualified' })
      .expect(201);
    const gone = await createLead(sales.agent, { assigned_admin_id: owner.id });
    await superAdmin.agent.delete(`/api/admin/leads/${gone}`).set(CSRF).expect(200);

    const res = await owner.agent.get('/api/admin/leads/board').query({ assigned: 'me' });
    expect(res.status).toBe(200);
    const col = (s: string) => res.body.columns.find((c: { stage: string }) => c.stage === s);
    expect(col('new')).toMatchObject({ count: 1, value: '999.00' });
    expect(col('new').cards.map((c: { id: string }) => c.id)).toEqual([a]);
    expect(col('qualified')).toMatchObject({ count: 1, value: '1500.00' });
    expect(col('won').count).toBe(0);
    await support.agent.get('/api/admin/leads/board').expect(403);
  });

  it('counts open, new, overdue and won for the overview', async () => {
    const before = (await support.agent.get('/api/admin/leads/summary').expect(200)).body;
    const id = await createLead(sales.agent);
    await sales.agent
      .post(`/api/admin/leads/${id}/tasks`)
      .set(CSRF)
      .send({ type: 'call', title: 'Late', due_at: new Date(Date.now() - 60_000).toISOString() })
      .expect(201);
    const after = (await support.agent.get('/api/admin/leads/summary').expect(200)).body;
    expect(after.open).toBe(before.open + 1);
    expect(after.new_this_week).toBe(before.new_this_week + 1);
    expect(after.overdue).toBe(before.overdue + 1);
  });
});

describe('merge', () => {
  it('moves the timeline and follow-ups, fills gaps and hides the duplicate', async () => {
    const keep = await createLead(sales.agent, {
      business_name: 'Merge Keep',
      email: null,
      tags: ['a'],
    });
    const dupPhone = uniquePhone();
    const dup = await createLead(sales.agent, {
      business_name: 'Merge Dup',
      phone: dupPhone,
      email: 'dup@merge.example',
      area: 'Park Street',
      outlet_count: 4,
      tags: ['b'],
      force: true,
    });
    await sales.agent
      .post(`/api/admin/leads/${dup}/activities`)
      .set(CSRF)
      .send({ type: 'note', body: 'From the duplicate' })
      .expect(201);
    const due = new Date(Date.now() + 86_400_000).toISOString();
    await sales.agent
      .post(`/api/admin/leads/${dup}/tasks`)
      .set(CSRF)
      .send({ type: 'call', title: 'Dup task', due_at: due })
      .expect(201);

    await sales.agent
      .post(`/api/admin/leads/${keep}/merge`)
      .set(CSRF)
      .send({ duplicate_id: dup })
      .expect(200);

    await sales.agent.get(`/api/admin/leads/${dup}`).expect(404);
    const { lead, open_tasks } = (await sales.agent.get(`/api/admin/leads/${keep}`)).body;
    expect(lead.businessName).toBe('Merge Keep');
    expect(lead.email).toBe('dup@merge.example');
    expect(lead.altPhoneE164).toBe(dupPhone);
    expect(lead.area).toBe('Park Street');
    expect(lead.outletCount).toBe(4);
    expect(lead.tags.toSorted()).toEqual(['a', 'b']);
    expect(new Date(lead.nextFollowUpAt).toISOString()).toBe(due);
    expect(open_tasks.map((t: { title: string }) => t.title)).toEqual(['Dup task']);
    const timeline = (await sales.agent.get(`/api/admin/leads/${keep}/activities`)).body.data;
    expect(timeline[0]).toMatchObject({ type: 'merged', meta: { duplicate_name: 'Merge Dup' } });
    expect(timeline.map((a: { body: string }) => a.body)).toContain('From the duplicate');
    expect(await auditRows(keep, 'lead.merge')).toHaveLength(1);
  });

  it('refuses merging a lead into itself or two leads linked to different stores', async () => {
    const id = await createLead(sales.agent);
    await sales.agent
      .post(`/api/admin/leads/${id}/merge`)
      .set(CSRF)
      .send({ duplicate_id: id })
      .expect(400);
    const other = await createLead(sales.agent);
    const [s1, s2] = [await registerPos(app), await registerPos(app)];
    for (const [lead, store] of [
      [id, s1.storeId],
      [other, s2.storeId],
    ] as const) {
      await sales.agent
        .post(`/api/admin/leads/${lead}/store`)
        .set(CSRF)
        .send({ store_id: store })
        .expect(201);
    }
    const res = await sales.agent
      .post(`/api/admin/leads/${id}/merge`)
      .set(CSRF)
      .send({ duplicate_id: other })
      .expect(409);
    expect(res.body.error).toBe('both_have_stores');
  });
});

describe('bulk actions', () => {
  it('assigns, tags and changes stage for many leads at once, with a timeline entry each', async () => {
    const ids = [await createLead(sales.agent), await createLead(sales.agent)];
    const assign = await sales.agent
      .post('/api/admin/leads/bulk')
      .set(CSRF)
      .send({ action: 'assign', ids, admin_id: sales2.id })
      .expect(200);
    expect(assign.body.changed).toBe(2);
    await sales.agent
      .post('/api/admin/leads/bulk')
      .set(CSRF)
      .send({ action: 'tag', ids, tag: 'Mall' })
      .expect(200);
    const lost = await sales.agent
      .post('/api/admin/leads/bulk')
      .set(CSRF)
      .send({ action: 'stage', ids, stage: 'lost', lost_reason: 'no_response' })
      .expect(200);
    expect(lost.body.changed).toBe(2);
    for (const id of ids) {
      const { lead } = (await sales.agent.get(`/api/admin/leads/${id}`)).body;
      expect(lead).toMatchObject({
        assignedAdminId: sales2.id,
        stage: 'lost',
        lostReason: 'no_response',
        tags: ['mall'],
      });
      expect(await auditRows(id, 'lead.stage')).toHaveLength(1);
    }
  });

  it('refuses won, lost without a reason, and delete by sales; rolls back on a missing id', async () => {
    const id = await createLead(sales.agent);
    await sales.agent
      .post('/api/admin/leads/bulk')
      .set(CSRF)
      .send({ action: 'stage', ids: [id], stage: 'won' })
      .expect(400);
    await sales.agent
      .post('/api/admin/leads/bulk')
      .set(CSRF)
      .send({ action: 'stage', ids: [id], stage: 'lost' })
      .expect(400);
    await sales.agent
      .post('/api/admin/leads/bulk')
      .set(CSRF)
      .send({ action: 'delete', ids: [id] })
      .expect(403);
    await sales.agent
      .post('/api/admin/leads/bulk')
      .set(CSRF)
      .send({ action: 'tag', ids: [id, randomUUID()], tag: 'ghost' })
      .expect(404);
    const { lead } = (await sales.agent.get(`/api/admin/leads/${id}`)).body;
    expect(lead.tags).not.toContain('ghost');
    await superAdmin.agent
      .post('/api/admin/leads/bulk')
      .set(CSRF)
      .send({ action: 'delete', ids: [id] })
      .expect(200);
    await sales.agent.get(`/api/admin/leads/${id}`).expect(404);
  });
});

describe('CSV import and export', () => {
  const csv = (rows: string[]) =>
    ['Business Name,Phone,Email,City,Outlet Count,Tags,Owner Email,Source,Notes', ...rows].join(
      '\n',
    );

  it('dry run reports bad rows, duplicates and unknown columns without saving', async () => {
    const existingPhone = uniquePhone();
    await createLead(sales.agent, { business_name: 'Already Here', phone: existingPhone });
    const res = await sales.agent
      .post('/api/admin/leads/import')
      .set(CSRF)
      .send({
        csv: csv([
          `"Chai, Point",98111 22233,chai@x.example,Kolkata,2,mall;chain,,referral,hello`,
          `,9811122234,,Kolkata,,,,,`,
          `Dup Cafe,${existingPhone},,Pune,,,,,`,
          `File Twin,98111 22233,,Delhi,,,,,`,
          `Bad Owner,9811122299,,Delhi,,,nobody@x.example,,`,
        ]),
      })
      .expect(200);
    expect(res.body).toMatchObject({ total: 5, valid: 3, will_import: 1, imported: 0 });
    expect(res.body.unknown_columns).toEqual(['notes']);
    expect(res.body.invalid.map((r: { row: number }) => r.row)).toEqual([3, 6]);
    expect(res.body.duplicates).toEqual([
      { row: 4, business_name: 'Dup Cafe', of: 'lead' },
      { row: 5, business_name: 'File Twin', of: 'file' },
    ]);
    const list = await sales.agent.get('/api/admin/leads').query({ q: 'Chai, Point' });
    expect(list.body.total).toBe(0);
  });

  it('imports valid rows with normalised phones, tags and owner, and audits once', async () => {
    const tag = `imp${randomUUID().slice(0, 6)}`;
    const ownerEmail = (await db.query.admins.findFirst({
      where: eq(schema.admins.id, sales2.id),
    }))!.email;
    const res = await sales.agent
      .post('/api/admin/leads/import')
      .set(CSRF)
      .send({
        dry_run: false,
        csv: csv([
          `Import One,98222 33301,one@imp.example,Kolkata,3,${tag};vip,${ownerEmail},,`,
          `Import Two,9822233302,,Kolkata,,${tag},,,`,
        ]),
      })
      .expect(200);
    expect(res.body.imported).toBe(2);
    const list = await sales.agent.get('/api/admin/leads').query({ tag, stage: 'open' });
    expect(list.body.total).toBe(2);
    const one = list.body.data.find(
      (l: { business_name: string }) => l.business_name === 'Import One',
    );
    expect(one).toMatchObject({
      phone: '+919822233301',
      source: 'import',
      assigned_admin_id: sales2.id,
    });
    expect(one.tags.toSorted()).toEqual([tag, 'vip']);
    const imports = await db
      .select()
      .from(schema.adminAuditLog)
      .where(eq(schema.adminAuditLog.action, 'lead.import'));
    expect(imports.at(-1)!.details).toMatchObject({ imported: 2 });
  });

  it('rejects a file without a business_name column', async () => {
    const res = await sales.agent
      .post('/api/admin/leads/import')
      .set(CSRF)
      .send({ csv: 'name,phone\nX,9800000001' })
      .expect(400);
    expect(res.body.error).toBe('import_needs_business_name');
  });

  it('exports the filtered list as CSV for super admins only, defusing formulas', async () => {
    const tag = `exp${randomUUID().slice(0, 6)}`;
    await createLead(sales.agent, { business_name: '=HYPERLINK("x")', tags: [tag] });
    await sales.agent.get('/api/admin/leads/export.csv').expect(403);
    const res = await superAdmin.agent
      .get('/api/admin/leads/export.csv')
      .query({ tag })
      .expect(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toMatch(/restrovia-leads-.*\.csv/);
    const lines = res.text
      .replace(/^\uFEFF/, '')
      .trim()
      .split('\r\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^business_name,contact_name,phone/);
    expect(lines[1]).toMatch(/^"'=HYPERLINK\(""x""\)",/);
    expect(lines[1]).toContain('+91');
    const exports = await db
      .select()
      .from(schema.adminAuditLog)
      .where(eq(schema.adminAuditLog.action, 'lead.export'));
    expect(exports.at(-1)!.details).toMatchObject({ rows: 1 });
  });
});

describe('reports', () => {
  it('builds the funnel from stages reached, and counts wins, sources and lost reasons', async () => {
    const day = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
    const before = (
      await sales.agent.get('/api/admin/leads/reports').query({ from: day, to: day }).expect(200)
    ).body;

    const walked = await createLead(sales.agent, { source: 'event' });
    for (const stage of ['contacted', 'qualified', 'demo_scheduled']) {
      await sales.agent
        .post(`/api/admin/leads/${walked}/stage`)
        .set(CSRF)
        .send({ stage })
        .expect(201);
    }
    await sales.agent
      .post(`/api/admin/leads/${walked}/stage`)
      .set(CSRF)
      .send({ stage: 'lost', lost_reason: 'timing' })
      .expect(201);
    const winner = await createLead(sales.agent, { source: 'event', expected_value: '2000' });
    await superAdmin.agent
      .post(`/api/admin/leads/${winner}/stage`)
      .set(CSRF)
      .send({ stage: 'won' })
      .expect(201);

    const after = (
      await sales.agent.get('/api/admin/leads/reports').query({ from: day, to: day }).expect(200)
    ).body;
    const funnel = (r: typeof after, s: string) =>
      r.funnel.find((f: { stage: string }) => f.stage === s).count;
    expect(funnel(after, 'new') - funnel(before, 'new')).toBe(2);
    expect(funnel(after, 'demo_scheduled') - funnel(before, 'demo_scheduled')).toBe(2);
    expect(funnel(after, 'won') - funnel(before, 'won')).toBe(1);
    expect(after.totals.won - before.totals.won).toBe(1);
    const event = after.by_source.find((s: { source: string }) => s.source === 'event');
    expect(event).toMatchObject({ won: 1, lost: 1 });
    const timing = after.lost_reasons.find((r: { reason: string }) => r.reason === 'timing');
    expect(timing.n).toBeGreaterThanOrEqual(1);
    expect(after.by_admin.map((a: { id: string }) => a.id)).toContain(sales.id);
    await sales.agent
      .get('/api/admin/leads/reports')
      .query({ from: day, to: '2020-01-01' })
      .expect(400);
  });

  it('counts each team member’s own open leads, wins, activities and overdue follow-ups', async () => {
    const owner = await signIn('sales');
    const day = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
    const open = await createLead(owner.agent, { assigned_admin_id: owner.id });
    await createLead(owner.agent, { assigned_admin_id: owner.id });
    const won = await createLead(owner.agent, { assigned_admin_id: owner.id });
    await superAdmin.agent
      .post(`/api/admin/leads/${won}/stage`)
      .set(CSRF)
      .send({ stage: 'won' })
      .expect(201);
    await owner.agent
      .post(`/api/admin/leads/${open}/activities`)
      .set(CSRF)
      .send({ type: 'demo', body: 'Showed the KDS' })
      .expect(201);
    await owner.agent
      .post(`/api/admin/leads/${open}/tasks`)
      .set(CSRF)
      .send({ type: 'call', title: 'Late', due_at: new Date(Date.now() - 60_000).toISOString() })
      .expect(201);

    const report = (
      await owner.agent.get('/api/admin/leads/reports').query({ from: day, to: day }).expect(200)
    ).body;
    expect(report.by_admin.find((a: { id: string }) => a.id === owner.id)).toEqual({
      id: owner.id,
      name: expect.any(String),
      open: 2,
      won: 1,
      activities: 1,
      demos: 1,
      overdue_tasks: 1,
    });
  });
});
