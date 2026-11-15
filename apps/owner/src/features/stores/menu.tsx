'use client';

import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { errorMessage } from '@/lib/api-client';
import { formatMoney, timeAgo } from '@/lib/display';
import { cn } from '@/lib/utils';
import { useMenu, useSetAvailability, useStores, type Menu, type MenuItem } from './api';
import { CategoryDialog, ChangesPanel, ItemDialog } from './menu-edit';
import { scheduleSummary } from './menu-schedule';
import { AddonGroupsCard, BulkDialog, ImportExport } from './menu-tools';

function SyncNote({ menu }: { menu: Menu }) {
  if (!menu.has_menu) {
    return (
      <Note>
        The POS has not sent its menu yet. It sends it a few minutes after it goes online with menu
        sharing turned on.
      </Note>
    );
  }
  if (!menu.sync.enabled) {
    return (
      <Note>
        Menu sharing is off on the POS, so this is the menu as of {timeAgo(menu.sync.synced_at)}.
        Turn it on in the POS under Settings → About.
      </Note>
    );
  }
  if (!menu.sync.portal_editing) {
    return (
      <Note>
        The café turned off menu changes from the portal. You can see the menu, but not change it.
      </Note>
    );
  }
  return null;
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <div className='bg-muted text-muted-foreground rounded-lg border p-3 text-sm' role='status'>
      {children}
    </div>
  );
}

function ItemRow({
  item,
  currency,
  canChange,
  pending,
  selected,
  onSelect,
  onToggle,
  onEdit
}: {
  item: MenuItem;
  currency: string;
  canChange: boolean;
  pending: boolean;
  onToggle: (available: boolean) => void;
  selected: boolean;
  onSelect: ((checked: boolean) => void) | null;
  onEdit: () => void;
}) {
  const variants = item.variants.filter((v) => v.is_active);
  return (
    <li className='flex items-center justify-between gap-3 py-3'>
      {onSelect && (
        <input
          type='checkbox'
          checked={selected}
          onChange={(e) => onSelect(e.target.checked)}
          aria-label={`Select ${item.name}`}
        />
      )}
      <div className='min-w-0 flex-1'>
        <div className='flex flex-wrap items-center gap-2'>
          <span className={cn('truncate font-medium', !item.is_active && 'text-muted-foreground')}>
            {item.name}
          </span>
          {!item.is_active && <Badge variant='secondary'>Sold out</Badge>}
          {variants.length > 0 && (
            <Badge variant='outline'>
              {variants.length} size{variants.length === 1 ? '' : 's'}
            </Badge>
          )}
          {item.addon_group_ids.length > 0 && <Badge variant='outline'>Add-ons</Badge>}
          {item.schedule.length > 0 && (
            <Badge variant='outline'>{scheduleSummary(item.schedule)}</Badge>
          )}
        </div>
        <p className='text-muted-foreground text-sm'>
          {variants.length > 0
            ? `${formatMoney(Math.min(...variants.map((v) => v.price)), currency)} – ${formatMoney(Math.max(...variants.map((v) => v.price)), currency)}`
            : formatMoney(item.price, currency)}
          {item.cost !== null && item.cost > 0
            ? ` · costs ${formatMoney(item.cost, currency)}`
            : ''}
          {item.track_inventory ? ` · ${item.stock_quantity} in stock` : ''}
        </p>
      </div>
      <div className='flex shrink-0 items-center gap-2 text-sm'>
        <Button variant='outline' size='sm' disabled={!canChange} onClick={onEdit}>
          Edit
        </Button>
        <span className='text-muted-foreground'>Available</span>
        <Switch
          checked={item.is_active}
          disabled={!canChange || pending}
          onCheckedChange={(checked) => onToggle(checked)}
          aria-label={`${item.name} available`}
        />
      </div>
    </li>
  );
}

export function MenuScreen({ storeId }: { storeId: string }) {
  const { data: menu, error, isPending } = useMenu(storeId);
  const { data: stores } = useStores();
  const currency = stores?.find((s) => s.id === storeId)?.currency ?? 'INR';
  const setAvailability = useSetAvailability(storeId);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [itemDialog, setItemDialog] = useState<{ item: MenuItem | null; open: boolean } | null>(
    null
  );
  const [categoryDialog, setCategoryDialog] = useState<{
    category: Menu['categories'][number] | null;
    open: boolean;
  } | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const isOwner = stores?.find((s) => s.id === storeId)?.role === 'owner';

  const groups = useMemo(() => {
    if (!menu) return [];
    const q = search.trim().toLowerCase();
    const items = menu.items.filter(
      (i) => (!category || i.category_id === category) && (!q || i.name.toLowerCase().includes(q))
    );
    const known = new Set(menu.categories.map((c) => c.id));
    const out = menu.categories
      .map((c) => ({
        id: c.id,
        name: c.name,
        active: c.is_active,
        items: items.filter((i) => i.category_id === c.id)
      }))
      .filter((g) => g.items.length > 0 || (!q && !category));
    const loose = items.filter((i) => !i.category_id || !known.has(i.category_id));
    if (loose.length > 0) out.push({ id: 'none', name: 'Other', active: true, items: loose });
    return out;
  }, [menu, search, category]);

  if (isPending) {
    return (
      <div className='flex flex-col gap-3' role='status' aria-label='Loading'>
        <Skeleton className='h-10 w-full' />
        <Skeleton className='h-48 w-full' />
      </div>
    );
  }
  if (error || !menu) {
    return <Note>{errorMessage(error)}</Note>;
  }

  const canChange = menu.has_menu && menu.sync.enabled && menu.sync.portal_editing;
  const soldOut = menu.items.filter((i) => !i.is_active).length;

  const toggle = (item: MenuItem, available: boolean) => {
    setBusy(item.id);
    setAvailability.mutate(
      { itemId: item.id, available },
      {
        onSuccess: () => toast.success(`${item.name} is ${available ? 'available' : 'sold out'}.`),
        onError: (err) => toast.error(errorMessage(err)),
        onSettled: () => setBusy(null)
      }
    );
  };

  return (
    <div className='flex flex-col gap-4'>
      <SyncNote menu={menu} />
      <ChangesPanel storeId={storeId} currency={currency} canChange={canChange} />
      {menu.has_menu && (
        <>
          <div className='flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center'>
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder='Search items'
              aria-label='Search items'
              className='sm:max-w-xs'
            />
            <NativeSelect
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              aria-label='Category'
            >
              <NativeSelectOption value=''>All categories</NativeSelectOption>
              {menu.categories.map((c) => (
                <NativeSelectOption key={c.id} value={c.id}>
                  {c.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            {canChange && (
              <div className='flex gap-2'>
                <Button size='sm' onClick={() => setItemDialog({ item: null, open: true })}>
                  Add item
                </Button>
                <Button
                  size='sm'
                  variant='outline'
                  onClick={() => setCategoryDialog({ category: null, open: true })}
                >
                  Add category
                </Button>
              </div>
            )}
            <div className='flex gap-2'>
              <ImportExport storeId={storeId} menu={menu} canChange={canChange} />
            </div>
            <p className='text-muted-foreground text-sm sm:ml-auto'>
              {menu.items.length} items{soldOut > 0 ? ` · ${soldOut} sold out` : ''}
              {menu.sync.synced_at ? ` · menu sent ${timeAgo(menu.sync.synced_at)}` : ''}
            </p>
          </div>
          {picked.size > 0 && (
            <div className='bg-muted flex flex-wrap items-center gap-2 rounded-lg border p-3 text-sm'>
              <span className='font-medium'>{picked.size} selected</span>
              <Button size='sm' onClick={() => setBulkOpen(true)}>
                Change selected
              </Button>
              <Button size='sm' variant='ghost' onClick={() => setPicked(new Set())}>
                Clear
              </Button>
            </div>
          )}
          {groups.length === 0 ? (
            <Note>No items match.</Note>
          ) : (
            groups.map((group) => (
              <Card key={group.id} className='gap-0 py-0'>
                <CardContent className='px-4'>
                  <div className='flex items-center justify-between gap-2 pt-4'>
                    <h2 className='text-muted-foreground text-sm font-semibold'>
                      {group.name}
                      {!group.active && ' (hidden on the POS)'}
                      {(() => {
                        const hours =
                          menu.categories.find((c) => c.id === group.id)?.schedule ?? [];
                        return hours.length > 0 ? ` · ${scheduleSummary(hours)}` : '';
                      })()}
                    </h2>
                    {canChange && group.id !== 'none' && (
                      <Button
                        variant='ghost'
                        size='sm'
                        onClick={() =>
                          setCategoryDialog({
                            category: menu.categories.find((c) => c.id === group.id) ?? null,
                            open: true
                          })
                        }
                      >
                        Edit category
                      </Button>
                    )}
                  </div>
                  {group.items.length === 0 && (
                    <p className='text-muted-foreground py-3 text-sm'>No items yet.</p>
                  )}
                  <ul className='divide-y'>
                    {group.items.map((item) => (
                      <ItemRow
                        key={item.id}
                        item={item}
                        currency={currency}
                        canChange={canChange}
                        pending={busy === item.id}
                        onToggle={(available) => toggle(item, available)}
                        selected={picked.has(item.id)}
                        onSelect={
                          canChange
                            ? (checked) =>
                                setPicked((prev) => {
                                  const next = new Set(prev);
                                  if (checked) next.add(item.id);
                                  else next.delete(item.id);
                                  return next;
                                })
                            : null
                        }
                        onEdit={() => setItemDialog({ item, open: true })}
                      />
                    ))}
                  </ul>
                </CardContent>
              </Card>
            ))
          )}
          <AddonGroupsCard
            storeId={storeId}
            menu={menu}
            canChange={canChange}
            currency={currency}
          />
        </>
      )}
      <BulkDialog
        storeId={storeId}
        menu={menu}
        itemIds={[...picked]}
        open={bulkOpen}
        onOpenChange={setBulkOpen}
        onDone={() => setPicked(new Set())}
      />
      <ItemDialog
        storeId={storeId}
        item={itemDialog?.item ?? null}
        menu={menu}
        isOwner={isOwner}
        open={itemDialog?.open ?? false}
        onOpenChange={(open) => setItemDialog((d) => (d ? { ...d, open } : d))}
      />
      <CategoryDialog
        storeId={storeId}
        category={categoryDialog?.category ?? null}
        menu={menu}
        open={categoryDialog?.open ?? false}
        onOpenChange={(open) => setCategoryDialog((d) => (d ? { ...d, open } : d))}
      />
    </div>
  );
}
