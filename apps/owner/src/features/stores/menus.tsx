'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
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
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { errorMessage } from '@/lib/api-client';
import { formatMoney } from '@/lib/display';
import {
  useChannelMenu,
  useChannelMenuActions,
  useMenus,
  useStores,
  type ChannelMenuItem
} from './api';

// ── The page of menus ──────────────────────────────────────────────────────

function MenuCard({
  href,
  title,
  note,
  badge
}: {
  href: string;
  title: string;
  note: string;
  badge?: string;
}) {
  return (
    <Link href={href} className='block' aria-label={title}>
      <Card className='hover:bg-muted/40 h-full gap-1 py-4 transition-colors'>
        <CardContent className='flex flex-col gap-1 px-4'>
          <div className='flex items-start justify-between gap-2'>
            <span className='font-medium'>{title}</span>
            {badge && <Badge variant='secondary'>{badge}</Badge>}
          </div>
          <span className='text-muted-foreground text-sm'>{note}</span>
        </CardContent>
      </Card>
    </Link>
  );
}

function AddMenuDialog({
  storeId,
  open,
  onOpenChange
}: {
  storeId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const { create } = useChannelMenuActions(storeId);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          className='flex flex-col gap-4'
          onSubmit={(e) => {
            e.preventDefault();
            setError('');
            create.mutate(name.trim(), {
              onSuccess: (menu) => {
                setName('');
                onOpenChange(false);
                router.push(`/dashboard/${storeId}/menus/${menu.id}`);
              },
              onError: (err) => setError(errorMessage(err))
            });
          }}
        >
          <DialogHeader>
            <DialogTitle>Add a menu</DialogTitle>
            <DialogDescription>
              For example “Happy hour” or “Zomato”. It starts as your Base Menu; you change only
              what differs.
            </DialogDescription>
          </DialogHeader>
          <div className='flex flex-col gap-1.5'>
            <Label htmlFor='menu-name'>Name</Label>
            <Input
              id='menu-name'
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={60}
              autoFocus
            />
            {error && (
              <p role='alert' className='text-destructive text-sm'>
                {error}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button type='submit' disabled={create.isPending || name.trim() === ''}>
              {create.isPending ? 'Adding…' : 'Add menu'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function MenusScreen({ storeId }: { storeId: string }) {
  const { data, error, isPending } = useMenus(storeId);
  const [adding, setAdding] = useState(false);

  if (isPending) {
    return (
      <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-3' role='status' aria-label='Loading'>
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className='h-24' />
        ))}
      </div>
    );
  }
  if (error || !data) {
    return <p className='text-muted-foreground text-sm'>{errorMessage(error)}</p>;
  }

  return (
    <div className='flex flex-col gap-4'>
      {!data.has_menu && (
        <div className='bg-muted text-muted-foreground rounded-lg border p-3 text-sm' role='status'>
          The POS has not sent its menu yet, so there is nothing to price. It sends it a few minutes
          after it goes online.
        </div>
      )}
      <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-3'>
        <MenuCard
          href={`/dashboard/${storeId}/menu`}
          title='Base Menu'
          note={`${data.base.item_count} items · the menu on your POS`}
          badge='POS'
        />
        {data.menus.map((m) => (
          <MenuCard
            key={m.id}
            href={`/dashboard/${storeId}/menus/${m.id}`}
            title={m.name}
            note={
              m.priced_items + m.hidden_items === 0
                ? 'Same as the Base Menu'
                : `${m.priced_items} price${m.priced_items === 1 ? '' : 's'} changed · ${m.hidden_items} hidden`
            }
          />
        ))}
      </div>
      <div>
        <Button variant='outline' onClick={() => setAdding(true)}>
          Add menu
        </Button>
      </div>
      <p className='text-muted-foreground text-sm'>
        These menus are for the ways Restrovia Cloud sells. Your POS keeps one menu and one price
        for each item.
      </p>
      <AddMenuDialog storeId={storeId} open={adding} onOpenChange={setAdding} />
    </div>
  );
}

// ── One menu ───────────────────────────────────────────────────────────────

/** A price box that shows the Base Menu price as a hint and saves when you leave it. */
function PriceBox({
  value,
  base,
  label,
  onSave
}: {
  value: number | null;
  base: number;
  label: string;
  onSave: (price: number | null) => void;
}) {
  const [text, setText] = useState(value === null ? '' : String(value));
  const [saved, setSaved] = useState(value);
  if (saved !== value) {
    setSaved(value);
    setText(value === null ? '' : String(value));
  }
  const commit = () => {
    const trimmed = text.trim();
    if (trimmed === '') {
      if (value !== null) onSave(null);
      return;
    }
    const n = Number(trimmed);
    if (!Number.isFinite(n) || n < 0) {
      toast.error('Enter a price of 0 or more.');
      setText(value === null ? '' : String(value));
      return;
    }
    if (n !== value) onSave(n);
  };
  return (
    <Input
      aria-label={label}
      className='h-8 w-24 text-right tabular-nums'
      inputMode='decimal'
      placeholder={String(base)}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  );
}

export function ChannelMenuScreen({ storeId, menuId }: { storeId: string; menuId: string }) {
  const router = useRouter();
  const { data, error, isPending } = useChannelMenu(storeId, menuId);
  const { data: menus } = useMenus(storeId);
  const { data: stores } = useStores();
  const currency = stores?.find((s) => s.id === storeId)?.currency ?? 'INR';
  const actions = useChannelMenuActions(storeId, menuId);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const builtIn = menus?.menus.find((m) => m.id === menuId)?.built_in ?? true;

  const groups = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    const items = data.items.filter(
      (i) => (!category || i.category_id === category) && (!q || i.name.toLowerCase().includes(q))
    );
    const known = new Set(data.categories.map((c) => c.id));
    const out = data.categories
      .map((c) => ({ id: c.id, name: c.name, items: items.filter((i) => i.category_id === c.id) }))
      .filter((g) => g.items.length > 0);
    const loose = items.filter((i) => !i.category_id || !known.has(i.category_id));
    if (loose.length > 0) out.push({ id: 'none', name: 'Other', items: loose });
    return out;
  }, [data, search, category]);

  if (isPending) {
    return (
      <div className='flex flex-col gap-3' role='status' aria-label='Loading'>
        <Skeleton className='h-10 w-full' />
        <Skeleton className='h-48 w-full' />
      </div>
    );
  }
  if (error || !data) return <p className='text-muted-foreground text-sm'>{errorMessage(error)}</p>;

  const save = (
    item: ChannelMenuItem,
    body: Parameters<typeof actions.setItem.mutate>[0]['body']
  ) =>
    actions.setItem.mutate(
      { itemId: item.id, body },
      { onError: (err) => toast.error(errorMessage(err)) }
    );
  const changed = data.items.filter(
    (i) => i.price !== null || i.hidden || i.variants.some((v) => v.price !== null)
  ).length;

  return (
    <div className='flex flex-col gap-4'>
      <div className='flex flex-wrap items-center gap-2'>
        <Link
          href={`/dashboard/${storeId}/menus`}
          className='text-muted-foreground text-sm underline-offset-4 hover:underline'
        >
          ← All menus
        </Link>
        <h2 className='text-lg font-semibold'>{data.menu.name}</h2>
        <span className='text-muted-foreground text-sm'>
          {changed === 0
            ? 'Same as the Base Menu'
            : `${changed} item${changed === 1 ? '' : 's'} differ`}
        </span>
        <div className='ml-auto flex gap-2'>
          <Button
            size='sm'
            variant='outline'
            disabled={changed === 0 || actions.reset.isPending}
            onClick={() =>
              actions.reset.mutate(menuId, {
                onSuccess: () =>
                  toast.success(`${data.menu.name} is the same as the Base Menu again.`),
                onError: (err) => toast.error(errorMessage(err))
              })
            }
          >
            Reset to Base Menu
          </Button>
          {!builtIn && (
            <Button
              size='sm'
              variant='outline'
              disabled={actions.remove.isPending}
              onClick={() =>
                actions.remove.mutate(menuId, {
                  onSuccess: () => router.push(`/dashboard/${storeId}/menus`),
                  onError: (err) => toast.error(errorMessage(err))
                })
              }
            >
              Delete menu
            </Button>
          )}
        </div>
      </div>

      {!data.has_menu ? (
        <p className='text-muted-foreground text-sm'>The POS has not sent its menu yet.</p>
      ) : (
        <>
          <div className='flex flex-col gap-2 sm:flex-row sm:items-center'>
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
              {data.categories.map((c) => (
                <NativeSelectOption key={c.id} value={c.id}>
                  {c.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
          {groups.length === 0 ? (
            <p className='text-muted-foreground text-sm'>No items match.</p>
          ) : (
            groups.map((group) => (
              <Card key={group.id} className='gap-0 py-0'>
                <CardContent className='px-4'>
                  <h3 className='text-muted-foreground pt-4 text-sm font-semibold'>{group.name}</h3>
                  <ul className='divide-y'>
                    {group.items.map((item) => (
                      <li key={item.id} className='flex flex-col gap-2 py-3'>
                        <div className='flex items-center justify-between gap-3'>
                          <div className='min-w-0'>
                            <span
                              className={
                                item.hidden ? 'text-muted-foreground font-medium' : 'font-medium'
                              }
                            >
                              {item.name}
                            </span>
                            {!item.is_active && (
                              <Badge variant='secondary' className='ml-2'>
                                Sold out on POS
                              </Badge>
                            )}
                            {item.variants.length === 0 && (
                              <p className='text-muted-foreground text-sm'>
                                Base Menu {formatMoney(item.base_price, currency)}
                              </p>
                            )}
                          </div>
                          <div className='flex shrink-0 items-center gap-3'>
                            {item.variants.length === 0 && (
                              <PriceBox
                                value={item.price}
                                base={item.base_price}
                                label={`${item.name} price`}
                                onSave={(price) => save(item, { price })}
                              />
                            )}
                            <div className='flex items-center gap-2 text-sm'>
                              <span className='text-muted-foreground'>Show</span>
                              <Switch
                                checked={!item.hidden}
                                onCheckedChange={(show) => save(item, { hidden: !show })}
                                aria-label={`Show ${item.name} on this menu`}
                              />
                            </div>
                          </div>
                        </div>
                        {item.variants.length > 0 && (
                          <ul className='text-muted-foreground flex flex-col gap-1.5 pl-4 text-sm'>
                            {item.variants.map((v) => (
                              <li key={v.id} className='flex items-center justify-between gap-3'>
                                <span>
                                  {v.name} · Base Menu {formatMoney(v.base_price, currency)}
                                </span>
                                <PriceBox
                                  value={v.price}
                                  base={v.base_price}
                                  label={`${item.name} ${v.name} price`}
                                  onSave={(price) =>
                                    save(item, { variants: [{ variant_id: v.id, price }] })
                                  }
                                />
                              </li>
                            ))}
                          </ul>
                        )}
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            ))
          )}
        </>
      )}
    </div>
  );
}
