import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { PosMenuSnapshot } from '@restrovia/shared';
import { DB, type Database } from '../db/database.module.js';
import {
  menuSnapshots,
  storeMenuItems,
  storeMenus,
  storeMenuVariants,
} from '../db/schema/index.js';
import type { StoreRow } from './store-member.guard.js';

/** The menus every café starts with, as in a typical restaurant back office. */
const BUILT_IN = [
  { slug: 'home_delivery', name: 'Home Delivery' },
  { slug: 'parcel', name: 'Parcel' },
  { slug: 'dine_in', name: 'Dine In' },
  { slug: 'home_website', name: 'Home Website' },
  { slug: 'pickup_qr', name: 'Pick Up Menu QR' },
] as const;

const MAX_MENUS = 20;
const price = z.number().min(0).max(10_000_000);

export const menuCreateInput = z.object({ name: z.string().trim().min(1).max(60) });
export const menuItemInput = z
  .object({
    /** A price for this menu; null goes back to the Base Menu price. */
    price: price.nullable().optional(),
    hidden: z.boolean().optional(),
    variants: z
      .array(z.object({ variant_id: z.string().trim().min(1).max(64), price: price.nullable() }))
      .max(30)
      .optional(),
  })
  .refine((v) => v.price !== undefined || v.hidden !== undefined || v.variants !== undefined, {
    message: 'Nothing to change',
  });
export type MenuItemInput = z.infer<typeof menuItemInput>;

type Row = Record<string, unknown>;
const cents = (n: number) => Math.round(n * 100) / 100;
const num = (v: unknown) => Number(v ?? 0) || 0;

/**
 * Menus for the ways Restrovia Cloud sells (Dine In, Parcel, Home Delivery, the website, the pick-up
 * QR, or the owner's own). Each one starts as the Base Menu, which is the POS menu, and records only
 * where it differs. The POS is not involved: it keeps one menu.
 */
@Injectable()
export class OwnerChannelMenusService {
  constructor(@Inject(DB) private readonly db: Database) {}

  private async ensureDefaults(storeId: string) {
    await this.db
      .insert(storeMenus)
      .values(BUILT_IN.map((m, i) => ({ storeId, slug: m.slug, name: m.name, sortOrder: i })))
      .onConflictDoNothing();
  }

  private async snapshot(storeId: string) {
    const row = await this.db.query.menuSnapshots.findFirst({
      where: eq(menuSnapshots.storeId, storeId),
    });
    return (row?.data as PosMenuSnapshot | null | undefined) ?? null;
  }

  private async menuOf(storeId: string, menuId: string) {
    const [menu] = await this.db
      .select()
      .from(storeMenus)
      .where(and(eq(storeMenus.id, menuId), eq(storeMenus.storeId, storeId)));
    if (!menu) throw new NotFoundException({ error: 'menu_not_found' });
    return menu;
  }

  async list(store: StoreRow) {
    await this.ensureDefaults(store.id);
    const data = await this.snapshot(store.id);
    const menus = await this.db
      .select()
      .from(storeMenus)
      .where(eq(storeMenus.storeId, store.id))
      .orderBy(asc(storeMenus.sortOrder), asc(storeMenus.createdAt));
    const ids = menus.map((m) => m.id);
    const items = ids.length
      ? await this.db
          .select({
            menuId: storeMenuItems.menuId,
            priced: sql<number>`count(*) filter (where ${storeMenuItems.price} is not null)::int`,
            hidden: sql<number>`count(*) filter (where ${storeMenuItems.hidden})::int`,
          })
          .from(storeMenuItems)
          .where(inArray(storeMenuItems.menuId, ids))
          .groupBy(storeMenuItems.menuId)
      : [];
    const byMenu = new Map(items.map((i) => [i.menuId, i]));
    return {
      has_menu: data !== null,
      base: { id: 'base', name: 'Base Menu', item_count: data?.products.length ?? 0 },
      menus: menus.map((m) => ({
        id: m.id,
        name: m.name,
        built_in: m.slug !== null,
        priced_items: byMenu.get(m.id)?.priced ?? 0,
        hidden_items: byMenu.get(m.id)?.hidden ?? 0,
      })),
    };
  }

  async create(store: StoreRow, name: string) {
    await this.ensureDefaults(store.id);
    const existing = await this.db.select().from(storeMenus).where(eq(storeMenus.storeId, store.id));
    if (existing.length >= MAX_MENUS) throw new BadRequestException({ error: 'too_many_menus' });
    if (existing.some((m) => m.name.toLowerCase() === name.toLowerCase())) {
      throw new ConflictException({ error: 'menu_name_taken' });
    }
    const [menu] = await this.db
      .insert(storeMenus)
      .values({ storeId: store.id, name, sortOrder: existing.length })
      .returning();
    return { id: menu.id, name: menu.name, built_in: false, priced_items: 0, hidden_items: 0 };
  }

  async remove(store: StoreRow, menuId: string) {
    const menu = await this.menuOf(store.id, menuId);
    if (menu.slug !== null) throw new BadRequestException({ error: 'built_in_menu' });
    await this.db.delete(storeMenus).where(eq(storeMenus.id, menu.id));
    return { removed: menu.id };
  }

  /** Every item with its Base Menu price and how this menu differs. */
  async get(store: StoreRow, menuId: string) {
    const menu = await this.menuOf(store.id, menuId);
    const data = await this.snapshot(store.id);
    if (!data) return { menu: { id: menu.id, name: menu.name }, has_menu: false, categories: [], items: [] };

    const [itemRows, variantRows] = await Promise.all([
      this.db.select().from(storeMenuItems).where(eq(storeMenuItems.menuId, menu.id)),
      this.db.select().from(storeMenuVariants).where(eq(storeMenuVariants.menuId, menu.id)),
    ]);
    const itemOf = new Map(itemRows.map((r) => [r.itemId, r]));
    const variantPrice = new Map(variantRows.map((r) => [r.variantId, Number(r.price)]));
    const sizesOf = new Map<string, Row[]>();
    for (const v of data.variants as Row[]) {
      const list = sizesOf.get(String(v.product_id)) ?? [];
      list.push(v);
      sizesOf.set(String(v.product_id), list);
    }

    return {
      menu: { id: menu.id, name: menu.name },
      has_menu: true,
      categories: (data.categories as Row[]).map((c) => ({
        id: String(c.id),
        name: String(c.name),
        sort_order: num(c.sort_order),
      })),
      items: (data.products as Row[]).map((p) => {
        const own = itemOf.get(String(p.id));
        const base = num(p.price);
        const override = own?.price == null ? null : Number(own.price);
        return {
          id: String(p.id),
          name: String(p.name),
          category_id: (p.category_id as string | null) ?? null,
          is_active: p.is_active === 1 || p.is_active === true,
          base_price: base,
          price: override,
          effective_price: override ?? base,
          hidden: own?.hidden ?? false,
          variants: (sizesOf.get(String(p.id)) ?? []).map((v) => {
            const vo = variantPrice.get(String(v.id)) ?? null;
            return {
              id: String(v.id),
              name: String(v.name),
              base_price: num(v.price),
              price: vo,
              effective_price: vo ?? num(v.price),
            };
          }),
        };
      }),
    };
  }

  /** Sets an item's price and visibility on a menu; matching the Base Menu removes the difference. */
  async setItem(store: StoreRow, menuId: string, itemId: string, input: MenuItemInput) {
    const menu = await this.menuOf(store.id, menuId);
    const data = await this.snapshot(store.id);
    const item = (data?.products as Row[] | undefined)?.find((p) => p.id === itemId);
    if (!data || !item) throw new NotFoundException({ error: 'item_not_found' });

    await this.db.transaction(async (tx) => {
      if (input.price !== undefined || input.hidden !== undefined) {
        const [existing] = await tx
          .select()
          .from(storeMenuItems)
          .where(and(eq(storeMenuItems.menuId, menu.id), eq(storeMenuItems.itemId, itemId)));
        const next =
          input.price === undefined
            ? (existing?.price ?? null)
            : input.price === null || cents(input.price) === cents(num(item.price))
              ? null
              : cents(input.price).toFixed(2);
        const hidden = input.hidden ?? existing?.hidden ?? false;
        if (next === null && !hidden) {
          await tx
            .delete(storeMenuItems)
            .where(and(eq(storeMenuItems.menuId, menu.id), eq(storeMenuItems.itemId, itemId)));
        } else {
          await tx
            .insert(storeMenuItems)
            .values({ menuId: menu.id, itemId, price: next === null ? null : String(next), hidden })
            .onConflictDoUpdate({
              target: [storeMenuItems.menuId, storeMenuItems.itemId],
              set: { price: next === null ? null : String(next), hidden },
            });
        }
      }
      for (const v of input.variants ?? []) {
        const size = (data.variants as Row[]).find((x) => x.id === v.variant_id && x.product_id === itemId);
        if (!size) throw new BadRequestException({ error: 'invalid_fields', message: 'variants: unknown size' });
        if (v.price === null || cents(v.price) === cents(num(size.price))) {
          await tx
            .delete(storeMenuVariants)
            .where(and(eq(storeMenuVariants.menuId, menu.id), eq(storeMenuVariants.variantId, v.variant_id)));
        } else {
          await tx
            .insert(storeMenuVariants)
            .values({ menuId: menu.id, variantId: v.variant_id, price: cents(v.price).toFixed(2) })
            .onConflictDoUpdate({
              target: [storeMenuVariants.menuId, storeMenuVariants.variantId],
              set: { price: cents(v.price).toFixed(2) },
            });
        }
      }
    });
    const view = await this.get(store, menuId);
    return { item: view.items.find((i) => i.id === itemId) };
  }

  /** Puts a menu back to the Base Menu. */
  async reset(store: StoreRow, menuId: string) {
    const menu = await this.menuOf(store.id, menuId);
    await this.db.delete(storeMenuItems).where(eq(storeMenuItems.menuId, menu.id));
    await this.db.delete(storeMenuVariants).where(eq(storeMenuVariants.menuId, menu.id));
    return { reset: menu.id };
  }
}
