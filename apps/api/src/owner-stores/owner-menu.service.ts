import {
  BadGatewayException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { PosMenuSnapshot, StoreMemberRole } from '@restrovia/shared';
import { CommandsService } from '../commands/commands.service.js';
import { DB, type Database } from '../db/database.module.js';
import { menuSnapshots, posDevices } from '../db/schema/index.js';
import { deviceLastSeen, isOnline } from '../pos/device-status.js';
import type { StoreRow } from './store-member.guard.js';

const COMMAND_WAIT_MS = 8_000;

type Row = Record<string, unknown>;

const text = (v: unknown) => (typeof v === 'string' ? v : null);
const num = (v: unknown) => (typeof v === 'number' ? v : Number(v ?? 0) || 0);
const flag = (v: unknown) => v === 1 || v === true || v === '1';

/** What a café's menu looks like in the owner portal: the POS's own menu, read-only except availability. */
@Injectable()
export class OwnerMenuService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly commands: CommandsService,
  ) {}

  async menu(store: StoreRow, role: StoreMemberRole) {
    const row = await this.db.query.menuSnapshots.findFirst({
      where: eq(menuSnapshots.storeId, store.id),
    });
    const sync = {
      enabled: row?.syncEnabled ?? true,
      portal_editing: row?.portalEditing ?? true,
      synced_at: row?.syncedAt?.toISOString() ?? null,
      pos_generated_at: row?.posGeneratedAt?.toISOString() ?? null,
    };
    const data = row?.data;
    if (!data) return { sync, has_menu: false, categories: [], items: [], addon_groups: [] };

    const variantsBy = groupBy(data.variants, 'product_id');
    const groupsBy = groupBy(data.addon_group_products, 'product_id');
    const optionsBy = groupBy(data.addons, 'addon_group_id');
    const showMoney = role === 'owner';
    const windows = (entity: string, id: unknown) =>
      ((data.schedules ?? []) as Row[])
        .filter((w) => w.entity === entity && w.entity_id === id)
        .map((w) => ({ days: w.days as number[], start: text(w.start), end: text(w.end) }));

    return {
      sync,
      has_menu: true,
      categories: data.categories.map((c) => ({
        id: text(c.id),
        name: text(c.name),
        parent_id: text(c.parent_id),
        sort_order: num(c.sort_order),
        is_active: flag(c.is_active),
        color: text(c.color),
        schedule: windows('category', c.id),
      })),
      items: data.products.map((p) => ({
        id: text(p.id),
        category_id: text(p.category_id),
        name: text(p.name),
        description: text(p.description),
        price: num(p.price),
        cost: showMoney ? num(p.cost) : null,
        sku: text(p.sku),
        barcode: text(p.barcode),
        sale_unit: text(p.sale_unit),
        image_url: text(p.image_url),
        tags: text(p.tags),
        dietary_tags: text(p.dietary_tags),
        tax_type: text(p.tax_type),
        tax_rate: num(p.tax_rate),
        track_inventory: flag(p.track_inventory),
        stock_quantity: num(p.stock_quantity),
        is_active: flag(p.is_active),
        sort_order: num(p.sort_order),
        schedule: windows('item', p.id),
        variants: (variantsBy.get(String(p.id)) ?? []).map((v) => ({
          id: text(v.id),
          name: text(v.name),
          price: num(v.price),
          online_price: v.online_price == null ? null : num(v.online_price),
          sku: text(v.sku),
          barcode: text(v.barcode),
          sort_order: num(v.sort_order),
          is_active: flag(v.is_active),
        })),
        addon_group_ids: (groupsBy.get(String(p.id)) ?? []).map((g) => text(g.addon_group_id)),
      })),
      addon_groups: data.addon_groups.map((g) => ({
        id: text(g.id),
        name: text(g.name),
        description: text(g.description),
        allow_multiple_quantities: flag(g.allow_multiple_quantities),
        sort_order: num(g.sort_order),
        is_required: flag(g.is_required),
        min_selection: num(g.min_selection),
        max_selection: num(g.max_selection),
        is_active: flag(g.is_active),
        options: (optionsBy.get(String(g.id)) ?? []).map((o) => ({
          id: text(o.id),
          name: text(o.name),
          price: num(o.price),
          sort_order: num(o.sort_order),
          is_active: flag(o.is_active),
        })),
      })),
    };
  }

  /** Marks an item available or sold out on the POS; the portal copy changes only after the POS agrees. */
  async setAvailability(store: StoreRow, ownerId: string, productId: string, available: boolean) {
    const row = await this.db.query.menuSnapshots.findFirst({
      where: eq(menuSnapshots.storeId, store.id),
    });
    if (!row?.data) throw new NotFoundException({ error: 'menu_not_synced' });
    if (!row.syncEnabled) throw new ConflictException({ error: 'menu_sync_off' });
    if (!row.portalEditing) throw new ForbiddenException({ error: 'portal_editing_off' });
    if (!row.data.products.some((p) => p.id === productId)) {
      throw new NotFoundException({ error: 'item_not_found' });
    }

    const [device] = await this.db
      .select({ lastSeen: deviceLastSeen })
      .from(posDevices)
      .where(and(eq(posDevices.storeId, store.id), isNull(posDevices.revokedAt)))
      .orderBy(sql`${deviceLastSeen} desc nulls last`)
      .limit(1);
    if (!device || !isOnline(device.lastSeen)) throw new ConflictException({ error: 'pos_offline' });

    const command = await this.commands.create(
      store.id,
      'menu.set_availability',
      { product_id: productId, available },
      ownerId,
    );
    const answered = await this.commands.waitForResult(command.id, COMMAND_WAIT_MS);
    if (answered.status !== 'done') {
      throw new BadGatewayException({
        error: answered.status === 'failed' ? 'pos_refused' : 'pos_no_answer',
        message: answered.error ?? undefined,
      });
    }

    await this.patchAvailability(store.id, productId, available);
    return { id: productId, is_active: available };
  }

  /** Mirrors the change in the stored snapshot so the portal is right before the POS's next snapshot. */
  private async patchAvailability(storeId: string, productId: string, available: boolean) {
    await this.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(menuSnapshots)
        .where(eq(menuSnapshots.storeId, storeId))
        .for('update');
      if (!row?.data) return;
      const data: PosMenuSnapshot = {
        ...row.data,
        products: row.data.products.map((p) =>
          p.id === productId ? { ...p, is_active: available ? 1 : 0 } : p,
        ),
      };
      await tx.update(menuSnapshots).set({ data }).where(eq(menuSnapshots.storeId, storeId));
    });
  }
}

function groupBy(rows: Row[], key: string): Map<string, Row[]> {
  const out = new Map<string, Row[]>();
  for (const r of rows) {
    const k = String(r[key] ?? '');
    const list = out.get(k);
    if (list) list.push(r);
    else out.set(k, [r]);
  }
  return out;
}
