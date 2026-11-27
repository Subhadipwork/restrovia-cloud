# Restrovia Cloud on a shared server, without Docker

This guide runs Restrovia Cloud on a Linux server that already serves other sites through its own
Caddy and PostgreSQL. The apps run under PM2 as the `deploy` user, and every push to the
`production` branch deploys itself. [DEPLOY.md](DEPLOY.md) covers the Docker Compose setup for a
server of its own.

| PM2 app | What it does | Listens on | Site |
| --- | --- | --- | --- |
| `restrovia-api` | NestJS API for POS machines, the admin panel and the owner portal | `127.0.0.1:4000` | `cloud.restrovia.in` |
| `restrovia-admin` | Admin panel | `127.0.0.1:3100` | `admin.restrovia.in` |
| `restrovia-owner` | Owner portal | `127.0.0.1:3200` | `app.restrovia.in` |
| (Caddy, files) | POS installers and update feeds from `/srv/restrovia/updates` | none | `updates.restrovia.in` |

The database is `restrovia_cloud` in the server's PostgreSQL, owned by its own `restrovia` role.

Server layout, owned by `deploy`:

```text
/srv/restrovia/
  cloud/                 this repository, on the production branch
  env/cloud.env          settings (chmod 600)
  backups/pre-deploy/    database dump taken before each deploy's migrations (last 5)
  updates/               POS update files
  .cloud-last-release    last commit that passed its health checks
```

## 1. One-time server setup

Run as root. The server needs Node.js 22.12 or later for `deploy`, PM2, Caddy 2.7 or later, and
PostgreSQL 16 or later with its client tools.

```bash
sudo -u deploy bash -lc 'node -v; pm2 -v'
caddy version
```

### Folders and the code

```bash
install -d -o deploy -g deploy -m 755 /srv/restrovia /srv/restrovia/updates
install -d -o deploy -g deploy -m 700 /srv/restrovia/env /srv/restrovia/backups
sudo -u deploy git clone -b production https://github.com/Subhadipwork/restrovia-cloud.git /srv/restrovia/cloud
```

### Database

Each project's role can connect only to its own database:

```bash
PW="$(openssl rand -hex 24)"
sudo -u postgres psql -v ON_ERROR_STOP=1 -v pw="$PW" <<'SQL'
CREATE ROLE restrovia LOGIN PASSWORD :'pw';
CREATE DATABASE restrovia_cloud OWNER restrovia;
REVOKE CONNECT ON DATABASE restrovia_cloud FROM PUBLIC;
\c restrovia_cloud
CREATE EXTENSION IF NOT EXISTS citext;
SQL
echo "DATABASE_URL=postgres://restrovia:$PW@127.0.0.1:5432/restrovia_cloud"; unset PW
```

Keep the printed `DATABASE_URL` for `cloud.env`. Then close each other database on the server to
roles other than its own (for a database `scanping` owned by `scanping`):

```bash
sudo -u postgres psql -c 'REVOKE CONNECT ON DATABASE scanping FROM PUBLIC; GRANT CONNECT ON DATABASE scanping TO scanping;'
```

### Caddy

The sites live in `/etc/caddy/sites/`. The main `/etc/caddy/Caddyfile` must start with a global
options block that trusts Cloudflare, so `{client_ip}` is the visitor's address, and end with an
import of the sites folder:

```caddyfile
{
	servers {
		trusted_proxies static 173.245.48.0/20 103.21.244.0/22 103.22.200.0/22 103.31.4.0/22 141.101.64.0/18 108.162.192.0/18 190.93.240.0/20 188.114.96.0/20 197.234.240.0/22 198.41.128.0/17 162.158.0.0/15 104.16.0.0/13 104.24.0.0/14 172.64.0.0/13 131.0.72.0/22 2400:cb00::/32 2606:4700::/32 2803:f800::/32 2405:b500::/32 2405:8100::/32 2a06:98c0::/29 2c0f:f248::/32
		client_ip_headers CF-Connecting-IP
	}
}

# ... the server's other sites ...

import /etc/caddy/sites/*.caddy
```

The ranges come from <https://www.cloudflare.com/ips-v4> and `/ips-v6`; update them when Cloudflare
changes them. Install the Restrovia Cloud sites and reload:

```bash
install -d /etc/caddy/sites
cp /srv/restrovia/cloud/ops/restrovia-cloud.caddy /etc/caddy/sites/
install -d -o caddy -g caddy /var/log/caddy
cd / && sudo -u caddy caddy validate --config /etc/caddy/Caddyfile && systemctl reload caddy
```

Validate as the `caddy` user. Run as root, `caddy validate` creates any new log file owned by
root, and the reload then fails because Caddy cannot open it.

### DNS

In Cloudflare, point `cloud`, `admin`, `app` and `updates` at the server, proxied, with SSL/TLS set to
**Full (strict)**. Allow only ports 22, 80 and 443 in the firewall.

## 2. Settings

Create `/srv/restrovia/env/cloud.env` as `deploy` (`chmod 600`). PM2 passes it to the API with
`node --env-file`, and the deploy reads `DATABASE_URL` and `MAPBOX_PUBLIC_TOKEN` from it.

```bash
DATABASE_URL=postgres://restrovia:<password>@127.0.0.1:5432/restrovia_cloud
# openssl rand -base64 32. Encrypts POS API keys; losing it breaks every POS.
MASTER_KEY=
LICENCE_SIGNING_KEY=
LICENCE_KEY_ID=k1
EMAIL_PROVIDER=resend
EMAIL_API_KEY=
EMAIL_FROM=Restrovia <no-reply@restrovia.in>
OWNER_APP_URL=https://app.restrovia.in
API_PUBLIC_URL=https://cloud.restrovia.in
ADMIN_APP_URL=https://admin.restrovia.in
PUBLIC_FORM_ORIGINS=https://restrovia.in,https://www.restrovia.in
LEADS_NOTIFY_EMAIL=
CHATWOOT_WEBHOOK_TOKEN=
WHATSAPP_PROVIDER=outbox
WHATSAPP_TOKEN=
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_LEAD_OFFER_TEMPLATE=restrovia_lead_offer
WHATSAPP_LEAD_OFFER_IMAGE_URL=
# Public Mapbox token (pk.) for the admin lead map, built into the admin panel.
MAPBOX_PUBLIC_TOKEN=
```

Generate the production licence key on the server, so the private key never exists anywhere else.
The command appends it to the file and prints the public key, which goes into
`LICENCE_PUBLIC_KEYS` in restrovia-pos (see [LICENSING.md](LICENSING.md)):

```bash
sudo -u deploy node -e "
const k = require('crypto').generateKeyPairSync('ed25519');
console.log('LICENCE_SIGNING_KEY=' + k.privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'));
console.error('Public key for the POS: ' + k.publicKey.export({ type: 'spki', format: 'der' }).toString('base64'));
" >> /srv/restrovia/env/cloud.env
```

Delete the empty `LICENCE_SIGNING_KEY=` line above it, then copy the whole file into your password
manager. In production the deploy refuses settings without a licence key, with `outbox` email, or
with app addresses that are not `https://`.

## 3. First release

As `deploy`:

```bash
/srv/restrovia/cloud/ops/deploy.sh --first
pm2 save
```

As root, once, so PM2 starts the apps after a reboot (skip if `pm2-deploy.service` already exists):

```bash
env PATH=$PATH:/usr/bin pm2 startup systemd -u deploy --hp /home/deploy
```

Check it from outside: `curl https://cloud.restrovia.in/healthz` answers
`{"status":"ok","database":"up"}`. Then create the first super admin, sign in at
`https://admin.restrovia.in` and add the plans (steps 6 and 7 of [DEPLOY.md](DEPLOY.md)):

```bash
cd /srv/restrovia/cloud/apps/api
read -rp 'Admin email: ' ADMIN_EMAIL
read -rsp 'Admin password (12+ characters): ' ADMIN_PASSWORD; echo
ADMIN_EMAIL="$ADMIN_EMAIL" ADMIN_PASSWORD="$ADMIN_PASSWORD" node --env-file=/srv/restrovia/env/cloud.env dist/db/create-admin.js
unset ADMIN_PASSWORD
```

## 4. Later releases

```bash
/srv/restrovia/cloud/ops/deploy.sh             # api, admin and owner
/srv/restrovia/cloud/ops/deploy.sh admin       # one app
/srv/restrovia/cloud/ops/deploy.sh --rollback  # the last good release
/srv/restrovia/cloud/ops/deploy.sh --check     # only check env/cloud.env
```

What a deploy guards against:

- **A bad settings file.** After building, `cloud.env` is checked with the API's own settings check
  before anything is migrated or restarted. If it fails, the running version keeps serving.
- **A migration gone wrong.** The database is dumped to `backups/pre-deploy/` before migrations run.
  Restore one with `pg_restore --clean --no-owner -d <DATABASE_URL> <file>`.
- **A release that will not come up.** Each deployed app must pass a health check within a minute:
  the API's `/healthz` returns 200 (which also checks the database), and the admin and owner sign-in
  pages answer without a server error. If one fails, the deploy rolls back to the last good release
  and still exits non-zero, so the Action shows red. `AUTO_ROLLBACK=0` turns that off.

Rollback does not undo migrations: keep them additive, so an older release runs on a newer schema.
Builds run at low CPU priority (`nice`) so the server's other sites keep answering, and
`npm ci` runs only when `package-lock.json` changed. The admin and owner apps are rebuilt in place,
so they can answer slowly for a moment while a build finishes.

## 5. Automatic deploys

`.github/workflows/deploy.yml` runs the CI checks on every push to `production`, then connects to
the server as `deploy` and runs `ops/deploy.sh` for the apps that changed. The flow is a PR into
`main`, then a PR from `main` into `production`.

One-time setup, on the server as `deploy`:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/restrovia_actions -N "" -C "restrovia-actions"
cat ~/.ssh/restrovia_actions.pub >> ~/.ssh/authorized_keys
cat ~/.ssh/restrovia_actions            # private key: GitHub secret SSH_PRIVATE_KEY
ssh-keyscan -t ed25519 <server-ip>      # GitHub secret SSH_KNOWN_HOSTS
rm ~/.ssh/restrovia_actions ~/.ssh/restrovia_actions.pub
```

Repository secrets (Settings → Secrets and variables → Actions): `SSH_HOST`, `SSH_USER` (`deploy`),
`SSH_PRIVATE_KEY`, `SSH_KNOWN_HOSTS`. Run a deploy by hand from the Actions tab with **Run workflow**.

## 6. Backups

`ops/backup.sh` writes an encrypted dump. Create `/etc/restrovia-backup.env` (`chmod 600`, root only):

```bash
DATABASE_URL=postgres://restrovia:<password>@127.0.0.1:5432/restrovia_cloud
BACKUP_PASSPHRASE=<a long passphrase, also in your password manager>
BACKUP_DIR=/srv/restrovia/backups
# BACKUP_REMOTE=r2:restrovia-backups   # after setting up rclone: a copy off the server
```

Run it every night at 02:15:

```bash
echo '15 2 * * * root set -a; . /etc/restrovia-backup.env; /srv/restrovia/cloud/ops/backup.sh >> /var/log/restrovia-backup.log 2>&1' > /etc/cron.d/restrovia-backup
```

A backup on the same server is lost with the server: set `BACKUP_REMOTE`, and test a restore into a
scratch database every month.

## 7. POS update files

Upload installers and `latest*.yml` from the POS repo with
`RESTROVIA_UPDATES_TARGET=deploy@<server>:/srv/restrovia/updates brand/scripts/publish-update.sh`,
then check `curl https://updates.restrovia.in/latest.yml`.
