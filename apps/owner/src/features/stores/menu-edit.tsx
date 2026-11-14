'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { Textarea } from '@/components/ui/textarea';
import {
  AddonPicker,
  SizesEditor,
  sameSizes,
  sizePayload,
  sizeRows,
  type SizeRow
} from './menu-sizes';
import {
  ScheduleEditor,
  sameSchedule,
  scheduleProblem,
  scheduleSummary,
  type ScheduleWindow
} from './menu-schedule';
import { errorMessage } from '@/lib/api-client';
import { formatMoney, timeAgo } from '@/lib/display';
import { useMenuChanges, useMenuDrafts, type Menu, type MenuChange, type MenuItem } from './api';

const FIELD_LABELS: Record<string, string> = {
  name: 'Name',
  description: 'Description',
  price: 'Price',
  cost_price: 'Cost',
  sku: 'SKU',
  barcode: 'Barcode',
  category_id: 'Category',
  parent_id: 'Parent category',
  is_active: 'Available',
  sort_order: 'Order',
  color: 'Colour',
  icon: 'Icon',
  variants: 'Sizes',
  addon_group_ids: 'Add-ons',
  is_required: 'Must choose',
  min_selection: 'Fewest to pick',
  max_selection: 'Most to pick',
  allow_multiple_quantities: 'More than one of each',
  schedule: 'Hours'
};

const WORDS: Record<string, string> = {
  item: 'item',
  category: 'category',
  addon_group: 'add-on group',
  addon: 'add-on option'
};

const clean = (s: string) => (s.trim() === '' ? null : s.trim());

// ── Item ───────────────────────────────────────────────────────────────────

function ItemForm({
  storeId,
  item,
  menu,
  isOwner,
  onOpenChange
}: {
  storeId: string;
  /** null to add a new item */
  item: MenuItem | null;
  menu: Menu;
  isOwner: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const drafts = useMenuDrafts(storeId);
  const [form, setForm] = useState({
    name: item?.name ?? '',
    price: item ? String(item.price) : '',
    cost: item?.cost != null ? String(item.cost) : '',
    category_id: item?.category_id ?? '',
    description: item?.description ?? '',
    sku: item?.sku ?? '',
    barcode: item?.barcode ?? '',
    sort_order: String(item?.sort_order ?? 0),
    is_active: item?.is_active ?? true
  });
  const [sizes, setSizes] = useState<SizeRow[]>(() => sizeRows(item));
  const [groupIds, setGroupIds] = useState<string[]>(item?.addon_group_ids ?? []);
  const [schedule, setSchedule] = useState<ScheduleWindow[]>(item?.schedule ?? []);
  const [error, setError] = useState('');

  const set = (key: keyof typeof form, value: string | boolean) =>
    setForm((f) => ({ ...f, [key]: value }));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const price = Number(form.price);
    if (!form.name.trim()) return setError('Enter a name.');
    if (form.price.trim() === '' || !Number.isFinite(price) || price < 0)
      return setError('Enter a price of 0 or more.');
    const sizeList = sizePayload(sizes);
    if (typeof sizeList === 'string') return setError(sizeList);
    const hoursProblem = scheduleProblem(schedule);
    if (hoursProblem) return setError(hoursProblem);
    const all: Record<string, unknown> = {
      name: form.name.trim(),
      price,
      category_id: form.category_id || null,
      description: clean(form.description),
      sku: clean(form.sku),
      barcode: clean(form.barcode),
      sort_order: Math.max(0, Math.round(Number(form.sort_order) || 0)),
      is_active: form.is_active,
      ...(isOwner && form.cost.trim() !== '' ? { cost_price: Number(form.cost) } : {})
    };
    const done = {
      onSuccess: () => {
        toast.success(item ? 'Change added to your draft.' : 'New item added to your draft.');
        onOpenChange(false);
      },
      onError: (err: unknown) => setError(errorMessage(err))
    };
    if (!item) {
      const fields = Object.fromEntries(Object.entries(all).filter(([, v]) => v !== null));
      if (sizeList.length > 0) fields.variants = sizeList.map(({ id: _id, ...rest }) => rest);
      if (groupIds.length > 0) fields.addon_group_ids = groupIds;
      if (schedule.length > 0) fields.schedule = schedule;
      return drafts.add.mutate({ op: 'create', entity: 'item', fields }, done);
    }
    const was: Record<string, unknown> = {
      name: item.name,
      price: item.price,
      category_id: item.category_id,
      description: item.description,
      sku: item.sku,
      barcode: item.barcode,
      sort_order: item.sort_order ?? 0,
      is_active: item.is_active,
      cost_price: item.cost
    };
    const empty = (v: unknown) => v === null || v === undefined || v === '';
    const changed = Object.fromEntries(
      Object.entries(all).filter(([k, v]) =>
        empty(v) || empty(was[k]) ? !(empty(v) && empty(was[k])) : v !== was[k]
      )
    );
    if (!sameSizes(sizeList, item)) changed.variants = sizeList;
    const sameGroups =
      groupIds.length === item.addon_group_ids.length &&
      groupIds.every((id) => item.addon_group_ids.includes(id));
    if (!sameGroups) changed.addon_group_ids = groupIds;
    if (!sameSchedule(schedule, item.schedule)) changed.schedule = schedule;
    if (Object.keys(changed).length === 0) return setError('Nothing is different yet.');
    drafts.add.mutate({ op: 'update', entity: 'item', entity_id: item.id, fields: changed }, done);
  };

  const busy = drafts.add.isPending || drafts.duplicate.isPending;

  const copy = () =>
    item &&
    drafts.duplicate.mutate(item.id, {
      onSuccess: () => {
        toast.success(
          `A copy of ${item.name} is in your draft. Edit it from the menu after you publish.`
        );
        onOpenChange(false);
      },
      onError: (err) => setError(errorMessage(err))
    });

  const remove = () =>
    item &&
    drafts.add.mutate(
      { op: 'delete', entity: 'item', entity_id: item.id },
      {
        onSuccess: () => {
          toast.success(`${item.name} will be removed when you publish.`);
          onOpenChange(false);
        },
        onError: (err) => setError(errorMessage(err))
      }
    );

  return (
    <form className='flex flex-col gap-4' onSubmit={submit}>
      <DialogHeader>
        <DialogTitle>{item ? 'Edit item' : 'Add item'}</DialogTitle>
        <DialogDescription>
          Changes wait in your draft until you publish them to the POS.
        </DialogDescription>
      </DialogHeader>
      <div className='grid gap-3 sm:grid-cols-2'>
        <div className='flex flex-col gap-1.5 sm:col-span-2'>
          <Label htmlFor='item-name'>Name</Label>
          <Input
            id='item-name'
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            maxLength={120}
            autoFocus
          />
        </div>
        <div className='flex flex-col gap-1.5'>
          <Label htmlFor='item-price'>Price</Label>
          <Input
            id='item-price'
            inputMode='decimal'
            value={form.price}
            onChange={(e) => set('price', e.target.value)}
          />
        </div>
        <div className='flex flex-col gap-1.5'>
          <Label htmlFor='item-category'>Category</Label>
          <NativeSelect
            id='item-category'
            value={form.category_id}
            onChange={(e) => set('category_id', e.target.value)}
          >
            <NativeSelectOption value=''>No category</NativeSelectOption>
            {menu.categories.map((c) => (
              <NativeSelectOption key={c.id} value={c.id}>
                {c.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <div className='flex flex-col gap-1.5 sm:col-span-2'>
          <Label htmlFor='item-description'>Description</Label>
          <Textarea
            id='item-description'
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
            maxLength={1000}
            rows={2}
          />
        </div>
        <div className='flex flex-col gap-1.5'>
          <Label htmlFor='item-sku'>SKU</Label>
          <Input id='item-sku' value={form.sku} onChange={(e) => set('sku', e.target.value)} />
        </div>
        <div className='flex flex-col gap-1.5'>
          <Label htmlFor='item-barcode'>Barcode</Label>
          <Input
            id='item-barcode'
            value={form.barcode}
            onChange={(e) => set('barcode', e.target.value)}
          />
        </div>
        {isOwner && (
          <div className='flex flex-col gap-1.5'>
            <Label htmlFor='item-cost'>Cost</Label>
            <Input
              id='item-cost'
              inputMode='decimal'
              value={form.cost}
              onChange={(e) => set('cost', e.target.value)}
            />
          </div>
        )}
        <div className='flex flex-col gap-1.5'>
          <Label htmlFor='item-order'>Order on the POS</Label>
          <Input
            id='item-order'
            inputMode='numeric'
            value={form.sort_order}
            onChange={(e) => set('sort_order', e.target.value)}
          />
        </div>
        <SizesEditor rows={sizes} onChange={setSizes} />
        <AddonPicker groups={menu.addon_groups} selected={groupIds} onChange={setGroupIds} />
        <ScheduleEditor value={schedule} onChange={setSchedule} />
        <div className='flex items-center gap-2 sm:col-span-2'>
          <Switch
            checked={form.is_active}
            onCheckedChange={(v) => set('is_active', v)}
            aria-label='Available'
          />
          <span className='text-sm'>Available</span>
        </div>
      </div>
      {error && (
        <p role='alert' className='text-destructive text-sm'>
          {error}
        </p>
      )}
      <DialogFooter className='gap-2 sm:justify-between'>
        {item ? (
          <div className='flex gap-2'>
            <Button type='button' variant='outline' onClick={remove} disabled={busy}>
              Remove from menu
            </Button>
            <Button type='button' variant='outline' onClick={copy} disabled={busy}>
              Make a copy
            </Button>
          </div>
        ) : (
          <span />
        )}
        <Button type='submit' disabled={busy}>
          {drafts.add.isPending ? 'Saving…' : 'Add to draft'}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function ItemDialog(props: {
  storeId: string;
  /** null to add a new item */
  item: MenuItem | null;
  menu: Menu;
  isOwner: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { open, onOpenChange, ...rest } = props;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-h-[90vh] overflow-y-auto'>
        <ItemForm {...rest} onOpenChange={onOpenChange} />
      </DialogContent>
    </Dialog>
  );
}

// ── Category ───────────────────────────────────────────────────────────────

function CategoryForm({
  storeId,
  category,
  menu,
  onOpenChange
}: {
  storeId: string;
  category: Menu['categories'][number] | null;
  menu: Menu;
  onOpenChange: (open: boolean) => void;
}) {
  const drafts = useMenuDrafts(storeId);
  const [form, setForm] = useState({
    name: category?.name ?? '',
    description: '',
    parent_id: category?.parent_id ?? '',
    is_active: category?.is_active ?? true
  });
  const [schedule, setSchedule] = useState<ScheduleWindow[]>(category?.schedule ?? []);
  const [error, setError] = useState('');

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!form.name.trim()) return setError('Enter a name.');
    const hoursProblem = scheduleProblem(schedule);
    if (hoursProblem) return setError(hoursProblem);
    const done = {
      onSuccess: () => {
        toast.success('Added to your draft.');
        onOpenChange(false);
      },
      onError: (err: unknown) => setError(errorMessage(err))
    };
    if (!category) {
      const fields: Record<string, unknown> = { name: form.name.trim(), is_active: form.is_active };
      if (form.parent_id) fields.parent_id = form.parent_id;
      if (form.description.trim()) fields.description = form.description.trim();
      if (schedule.length > 0) fields.schedule = schedule;
      return drafts.add.mutate({ op: 'create', entity: 'category', fields }, done);
    }
    drafts.add.mutate(
      {
        op: 'update',
        entity: 'category',
        entity_id: category.id,
        fields: {
          name: form.name.trim(),
          is_active: form.is_active,
          ...(sameSchedule(schedule, category.schedule) ? {} : { schedule })
        }
      },
      done
    );
  };

  const remove = () =>
    category &&
    drafts.add.mutate(
      { op: 'delete', entity: 'category', entity_id: category.id },
      {
        onSuccess: () => {
          toast.success(`${category.name} will be removed when you publish.`);
          onOpenChange(false);
        },
        onError: (err) => setError(errorMessage(err))
      }
    );

  return (
    <form className='flex flex-col gap-4' onSubmit={submit}>
      <DialogHeader>
        <DialogTitle>{category ? 'Edit category' : 'Add category'}</DialogTitle>
        <DialogDescription>
          Changes wait in your draft until you publish them to the POS.
        </DialogDescription>
      </DialogHeader>
      <div className='flex flex-col gap-1.5'>
        <Label htmlFor='category-name'>Name</Label>
        <Input
          id='category-name'
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          maxLength={120}
          autoFocus
        />
      </div>
      {!category && (
        <div className='flex flex-col gap-1.5'>
          <Label htmlFor='category-parent'>Inside</Label>
          <NativeSelect
            id='category-parent'
            value={form.parent_id}
            onChange={(e) => setForm((f) => ({ ...f, parent_id: e.target.value }))}
          >
            <NativeSelectOption value=''>Top level</NativeSelectOption>
            {menu.categories
              .filter((c) => !c.parent_id)
              .map((c) => (
                <NativeSelectOption key={c.id} value={c.id}>
                  {c.name}
                </NativeSelectOption>
              ))}
          </NativeSelect>
        </div>
      )}
      <div className='flex items-center gap-2'>
        <Switch
          checked={form.is_active}
          onCheckedChange={(v) => setForm((f) => ({ ...f, is_active: v }))}
          aria-label='Shown on the POS'
        />
        <span className='text-sm'>Shown on the POS</span>
      </div>
      <ScheduleEditor value={schedule} onChange={setSchedule} />
      {error && (
        <p role='alert' className='text-destructive text-sm'>
          {error}
        </p>
      )}
      <DialogFooter className='gap-2 sm:justify-between'>
        {category ? (
          <Button type='button' variant='outline' onClick={remove} disabled={drafts.add.isPending}>
            Remove category
          </Button>
        ) : (
          <span />
        )}
        <Button type='submit' disabled={drafts.add.isPending}>
          {drafts.add.isPending ? 'Saving…' : 'Add to draft'}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function CategoryDialog(props: {
  storeId: string;
  category: Menu['categories'][number] | null;
  menu: Menu;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { open, onOpenChange, ...rest } = props;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <CategoryForm {...rest} onOpenChange={onOpenChange} />
      </DialogContent>
    </Dialog>
  );
}

// ── Draft and answers ──────────────────────────────────────────────────────

function show(field: string, value: unknown, currency: string): string {
  if (value === null || value === undefined || value === '') return 'none';
  if (field === 'price' || field === 'cost_price') return formatMoney(Number(value), currency);
  if (field === 'is_active') return value ? 'yes' : 'no';
  return String(value);
}

type SizeLike = { id?: string | null; name?: string; price?: number | null; is_active?: boolean };

function sizesText(from: SizeLike[], to: SizeLike[], currency: string): string {
  const parts: string[] = [];
  for (const t of to) {
    const f = from.find((x) => x.id && x.id === t.id);
    if (!f) parts.push(`+${t.name} ${formatMoney(Number(t.price), currency)}`);
    else {
      if (f.price !== t.price)
        parts.push(
          `${t.name} ${formatMoney(Number(f.price), currency)} → ${formatMoney(Number(t.price), currency)}`
        );
      if (f.is_active !== t.is_active) parts.push(`${t.name} ${t.is_active ? 'on' : 'off'}`);
      if (f.name !== t.name) parts.push(`${f.name} renamed ${t.name}`);
    }
  }
  for (const f of from) if (f.id && !to.some((t) => t.id === f.id)) parts.push(`−${f.name}`);
  return parts.length > 0 ? parts.join(', ') : 'changed';
}

function describe(change: MenuChange, currency: string): string {
  const what = WORDS[change.entity] ?? 'item';
  if (change.op === 'delete') return `Remove ${what}`;
  if (change.op === 'create') return `New ${what}`;
  return Object.entries(change.fields as Record<string, { from: unknown; to: unknown }>)
    .map(([f, v]) => {
      if (f === 'variants')
        return `Sizes: ${sizesText((v.from as SizeLike[]) ?? [], (v.to as SizeLike[]) ?? [], currency)}`;
      if (f === 'schedule')
        return `Hours: ${scheduleSummary((v.from as ScheduleWindow[]) ?? [])} → ${scheduleSummary((v.to as ScheduleWindow[]) ?? [])}`;
      if (f === 'addon_group_ids')
        return `Add-on groups: ${(v.from as unknown[] | null)?.length ?? 0} → ${(v.to as unknown[] | null)?.length ?? 0}`;
      return `${FIELD_LABELS[f] ?? f}: ${show(f, v.from, currency)} → ${show(f, v.to, currency)}`;
    })
    .join(' · ');
}

const STATUS: Record<
  MenuChange['status'],
  { label: string; variant: 'default' | 'secondary' | 'outline' | 'destructive' }
> = {
  draft: { label: 'Draft', variant: 'outline' },
  pending: { label: 'Waiting for the POS', variant: 'secondary' },
  applied: { label: 'Done', variant: 'default' },
  conflict: { label: 'Changed at the counter', variant: 'destructive' },
  rejected: { label: 'POS refused', variant: 'destructive' },
  expired: { label: 'Expired', variant: 'destructive' }
};

function detail(change: MenuChange, currency: string): string | null {
  if (change.status === 'conflict' && change.result?.current) {
    const now = Object.entries(change.result.current)
      .map(([f, v]) =>
        Array.isArray(v)
          ? `${FIELD_LABELS[f] ?? f} were changed at the counter`
          : `${FIELD_LABELS[f] ?? f} is now ${show(f, v, currency)}`
      )
      .join(', ');
    return `Not applied: ${now}. Edit it again to change it.`;
  }
  if (change.result?.error) return change.result.error;
  return null;
}

export function ChangesPanel({
  storeId,
  currency,
  canChange
}: {
  storeId: string;
  currency: string;
  canChange: boolean;
}) {
  const { data: changes } = useMenuChanges(storeId);
  const drafts = useMenuDrafts(storeId);
  if (!changes || changes.length === 0) return null;
  const waiting = changes.filter((c) => c.status === 'draft');
  const recent = changes.filter((c) => c.status !== 'draft').slice(0, 12);

  const publish = () =>
    drafts.publish.mutate(undefined, {
      onSuccess: ({ published }) =>
        toast.success(
          `${published} change${published === 1 ? '' : 's'} sent. The POS applies them when it is online.`
        ),
      onError: (err) => toast.error(errorMessage(err))
    });

  return (
    <div className='flex flex-col gap-4'>
      {waiting.length > 0 && (
        <Card className='gap-3 py-4'>
          <CardHeader className='flex flex-row items-center justify-between gap-2 px-4'>
            <CardTitle className='text-base'>
              Draft: {waiting.length} change{waiting.length === 1 ? '' : 's'} not yet on the POS
            </CardTitle>
            <Button onClick={publish} disabled={!canChange || drafts.publish.isPending}>
              {drafts.publish.isPending ? 'Sending…' : 'Publish to POS'}
            </Button>
          </CardHeader>
          <CardContent className='px-4'>
            <ul className='divide-y text-sm'>
              {waiting.map((c) => (
                <li key={c.id} className='flex items-center justify-between gap-3 py-2'>
                  <div className='min-w-0'>
                    <span className='font-medium'>{c.label}</span>
                    <p className='text-muted-foreground truncate'>{describe(c, currency)}</p>
                  </div>
                  <Button
                    variant='ghost'
                    size='sm'
                    disabled={drafts.discard.isPending}
                    onClick={() =>
                      drafts.discard.mutate(c.id, {
                        onError: (err) => toast.error(errorMessage(err))
                      })
                    }
                  >
                    Discard
                  </Button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
      {recent.length > 0 && (
        <Card className='gap-3 py-4'>
          <CardHeader className='px-4'>
            <CardTitle className='text-base'>Recent changes</CardTitle>
          </CardHeader>
          <CardContent className='px-4'>
            <ul className='divide-y text-sm'>
              {recent.map((c) => {
                const note = detail(c, currency);
                return (
                  <li key={c.id} className='flex items-start justify-between gap-3 py-2'>
                    <div className='min-w-0'>
                      <span className='font-medium'>{c.label}</span>
                      <p className='text-muted-foreground'>
                        {describe(c, currency)} · {c.requested_by || 'owner'} ·{' '}
                        {timeAgo(c.answered_at ?? c.published_at ?? c.created_at)}
                      </p>
                      {note && <p className='text-destructive'>{note}</p>}
                    </div>
                    <div className='flex shrink-0 flex-col items-end gap-1'>
                      <Badge variant={STATUS[c.status].variant}>{STATUS[c.status].label}</Badge>
                      {canChange && c.status === 'applied' && c.op !== 'delete' && (
                        <Button
                          variant='ghost'
                          size='sm'
                          disabled={drafts.revert.isPending}
                          onClick={() =>
                            drafts.revert.mutate(c.id, {
                              onSuccess: () => toast.success('Undo added to your draft.'),
                              onError: (err) => toast.error(errorMessage(err))
                            })
                          }
                        >
                          Undo
                        </Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
