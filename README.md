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
| Docker Compose, Caddy, CI workflow | Written; not yet run (needs Docker / GitHub) |
| POS sync API (`/api/pos/*`): register, signatures, heartbeat, events, daily totals, commands, pairing, support tickets | Built; tested, including against the real POS sync client |
| Live relay (`/api/pos/relay` WebSocket) | Later; the POS falls back to HTTP polling |
| Owner portal (`apps/owner`) | Starter copied, not adapted (phase 4) |
| Admin panel (`apps/admin`) | Starter copied, not adapted (phase 5) |

## Layout

```text
apps/api/          NestJS API. src/db/schema = tables, drizzle/ = SQL migrations
apps/admin/        Admin panel, from next-shadcn-dashboard-starter (see STARTER.md)
apps/owner/        Owner portal, from the same starter (see STARTER.md)
packages/shared/   Constants and Zod schemas used by the API and the web apps
ops/               docker-compose.yml, Caddyfile, backup.sh, restore.sh
docs/PLAN.md       Build plan
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

## Commands

| Command | Does |
| --- | --- |
| `npm run build` | Builds the shared package and the API |
| `npm run lint` | ESLint for the shared package and the API |
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
