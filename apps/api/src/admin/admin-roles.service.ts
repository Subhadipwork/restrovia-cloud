import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { asc, count, eq } from 'drizzle-orm';
import {
  type AdminPermission,
  ALL_PERMISSIONS,
  expandPermissions,
  isPermission,
  SYSTEM_ROLES,
  type SystemRoleKey,
  withRequired,
} from '@restrovia/shared';
import { DB, type Database } from '../db/database.module.js';
import { adminRoles, admins } from '../db/schema/index.js';
import { isUniqueViolation } from '../pos/register.service.js';
import { type AdminRow, grantsNoMoreThan } from './admin-auth.service.js';
import { writeAudit } from './audit.js';

export type RoleInput = { name: string; description: string; permissions: string[] };

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
type RoleRecord = typeof adminRoles.$inferSelect;

/** "Onboarding team" → "onboarding_team"; matches the key check in the database. */
function keyFrom(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32);
  return /^[a-z]/.test(slug) && slug.length >= 2 ? slug : `role_${slug}`.slice(0, 32);
}

/** Admin roles: list, view, add, edit, delete, reset. Built-in roles can't be deleted. */
@Injectable()
export class AdminRolesService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async list(by: AdminRow) {
    const [rows, counts] = await Promise.all([
      this.db.select().from(adminRoles).orderBy(asc(adminRoles.createdAt)),
      this.db
        .select({ roleId: admins.roleId, n: count() })
        .from(admins)
        .where(eq(admins.status, 'active'))
        .groupBy(admins.roleId),
    ]);
    const users = new Map(counts.map((c) => [c.roleId, c.n]));
    return rows.map((r) => ({ ...this.view(r, by), users: users.get(r.id) ?? 0 }));
  }

  async detail(id: string, by: AdminRow) {
    const role = await this.find(this.db, id);
    const people = await this.db
      .select({ id: admins.id, name: admins.name, email: admins.email, status: admins.status })
      .from(admins)
      .where(eq(admins.roleId, id))
      .orderBy(asc(admins.name));
    return { ...this.view(role, by), users: people.length, people };
  }

  async create(input: RoleInput, by: AdminRow, ip: string | null) {
    const permissions = this.checkPermissions(input.permissions, by);
    try {
      return await this.db.transaction(async (tx) => {
        const [row] = await tx
          .insert(adminRoles)
          .values({
            key: await this.freeKey(tx, keyFrom(input.name)),
            name: input.name,
            description: input.description,
            permissions,
          })
          .returning();
        await writeAudit(tx, {
          adminId: by.id,
          action: 'role.create',
          targetType: 'role',
          targetId: row!.id,
          details: { name: row!.name, permissions },
          ip,
        });
        return this.view(row!, by);
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException({ error: 'role_name_in_use' });
      throw err;
    }
  }

  async update(id: string, input: Partial<RoleInput>, by: AdminRow, ip: string | null) {
    try {
      return await this.db.transaction(async (tx) => {
        const role = await this.find(tx, id, true);
        this.assertEditable(role, by);
        if (role.isSystem && input.name !== undefined && input.name !== role.name) {
          throw new BadRequestException({ error: 'system_role_name_fixed' });
        }
        const permissions =
          input.permissions === undefined
            ? undefined
            : this.checkPermissions(input.permissions, by, role);
        const [row] = await tx
          .update(adminRoles)
          .set({
            ...(input.name !== undefined && !role.isSystem ? { name: input.name } : {}),
            ...(input.description !== undefined ? { description: input.description } : {}),
            ...(permissions ? { permissions } : {}),
            updatedAt: new Date(),
          })
          .where(eq(adminRoles.id, id))
          .returning();
        await writeAudit(tx, {
          adminId: by.id,
          action: 'role.update',
          targetType: 'role',
          targetId: id,
          details: {
            name: row!.name,
            ...(input.name !== undefined && input.name !== role.name
              ? { renamed_from: role.name }
              : {}),
            ...(permissions ? diff(role.permissions, permissions) : {}),
          },
          ip,
        });
        return this.view(row!, by);
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException({ error: 'role_name_in_use' });
      throw err;
    }
  }

  async remove(id: string, by: AdminRow, ip: string | null) {
    return this.db.transaction(async (tx) => {
      const role = await this.find(tx, id, true);
      if (role.isSystem) throw new BadRequestException({ error: 'system_role_locked' });
      this.assertEditable(role, by);
      const [inUse] = await tx.select({ n: count() }).from(admins).where(eq(admins.roleId, id));
      if ((inUse?.n ?? 0) > 0) {
        throw new ConflictException({ error: 'role_in_use', users: inUse!.n });
      }
      await tx.delete(adminRoles).where(eq(adminRoles.id, id));
      await writeAudit(tx, {
        adminId: by.id,
        action: 'role.delete',
        targetType: 'role',
        targetId: id,
        details: { name: role.name, permissions: role.permissions },
        ip,
      });
      return { ok: true };
    });
  }

  /** Puts a built-in role (other than Super admin) back to its shipped permissions. */
  async reset(id: string, by: AdminRow, ip: string | null) {
    return this.db.transaction(async (tx) => {
      const role = await this.find(tx, id, true);
      if (!role.isSystem || !(role.key in SYSTEM_ROLES)) {
        throw new BadRequestException({ error: 'not_a_system_role' });
      }
      this.assertEditable(role, by);
      const defaults = SYSTEM_ROLES[role.key as SystemRoleKey];
      const permissions = this.checkPermissions([...defaults.permissions], by, role);
      const [row] = await tx
        .update(adminRoles)
        .set({ description: defaults.description, permissions, updatedAt: new Date() })
        .where(eq(adminRoles.id, id))
        .returning();
      await writeAudit(tx, {
        adminId: by.id,
        action: 'role.reset',
        targetType: 'role',
        targetId: id,
        details: { name: role.name, ...diff(role.permissions, permissions) },
        ip,
      });
      return this.view(row!, by);
    });
  }

  private view(r: RoleRecord, by: AdminRow) {
    const locked = r.permissions.includes(ALL_PERMISSIONS);
    return {
      id: r.id,
      key: r.key,
      name: r.name,
      description: r.description,
      is_system: r.isSystem,
      /** Super admin: always every permission, can't be edited. */
      all_permissions: locked,
      permissions: expandPermissions(r.permissions),
      /** Whether `by` may give this role to someone. */
      assignable: grantsNoMoreThan(r.permissions, by),
      /** Whether `by` may change this role's permissions. */
      editable:
        !locked && by.permissions.has('roles.manage') && grantsNoMoreThan(r.permissions, by),
      created_at: r.createdAt,
      updated_at: r.updatedAt,
    };
  }

  private async find(db: Database | Tx, id: string, lock = false) {
    const q = db.select().from(adminRoles).where(eq(adminRoles.id, id));
    const [role] = lock ? await q.for('update') : await q;
    if (!role) throw new NotFoundException({ error: 'role_not_found' });
    return role;
  }

  /** Super admin is fixed, and nobody edits a role that allows more than they have. */
  private assertEditable(role: RoleRecord, by: AdminRow) {
    if (role.permissions.includes(ALL_PERMISSIONS)) {
      throw new BadRequestException({ error: 'system_role_locked' });
    }
    if (!grantsNoMoreThan(role.permissions, by)) {
      throw new ForbiddenException({ error: 'role_above_yours' });
    }
  }

  /**
   * Known keys only, plus everything they require, and nothing `by` lacks. `*` is never accepted:
   * only the built-in Super admin role has it.
   */
  private checkPermissions(
    requested: string[],
    by: AdminRow,
    current?: RoleRecord,
  ): AdminPermission[] {
    const unknown = requested.filter((p) => !isPermission(p));
    if (unknown.length) throw new BadRequestException({ error: 'unknown_permission', unknown });
    const full = withRequired(requested as AdminPermission[]);
    const beyond = full.filter((p) => !by.permissions.has(p));
    if (beyond.length) {
      throw new ForbiddenException({ error: 'permission_above_yours', permissions: beyond });
    }
    if (current && full.length === 0 && current.isSystem) {
      throw new BadRequestException({ error: 'role_needs_permissions' });
    }
    return full;
  }

  private async freeKey(tx: Tx, base: string): Promise<string> {
    for (let i = 1; ; i++) {
      const candidate = i === 1 ? base : `${base.slice(0, 28)}_${i}`;
      const taken = await tx
        .select({ id: adminRoles.id })
        .from(adminRoles)
        .where(eq(adminRoles.key, candidate));
      if (taken.length === 0) return candidate;
    }
  }
}

function diff(before: readonly string[], after: readonly string[]) {
  const was = new Set(expandPermissions(before));
  const now = new Set(after);
  return {
    added: [...now].filter((p) => !was.has(p as AdminPermission)),
    removed: [...was].filter((p) => !now.has(p)),
  };
}
