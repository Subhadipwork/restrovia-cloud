'use client';

import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Switch } from '@/components/ui/switch';
import { errorMessage } from '@/lib/api-client';
import {
  useMenuDrafts,
  type BulkAction,
  type ImportRow,
  type Menu,
  type MenuAddonGroup,
  type MenuItem
} from './api';

// ── Add-on groups ──────────────────────────────────────────────────────────

type OptionRow = { id?: string; name: string; price: string; is_active: boolean };

function GroupForm({
  storeId,
  group,
  onClose
}: {
  storeId: string;
  group: MenuAddonGroup | null;
  onClose: () => void;
}) {
  const drafts = useMenuDrafts(storeId);
  const [form, setForm] = useState({
    name: group?.name ?? '',
    is_required: group?.is_required ?? false,
    min_selection: String(group?.min_selection ?? 0),
    max_selection: String(group?.max_selection ?? 1),
    allow_multiple_quantities: group?.allow_multiple_quantities ?? false,
    is_active: group?.is_active ?? true
  });
  const [options, setOptions] = useState<OptionRow[]>(
    (group?.options ?? []).map((o) => ({
      id: o.id,
      name: o.name,
      price: String(o.price),
      is_active: o.is_active
    }))
  );
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!form.name.trim()) return setError('Enter a name.');
    const min = Math.max(0, Math.round(Number(form.min_selection) || 0));
    const max = Math.max(0, Math.round(Number(form.max_selection) || 0));
    const rows: { id?: string; name: string; price: number; is_active: boolean }[] = [];
    for (const o of options) {
      const price = Number(o.price);
      if (!o.name.trim()) return setError('Every option needs a name.');
      if (o.price.trim() === '' || !Number.isFinite(price) || price < 0)
        return setError(`${o.name.trim()}: enter a price of 0 or more.`);
      rows.push({ id: o.id, name: o.name.trim(), price, is_active: o.is_active });
    }
    const groupFields = {
      name: form.name.trim(),
      is_required: form.is_required,
      min_selection: min,
      max_selection: max,
      allow_multiple_quantities: form.allow_multiple_quantities,
      is_active: form.is_active
    };
    setSaving(true);
    try {
      if (!group) {
        await drafts.add.mutateAsync({ op: 'create', entity: 'addon_group', fields: groupFields });
      } else {
        const changed = Object.fromEntries(
          Object.entries(groupFields).filter(
            ([k, v]) => v !== (group as unknown as Record<string, unknown>)[k]
          )
        );
        if (Object.keys(changed).length > 0) {
          await drafts.add.mutateAsync({
            op: 'update',
            entity: 'addon_group',
            entity_id: group.id,
            fields: changed
          });
        }
        for (const o of rows) {
          const was = group.options.find((x) => x.id === o.id);
          if (!o.id) {
            await drafts.add.mutateAsync({
              op: 'create',
              entity: 'addon',
              fields: {
                addon_group_id: group.id,
                name: o.name,
                price: o.price,
                is_active: o.is_active
              }
            });
          } else if (was) {
            const fields: Record<string, unknown> = {};
            if (was.name !== o.name) fields.name = o.name;
            if (was.price !== o.price) fields.price = o.price;
            if (was.is_active !== o.is_active) fields.is_active = o.is_active;
            if (Object.keys(fields).length > 0) {
              await drafts.add.mutateAsync({
                op: 'update',
                entity: 'addon',
                entity_id: o.id,
                fields
              });
            }
          }
        }
      }
      toast.success('Added to your draft.');
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!group) return;
    setSaving(true);
    try {
      await drafts.add.mutateAsync({ op: 'delete', entity: 'addon_group', entity_id: group.id });
      toast.success(`${group.name} will be switched off when you publish.`);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className='flex flex-col gap-4' onSubmit={save}>
      <DialogHeader>
        <DialogTitle>{group ? 'Edit add-on group' : 'Add an add-on group'}</DialogTitle>
        <DialogDescription>
          A group of extras, such as milk choices or toppings. Attach it to items from the item’s
          Edit screen.
        </DialogDescription>
      </DialogHeader>
      <div className='grid gap-3 sm:grid-cols-2'>
        <div className='flex flex-col gap-1.5 sm:col-span-2'>
          <Label htmlFor='group-name'>Name</Label>
          <Input
            id='group-name'
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            maxLength={120}
            autoFocus
          />
        </div>
        <div className='flex flex-col gap-1.5'>
          <Label htmlFor='group-min'>Fewest to pick</Label>
          <Input
            id='group-min'
            inputMode='numeric'
            value={form.min_selection}
            onChange={(e) => setForm((f) => ({ ...f, min_selection: e.target.value }))}
          />
        </div>
        <div className='flex flex-col gap-1.5'>
          <Label htmlFor='group-max'>Most to pick</Label>
          <Input
            id='group-max'
            inputMode='numeric'
            value={form.max_selection}
            onChange={(e) => setForm((f) => ({ ...f, max_selection: e.target.value }))}
          />
        </div>
        <div className='flex items-center gap-2'>
          <Switch
            checked={form.is_required}
            onCheckedChange={(v) => setForm((f) => ({ ...f, is_required: v }))}
            aria-label='Required'
          />
          <span className='text-sm'>Customer must choose</span>
        </div>
        <div className='flex items-center gap-2'>
          <Switch
            checked={form.allow_multiple_quantities}
            onCheckedChange={(v) => setForm((f) => ({ ...f, allow_multiple_quantities: v }))}
            aria-label='Allow more than one of each'
          />
          <span className='text-sm'>Allow more than one of each</span>
        </div>
        <div className='flex items-center gap-2 sm:col-span-2'>
          <Switch
            checked={form.is_active}
            onCheckedChange={(v) => setForm((f) => ({ ...f, is_active: v }))}
            aria-label='On'
          />
          <span className='text-sm'>On</span>
        </div>
      </div>
      {group ? (
        <div className='flex flex-col gap-2'>
          <div className='flex items-center justify-between'>
            <span className='text-sm font-medium'>Options</span>
            <Button
              type='button'
              variant='outline'
              size='sm'
              onClick={() => setOptions((o) => [...o, { name: '', price: '0', is_active: true }])}
            >
              Add option
            </Button>
          </div>
          <ul className='flex flex-col gap-2'>
            {options.map((o, i) => (
              <li
                key={o.id ?? `new-${i}`}
                className='grid grid-cols-[1fr_6rem_auto] items-center gap-2'
              >
                <Input
                  aria-label={`Option ${i + 1} name`}
                  value={o.name}
                  placeholder='Name'
                  onChange={(e) =>
                    setOptions((all) =>
                      all.map((x, j) => (j === i ? { ...x, name: e.target.value } : x))
                    )
                  }
                />
                <Input
                  aria-label={`Option ${i + 1} price`}
                  value={o.price}
                  inputMode='decimal'
                  placeholder='Price'
                  onChange={(e) =>
                    setOptions((all) =>
                      all.map((x, j) => (j === i ? { ...x, price: e.target.value } : x))
                    )
                  }
                />
                {o.id ? (
                  <Switch
                    checked={o.is_active}
                    onCheckedChange={(v) =>
                      setOptions((all) => all.map((x, j) => (j === i ? { ...x, is_active: v } : x)))
                    }
                    aria-label={`Option ${i + 1} available`}
                  />
                ) : (
                  <Button
                    type='button'
                    variant='ghost'
                    size='sm'
                    onClick={() => setOptions((all) => all.filter((_, j) => j !== i))}
                  >
                    Remove
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className='text-muted-foreground text-sm'>
          Add the options after this group has been published to the POS.
        </p>
      )}
      {error && (
        <p role='alert' className='text-destructive text-sm'>
          {error}
        </p>
      )}
      <DialogFooter className='gap-2 sm:justify-between'>
        {group ? (
          <Button type='button' variant='outline' onClick={remove} disabled={saving}>
            Switch group off
          </Button>
        ) : (
          <span />
        )}
        <Button type='submit' disabled={saving}>
          {saving ? 'Saving…' : 'Add to draft'}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function AddonGroupsCard({
  storeId,
  menu,
  canChange,
  currency
}: {
  storeId: string;
  menu: Menu;
  canChange: boolean;
  currency: string;
}) {
  const [dialog, setDialog] = useState<{ group: MenuAddonGroup | null; open: boolean } | null>(
    null
  );
  if (menu.addon_groups.length === 0 && !canChange) return null;
  return (
    <Card className='gap-0 py-0'>
      <CardContent className='px-4'>
        <div className='flex items-center justify-between gap-2 pt-4'>
          <h2 className='text-muted-foreground text-sm font-semibold'>Add-on groups</h2>
          {canChange && (
            <Button
              size='sm'
              variant='outline'
              onClick={() => setDialog({ group: null, open: true })}
            >
              Add group
            </Button>
          )}
        </div>
        {menu.addon_groups.length === 0 ? (
          <p className='text-muted-foreground py-3 text-sm'>No add-on groups yet.</p>
        ) : (
          <ul className='divide-y'>
            {menu.addon_groups.map((g) => (
              <li key={g.id} className='flex items-center justify-between gap-3 py-3'>
                <div className='min-w-0'>
                  <span
                    className={g.is_active ? 'font-medium' : 'text-muted-foreground font-medium'}
                  >
                    {g.name}
                  </span>
                  <p className='text-muted-foreground truncate text-sm'>
                    {g.options.filter((o) => o.is_active).length} options
                    {g.is_required ? ' · must choose' : ''} · pick {g.min_selection}–
                    {g.max_selection}
                    {g.options.length > 0
                      ? ` · ${g.options
                          .slice(0, 3)
                          .map(
                            (o) =>
                              `${o.name} ${new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 0 }).format(o.price)}`
                          )
                          .join(', ')}${g.options.length > 3 ? '…' : ''}`
                      : ''}
                  </p>
                </div>
                {canChange && (
                  <Button
                    size='sm'
                    variant='outline'
                    onClick={() => setDialog({ group: g, open: true })}
                  >
                    Edit
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      <Dialog
        open={dialog?.open ?? false}
        onOpenChange={(open) => setDialog((d) => (d ? { ...d, open } : d))}
      >
        <DialogContent className='max-h-[90vh] overflow-y-auto'>
          <GroupForm
            storeId={storeId}
            group={dialog?.group ?? null}
            onClose={() => setDialog((d) => (d ? { ...d, open: false } : d))}
          />
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ── Bulk edit ──────────────────────────────────────────────────────────────

type BulkKind = 'price_percent' | 'price_amount' | 'set_active' | 'move_category';

export function BulkDialog({
  storeId,
  menu,
  itemIds,
  open,
  onOpenChange,
  onDone
}: {
  storeId: string;
  menu: Menu;
  itemIds: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const drafts = useMenuDrafts(storeId);
  const [kind, setKind] = useState<BulkKind>('price_percent');
  const [value, setValue] = useState('');
  const [category, setCategory] = useState('');
  const [active, setActive] = useState('true');
  const [error, setError] = useState('');

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    let action: BulkAction;
    if (kind === 'set_active') action = { type: 'set_active', value: active === 'true' };
    else if (kind === 'move_category') action = { type: 'move_category', value: category || null };
    else {
      const n = Number(value);
      if (value.trim() === '' || !Number.isFinite(n) || n === 0)
        return setError('Enter how much to change prices by.');
      action = { type: kind, value: n };
    }
    drafts.bulk.mutate(
      { item_ids: itemIds, action },
      {
        onSuccess: (r) => {
          toast.success(
            `${r.drafted} item${r.drafted === 1 ? '' : 's'} added to your draft${
              r.unchanged ? `, ${r.unchanged} already right` : ''
            }.`
          );
          onDone();
          onOpenChange(false);
        },
        onError: (err) => setError(errorMessage(err))
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form className='flex flex-col gap-4' onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Change {itemIds.length} items</DialogTitle>
            <DialogDescription>
              The changes go into your draft first, so you can check them before they reach the POS.
            </DialogDescription>
          </DialogHeader>
          <div className='flex flex-col gap-1.5'>
            <Label htmlFor='bulk-kind'>What to do</Label>
            <NativeSelect
              id='bulk-kind'
              value={kind}
              onChange={(e) => setKind(e.target.value as BulkKind)}
            >
              <NativeSelectOption value='price_percent'>
                Change prices by a percentage
              </NativeSelectOption>
              <NativeSelectOption value='price_amount'>
                Add or take off an amount
              </NativeSelectOption>
              <NativeSelectOption value='set_active'>Show or hide on the POS</NativeSelectOption>
              <NativeSelectOption value='move_category'>Move to a category</NativeSelectOption>
            </NativeSelect>
          </div>
          {(kind === 'price_percent' || kind === 'price_amount') && (
            <div className='flex flex-col gap-1.5'>
              <Label htmlFor='bulk-value'>
                {kind === 'price_percent'
                  ? 'Percent (10 raises by 10%, −5 lowers by 5%)'
                  : 'Amount (negative to lower)'}
              </Label>
              <Input
                id='bulk-value'
                inputMode='decimal'
                value={value}
                onChange={(e) => setValue(e.target.value)}
                autoFocus
              />
              <p className='text-muted-foreground text-sm'>Sizes change by the same amount.</p>
            </div>
          )}
          {kind === 'set_active' && (
            <NativeSelect
              value={active}
              onChange={(e) => setActive(e.target.value)}
              aria-label='Show or hide'
            >
              <NativeSelectOption value='true'>Show (available)</NativeSelectOption>
              <NativeSelectOption value='false'>Hide (sold out)</NativeSelectOption>
            </NativeSelect>
          )}
          {kind === 'move_category' && (
            <NativeSelect
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              aria-label='Category'
            >
              <NativeSelectOption value=''>No category</NativeSelectOption>
              {menu.categories.map((c) => (
                <NativeSelectOption key={c.id} value={c.id}>
                  {c.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
          {error && (
            <p role='alert' className='text-destructive text-sm'>
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type='submit' disabled={drafts.bulk.isPending}>
              {drafts.bulk.isPending ? 'Adding…' : 'Add to draft'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── CSV ────────────────────────────────────────────────────────────────────

const HEADERS = ['name', 'category', 'price', 'description', 'sku', 'barcode', 'available'];

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};

export function menuCsv(menu: Menu): string {
  const category = new Map(menu.categories.map((c) => [c.id, c.name]));
  const rows = menu.items.map((i: MenuItem) => [
    i.name,
    category.get(i.category_id ?? '') ?? '',
    i.price,
    i.description ?? '',
    i.sku ?? '',
    i.barcode ?? '',
    i.is_active ? 'yes' : 'no'
  ]);
  return [HEADERS, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
}

/** Reads a CSV with quoted cells; returns rows of cells. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const input = text.replace(/^﻿/, '');
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (quoted) {
      if (c === '"' && input[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && input[i + 1] === '\n') i++;
      row.push(cell);
      cell = '';
      if (row.some((x) => x.trim() !== '')) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim() !== '')) rows.push(row);
  return rows;
}

/** Turns CSV rows (first row = headers) into import rows, or says what is wrong with the file. */
export function csvToRows(rows: string[][]): ImportRow[] | string {
  if (rows.length < 2) return 'The file has no items.';
  const head = rows[0].map((h) => h.trim().toLowerCase());
  if (!head.includes('name')) return 'The first row must have a “name” column.';
  const at = (name: string) => head.indexOf(name);
  const out: ImportRow[] = [];
  for (const [i, r] of rows.slice(1).entries()) {
    const cell = (name: string) => (at(name) < 0 ? undefined : (r[at(name)] ?? '').trim());
    const name = cell('name');
    if (!name) return `Row ${i + 2} has no name.`;
    const row: ImportRow = { name };
    const category = cell('category');
    if (category) row.category = category;
    const price = cell('price');
    if (price) {
      const n = Number(price);
      if (!Number.isFinite(n) || n < 0) return `Row ${i + 2}: “${price}” is not a price.`;
      row.price = n;
    }
    for (const key of ['description', 'sku', 'barcode'] as const) {
      const v = cell(key);
      if (v !== undefined && v !== '') row[key] = v;
    }
    const available = cell('available')?.toLowerCase();
    if (available) {
      if (['yes', 'true', '1', 'y'].includes(available)) row.available = true;
      else if (['no', 'false', '0', 'n'].includes(available)) row.available = false;
      else return `Row ${i + 2}: “available” must be yes or no.`;
    }
    out.push(row);
  }
  return out;
}

export function ImportExport({
  storeId,
  menu,
  canChange
}: {
  storeId: string;
  menu: Menu;
  canChange: boolean;
}) {
  const drafts = useMenuDrafts(storeId);
  const input = useRef<HTMLInputElement>(null);
  const [result, setResult] = useState<{
    created: number;
    updated: number;
    unchanged: number;
    errors: { row: number; error: string }[];
  } | null>(null);

  const download = () => {
    const blob = new Blob([`﻿${menuCsv(menu)}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'menu.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const upload = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 2_000_000) return void toast.error('That file is too big for an import.');
    const parsed = csvToRows(parseCsv(await file.text()));
    if (typeof parsed === 'string') return void toast.error(parsed);
    if (parsed.length > 500) return void toast.error('Import up to 500 items at a time.');
    drafts.importRows.mutate(parsed, {
      onSuccess: setResult,
      onError: (err) => toast.error(errorMessage(err))
    });
    if (input.current) input.current.value = '';
  };

  return (
    <>
      <Button size='sm' variant='outline' onClick={download}>
        Export CSV
      </Button>
      {canChange && (
        <>
          <Button
            size='sm'
            variant='outline'
            disabled={drafts.importRows.isPending}
            onClick={() => input.current?.click()}
          >
            {drafts.importRows.isPending ? 'Reading…' : 'Import CSV'}
          </Button>
          <input
            ref={input}
            type='file'
            accept='.csv,text/csv'
            className='hidden'
            aria-label='Choose a CSV file to import'
            onChange={(e) => void upload(e.target.files?.[0])}
          />
        </>
      )}
      <Dialog open={result !== null} onOpenChange={(open) => !open && setResult(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Import added to your draft</DialogTitle>
            <DialogDescription>
              Review and publish it from the draft at the top of the page.
            </DialogDescription>
          </DialogHeader>
          {result && (
            <div className='flex flex-col gap-2 text-sm'>
              <p>
                {result.created} new item{result.created === 1 ? '' : 's'} · {result.updated}{' '}
                changed · {result.unchanged} already the same
              </p>
              {result.errors.length > 0 && (
                <div>
                  <p className='text-destructive font-medium'>
                    {result.errors.length} row{result.errors.length === 1 ? '' : 's'} skipped
                  </p>
                  <ul className='text-muted-foreground max-h-40 overflow-y-auto'>
                    {result.errors.map((e) => (
                      <li key={e.row}>
                        Row {e.row + 1}: {e.error}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setResult(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
