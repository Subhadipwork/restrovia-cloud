# Restrovia admin panel

The Restrovia team's panel for every store running Restrovia POS: overview, stores, licences,
support tickets, admin accounts and the audit log. It talks only to the Restrovia Cloud API under
`/api/admin`. Setup and commands are in the repository [README](../../README.md); where the code
came from is in [STARTER.md](STARTER.md).

| Path | Screen | Roles |
| --- | --- | --- |
| `/sign-in` | Sign-in and first-time two-step setup | Everyone |
| `/dashboard/overview` | Store, licence and version totals | Everyone |
| `/dashboard/stores` | Store list, search and filters | Everyone |
| `/dashboard/stores/[id]` | Store details, licence actions, sales, devices, tickets | Everyone; licence changes: super admin, sales |
| `/dashboard/tickets` | Support tickets from the POS | Super admin, support |
| `/dashboard/admins` | Admin accounts | Super admin |
| `/dashboard/audit-log` | Every sign-in and change | Super admin |

The API enforces every role; the menu only hides what a role can't use.
