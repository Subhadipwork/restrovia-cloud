/**
 * What a Restrovia admin may do. Routes check permissions, never role names; a role is just a
 * named set of these. Adding a permission means adding it here and to the default roles in a
 * migration.
 */
export const PERMISSION_AREAS = [
  'dashboard',
  'stores',
  'owners',
  'plans',
  'support',
  'leads',
  'team',
] as const;
export type PermissionArea = (typeof PERMISSION_AREAS)[number];

type PermissionDef = {
  key: string;
  area: PermissionArea;
  label: string;
  description: string;
  /** Highlighted in the role editor: money, data export, deletion or access control. */
  sensitive?: boolean;
  /** Permissions this one is useless without; the role editor and API add them. */
  requires?: readonly string[];
};

export const ADMIN_PERMISSIONS = [
  {
    key: 'overview.view',
    area: 'dashboard',
    label: 'See the overview',
    description: 'The dashboard and its numbers.',
  },
  {
    key: 'stores.view',
    area: 'stores',
    label: 'See stores',
    description: 'Stores list, store details and store history.',
  },
  {
    key: 'stores.block',
    area: 'stores',
    label: 'Block stores',
    description: 'Block or unblock a store’s cloud access.',
    sensitive: true,
    requires: ['stores.view'],
  },
  {
    key: 'stores.licence',
    area: 'stores',
    label: 'Change licences',
    description: 'Start or extend a trial, activate a plan, record a payment, suspend.',
    sensitive: true,
    requires: ['stores.view', 'plans.view'],
  },
  {
    key: 'stores.devices',
    area: 'stores',
    label: 'Reset POS computers',
    description: 'Let a POS check in from a different computer.',
    requires: ['stores.view'],
  },
  {
    key: 'owners.view',
    area: 'owners',
    label: 'See owners',
    description: 'Owners list and owner details.',
  },
  {
    key: 'owners.invite',
    area: 'owners',
    label: 'Invite owners',
    description: 'Add an owner to a store and resend invites.',
    requires: ['owners.view'],
  },
  {
    key: 'owners.manage',
    area: 'owners',
    label: 'Manage owner logins',
    description: 'Disable or enable owners, reset their 2FA, set a password, remove from a store.',
    sensitive: true,
    requires: ['owners.view'],
  },
  {
    key: 'plans.view',
    area: 'plans',
    label: 'See plans',
    description: 'The plans page.',
  },
  {
    key: 'plans.manage',
    area: 'plans',
    label: 'Manage plans',
    description: 'Create plans and change prices.',
    sensitive: true,
    requires: ['plans.view'],
  },
  {
    key: 'tickets.view',
    area: 'support',
    label: 'See support tickets',
    description: 'Tickets sent from the POS and their notes.',
  },
  {
    key: 'tickets.manage',
    area: 'support',
    label: 'Work on tickets',
    description: 'Change status, assign and add notes.',
    requires: ['tickets.view'],
  },
  {
    key: 'leads.view',
    area: 'leads',
    label: 'See leads',
    description: 'Leads list, lead details and timeline.',
  },
  {
    key: 'leads.edit',
    area: 'leads',
    label: 'Work on leads',
    description:
      'Add and edit leads, change stage and owner, log activity, follow-ups, merge, import, pipeline board.',
    requires: ['leads.view'],
  },
  {
    key: 'leads.reports',
    area: 'leads',
    label: 'See sales reports',
    description: 'Funnel, sources, lost reasons and team numbers.',
    requires: ['leads.view'],
  },
  {
    key: 'leads.delete',
    area: 'leads',
    label: 'Delete leads',
    description: 'Delete leads and unlink their store.',
    sensitive: true,
    requires: ['leads.view'],
  },
  {
    key: 'leads.export',
    area: 'leads',
    label: 'Export leads',
    description: 'Download leads with their contact details as CSV.',
    sensitive: true,
    requires: ['leads.view'],
  },
  {
    key: 'leads.win_override',
    area: 'leads',
    label: 'Mark won without a store',
    description: 'For deals paid outside Restrovia.',
    requires: ['leads.view', 'leads.edit'],
  },
  {
    key: 'users.view',
    area: 'team',
    label: 'See the team',
    description: 'Users list, user details and roles.',
  },
  {
    key: 'users.manage',
    area: 'team',
    label: 'Manage users',
    description: 'Invite, edit, change role, disable, reset 2FA and passwords.',
    sensitive: true,
    requires: ['users.view'],
  },
  {
    key: 'roles.manage',
    area: 'team',
    label: 'Manage roles',
    description: 'Create, edit and delete roles.',
    sensitive: true,
    requires: ['users.view'],
  },
  {
    key: 'audit.view',
    area: 'team',
    label: 'See the audit log',
    description: 'Every change made by every admin.',
    sensitive: true,
  },
] as const satisfies readonly PermissionDef[];

export type AdminPermission = (typeof ADMIN_PERMISSIONS)[number]['key'];
export const PERMISSION_KEYS: readonly AdminPermission[] = ADMIN_PERMISSIONS.map((p) => p.key);
/** Stored on the Super admin role: every permission, including ones added later. */
export const ALL_PERMISSIONS = '*';

export function isPermission(value: string): value is AdminPermission {
  return (PERMISSION_KEYS as readonly string[]).includes(value);
}

/** What a stored permission list grants: `*` becomes the full catalog; unknown keys are dropped. */
export function expandPermissions(stored: readonly string[]): AdminPermission[] {
  if (stored.includes(ALL_PERMISSIONS)) return [...PERMISSION_KEYS];
  return PERMISSION_KEYS.filter((k) => stored.includes(k));
}

/** Adds every permission the given ones require. */
export function withRequired(perms: readonly AdminPermission[]): AdminPermission[] {
  const out = new Set<AdminPermission>(perms);
  for (const p of ADMIN_PERMISSIONS) {
    if (out.has(p.key) && 'requires' in p) for (const r of p.requires) out.add(r as AdminPermission);
  }
  return PERMISSION_KEYS.filter((k) => out.has(k));
}

export const SYSTEM_ROLE_KEYS = ['super_admin', 'admin', 'manager', 'support', 'sales'] as const;
export type SystemRoleKey = (typeof SYSTEM_ROLE_KEYS)[number];

/** Fixed ids, so migrations, seeds and tests can refer to the built-in roles directly. */
export const SYSTEM_ROLE_IDS: Record<SystemRoleKey, string> = {
  super_admin: '00000000-0000-4000-8000-000000000001',
  admin: '00000000-0000-4000-8000-000000000002',
  manager: '00000000-0000-4000-8000-000000000003',
  support: '00000000-0000-4000-8000-000000000004',
  sales: '00000000-0000-4000-8000-000000000005',
};

const SUPPORT: AdminPermission[] = [
  'overview.view',
  'stores.view',
  'stores.devices',
  'owners.view',
  'owners.invite',
  'owners.manage',
  'tickets.view',
  'tickets.manage',
  'leads.view',
];
const SALES: AdminPermission[] = [
  'overview.view',
  'stores.view',
  'stores.block',
  'stores.licence',
  'owners.view',
  'owners.invite',
  'plans.view',
  'leads.view',
  'leads.edit',
  'leads.reports',
];
const MANAGER: AdminPermission[] = withRequired([
  ...SUPPORT,
  ...SALES,
  'leads.export',
  'leads.win_override',
  'users.view',
]);
const ADMIN: AdminPermission[] = PERMISSION_KEYS.filter((k) => k !== 'roles.manage');

/** Default name, description and permissions of each built-in role. */
export const SYSTEM_ROLES: Record<
  SystemRoleKey,
  { name: string; description: string; permissions: readonly string[] }
> = {
  super_admin: {
    name: 'Super admin',
    description: 'Everything, including roles and other Super admins.',
    permissions: [ALL_PERMISSIONS],
  },
  admin: {
    name: 'Admin',
    description: 'Runs operations and the team. Can’t edit roles or manage Super admins.',
    permissions: ADMIN,
  },
  manager: {
    name: 'Manager',
    description: 'Leads sales and support: stores, owners, tickets, leads, reports and export.',
    permissions: MANAGER,
  },
  support: {
    name: 'Support',
    description: 'Helps cafés: stores, owners, POS computers and tickets. Reads leads.',
    permissions: SUPPORT,
  },
  sales: {
    name: 'Sales',
    description: 'Sells: stores, licences, owner invites and leads.',
    permissions: SALES,
  },
};
