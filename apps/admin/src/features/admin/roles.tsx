'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import {
  ADMIN_PERMISSIONS,
  type AdminPermission,
  PERMISSION_AREAS,
  type PermissionArea,
  withRequired,
} from '@restrovia/shared';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { useAdmin, useCan } from '@/features/auth/use-admin';
import { errorMessage } from '@/lib/api-client';
import { formatDateTime } from '@/lib/display';
import { cn } from '@/lib/utils';
import {
  type AdminRoleDetail,
  useAdminRole,
  useAdminRoles,
  useCreateRole,
  useDeleteRole,
  useResetRole,
  useUpdateRole,
} from './api';
import { EmptyRow, QueryState } from './ui';

const AREA_LABELS: Record<PermissionArea, string> = {
  dashboard: 'Dashboard',
  stores: 'Stores',
  owners: 'Café owners',
  plans: 'Plans',
  support: 'Support',
  leads: 'Leads',
  team: 'Team',
};

const TOTAL = ADMIN_PERMISSIONS.length;

type Def = (typeof ADMIN_PERMISSIONS)[number];
const requiresOf = (d: Def): readonly string[] => ('requires' in d ? d.requires : []);

/** Permissions that can't stay once `p` is removed, because they need it (directly or not). */
function dependentsOf(p: AdminPermission, selected: ReadonlySet<AdminPermission>) {
  const out = new Set<AdminPermission>();
  let grew = true;
  while (grew) {
    grew = false;
    for (const d of ADMIN_PERMISSIONS) {
      if (out.has(d.key) || !selected.has(d.key)) continue;
      if (requiresOf(d).some((r) => r === p || out.has(r as AdminPermission))) {
        out.add(d.key);
        grew = true;
      }
    }
  }
  return out;
}

const onError = (err: unknown) => toast.error(errorMessage(err));
const labelOf = (p: string) => ADMIN_PERMISSIONS.find((d) => d.key === p)?.label ?? p;

export function RolesScreen() {
  const { data, isPending, error } = useAdminRoles();
  const canManage = useCan('roles.manage');
  return (
    <div className="flex flex-col gap-4">
      {canManage && (
        <Link href="/dashboard/roles/new" className={cn(buttonVariants(), 'self-start')}>
          New role
        </Link>
      )}
      {!data ? (
        <QueryState isPending={isPending} error={error} />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Role</TableHead>
                <TableHead>Permissions</TableHead>
                <TableHead className="text-right">People</TableHead>
                <TableHead>Last changed</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.length === 0 && <EmptyRow colSpan={4}>No roles yet.</EmptyRow>}
              {data.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="max-w-md">
                    <div className="flex items-center gap-2">
                      <Link
                        href={`/dashboard/roles/${r.id}`}
                        className="font-medium hover:underline"
                      >
                        {r.name}
                      </Link>
                      {r.is_system && <Badge variant="secondary">Built-in</Badge>}
                    </div>
                    {r.description && (
                      <div className="text-muted-foreground text-xs whitespace-normal">
                        {r.description}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">
                    {r.all_permissions ? 'All, always' : `${r.permissions.length} of ${TOTAL}`}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{r.users}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {formatDateTime(r.updated_at)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function PermissionChecklist({
  selected,
  onToggle,
  readOnly,
  mine,
}: {
  selected: ReadonlySet<AdminPermission>;
  onToggle: (p: AdminPermission, on: boolean) => void;
  readOnly: boolean;
  mine: ReadonlySet<string>;
}) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {PERMISSION_AREAS.map((area) => {
        const defs = ADMIN_PERMISSIONS.filter((d) => d.area === area);
        const on = defs.filter((d) => selected.has(d.key)).length;
        return (
          <fieldset key={area} className="rounded-lg border p-3">
            <legend className="px-1 text-sm font-medium">
              {AREA_LABELS[area]}{' '}
              <span className="text-muted-foreground font-normal">
                ({on} of {defs.length})
              </span>
            </legend>
            <ul className="flex flex-col gap-3">
              {defs.map((d) => {
                const id = `perm-${d.key}`;
                const notMine = !mine.has(d.key);
                const needs = requiresOf(d);
                return (
                  <li key={d.key} className="flex items-start gap-2.5">
                    <Checkbox
                      id={id}
                      aria-label={d.label}
                      className="mt-0.5"
                      checked={selected.has(d.key)}
                      disabled={readOnly || notMine}
                      onCheckedChange={(v) => onToggle(d.key, v === true)}
                    />
                    <label htmlFor={id} className="flex flex-col gap-0.5 text-sm">
                      <span className="flex flex-wrap items-center gap-1.5 font-medium">
                        {d.label}
                        {'sensitive' in d && d.sensitive && (
                          <Badge variant="outline" className="border-amber-500/50 text-amber-600">
                            Sensitive
                          </Badge>
                        )}
                      </span>
                      <span className="text-muted-foreground text-xs">{d.description}</span>
                      {needs.length > 0 && (
                        <span className="text-muted-foreground text-xs">
                          Also turns on: {needs.map(labelOf).join(', ')}
                        </span>
                      )}
                      {notMine && !readOnly && (
                        <span className="text-xs text-amber-600">
                          You don’t have this yourself, so you can’t change it.
                        </span>
                      )}
                    </label>
                  </li>
                );
              })}
            </ul>
          </fieldset>
        );
      })}
    </div>
  );
}

function RoleForm({ role, copyOf }: { role?: AdminRoleDetail; copyOf?: AdminRoleDetail }) {
  const router = useRouter();
  const { data: me } = useAdmin();
  const create = useCreateRole();
  const update = useUpdateRole(role?.id ?? '');
  const remove = useDeleteRole(role?.id ?? '');
  const reset = useResetRole(role?.id ?? '');
  const source = role ?? copyOf;
  const [name, setName] = useState(role?.name ?? (copyOf ? `${copyOf.name} (copy)` : ''));
  const [description, setDescription] = useState(source?.description ?? '');
  const [selected, setSelected] = useState<Set<AdminPermission>>(
    () => new Set(source && !source.all_permissions ? source.permissions : []),
  );
  const [confirm, setConfirm] = useState<'delete' | 'reset' | null>(null);

  const isNew = !role;
  const readOnly = !!role && !role.editable;
  const mine = new Set<string>(me?.permissions ?? []);
  const pending = create.isPending || update.isPending;

  const toggle = (p: AdminPermission, on: boolean) =>
    setSelected((cur) => {
      if (on) return new Set(withRequired([...cur, p]));
      const next = new Set(cur);
      next.delete(p);
      for (const d of dependentsOf(p, cur)) next.delete(d);
      return next;
    });

  const save = () => {
    const body = {
      ...(role?.is_system ? {} : { name: name.trim() }),
      description: description.trim(),
      permissions: [...selected],
    };
    if (isNew) {
      create.mutate(
        { name: name.trim(), description: description.trim(), permissions: [...selected] },
        {
          onSuccess: (r) => {
            toast.success(`${r.name} added`);
            router.push(`/dashboard/roles/${r.id}`);
          },
          onError,
        },
      );
    } else {
      update.mutate(body, { onSuccess: () => toast.success('Role saved'), onError });
    }
  };

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2 text-base">
            {isNew ? 'New role' : role.name}
            {role?.is_system && <Badge variant="secondary">Built-in</Badge>}
          </CardTitle>
          {role?.all_permissions && (
            <CardDescription>
              Super admin always has every permission, including ones added later. It can’t be
              edited or deleted.
            </CardDescription>
          )}
          {role && !role.all_permissions && !role.editable && (
            <CardDescription>
              You can view this role but not change it
              {mine.has('roles.manage') ? ', because it allows things you can’t do' : ''}.
            </CardDescription>
          )}
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="role-name">Name</Label>
            <Input
              id="role-name"
              required
              minLength={2}
              maxLength={60}
              disabled={readOnly || !!role?.is_system}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            {role?.is_system && !readOnly && (
              <p className="text-muted-foreground text-xs">Built-in roles keep their names.</p>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="role-description">Description</Label>
            <Textarea
              id="role-description"
              rows={2}
              maxLength={300}
              disabled={readOnly}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What people with this role do"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Permissions{' '}
            <span className="text-muted-foreground font-normal">
              ({role?.all_permissions ? TOTAL : selected.size} of {TOTAL})
            </span>
          </CardTitle>
          <CardDescription>
            Turning one on also turns on what it needs; turning one off also turns off what depends
            on it. Changes apply to everyone with this role on their next click.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PermissionChecklist
            selected={
              role?.all_permissions ? new Set(ADMIN_PERMISSIONS.map((d) => d.key)) : selected
            }
            onToggle={toggle}
            readOnly={readOnly}
            mine={mine}
          />
        </CardContent>
      </Card>

      {role && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              People with this role ({role.people.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {role.people.length === 0 ? (
              <p className="text-muted-foreground text-sm">Nobody has this role yet.</p>
            ) : (
              <ul className="flex flex-col gap-1 text-sm">
                {role.people.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{p.name}</span>
                    <span className="text-muted-foreground">{p.email}</span>
                    {p.status === 'disabled' && <Badge variant="destructive">Disabled</Badge>}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {!readOnly && (
          <Button type="submit" disabled={pending || (!isNew && !role.editable)}>
            {pending ? 'Saving…' : isNew ? 'Add role' : 'Save changes'}
          </Button>
        )}
        <Link href="/dashboard/roles" className={buttonVariants({ variant: 'outline' })}>
          {readOnly ? 'Back to roles' : 'Cancel'}
        </Link>
        {role && mine.has('roles.manage') && (
          <Link
            href={`/dashboard/roles/new?from=${role.id}`}
            className={buttonVariants({ variant: 'ghost' })}
          >
            Duplicate
          </Link>
        )}
        {role?.is_system && !role.all_permissions && role.editable && (
          <Button type="button" variant="ghost" onClick={() => setConfirm('reset')}>
            Reset to default
          </Button>
        )}
        {role && !role.is_system && role.editable && (
          <Button
            type="button"
            variant="ghost"
            className="text-destructive ml-auto"
            onClick={() => setConfirm('delete')}
          >
            Delete role
          </Button>
        )}
      </div>

      <Dialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirm === 'delete' ? `Delete ${role?.name}?` : `Reset ${role?.name}?`}
            </DialogTitle>
            <DialogDescription>
              {confirm === 'delete'
                ? role && role.people.length > 0
                  ? `${role.people.length} people still have this role. Give them another role first.`
                  : 'The role is removed. The audit log keeps a record of it.'
                : 'Its permissions and description go back to how Restrovia ships them. Everyone with this role is affected on their next click.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            {confirm === 'delete' ? (
              <Button
                variant="destructive"
                disabled={remove.isPending || (role?.people.length ?? 0) > 0}
                onClick={() =>
                  remove.mutate(undefined, {
                    onSuccess: () => {
                      toast.success('Role deleted');
                      router.replace('/dashboard/roles');
                    },
                    onError,
                  })
                }
              >
                Delete
              </Button>
            ) : (
              <Button
                disabled={reset.isPending}
                onClick={() =>
                  reset.mutate(undefined, {
                    onSuccess: (r) => {
                      toast.success(`${r.name} reset`);
                      setSelected(new Set(r.permissions));
                      setDescription(r.description);
                      setConfirm(null);
                    },
                    onError,
                  })
                }
              >
                Reset
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </form>
  );
}

/** View and edit one role; `id` undefined means a new role, optionally copied from `from`. */
export function RoleEditorScreen({ id, from }: { id?: string; from?: string }) {
  const canManage = useCan('roles.manage');
  const role = useAdminRole(id);
  const source = useAdminRole(id ? undefined : from);
  if (!id && !canManage) {
    return <p className="text-muted-foreground text-sm">Your role doesn’t allow adding roles.</p>;
  }
  if (id && !role.data)
    return <QueryState isPending={role.isPending} error={role.error} rows={6} />;
  if (!id && from && !source.data) {
    return <QueryState isPending={source.isPending} error={source.error} rows={6} />;
  }
  return (
    <RoleForm
      key={role.data?.updated_at ?? source.data?.id ?? 'new'}
      role={role.data}
      copyOf={source.data}
    />
  );
}
