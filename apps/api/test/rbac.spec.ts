/** Admin permissions: every route declares one, roles grant exactly their table, no escalation. */
import { randomUUID } from 'node:crypto';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';
import request from 'supertest';
import {
  expandPermissions,
  SYSTEM_ROLE_IDS,
  SYSTEM_ROLES,
  type SystemRoleKey,
} from '@restrovia/shared';
import { AdminOwnersController } from '../src/admin/admin-owners.controller.js';
import { AdminAccountController } from '../src/admin/admin-account.controller.js';
import { AdminController } from '../src/admin/admin.controller.js';
import { AdminUsersController } from '../src/admin/admin-users.controller.js';
import { AdminRolesController } from '../src/admin/admin-roles.controller.js';
import { CAN_KEY, SIGNED_IN_KEY } from '../src/admin/admin.guard.js';
import { CryptoService } from '../src/crypto/crypto.service.js';
import * as schema from '../src/db/schema/index.js';
import { LeadsController } from '../src/leads/leads.controller.js';
import { createTestApp, resetDatabase, testDatabaseUrl } from './helpers.js';

const url = testDatabaseUrl();
let pool: Pool;
let db: NodePgDatabase<typeof schema>;
let app: NestExpressApplication;
const CSRF = { 'X-Restrovia-Admin': '1' };
const PASSWORD = 'correct horse battery';

type Route = {
  controller: string;
  handler: string;
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  can?: string[];
  signedIn: boolean;
};

const PUBLIC_ROUTES = new Set([
  'POST auth/login',
  'GET auth/invite',
  'POST auth/accept-invite',
  'POST auth/forgot-password',
  'POST auth/reset-password',
]);

/** Every route on the admin controllers, with the permission metadata the guard reads. */
function adminRoutes(): Route[] {
  const out: Route[] = [];
  for (const ctrl of [
    AdminController,
    AdminAccountController,
    AdminUsersController,
    AdminOwnersController,
    AdminRolesController,
    LeadsController,
  ]) {
    for (const name of Object.getOwnPropertyNames(ctrl.prototype)) {
      const fn = (ctrl.prototype as unknown as Record<string, unknown>)[name];
      if (name === 'constructor' || typeof fn !== 'function') continue;
      const path = Reflect.getMetadata(PATH_METADATA, fn) as string | undefined;
      if (path === undefined) continue;
      const method = RequestMethod[Reflect.getMetadata(METHOD_METADATA, fn) as number];
      out.push({
        controller: ctrl.name,
        handler: name,
        method: method as Route['method'],
        path,
        can: Reflect.getMetadata(CAN_KEY, fn) as string[] | undefined,
        signedIn: Reflect.getMetadata(SIGNED_IN_KEY, fn) === true,
      });
    }
  }
  return out;
}

const key = (r: Route) => `${r.method} ${r.path}`;
const routes = adminRoutes();
const guarded = routes.filter((r) => !PUBLIC_ROUTES.has(key(r)) && !r.signedIn);

/**
 * Who could call each route before permissions existed (from the old @Roles lists). Routes not
 * listed were open to every signed-in admin.
 */
const BEFORE: Record<string, SystemRoleKey[]> = {
  'POST plans': ['super_admin'],
  'PATCH plans/:id': ['super_admin'],
  'POST stores/:id/status': ['super_admin', 'sales'],
  'POST stores/:id/licence': ['super_admin', 'sales'],
  'GET tickets': ['super_admin', 'support'],
  'GET tickets/:id': ['super_admin', 'support'],
  'PATCH tickets/:id': ['super_admin', 'support'],
  'POST tickets/:id/notes': ['super_admin', 'support'],
  'GET admins': ['super_admin'],
  'POST admins': ['super_admin'],
  'POST admins/:id/disable': ['super_admin'],
  'POST admins/:id/enable': ['super_admin'],
  'POST stores/:id/devices/:deviceId/reset-binding': ['super_admin', 'support'],
  'POST admins/:id/reset-2fa': ['super_admin'],
  'GET audit-log': ['super_admin'],
  'POST owners/:id/reset-2fa': ['super_admin', 'support'],
  'POST owners/:id/disable': ['super_admin', 'support'],
  'POST owners/:id/enable': ['super_admin', 'support'],
  'POST owners/:id/resend-invite': ['super_admin', 'support', 'sales'],
  'POST owners/:id/password': ['super_admin', 'support'],
  'POST stores/:id/owners': ['super_admin', 'support', 'sales'],
  'DELETE stores/:id/owners/:ownerId': ['super_admin', 'support'],
  'GET leads/assignees': ['super_admin', 'sales', 'support'],
  'GET leads/summary': ['super_admin', 'sales', 'support'],
  'GET leads/board': ['super_admin', 'sales'],
  'GET leads/reports': ['super_admin', 'sales'],
  'GET leads/export.csv': ['super_admin'],
  'POST leads/import': ['super_admin', 'sales'],
  'POST leads/bulk': ['super_admin', 'sales'],
  'GET leads': ['super_admin', 'sales', 'support'],
  'POST leads': ['super_admin', 'sales'],
  'GET leads/:id': ['super_admin', 'sales', 'support'],
  'PATCH leads/:id': ['super_admin', 'sales'],
  'DELETE leads/:id': ['super_admin'],
  'POST leads/:id/stage': ['super_admin', 'sales'],
  'POST leads/:id/assign': ['super_admin', 'sales'],
  'POST leads/:id/store': ['super_admin', 'sales'],
  'POST leads/:id/merge': ['super_admin', 'sales'],
  'POST leads/:id/photos': ['super_admin', 'sales'],
  'GET leads/:id/photos/:photoId': ['super_admin', 'sales', 'support'],
  'DELETE leads/:id/photos/:photoId': ['super_admin', 'sales'],
  'GET leads/:id/activities': ['super_admin', 'sales', 'support'],
  'POST leads/:id/activities': ['super_admin', 'sales'],
  'POST leads/:id/tasks': ['super_admin', 'sales'],
  'GET lead-tasks': ['super_admin', 'sales'],
  'PATCH lead-tasks/:id': ['super_admin', 'sales'],
  'DELETE lead-tasks/:id': ['super_admin', 'sales'],
};
/** Deliberate changes: the plans list was open to Support although it had no Plans page. */
const CHANGED: Record<string, SystemRoleKey[]> = {
  'GET plans': ['super_admin', 'sales'],
};
/** Routes added with permissions (no "before"): the role table decides. */
const NEW_ROUTES = new Set([
  'GET admin-roles',
  'GET admin-roles/:id',
  'POST admin-roles',
  'PATCH admin-roles/:id',
  'DELETE admin-roles/:id',
  'POST admin-roles/:id/reset',
  'GET admins/:id',
  'PATCH admins/:id',
  'POST admins/:id/resend-invite',
  'POST admins/:id/cancel-invite',
  'POST admins/:id/send-password-reset',
  'POST admins/:id/end-sessions',
  'DELETE admins/:id/sessions/:sessionId',
]);

type Agent = ReturnType<typeof request.agent>;
const agents = {} as Record<SystemRoleKey, { agent: Agent; id: string }>;

beforeAll(async () => {
  ({ pool, db } = await resetDatabase(url));
  process.env.ADMIN_LOGIN_LIMIT = '1000';
  app = await createTestApp(url);
  for (const role of Object.keys(SYSTEM_ROLE_IDS) as SystemRoleKey[]) {
    agents[role] = await signIn(SYSTEM_ROLE_IDS[role]);
  }
});

afterAll(async () => {
  await app?.close();
  await pool?.end();
});

async function signIn(roleId: string) {
  const [admin] = await db
    .insert(schema.admins)
    .values({
      name: `Test ${randomUUID().slice(0, 6)}`,
      email: `admin-${randomUUID().slice(0, 8)}@restrovia.test`,
      roleId,
      passwordHash: await app.get(CryptoService).hashPassword(PASSWORD),
    })
    .returning();
  const agent = request.agent(app.getHttpServer());
  await agent
    .post('/api/admin/auth/login')
    .set(CSRF)
    .send({ email: admin!.email, password: PASSWORD })
    .expect(200);
  return { agent, id: admin!.id, email: admin!.email };
}

/** Calls a route with made-up ids and an empty body; true when the guard refused it. */
async function refused(agent: Agent, r: Route): Promise<boolean> {
  const path = `/api/admin/${r.path.replace(/:[A-Za-z]+/g, () => randomUUID())}`;
  const call = agent[r.method.toLowerCase() as 'get' | 'post' | 'patch' | 'delete'](path).set(CSRF);
  const res = r.method === 'GET' || r.method === 'DELETE' ? await call : await call.send({});
  return res.status === 403 && res.body.error === 'permission_denied';
}

const rolePermissions = (role: SystemRoleKey) =>
  new Set<string>(expandPermissions(SYSTEM_ROLES[role].permissions));

describe('route declarations', () => {
  it('finds the admin routes', () => {
    expect(routes.length).toBeGreaterThan(50);
  });

  it('every admin route declares a permission or says it is for any signed-in admin', () => {
    const undeclared = routes
      .filter((r) => !PUBLIC_ROUTES.has(key(r)) && !r.can?.length && !r.signedIn)
      .map(key);
    expect(undeclared).toEqual([]);
  });

  it('only your own account, sign-out and "who am I" are open to any signed-in admin', () => {
    expect(
      routes
        .filter((r) => r.signedIn)
        .map(key)
        .toSorted(),
    ).toEqual([
      'DELETE account/sessions/:id',
      'GET account',
      'GET auth/me',
      'PATCH account',
      'POST account/2fa/disable',
      'POST account/2fa/enable',
      'POST account/2fa/setup',
      'POST account/password',
      'POST auth/logout',
    ]);
  });

  it('every route is accounted for in the before/after table', () => {
    const unknown = guarded
      .map(key)
      .filter((k) => !(k in BEFORE) && !(k in CHANGED) && !NEW_ROUTES.has(k))
      .filter(
        (k) =>
          !/^GET (overview|stores|stores\/:id|stores\/:id\/history|owners|owners\/:id|plans)$/.test(
            k,
          ),
      );
    expect(unknown).toEqual([]);
  });
});

describe('system roles', () => {
  it.each(['super_admin', 'support', 'sales'] as const)(
    '%s keeps exactly the access it had before permissions',
    async (role) => {
      const mismatches: string[] = [];
      for (const r of guarded) {
        const k = key(r);
        if (NEW_ROUTES.has(k)) continue;
        const allowedBefore = (CHANGED[k] ?? BEFORE[k] ?? [role]).includes(role);
        if ((await refused(agents[role].agent, r)) === allowedBefore) {
          mismatches.push(`${k}: expected ${allowedBefore ? 'allowed' : 'refused'}`);
        }
      }
      expect(mismatches).toEqual([]);
    },
  );

  it.each(['admin', 'manager', 'support', 'sales'] as const)(
    '%s can call exactly the routes its permissions cover',
    async (role) => {
      const perms = rolePermissions(role);
      const mismatches: string[] = [];
      for (const r of guarded) {
        const allowed = (r.can ?? []).every((p) => perms.has(p));
        if ((await refused(agents[role].agent, r)) === allowed) {
          mismatches.push(`${key(r)}: expected ${allowed ? 'allowed' : 'refused'}`);
        }
      }
      expect(mismatches).toEqual([]);
    },
  );

  it('"who am I" returns the role and its permissions', async () => {
    const me = await agents.manager.agent.get('/api/admin/auth/me').expect(200);
    expect(me.body.admin).toMatchObject({ role: 'manager', role_name: 'Manager' });
    expect(me.body.admin.permissions.toSorted()).toEqual(
      expandPermissions(SYSTEM_ROLES.manager.permissions).toSorted(),
    );
    const sup = await agents.super_admin.agent.get('/api/admin/auth/me').expect(200);
    expect(sup.body.admin.permissions).not.toContain('*');
    expect(sup.body.admin.permissions).toContain('roles.manage');
  });
});

describe('custom roles', () => {
  it('grant only their permissions, and a change applies on the next request', async () => {
    const [role] = await db
      .insert(schema.adminRoles)
      .values({ key: 'ticket_reader', name: 'Ticket reader', permissions: ['tickets.view'] })
      .returning();
    const { agent } = await signIn(role!.id);
    await agent.get('/api/admin/tickets').expect(200);
    await agent.get('/api/admin/stores').expect(403);
    const patch = () => agent.patch(`/api/admin/tickets/${randomUUID()}`).set(CSRF).send({});
    expect((await patch()).body.error).toBe('permission_denied');

    await db
      .update(schema.adminRoles)
      .set({ permissions: ['tickets.view', 'tickets.manage'] })
      .where(eq(schema.adminRoles.id, role!.id));
    expect((await patch()).body.error).not.toBe('permission_denied');
  });

  it('ignores unknown permission keys stored on a role', async () => {
    const [role] = await db
      .insert(schema.adminRoles)
      .values({ key: 'odd', name: 'Odd', permissions: ['stores.view', 'stores.everything'] })
      .returning();
    const { agent } = await signIn(role!.id);
    const me = await agent.get('/api/admin/auth/me').expect(200);
    expect(me.body.admin.permissions).toEqual(['stores.view']);
  });
});

describe('no escalation', () => {
  const create = (agent: Agent, role: string) =>
    agent
      .post('/api/admin/admins')
      .set(CSRF)
      .send({
        name: 'New person',
        email: `new-${randomUUID().slice(0, 8)}@restrovia.test`,
        role,
        password: 'a long enough password',
      });

  it('an Admin can add Admins, Managers and Support, but not Super admins', async () => {
    const { agent } = agents.admin;
    expect((await create(agent, 'super_admin')).body.error).toBe('role_above_yours');
    await create(agent, 'admin').expect(201);
    const made = await create(agent, 'manager').expect(201);
    expect(made.body).toMatchObject({ role: 'manager', role_name: 'Manager' });
    await create(agent, 'support').expect(201);
    expect((await create(agent, 'no_such_role')).body.error).toBe('unknown_role');
  });

  it('an Admin can’t disable or reset a Super admin, but can a Manager', async () => {
    const { agent } = agents.admin;
    const sup = await signIn(SYSTEM_ROLE_IDS.super_admin);
    const res = await agent.post(`/api/admin/admins/${sup.id}/disable`).set(CSRF).expect(403);
    expect(res.body.error).toBe('admin_above_yours');
    await agent.post(`/api/admin/admins/${sup.id}/reset-2fa`).set(CSRF).expect(403);
    const mgr = await signIn(SYSTEM_ROLE_IDS.manager);
    await agent.post(`/api/admin/admins/${mgr.id}/disable`).set(CSRF).expect(200);
    await mgr.agent.get('/api/admin/auth/me').expect(401);
  });

  it('lists which admins and roles each person may manage', async () => {
    const roles = (await agents.admin.agent.get('/api/admin/admin-roles').expect(200)).body;
    const assignable = Object.fromEntries(
      roles.map((r: { key: string; assignable: boolean }) => [r.key, r.assignable]),
    );
    expect(assignable).toMatchObject({
      super_admin: false,
      admin: true,
      manager: true,
      support: true,
      sales: true,
    });
    const people = (await agents.admin.agent.get('/api/admin/admins').expect(200)).body;
    const supRow = people.find((p: { role: string }) => p.role === 'super_admin');
    const selfRow = people.find((p: { id: string }) => p.id === agents.admin.id);
    expect(supRow.manageable).toBe(false);
    expect(selfRow.manageable).toBe(false);
    await agents.manager.agent.get('/api/admin/admins').expect(200);
    await create(agents.manager.agent, 'sales').expect(403);
  });
});

describe('lead permissions inside actions', () => {
  it('win without a store needs leads.win_override; unlinking a store needs leads.delete', async () => {
    const newLead = async (agent: Agent) =>
      (
        await agent
          .post('/api/admin/leads')
          .set(CSRF)
          .send({ business_name: `Perm ${randomUUID().slice(0, 6)}`, source: 'other' })
          .expect(201)
      ).body.id as string;
    const salesLead = await newLead(agents.sales.agent);
    const won = (agent: Agent, id: string) =>
      agent.post(`/api/admin/leads/${id}/stage`).set(CSRF).send({ stage: 'won' });
    expect((await won(agents.sales.agent, salesLead)).body.error).toBe('won_needs_store');
    await won(agents.manager.agent, salesLead).expect(201);

    const unlink = (agent: Agent) =>
      agent.post(`/api/admin/leads/${salesLead}/store`).set(CSRF).send({ store_id: null });
    expect((await unlink(agents.sales.agent)).body.error).toBe('permission_denied');
    await unlink(agents.admin.agent).expect(201);
  });

  it('only admins whose role works on leads can own them', async () => {
    const owners = (await agents.sales.agent.get('/api/admin/leads/assignees').expect(200)).body;
    const ids = owners.map((o: { id: string }) => o.id);
    expect(ids).toEqual(
      expect.arrayContaining([agents.sales.id, agents.manager.id, agents.admin.id]),
    );
    expect(ids).not.toContain(agents.support.id);
  });
});

describe('managing roles', () => {
  const sup = () => agents.super_admin.agent;
  const newRole = (agent: Agent, body: Record<string, unknown>) =>
    agent.post('/api/admin/admin-roles').set(CSRF).send(body);

  it('lists roles with how many people have each, and shows one with its people', async () => {
    const list = (await agents.manager.agent.get('/api/admin/admin-roles').expect(200)).body;
    const manager = list.find((r: { key: string }) => r.key === 'manager');
    expect(manager).toMatchObject({ is_system: true, all_permissions: false, editable: false });
    expect(manager.users).toBeGreaterThanOrEqual(1);
    const one = (await sup().get(`/api/admin/admin-roles/${SYSTEM_ROLE_IDS.manager}`).expect(200))
      .body;
    expect(one.people.map((p: { id: string }) => p.id)).toContain(agents.manager.id);
    expect(one.editable).toBe(true);
    const superRole = list.find((r: { key: string }) => r.key === 'super_admin');
    expect(superRole).toMatchObject({ all_permissions: true, editable: false });
  });

  it('adds a role with required permissions filled in, and audits it', async () => {
    const res = await newRole(sup(), {
      name: 'Onboarding team',
      description: 'Sets up new cafés',
      permissions: ['stores.devices', 'owners.invite'],
    }).expect(201);
    expect(res.body).toMatchObject({ key: 'onboarding_team', is_system: false, editable: true });
    expect(res.body.permissions.toSorted()).toEqual(
      ['owners.invite', 'owners.view', 'stores.devices', 'stores.view'].toSorted(),
    );
    const dup = await newRole(sup(), { name: 'onboarding TEAM', permissions: [] }).expect(409);
    expect(dup.body.error).toBe('role_name_in_use');
    const audit = await db.query.adminAuditLog.findFirst({
      where: eq(schema.adminAuditLog.targetId, res.body.id),
    });
    expect(audit?.action).toBe('role.create');
  });

  it('refuses unknown permissions, the wildcard, and permissions you don’t hold', async () => {
    expect(
      (await newRole(sup(), { name: 'Bad one', permissions: ['stores.fly'] })).body.error,
    ).toBe('unknown_permission');
    expect((await newRole(sup(), { name: 'Bad two', permissions: ['*'] })).body.error).toBe(
      'unknown_permission',
    );
    const custom = await signIn(SYSTEM_ROLE_IDS.super_admin);
    const [limited] = await db
      .insert(schema.adminRoles)
      .values({
        key: 'role_editor',
        name: 'Role editor',
        permissions: ['users.view', 'roles.manage', 'tickets.view'],
      })
      .returning();
    await db
      .update(schema.admins)
      .set({ roleId: limited!.id })
      .where(eq(schema.admins.id, custom.id));
    const res = await newRole(custom.agent, {
      name: 'Too much',
      permissions: ['tickets.view', 'audit.view'],
    }).expect(403);
    expect(res.body).toMatchObject({
      error: 'permission_above_yours',
      permissions: ['audit.view'],
    });
    await newRole(custom.agent, { name: 'Just tickets', permissions: ['tickets.view'] }).expect(
      201,
    );
    const edit = await custom.agent
      .patch(`/api/admin/admin-roles/${SYSTEM_ROLE_IDS.sales}`)
      .set(CSRF)
      .send({ description: 'x' })
      .expect(403);
    expect(edit.body.error).toBe('role_above_yours');
  });

  it('edits permissions with a before/after audit, applied on the next request', async () => {
    const role = (
      await newRole(sup(), { name: 'Finance', permissions: ['stores.view'] }).expect(201)
    ).body;
    const person = await signIn(role.id);
    await person.agent.get('/api/admin/plans').expect(403);
    const res = await sup()
      .patch(`/api/admin/admin-roles/${role.id}`)
      .set(CSRF)
      .send({ name: 'Finance team', permissions: ['stores.view', 'plans.view'] })
      .expect(200);
    expect(res.body.name).toBe('Finance team');
    await person.agent.get('/api/admin/plans').expect(200);
    const audits = await db
      .select()
      .from(schema.adminAuditLog)
      .where(eq(schema.adminAuditLog.targetId, role.id));
    const update = audits.find((a) => a.action === 'role.update');
    expect(update?.details).toMatchObject({
      renamed_from: 'Finance',
      added: ['plans.view'],
      removed: [],
    });
  });

  it('keeps Super admin fixed and built-in role names fixed; resets built-in roles', async () => {
    const lockedEdit = await sup()
      .patch(`/api/admin/admin-roles/${SYSTEM_ROLE_IDS.super_admin}`)
      .set(CSRF)
      .send({ permissions: ['stores.view'] })
      .expect(400);
    expect(lockedEdit.body.error).toBe('system_role_locked');
    const rename = await sup()
      .patch(`/api/admin/admin-roles/${SYSTEM_ROLE_IDS.support}`)
      .set(CSRF)
      .send({ name: 'Helpdesk' })
      .expect(400);
    expect(rename.body.error).toBe('system_role_name_fixed');

    await sup()
      .patch(`/api/admin/admin-roles/${SYSTEM_ROLE_IDS.support}`)
      .set(CSRF)
      .send({ permissions: ['tickets.view'] })
      .expect(200);
    const reset = await sup()
      .post(`/api/admin/admin-roles/${SYSTEM_ROLE_IDS.support}/reset`)
      .set(CSRF)
      .expect(200);
    expect(reset.body.permissions.toSorted()).toEqual(
      expandPermissions(SYSTEM_ROLES.support.permissions).toSorted(),
    );
  });

  it('deletes only unused custom roles', async () => {
    await sup().delete(`/api/admin/admin-roles/${SYSTEM_ROLE_IDS.sales}`).set(CSRF).expect(400);
    const role = (
      await newRole(sup(), { name: 'Temporary', permissions: ['overview.view'] }).expect(201)
    ).body;
    const person = await signIn(role.id);
    const inUse = await sup().delete(`/api/admin/admin-roles/${role.id}`).set(CSRF).expect(409);
    expect(inUse.body).toMatchObject({ error: 'role_in_use', users: 1 });
    await db
      .update(schema.admins)
      .set({ roleId: SYSTEM_ROLE_IDS.support })
      .where(eq(schema.admins.id, person.id));
    await sup().delete(`/api/admin/admin-roles/${role.id}`).set(CSRF).expect(200);
    await sup().get(`/api/admin/admin-roles/${role.id}`).expect(404);
  });

  it('only roles.manage can change roles', async () => {
    const res = await newRole(agents.admin.agent, { name: 'Nope', permissions: [] }).expect(403);
    expect(res.body.error).toBe('permission_denied');
  });
});
