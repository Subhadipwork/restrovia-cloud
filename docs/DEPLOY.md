# Putting Restrovia Cloud online

This guide takes Restrovia Cloud from an empty server to a live service that Restrovia POS can use.
It runs everything on one Linux server with Docker Compose (`ops/docker-compose.yml`):

| Container | What it does | Reached at |
| --- | --- | --- |
| `caddy` | HTTPS certificates (Let's Encrypt) and routing | ports 80 and 443 |
| `api` | NestJS API for POS machines and the admin panel | `https://cloud.restrovia.shop` |
| `admin` | Admin panel | `https://admin.restrovia.shop` |
| `caddy` (files) | Restrovia POS installers and update files, from `ops/updates` | `https://updates.restrovia.shop` |
| `postgres` | PostgreSQL 16 database | the server itself only (`127.0.0.1:5432`) |

The API applies database migrations every time it starts, so a deploy never serves an old schema.

## What you need

- **A server**: Ubuntu 24.04 LTS, 2 vCPUs, 4 GB RAM, 40 GB disk, in a region near your cafés (for
  India: Mumbai or Bangalore). Building the admin panel needs about 2 GB of memory.
- **A domain** where you can add DNS records (the examples use `restrovia.shop`).
- **An authenticator app** (Google Authenticator, Microsoft Authenticator, 1Password…) for admin
  sign-in.
- **A password manager** for the four secrets below. Losing some of them breaks every POS.

| Secret | Losing it means |
| --- | --- |
| `MASTER_KEY` | Every POS's API key becomes unreadable; every café must register again |
| `LICENCE_SIGNING_KEY` | No more licences until you ship a POS release with a new public key |
| `POSTGRES_PASSWORD` | You can reset it on the server, then update `ops/.env` and the backup settings |
| Backup passphrase | Every backup is unreadable |

Examples below use `cloud.restrovia.shop` and `admin.restrovia.shop`; replace them with your names.

## 1. Prepare the server

Sign in over SSH as a user with `sudo`, then:

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y git ufw postgresql-client-16
```

Allow only SSH and web traffic. Postgres is bound to `127.0.0.1`, so it stays private even though
Docker manages its own firewall rules.

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

Install Docker with its official script, and let your user run it:

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"
```

Sign out and back in so the group change applies, then check `docker compose version` works.

If the server has less than 4 GB of memory, add swap so the admin panel build is not killed:

```bash
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

## 2. Point the domain at the server

At your DNS provider, add three **A records** to the server's public IP address:

| Name | Type | Value |
| --- | --- | --- |
| `cloud` | A | server IP |
| `admin` | A | server IP |
| `updates` | A | server IP |

Wait until `getent hosts cloud.restrovia.shop admin.restrovia.shop updates.restrovia.shop` on the server
prints its IP for every name. Caddy can only get certificates after that.

## 3. Get the code

```bash
sudo mkdir -p /opt/restrovia-cloud && sudo chown "$USER" /opt/restrovia-cloud
git clone https://github.com/Subhadipwork/restrovia-cloud.git /opt/restrovia-cloud
cd /opt/restrovia-cloud
```

Every command from here on runs in `/opt/restrovia-cloud`. A short alias saves typing:

```bash
echo "alias dc='docker compose -f ops/docker-compose.yml --env-file ops/.env'" >> ~/.bashrc
source ~/.bashrc
```

## 4. Write the settings file

```bash
cp ops/env.example ops/.env
chmod 600 ops/.env
```

Generate the database password and the master key, and add them to the file:

```bash
sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(openssl rand -hex 24)|" ops/.env
sed -i "s|^MASTER_KEY=.*|MASTER_KEY=$(openssl rand -base64 32)|" ops/.env
```

Open `ops/.env` (`nano ops/.env`) and set `API_HOST`, `ADMIN_HOST`, `UPDATES_HOST` and
`ACME_EMAIL`.

### The licence signing key

Restrovia POS only accepts licences signed by the private key whose public key is built into the
app (`LICENCE_PUBLIC_KEYS` in `shared/restrovia-licence.ts` in restrovia-pos). Choose one:

**A. Generate a new production key (recommended).** The key is created on the server and never
exists on a laptop. Then put its public key into the POS before the release that uses this server
(step 9).

```bash
docker run --rm node:22-slim node -e "
const k = require('crypto').generateKeyPairSync('ed25519');
console.log('LICENCE_SIGNING_KEY=' + k.privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'));
console.error('Public key for the POS: ' + k.publicKey.export({ type: 'spki', format: 'der' }).toString('base64'));
" > /tmp/licence-key && sed -i '/^LICENCE_SIGNING_KEY=/d' ops/.env && cat /tmp/licence-key >> ops/.env && shred -u /tmp/licence-key
```

The public key printed on screen is not secret; copy it for step 9. Keep `LICENCE_KEY_ID=k1` and
replace the `k1` value in the POS with this public key. That is safe while no café runs a POS
release with licensing switched on; after that, add a new key id instead (see `docs/LICENSING.md`).

**B. Reuse the development key.** Copy the `LICENCE_SIGNING_KEY` line from `apps/api/.env` on your
Mac into `ops/.env` on the server, over SSH. The POS already trusts it as `k1`. Only do this if that
key has never left your Mac.

Never send the private key by chat or email.

Finally, copy the whole `ops/.env` into your password manager.

## 5. Start the stack

```bash
dc up -d --build
```

The first build takes several minutes. Then check every container is running and the API started:

```bash
dc ps
dc logs api | tail -5
```

The API log should show `Migrations applied` and `Restrovia Cloud API listening on :4000`. Check it
from outside, over HTTPS:

```bash
curl https://cloud.restrovia.shop/healthz
```

It answers `{"status":"ok","database":"up"}`.

## 6. Create the first admin

The development seed never runs in production. This one-time command creates the first super admin
and refuses once any admin exists:

```bash
read -rp 'Admin email: ' ADMIN_EMAIL
read -rsp 'Admin password (12+ characters): ' ADMIN_PASSWORD; echo
dc exec -e ADMIN_EMAIL="$ADMIN_EMAIL" -e ADMIN_PASSWORD="$ADMIN_PASSWORD" api node dist/db/create-admin.js
unset ADMIN_PASSWORD
```

Open `https://admin.restrovia.shop`, sign in, and scan the QR code with your authenticator app. Every
sign-in after that needs a 6-digit code. Add colleagues on the **Admins** page (roles: super admin,
support, sales); each sets up their own authenticator at first sign-in.

## 7. Create the plans

On the **Plans** page, add the plans you sell, with real prices (for example monthly and yearly).
A new café gets a 30-day trial automatically; you activate a paid plan on its store page.

## 8. Back up every night

Backups are encrypted `pg_dump` files written by `ops/backup.sh`. Create a settings file only root
can read:

```bash
sudo install -m 600 /dev/null /etc/restrovia-backup.env
sudo nano /etc/restrovia-backup.env
```

```bash
DATABASE_URL=postgres://restrovia:<POSTGRES_PASSWORD>@127.0.0.1:5432/restrovia_cloud
BACKUP_PASSPHRASE=<a long passphrase, also in your password manager>
BACKUP_DIR=/var/backups/restrovia
# Optional, after setting up rclone (https://rclone.org): copy every backup off the server.
# BACKUP_REMOTE=b2:restrovia-backups
```

Run it once by hand, then every night at 02:15 server time:

```bash
sudo sh -c 'set -a; . /etc/restrovia-backup.env; /opt/restrovia-cloud/ops/backup.sh'
echo '15 2 * * * root set -a; . /etc/restrovia-backup.env; /opt/restrovia-cloud/ops/backup.sh >> /var/log/restrovia-backup.log 2>&1' \
  | sudo tee /etc/cron.d/restrovia-backup
```

A backup on the same server is lost with the server: set `BACKUP_REMOTE`. Test a restore every
month into a scratch database (`ops/restore.sh` refuses a database that has tables):

```bash
dc exec postgres createdb -U restrovia restore_test
sudo sh -c 'set -a; . /etc/restrovia-backup.env; /opt/restrovia-cloud/ops/restore.sh "$(ls -t /var/backups/restrovia/*.enc | head -1)" "${DATABASE_URL%/*}/restore_test"'
dc exec postgres dropdb -U restrovia restore_test
```

## 9. Point Restrovia POS at the server

These changes are in the restrovia-pos repository. Release them in two steps, so a mistake can never
stop billing:

1. **Connect, licensing still off.** In `shared/restrovia-brand.ts`, set
   `BRAND_CLOUD_SERVER_URL = 'https://cloud.restrovia.shop/'` and the real
   `BRAND_SUPPORT_WHATSAPP_URL`. If you made a new key in step 4, put its public key as `k1` in
   `LICENCE_PUBLIC_KEYS` in `shared/restrovia-licence.ts`. Build installers
   (`brand/scripts/build-restrovia.sh --win`), install on one café, and check it appears on the
   admin panel's **Stores** page with its store code.
2. **Switch licensing on.** Once cafés register and their devices show as seen, set
   `BRAND_LICENCE_ENFORCED = true` and release. Every café gets a 30-day trial at its first check-in
   (see `docs/LICENSING.md`).

The POS only accepts an `https://` cloud address (plain `http://` works only for local development).

## 10. Publish POS updates

Restrovia POS asks `https://updates.restrovia.shop/` for new versions (`publish.url` in
`brand/builder.js` in restrovia-pos). Caddy serves that site from `ops/updates` on the server; the
folder holds the installers and the `latest*.yml` files that announce a version.

1. In restrovia-pos, give the release a higher `version` in `package.json` than the cafés run: the
   POS only offers an update to a higher version.
2. Build it: `brand/scripts/build-restrovia.sh --win` (and `--mac`).
3. Upload it from the same machine. Installers go first and the `latest*.yml` files last:

   ```bash
   RESTROVIA_UPDATES_TARGET=you@server:/opt/restrovia-cloud/ops/updates brand/scripts/publish-update.sh
   ```

4. Check it is live: `curl https://updates.restrovia.shop/latest.yml` (Windows) or
   `latest-mac.yml` (Mac) shows the new version.

Cafés see the new version under **Settings → Software Updates** and choose when to install it.
Mac builds must be signed with an Apple Developer ID to install updates themselves; until then a
Mac café sees the new version but installs it from the `.dmg` by hand. Older versions stay in the
folder, so a café can always be given a previous installer.

## Updating the server

Back up first, then pull and rebuild. Migrations run when the new API starts.

```bash
sudo sh -c 'set -a; . /etc/restrovia-backup.env; /opt/restrovia-cloud/ops/backup.sh'
git pull
dc up -d --build
dc logs api | tail -5
```

## When something goes wrong

| What you see | Cause and fix |
| --- | --- |
| `dc up` stops with `set LICENCE_SIGNING_KEY` (or another name) | That setting is empty in `ops/.env` (servers set up before the update site need `UPDATES_HOST`) |
| POS **Software Updates** says "Offline" while the internet works | The update site is not reachable: check its DNS record and `curl https://updates.restrovia.shop/latest-mac.yml` |
| API keeps restarting; `dc logs api` shows `Invalid environment` | A value in `ops/.env` has the wrong format; the log names it |
| Browser shows a certificate error | DNS does not point at the server yet, or ports 80/443 are closed; `dc logs caddy` says which |
| `https://cloud.restrovia.shop/api/admin/...` answers 404 | Expected: the admin API is only served on the admin site |
| Admin build stops with `Killed` | Not enough memory; add swap (step 1) |
| POS shows "Cloud server URL must use HTTPS" | `BRAND_CLOUD_SERVER_URL` starts with `http://` |
| POS licence check fails with `machine_mismatch` | The licence belongs to another computer; use **Reset binding** on the store page |
