'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import type { MenuAddonGroup, MenuItem } from './api';

export type SizeRow = {
  id?: string;
  name: string;
  price: string;
  online_price: string;
  is_active: boolean;
  /** Kept as they are on the POS; the portal does not edit them. */
  sku: string | null;
  barcode: string | null;
  sort_order: number;
};

export type SizePayload = {
  id?: string;
  name: string;
  price: number;
  online_price: number | null;
  sku: string | null;
  barcode: string | null;
  sort_order: number;
  is_active: boolean;
};

export const sizeRows = (item: MenuItem | null): SizeRow[] =>
  (item?.variants ?? []).map((v) => ({
    id: v.id,
    name: v.name,
    price: String(v.price),
    online_price: v.online_price === null ? '' : String(v.online_price),
    is_active: v.is_active,
    sku: v.sku,
    barcode: v.barcode,
    sort_order: v.sort_order
  }));

/** The sizes as the API wants them, or the first problem to show the owner. */
export function sizePayload(rows: SizeRow[]): SizePayload[] | string {
  const out: SizePayload[] = [];
  for (const [i, r] of rows.entries()) {
    const price = Number(r.price);
    const online = r.online_price.trim() === '' ? null : Number(r.online_price);
    if (!r.name.trim()) return `Size ${i + 1} needs a name.`;
    if (r.price.trim() === '' || !Number.isFinite(price) || price < 0)
      return `${r.name.trim()}: enter a price of 0 or more.`;
    if (online !== null && (!Number.isFinite(online) || online < 0))
      return `${r.name.trim()}: the online price must be 0 or more.`;
    out.push({
      ...(r.id ? { id: r.id } : {}),
      name: r.name.trim(),
      price,
      online_price: online,
      sku: r.sku,
      barcode: r.barcode,
      sort_order: r.sort_order,
      is_active: r.is_active
    });
  }
  return out;
}

/** True when the sizes are what the POS already has. */
export function sameSizes(payload: SizePayload[], item: MenuItem | null): boolean {
  const key = (v: SizePayload) =>
    JSON.stringify([v.id ?? null, v.name, v.price, v.online_price, v.is_active]);
  const was = (item?.variants ?? [])
    .map((v) => key({ ...v, online_price: v.online_price } as SizePayload))
    .sort();
  const now = payload.map(key).sort();
  return was.length === now.length && was.every((k, i) => k === now[i]);
}

export function SizesEditor({
  rows,
  onChange
}: {
  rows: SizeRow[];
  onChange: (rows: SizeRow[]) => void;
}) {
  const set = (i: number, patch: Partial<SizeRow>) =>
    onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <div className='flex flex-col gap-2 sm:col-span-2'>
      <div className='flex items-center justify-between'>
        <span className='text-sm font-medium'>Sizes</span>
        <Button
          type='button'
          variant='outline'
          size='sm'
          onClick={() =>
            onChange([
              ...rows,
              {
                name: '',
                price: '',
                online_price: '',
                is_active: true,
                sku: null,
                barcode: null,
                sort_order: rows.length
              }
            ])
          }
        >
          Add size
        </Button>
      </div>
      {rows.length === 0 ? (
        <p className='text-muted-foreground text-sm'>
          One price for this item. Add a size to sell it in more than one size.
        </p>
      ) : (
        <ul className='flex flex-col gap-2'>
          {rows.map((r, i) => (
            <li
              key={r.id ?? `new-${i}`}
              className='grid grid-cols-[1fr_5.5rem_5.5rem_auto] items-center gap-2'
            >
              <Input
                aria-label={`Size ${i + 1} name`}
                placeholder='Name'
                value={r.name}
                onChange={(e) => set(i, { name: e.target.value })}
                maxLength={120}
              />
              <Input
                aria-label={`Size ${i + 1} price`}
                placeholder='Price'
                inputMode='decimal'
                value={r.price}
                onChange={(e) => set(i, { price: e.target.value })}
              />
              <Input
                aria-label={`Size ${i + 1} online price`}
                placeholder='Online'
                inputMode='decimal'
                value={r.online_price}
                onChange={(e) => set(i, { online_price: e.target.value })}
              />
              {r.id ? (
                <Switch
                  checked={r.is_active}
                  onCheckedChange={(v) => set(i, { is_active: v })}
                  aria-label={`Size ${i + 1} available`}
                />
              ) : (
                <Button
                  type='button'
                  variant='ghost'
                  size='sm'
                  onClick={() => onChange(rows.filter((_, j) => j !== i))}
                >
                  Remove
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function AddonPicker({
  groups,
  selected,
  onChange
}: {
  groups: MenuAddonGroup[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const shown = groups.filter((g) => g.is_active || selected.includes(g.id));
  if (shown.length === 0) return null;
  return (
    <fieldset className='flex flex-col gap-2 sm:col-span-2'>
      <legend className='text-sm font-medium'>Add-ons offered with this item</legend>
      <div className='flex flex-wrap gap-x-4 gap-y-2'>
        {shown.map((g) => (
          <label key={g.id} className='flex items-center gap-2 text-sm'>
            <input
              type='checkbox'
              checked={selected.includes(g.id)}
              onChange={(e) =>
                onChange(
                  e.target.checked ? [...selected, g.id] : selected.filter((id) => id !== g.id)
                )
              }
            />
            {g.name}
            {!g.is_active && <span className='text-muted-foreground'>(off)</span>}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
