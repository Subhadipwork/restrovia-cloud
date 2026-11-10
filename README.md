# Restrovia Cloud

The online server for Restrovia POS: the sync API that café POS machines talk to, the owner portal
(`app.restrovia.in`) and the Restrovia admin panel (`admin.restrovia.in`). The full plan is in
[docs/PLAN.md](docs/PLAN.md).

## What exists today

| Part | Status |
| --- | --- |
| Database: 26 PostgreSQL tables, migrations, dev seed | Built and tested |
| API (NestJS 12): config, database, encryption, `/healthz`, cleanup jobs | Built and tested |
| Backup and restore scripts (`ops/`) | Built; restore tested locally |
| Deployment: Docker Compose (API, admin panel, Postgres, Caddy), first-admin command, CI workflow: see [docs/DEPLOY.md](docs/DEPLOY.md) | Written; containers not yet built or run (needs Docker) |
| POS sync API (`/api/pos/*`): register, signatures, heartbeat, events, daily totals, commands, pairing, support tickets | Built; tested, including against the real POS sync client |
| POS licensing (`/api/pos/licence`, signed tokens, computer binding): see [docs/LICENSING.md](docs/LICENSING.md) | Built; tested end to end with the real POS |
| Live relay (`/api/pos/relay` WebSocket) | Later; the POS falls back to HTTP polling |
| Owner accounts: created by an admin from the store page, invite email, sign-in with optional 2FA, sessions, password reset: see [docs/OWNER_SIGN_IN_PLAN.md](docs/OWNER_SIGN_IN_PLAN.md) | Built and tested |
| Owner portal (`apps/owner`): sign-in, profile, security, and per café: today's sales, live orders, order history, café details, POS status (`/api/owner/stores/*`): see [docs/OWNER_PORTAL_PHASE1_PLAN.md](docs/OWNER_PORTAL_PHASE1_PLAN.md) | Built; checked in a browser with sample orders |
| Owner portal reports: sales by day, week or month, items, busy hours, the payments split asked live from the POS, CSV download and a print layout (`/api/owner/stores/:storeId/reports/*`): see [docs/OWNER_PORTAL_PHASE2_PLAN.md](docs/OWNER_PORTAL_PHASE2_PLAN.md) | Built and tested; checked in a browser with sample orders and a stand-in POS, not yet with a real POS. The all-outlets view, team and alerts are next |
| Admin API (`/api/admin/*`): sign-in with 2FA, roles, stores, owners, licences, tickets, admins, audit log | Built and tested |
| Admin panel (`apps/admin`) | Built on the dashboard starter; checked in a browser |

## Layout

```text
apps/api/          NestJS API. src/db/schema = tables, drizzle/ = SQL migrations
apps/admin/        Admin panel, from next-shadcn-dashboard-starter (see STARTER.md)
apps/owner/        Owner portal, from the same starter (see STARTER.md)
packages/shared/   Constants and Zod schemas used by the API and the web apps
ops/               docker-compose.yml, Caddyfile, env.example, backup.sh, restore.sh
docs/PLAN.md       Build plan
docs/DEPLOY.md     Putting Restrovia Cloud online
```

## Local setup

Needs Node.js 22.12 or later and PostgreSQL 16.

```bash
npm install
cp apps/api/.env.example apps/api/.env
```

In `apps/api/.env`, set `MASTER_KEY` (`openssl rand -base64 32`), `DATABASE_URL`, and the seed admin
email and password. Create the databases, then:

```bash
npm run build
npm run db:migrate
npm run db:seed
npm run dev:api
```

`http://localhost:4000/healthz` answers `{"status":"ok","database":"up"}`.

### Admin panel

```bash
npm run dev:admin
```

Open `http://localhost:3100`. It forwards `/api/admin/*` to the API at `API_INTERNAL_URL`
(default `http://127.0.0.1:4000`). Next.js fixes that address when it builds, so set
`API_INTERNAL_URL` before `next build`, not only before `next start`. In production Caddy sends
`/api/admin/*` to the API itself.

Sign in with the seed admin from `apps/api/.env`. The first sign-in of every admin sets up an
authenticator app (Google Authenticator, Microsoft Authenticator, 1Password); there is no way to
skip it. Roles: **super admin** (everything), **sales** (stores and licences), **support** (stores and
tickets). Every sign-in and change is written to the audit log.

### Owner portal

```bash
npm run dev:owner
```

Open `http://localhost:3200`. Like the admin panel, it forwards `/api/owner/*` to the API at
`API_INTERNAL_URL`. With `EMAIL_PROVIDER=outbox` (the default) and `NODE_ENV=development`, the API
prints each owner email, links included, to its log instead of sending it. To try the portal,
create an owner account from a store page in the admin panel and open the invite link from the API
log.

## Commands

| Command | Does |
| --- | --- |
| `npm run build` | Builds the shared package, the API, the admin panel and the owner portal |
| `npm run lint` | ESLint (shared, API, contract test) and oxlint (admin panel) |
| `npm test` | Unit and database tests (needs `TEST_DATABASE_URL`, a database ending in `_test`; it is wiped) |
| `npm run db:generate` | Writes a new migration after a schema change in `apps/api/src/db/schema` |
| `npm run db:migrate` | Applies pending migrations |
| `npm run db:seed` | Development data: two sample plans, a super admin, a sample café with orders |

## Contract test with the real POS

`tests/pos-contract/run.cjs` runs the POS's own compiled sync client (from a `restrovia-pos`
checkout) against a running API: registration, signed requests, order sync, daily totals,
heartbeat, a live report command and pairing. It uses a throwaway POS database. Usage is at the top
of the file; run it before every POS or API release.

## Database rules

- Migrations only add. Never drop, truncate or reset customer data to make a migration easier.
- After changing `apps/api/src/db/schema`, run `npm run db:generate` and commit the new SQL file.
  CI fails if the schema and the migrations differ.
- `admin_audit_log` is append-only; a database trigger rejects updates, deletes and truncation.
- Secrets: passwords use argon2id; API keys and 2FA secrets are encrypted with `MASTER_KEY`.
  Losing `MASTER_KEY` makes them unreadable, so keep an offline copy.

## Backups

`ops/backup.sh` writes an encrypted `pg_dump` (and can copy it off the server with rclone).
`ops/restore.sh` restores one into an empty database and refuses a database that has tables. Test a
restore every month.
