import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import {
  MENU_CHANGE_TTL_SECONDS,
  type MenuChangeStatus,
  type PosMenuSnapshot,
  type StoreMemberRole,
} from '@restrovia/shared';
import { CommandsService } from '../commands/commands.service.js';
import { DB, type Database } from '../db/database.module.js';
import { commands, menuChanges, menuSnapshots } from '../db/schema/index.js';
import type { StoreRow } from './store-member.guard.js';

/** A manager may not move a price further than this share without the owner. */
const MANAGER_PRICE_LIMIT = 0.25;
const MAX_DRAFTS = 500;
const BATCH_SIZE = 100;

const text = (max: number) => z.string().trim().max(max);
const optionalText = (max: number) => text(max).nullable();

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'use a time like 08:00');
const endTime = z.union([time, z.literal('24:00')]);
const scheduleWindow = z
  .strictObject({
    days: z.array(z.number().int().min(0).max(6)).min(1).max(7),
    start: time,
    end: endTime,
  })
  .refine((w) => w.start !== w.end, 'start and end must differ')
  .refine((w) => new Set(w.days).size === w.days.length, 'days must not repeat');
const schedule = z.array(scheduleWindow).max(14);

const variantRow = z.strictObject({
  id: z.string().trim().min(1).max(64).optional(),
  name: text(120).min(1),
  price: z.number().min(0).max(10_000_000),
  online_price: z.number().min(0).max(10_000_000).nullable().optional(),
  sku: optionalText(64).optional(),
  barcode: optionalText(64).optional(),
  is_active: z.boolean().optional(),
  sort_order: z.number().int().min(0).max(100_000).optional(),
});

const itemFields = z.strictObject({
  name: text(120).min(1),
  description: optionalText(1000),
  price: z.number().min(0).max(10_000_000),
  cost_price: z.number().min(0).max(10_000_000).nullable(),
  sku: optionalText(64),
  barcode: optionalText(64),
  category_id: optionalText(64),
  is_active: z.boolean(),
  sort_order: z.number().int().min(0).max(100_000),
  variants: z.array(variantRow).max(30),
  addon_group_ids: z.array(z.string().trim().min(1).max(64)).max(50),
  schedule,
});
const categoryFields = z.strictObject({
  name: text(120).min(1),
  description: optionalText(1000),
  parent_id: optionalText(64),
  sort_order: z.number().int().min(0).max(100_000),
  is_active: z.boolean(),
  color: optionalText(32),
  icon: optionalText(64),
  schedule,
});

const addonGroupFields = z.strictObject({
  name: text(120).min(1),
  description: optionalText(1000),
  is_required: z.boolean(),
  min_selection: z.number().int().min(0).max(100),
  max_selection: z.number().int().min(0).max(100),
  allow_multiple_quantities: z.boolean(),
  is_active: z.boolean(),
  sort_order: z.number().int().min(0).max(100_000),
});
const addonFields = z.strictObject({
  addon_group_id: text(64).min(1),
  name: text(120).min(1),
  price: z.number().min(0).max(10_000_000),
  is_active: z.boolean(),
  sort_order: z.number().int().min(0).max(100_000),
});

const ENTITIES = ['item', 'category', 'addon_group', 'addon'] as const;
type Entity = (typeof ENTITIES)[number];
const FIELD_SCHEMAS = {
  item: itemFields,
  category: categoryFields,
  addon_group: addonGroupFields,
  addon: addonFields,
} as const;

export const menuDraftInput = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('create'),
    entity: z.enum(ENTITIES),
    fields: z.record(z.string(), z.unknown()),
  }),
  z.object({
    op: z.literal('update'),
    entity: z.enum(ENTITIES),
    entity_id: z.string().trim().min(1).max(64),
    fields: z.record(z.string(), z.unknown()),
  }),
  z.object({
    op: z.literal('delete'),
    entity: z.enum(ENTITIES),
    entity_id: z.string().trim().min(1).max(64),
  }),
]);
export type MenuDraftInput = z.infer<typeof menuDraftInput>;

export const menuBulkInput = z.object({
  item_ids: z.array(z.string().trim().min(1).max(64)).min(1).max(200),
  action: z.discriminatedUnion('type', [
    z.object({ type: z.literal('price_percent'), value: z.number().min(-90).max(500) }),
    z.object({ type: z.literal('price_amount'), value: z.number().min(-100_000).max(100_000) }),
    z.object({ type: z.literal('set_active'), value: z.boolean() }),
    z.object({ type: z.literal('move_category'), value: z.string().trim().min(1).max(64).nullable() }),
  ]),
});
export type MenuBulkInput = z.infer<typeof menuBulkInput>;

const importRow = z.object({
  name: text(120).min(1),
  category: text(120).optional(),
  price: z.number().min(0).max(10_000_000).optional(),
  description: optionalText(1000).optional(),
  sku: optionalText(64).optional(),
  barcode: optionalText(64).optional(),
  available: z.boolean().optional(),
});
export const menuImportInput = z.object({ rows: z.array(importRow).min(1).max(500) });
export type ImportRow = z.infer<typeof importRow>;

export const menuDuplicateInput = z.object({
  item_id: z.string().trim().min(1).max(64),
  name: text(120).min(1).optional(),
});

function errorCode(err: BadRequestException): string {
  return String((err.getResponse() as { error?: string }).error ?? '');
}

function errorText(err: unknown): string {
  if (err instanceof HttpException) {
    const body = err.getResponse() as { message?: string; error?: string };
    return body.message ?? body.error ?? err.message;
  }
  return err instanceof Error ? err.message : 'Could not use this row';
}

type Row = Record<string, unknown>;
type Owner = { id: string; name: string };

const same = (a: unknown, b: unknown) => (a ?? null) === (b ?? null) || (a === '' && b === null);
const flag = (v: unknown) => v === 1 || v === true || v === '1';

/** A size as the portal sees it; two lists with the same sizes compare equal. */
function canonVariant(v: Row): Row {
  const num = (x: unknown) => (x === null || x === undefined || x === '' ? null : Number(x));
  const str = (x: unknown) => (x === null || x === undefined || x === '' ? null : String(x));
  return {
    id: v.id ?? null,
    name: String(v.name ?? ''),
    price: num(v.price),
    online_price: num(v.online_price),
    sku: str(v.sku),
    barcode: str(v.barcode),
    is_active: v.is_active === undefined ? true : flag(v.is_active),
    sort_order: Number(v.sort_order ?? 0) || 0,
  };
}
const canonWindows = (list: unknown) =>
  (Array.isArray(list) ? (list as Row[]) : [])
    .map((w) => ({
      days: [...((w.days as number[]) ?? [])].sort((a, b) => a - b),
      start: String(w.start),
      end: String(w.end),
    }))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
const canonList = (list: unknown, kind: 'variants' | 'ids' | 'schedule') =>
  JSON.stringify(
    kind === 'schedule'
      ? canonWindows(list)
      : kind === 'ids'
      ? (Array.isArray(list) ? list.map(String) : []).sort()
      : (Array.isArray(list) ? (list as Row[]) : [])
          .map(canonVariant)
          .sort((a, b) => String(a.id).localeCompare(String(b.id))),
  );
const LIST_FIELDS: Record<string, 'variants' | 'ids' | 'schedule'> = {
  variants: 'variants',
  addon_group_ids: 'ids',
  schedule: 'schedule',
};
const sameValue = (field: string, a: unknown, b: unknown) =>
  LIST_FIELDS[field]
    ? canonList(a, LIST_FIELDS[field]) === canonList(b, LIST_FIELDS[field])
    : same(a, b);

@Injectable()
export class OwnerMenuChangesService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly commands: CommandsService,
  ) {}

  private async snapshot(storeId: string) {
    const row = await this.db.query.menuSnapshots.findFirst({
      where: eq(menuSnapshots.storeId, storeId),
    });
    if (!row?.data) throw new NotFoundException({ error: 'menu_not_synced' });
    return { row, data: row.data as PosMenuSnapshot };
  }

  private requireEditable(row: { syncEnabled: boolean; portalEditing: boolean }) {
    if (!row.syncEnabled) throw new ConflictException({ error: 'menu_sync_off' });
    if (!row.portalEditing) throw new ForbiddenException({ error: 'portal_editing_off' });
  }

  /** The value the POS has now for a portal field name. */
  private current(data: PosMenuSnapshot, entity: Entity, source: Row, field: string): unknown {
    if (field === 'variants') {
      return (data.variants as Row[]).filter((v) => v.product_id === source.id).map(canonVariant);
    }
    if (field === 'schedule') {
      const kind = entity === 'item' ? 'item' : 'category';
      return canonWindows(
        ((data.schedules ?? []) as Row[]).filter((w) => w.entity === kind && w.entity_id === source.id),
      );
    }
    if (field === 'addon_group_ids') {
      return (data.addon_group_products as Row[])
        .filter((l) => l.product_id === source.id)
        .map((l) => String(l.addon_group_id));
    }
    if (['is_active', 'is_required', 'allow_multiple_quantities'].includes(field)) {
      return flag(source[field]);
    }
    if (entity === 'item' && field === 'cost_price') return source.cost ?? null;
    const value = source[field];
    return value === undefined || value === '' ? null : value;
  }

  /** Adds an edit to the store's draft; editing the same thing again replaces its earlier draft. */
  async addDraft(store: StoreRow, owner: Owner, role: StoreMemberRole, input: MenuDraftInput) {
    const { row, data } = await this.snapshot(store.id);
    this.requireEditable(row);
    const rows = this.rowsOf(data, input.entity);

    if (input.op === 'create') {
      const fields = this.parseFields(input.entity, input.fields, role);
      if (['item', 'addon'].includes(input.entity) && fields.price === undefined) {
        throw new BadRequestException({ error: 'invalid_fields', message: 'A price is required' });
      }
      if (input.entity === 'addon' && !fields.addon_group_id) {
        throw new BadRequestException({ error: 'invalid_fields', message: 'An option needs a group' });
      }
      if (fields.name === undefined) {
        throw new BadRequestException({ error: 'invalid_fields', message: 'A name is required' });
      }
      this.checkReferences(data, input.entity, fields);
      return this.insertDraft(store, owner, input.entity, 'create', null, String(fields.name), fields);
    }

    const source = rows.find((r) => r.id === input.entity_id);
    if (!source) throw new NotFoundException({ error: 'item_not_found' });
    const label = String(source.name ?? '');

    if (input.op === 'delete') {
      await this.db
        .delete(menuChanges)
        .where(
          and(
            eq(menuChanges.storeId, store.id),
            eq(menuChanges.entityId, input.entity_id),
            eq(menuChanges.entity, input.entity),
            eq(menuChanges.status, 'draft'),
          ),
        );
      return this.insertDraft(store, owner, input.entity, 'delete', input.entity_id, label, {});
    }

    const to = this.parseFields(input.entity, input.fields, role);
    if (input.entity === 'addon' && 'addon_group_id' in to) {
      throw new BadRequestException({
        error: 'invalid_fields',
        message: 'An option cannot move to another group',
      });
    }
    this.checkReferences(data, input.entity, to, source);
    const fields: Record<string, { from: unknown; to: unknown }> = {};
    for (const [name, value] of Object.entries(to)) {
      const from = this.current(data, input.entity, source, name);
      if (!sameValue(name, from, value)) fields[name] = { from, to: value };
    }

    const [existing] = await this.db
      .select()
      .from(menuChanges)
      .where(
        and(
          eq(menuChanges.storeId, store.id),
          eq(menuChanges.entityId, input.entity_id),
          eq(menuChanges.entity, input.entity),
          eq(menuChanges.op, 'update'),
          eq(menuChanges.status, 'draft'),
        ),
      );
    if (existing) {
      // Keep the first "from" so the change still means "from what the POS had when you began".
      const merged = { ...(existing.fields as Record<string, { from: unknown; to: unknown }>) };
      for (const name of Object.keys(to)) {
        const earlier = merged[name]?.from ?? this.current(data, input.entity, source, name);
        if (sameValue(name, earlier, to[name])) delete merged[name];
        else merged[name] = { from: earlier, to: to[name] };
      }
      if (Object.keys(merged).length === 0) {
        await this.db.delete(menuChanges).where(eq(menuChanges.id, existing.id));
        return { draft: null };
      }
      const [updated] = await this.db
        .update(menuChanges)
        .set({ fields: merged, label, requestedBy: owner.id, requestedByName: owner.name })
        .where(eq(menuChanges.id, existing.id))
        .returning();
      return { draft: this.view(updated) };
    }
    if (Object.keys(fields).length === 0) {
      throw new BadRequestException({ error: 'nothing_to_change' });
    }
    return this.insertDraft(store, owner, input.entity, 'update', input.entity_id, label, fields);
  }

  private rowsOf(data: PosMenuSnapshot, entity: Entity): Row[] {
    switch (entity) {
      case 'item':
        return data.products as Row[];
      case 'category':
        return data.categories as Row[];
      case 'addon_group':
        return data.addon_groups as Row[];
      default:
        return data.addons as Row[];
    }
  }

  private parseFields(entity: Entity, raw: Record<string, unknown>, role: StoreMemberRole): Row {
    const parsed = FIELD_SCHEMAS[entity].partial().safeParse(raw);
    if (!parsed.success) {
      throw new BadRequestException({
        error: 'invalid_fields',
        message: parsed.error.issues.map((i) => `${i.path.join('.') || 'fields'}: ${i.message}`).join(', '),
      });
    }
    const data = parsed.data as Row;
    if ('cost_price' in data && role !== 'owner') throw new ForbiddenException({ error: 'owner_only' });
    return Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined));
  }

  private checkReferences(data: PosMenuSnapshot, entity: Entity, fields: Row, product?: Row) {
    const bad = (message: string) =>
      new BadRequestException({ error: 'invalid_fields', message });
    const known = (rows: Row[], id: unknown) => rows.some((r) => r.id === id);
    const ref = entity === 'item' ? 'category_id' : entity === 'category' ? 'parent_id' : null;
    if (ref && typeof fields[ref] === 'string' && fields[ref] && !known(data.categories, fields[ref])) {
      throw bad(`${ref}: no such category`);
    }
    if (entity === 'addon' && fields.addon_group_id !== undefined && !known(data.addon_groups, fields.addon_group_id)) {
      throw bad('addon_group_id: no such group');
    }
    if (entity === 'item' && Array.isArray(fields.addon_group_ids)) {
      const missing = (fields.addon_group_ids as string[]).filter(
        (id) => !known(data.addon_groups, id),
      );
      if (missing.length > 0) throw bad('addon_group_ids: no such group');
    }
    if (entity === 'item' && Array.isArray(fields.variants)) {
      const owned = new Set(
        (data.variants as Row[]).filter((v) => v.product_id === product?.id).map((v) => v.id),
      );
      for (const v of fields.variants as Row[]) {
        if (v.id !== undefined && !owned.has(v.id)) throw bad('variants: unknown size');
      }
      if (!product && (fields.variants as Row[]).some((v) => v.id !== undefined)) {
        throw bad('variants: a new item cannot reuse sizes');
      }
    }
  }

  private async insertDraft(
    store: StoreRow,
    owner: Owner,
    entity: Entity,
    op: 'create' | 'update' | 'delete',
    entityId: string | null,
    label: string,
    fields: Record<string, unknown>,
  ) {
    const waiting = await this.db
      .select({ id: menuChanges.id })
      .from(menuChanges)
      .where(and(eq(menuChanges.storeId, store.id), eq(menuChanges.status, 'draft')));
    if (waiting.length >= MAX_DRAFTS) throw new BadRequestException({ error: 'too_many_changes' });
    const [draft] = await this.db
      .insert(menuChanges)
      .values({
        storeId: store.id,
        entity,
        op,
        entityId,
        label,
        fields,
        requestedBy: owner.id,
        requestedByName: owner.name,
      })
      .returning();
    return { draft: this.view(draft) };
  }

  async discard(store: StoreRow, changeId: string) {
    const removed = await this.db
      .delete(menuChanges)
      .where(
        and(
          eq(menuChanges.id, changeId),
          eq(menuChanges.storeId, store.id),
          eq(menuChanges.status, 'draft'),
        ),
      )
      .returning({ id: menuChanges.id });
    if (removed.length === 0) throw new NotFoundException({ error: 'draft_not_found' });
    return { discarded: removed[0].id };
  }

  /** Sends every draft to the POS as one batch, which the POS applies whenever it is online. */
  async publish(store: StoreRow, owner: Owner, role: StoreMemberRole) {
    const { row } = await this.snapshot(store.id);
    this.requireEditable(row);
    const drafts = await this.db
      .select()
      .from(menuChanges)
      .where(and(eq(menuChanges.storeId, store.id), eq(menuChanges.status, 'draft')))
      .orderBy(asc(menuChanges.createdAt));
    if (drafts.length === 0) throw new BadRequestException({ error: 'nothing_to_publish' });

    if (role !== 'owner') {
      const big = drafts.filter((d) => {
        const fields = d.fields as Record<string, { from?: unknown; to?: unknown }>;
        const price = fields.price;
        const from = Number(price?.from);
        const sizes = this.largestSizeMove(fields.variants);
        return (
          (price && from > 0 && Math.abs(Number(price.to) - from) / from > MANAGER_PRICE_LIMIT) ||
          sizes > MANAGER_PRICE_LIMIT
        );
      });
      if (big.length > 0) {
        throw new ForbiddenException({
          error: 'owner_approval_needed',
          message: big.map((d) => d.label).join(', '),
        });
      }
    }

    // The POS applies up to 100 changes per command; larger drafts go as several, in order.
    for (let i = 0; i < drafts.length; i += BATCH_SIZE) {
      const batch = drafts.slice(i, i + BATCH_SIZE);
      const command = await this.commands.create(
        store.id,
        'menu.apply_changes',
        {
          changes: batch.map((d) => ({
            id: d.id,
            entity: d.entity,
            op: d.op,
            entity_id: d.entityId,
            fields: d.fields,
            requested_by: `Owner portal: ${owner.name}`,
          })),
        },
        owner.id,
        MENU_CHANGE_TTL_SECONDS,
      );
      await this.db
        .update(menuChanges)
        .set({ status: 'pending', commandId: command.id, publishedAt: new Date() })
        .where(
          and(
            inArray(
              menuChanges.id,
              batch.map((d) => d.id),
            ),
            eq(menuChanges.status, 'draft'),
          ),
        );
    }
    return { published: drafts.length };
  }

  /** The biggest share any size's price moves in a change to an item's sizes. */
  private largestSizeMove(variants: unknown): number {
    const change = variants as { from?: Row[]; to?: Row[] } | undefined;
    if (!change?.from || !change.to) return 0;
    let largest = 0;
    for (const to of change.to) {
      const from = change.from.find((f) => f.id === to.id);
      const before = Number(from?.price);
      if (from && before > 0) largest = Math.max(largest, Math.abs(Number(to.price) - before) / before);
    }
    return largest;
  }

  /** Puts an applied change back: an edit is edited back, a new thing is removed. */
  async revert(store: StoreRow, owner: Owner, role: StoreMemberRole, changeId: string) {
    const [change] = await this.db
      .select()
      .from(menuChanges)
      .where(and(eq(menuChanges.id, changeId), eq(menuChanges.storeId, store.id)));
    if (!change || change.status !== 'applied') {
      throw new NotFoundException({ error: 'change_not_found' });
    }
    const entity = change.entity as Entity;
    if (change.op === 'update' && change.entityId) {
      const back = Object.fromEntries(
        Object.entries(change.fields as Record<string, { from: unknown }>).map(([k, v]) => [k, v.from]),
      );
      return this.addDraft(store, owner, role, {
        op: 'update',
        entity,
        entity_id: change.entityId,
        fields: back,
      });
    }
    if (change.op === 'create' && change.entityId) {
      return this.addDraft(store, owner, role, { op: 'delete', entity, entity_id: change.entityId });
    }
    throw new BadRequestException({ error: 'cannot_revert' });
  }

  /** Turns one action on many items into one draft per item. */
  async bulk(store: StoreRow, owner: Owner, role: StoreMemberRole, input: MenuBulkInput) {
    const { row, data } = await this.snapshot(store.id);
    this.requireEditable(row);
    const items = data.products as Row[];
    const result = { drafted: 0, unchanged: 0, skipped: 0 };
    const round = (n: number) => Math.max(0, Math.round(n * 100) / 100);
    const move = (price: number) =>
      input.action.type === 'price_percent'
        ? round(price * (1 + input.action.value / 100))
        : input.action.type === 'price_amount'
          ? round(price + input.action.value)
          : price;

    for (const id of [...new Set(input.item_ids)]) {
      const item = items.find((p) => p.id === id);
      if (!item) {
        result.skipped++;
        continue;
      }
      let fields: Row;
      switch (input.action.type) {
        case 'set_active':
          fields = { is_active: input.action.value };
          break;
        case 'move_category':
          fields = { category_id: input.action.value };
          break;
        default: {
          const sizes = (data.variants as Row[])
            .filter((v) => v.product_id === id)
            .map(canonVariant)
            .map((v) => ({ ...v, price: move(Number(v.price)) }));
          fields = {
            price: move(Number(item.price)),
            ...(sizes.length > 0 ? { variants: sizes } : {}),
          };
        }
      }
      try {
        await this.addDraft(store, owner, role, {
          op: 'update',
          entity: 'item',
          entity_id: id as string,
          fields,
        });
        result.drafted++;
      } catch (err) {
        if (err instanceof BadRequestException && errorCode(err) === 'nothing_to_change') {
          result.unchanged++;
        } else {
          throw err;
        }
      }
    }
    return result;
  }

  /** A copy of an item as a new-item draft: same price, sizes and add-ons; no SKU or barcode. */
  async duplicate(store: StoreRow, owner: Owner, role: StoreMemberRole, itemId: string, name?: string) {
    const { row, data } = await this.snapshot(store.id);
    this.requireEditable(row);
    const item = (data.products as Row[]).find((p) => p.id === itemId);
    if (!item) throw new NotFoundException({ error: 'item_not_found' });
    const sizes = (data.variants as Row[])
      .filter((v) => v.product_id === itemId)
      .map(canonVariant)
      .map(({ name: n, price, online_price, is_active, sort_order }) => ({
        name: n,
        price,
        online_price,
        is_active,
        sort_order,
      }));
    const groups = (data.addon_group_products as Row[])
      .filter((l) => l.product_id === itemId)
      .map((l) => String(l.addon_group_id));
    const copied = canonWindows(
      ((data.schedules ?? []) as Row[]).filter((w) => w.entity === 'item' && w.entity_id === itemId),
    );
    const fields: Row = {
      name: (name ?? `${String(item.name)} (copy)`).slice(0, 120),
      price: Number(item.price),
      is_active: flag(item.is_active),
      sort_order: Number(item.sort_order ?? 0) || 0,
      ...(item.category_id ? { category_id: item.category_id } : {}),
      ...(item.description ? { description: item.description } : {}),
      ...(role === 'owner' && item.cost ? { cost_price: Number(item.cost) } : {}),
      ...(sizes.length > 0 ? { variants: sizes } : {}),
      ...(groups.length > 0 ? { addon_group_ids: groups } : {}),
      ...(copied.length > 0 ? { schedule: copied } : {}),
    };
    return this.addDraft(store, owner, role, { op: 'create', entity: 'item', fields });
  }

  /** Creates or updates items from spreadsheet rows, matched by name (and category when given). */
  async importRows(store: StoreRow, owner: Owner, role: StoreMemberRole, rows: ImportRow[]) {
    const { row, data } = await this.snapshot(store.id);
    this.requireEditable(row);
    const result = {
      created: 0,
      updated: 0,
      unchanged: 0,
      errors: [] as { row: number; error: string }[],
    };
    const lower = (v: unknown) => String(v ?? '').trim().toLowerCase();
    const items = data.products as Row[];

    for (const [index, r] of rows.entries()) {
      const line = index + 1;
      try {
        let categoryId: string | null | undefined;
        if (r.category) {
          const match = (data.categories as Row[]).find((c) => lower(c.name) === lower(r.category));
          if (!match) throw new Error(`No category called "${r.category}"`);
          categoryId = String(match.id);
        }
        const matches = items.filter(
          (p) =>
            lower(p.name) === lower(r.name) && (categoryId === undefined || p.category_id === categoryId),
        );
        if (matches.length > 1) throw new Error(`More than one item is called "${r.name}"; add its category`);
        const fields: Row = {
          ...(r.price !== undefined ? { price: r.price } : {}),
          ...(r.description !== undefined ? { description: r.description } : {}),
          ...(r.sku !== undefined ? { sku: r.sku } : {}),
          ...(r.barcode !== undefined ? { barcode: r.barcode } : {}),
          ...(r.available !== undefined ? { is_active: r.available } : {}),
          ...(categoryId !== undefined ? { category_id: categoryId } : {}),
        };
        if (matches.length === 1) {
          try {
            await this.addDraft(store, owner, role, {
              op: 'update',
              entity: 'item',
              entity_id: String(matches[0].id),
              fields,
            });
            result.updated++;
          } catch (err) {
            if (err instanceof BadRequestException && errorCode(err) === 'nothing_to_change') result.unchanged++;
            else throw err;
          }
        } else {
          await this.addDraft(store, owner, role, {
            op: 'create',
            entity: 'item',
            fields: { name: r.name, ...fields },
          });
          result.created++;
        }
      } catch (err) {
        result.errors.push({ row: line, error: errorText(err) });
      }
    }
    return result;
  }

  /** Drafts, changes waiting for the POS, and the latest answers. */
  async list(store: StoreRow) {
    await this.reconcile(store.id);
    const rows = await this.db
      .select()
      .from(menuChanges)
      .where(eq(menuChanges.storeId, store.id))
      .orderBy(desc(menuChanges.createdAt))
      .limit(100);
    return { changes: rows.map((r) => this.view(r)) };
  }

  /** Copies the POS's answers from the command onto each change. */
  private async reconcile(storeId: string) {
    const pending = await this.db
      .select()
      .from(menuChanges)
      .where(and(eq(menuChanges.storeId, storeId), eq(menuChanges.status, 'pending')));
    if (pending.length === 0) return;
    const ids = [...new Set(pending.map((p) => p.commandId).filter((x): x is string => !!x))];
    const rows = ids.length
      ? await this.db.select().from(commands).where(inArray(commands.id, ids))
      : [];
    const byId = new Map(rows.map((c) => [c.id, c]));

    for (const change of pending) {
      const command = change.commandId ? byId.get(change.commandId) : undefined;
      let status: MenuChangeStatus | null = null;
      let result: Record<string, unknown> | null = null;
      if (!command || command.status === 'expired') {
        if (!command || command.expiresAt.getTime() < Date.now()) {
          status = 'expired';
          result = { error: 'The POS did not come online in time' };
        }
      } else if (command.status === 'failed') {
        status = 'rejected';
        result = { error: command.error ?? 'The POS refused the changes' };
      } else if (command.status === 'done') {
        const answers = (command.result as { results?: Row[] } | null)?.results ?? [];
        const answer = answers.find((a) => a.id === change.id);
        if (answer) {
          status = answer.status as MenuChangeStatus;
          result = {
            ...(answer.error ? { error: answer.error } : {}),
            ...(answer.current ? { current: answer.current } : {}),
            ...(answer.entity_id ? { entity_id: answer.entity_id } : {}),
          };
        } else {
          status = 'rejected';
          result = { error: 'The POS gave no answer for this change' };
        }
      }
      if (!status) continue;
      await this.db
        .update(menuChanges)
        .set({
          status,
          result,
          answeredAt: new Date(),
          ...(typeof result?.entity_id === 'string' && change.op === 'create'
            ? { entityId: result.entity_id }
            : {}),
        })
        .where(and(eq(menuChanges.id, change.id), eq(menuChanges.status, 'pending')));
    }
  }

  private view(r: typeof menuChanges.$inferSelect) {
    return {
      id: r.id,
      entity: r.entity,
      op: r.op,
      entity_id: r.entityId,
      label: r.label,
      fields: r.fields,
      status: r.status,
      requested_by: r.requestedByName,
      result: r.result,
      created_at: r.createdAt.toISOString(),
      published_at: r.publishedAt?.toISOString() ?? null,
      answered_at: r.answeredAt?.toISOString() ?? null,
    };
  }
}
