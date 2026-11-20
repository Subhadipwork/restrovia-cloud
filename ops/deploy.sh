#!/usr/bin/env bash
#
# Build and (re)start Restrovia Cloud on a server without Docker (docs/DEPLOY_VPS.md).
#
#   ./deploy.sh                    api, admin and owner
#   ./deploy.sh api admin          only the named apps
#   DEPLOY_BRANCH=main ./deploy.sh deploy another branch (default: production)
#   ./deploy.sh --first            first release: no previous release or database to back up
#   ./deploy.sh --rollback         check out the last good release and redeploy it
#   ./deploy.sh --check            only check env/cloud.env against the built API; no deploy
#
# Safety:
# - The env file is checked with the API's own settings check after building and BEFORE
#   migrating or restarting anything. A bad env stops the deploy while the old version serves.
# - The database is dumped before migrations run (backups/pre-deploy, last 5 kept).
# - After restarting, each deployed app must pass a health check. If one fails, the deploy
#   rolls back to the last good release by itself (AUTO_ROLLBACK=0 turns that off) and still
#   exits non-zero.
# - Builds run at low CPU priority so other sites on the server keep answering.

set -euo pipefail

# Bash reads a script as it runs; the braces make it read all of it first, because the git
# reset below may rewrite this file mid-deploy.
{

SELF="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"

ROOT="${RESTROVIA_ROOT:-/srv/restrovia}"
REPO="$ROOT/cloud"
ENV_FILE="$ROOT/env/cloud.env"
BRANCH="${DEPLOY_BRANCH:-production}"
STATE="$ROOT/.cloud-last-release"
PRE_DEPLOY_DIR="$ROOT/backups/pre-deploy"
NICE="nice -n 10"

FIRST=0; ROLLBACK=0; CHECK=0; APPS=()
for a in "$@"; do
  case "$a" in
    --first) FIRST=1 ;;
    --rollback) ROLLBACK=1 ;;
    --check) CHECK=1 ;;
    api|admin|owner) APPS+=("$a") ;;
    *) echo "unknown argument: $a" >&2; exit 1 ;;
  esac
done
if [ ${#APPS[@]} -eq 0 ]; then APPS=(api admin owner); fi
want() { printf '%s\n' "${APPS[@]}" | grep -qx "$1"; }

# One value from the env file, without sourcing it (values such as EMAIL_FROM contain < >).
env_value() { grep -E "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2- | sed -E 's/^"(.*)"$/\1/'; }

# Runs the built API's settings check the way PM2 starts the API (ops/ecosystem.config.cjs).
check_env() {
  local js="$REPO/apps/api/dist/config/check-env.js"
  if [ ! -f "$js" ]; then
    echo "(this release has no env check; skipped)"
    return 0
  fi
  ( cd "$REPO/apps/api" && env -i PATH="$PATH" HOME="$HOME" NODE_ENV=production PORT=4000 \
      HOST=127.0.0.1 node --env-file="$ENV_FILE" "$js" )
}

[ -f "$ENV_FILE" ] || { echo "missing $ENV_FILE" >&2; exit 1; }

if [ "$CHECK" = 1 ]; then
  check_env
  exit $?
fi

# One deploy at a time: a push during a running build waits its turn.
exec 9>"$ROOT/.cloud-deploy.lock"
flock 9

cd "$REPO"
if [ "$ROLLBACK" = 1 ]; then
  [ -f "$STATE" ] || { echo "no previous release recorded" >&2; exit 1; }
  TARGET="$(cat "$STATE")"
  echo "==> rolling back to $TARGET"
  git checkout --detach "$TARGET"
elif [ -z "${DEPLOY_UPDATED:-}" ]; then
  echo "==> updating to origin/$BRANCH"
  git fetch origin "$BRANCH"
  git checkout "$BRANCH"
  git reset --hard "origin/$BRANCH"
  # Carry on with this release's own copy of the script, so changes to it apply now.
  flock -u 9
  DEPLOY_UPDATED=1 exec "$REPO/ops/deploy.sh" "$@"
fi
echo "==> release $(git rev-parse --short HEAD): $(git log -1 --format=%s)"

# npm ci empties node_modules, which the running apps still load from, so it runs only when the
# lockfile changed since the last install.
LOCK_HASH="$(sha256sum package-lock.json | cut -d' ' -f1)"
if [ ! -d node_modules ] || [ "$(cat "$ROOT/.cloud-lock-hash" 2>/dev/null)" != "$LOCK_HASH" ]; then
  echo "==> installing dependencies"
  $NICE npm ci --no-audit --no-fund
  echo "$LOCK_HASH" > "$ROOT/.cloud-lock-hash"
else
  echo "==> dependencies unchanged"
fi

echo "==> building"
$NICE npm run build -w @restrovia/shared
if want api; then $NICE npm run build -w @restrovia/api; fi
# Next.js fixes the API address and the public Mapbox token when it builds.
export API_INTERNAL_URL=http://127.0.0.1:4000 NEXT_TELEMETRY_DISABLED=1
NEXT_PUBLIC_MAPBOX_TOKEN="$(env_value MAPBOX_PUBLIC_TOKEN || true)"
export NEXT_PUBLIC_MAPBOX_TOKEN
if want admin; then $NICE npm run build -w @restrovia/admin; fi
if want owner; then $NICE npm run build -w @restrovia/owner; fi

if want api; then
  echo "==> checking $ENV_FILE (before migrating or restarting anything)"
  if ! check_env; then
    echo "deploy STOPPED: $ENV_FILE would not run this release." >&2
    echo "Nothing was migrated or restarted; the running version is untouched." >&2
    echo "Fix the env, check it with: $SELF --check, and deploy again." >&2
    exit 1
  fi

  if [ "$FIRST" = 0 ]; then
    echo "==> backing up the database before migrating"
    install -d -m 700 "$PRE_DEPLOY_DIR"
    dump="$PRE_DEPLOY_DIR/restrovia-cloud-$(date -u +%Y%m%dT%H%M%SZ)-$(git rev-parse --short HEAD).dump"
    ( umask 077; pg_dump --format=custom --no-owner "$(env_value DATABASE_URL)" > "$dump.partial" )
    mv "$dump.partial" "$dump"
    ls -1t "$PRE_DEPLOY_DIR"/restrovia-cloud-*.dump | tail -n +6 | xargs -r rm -f
  fi

  echo "==> applying migrations"
  ( cd apps/api && node --env-file="$ENV_FILE" dist/db/migrate.js )
fi

echo "==> restarting"
# startOrReload re-reads the process file, so a changed port or setting applies.
for a in "${APPS[@]}"; do
  pm2 startOrReload "$REPO/ops/ecosystem.config.cjs" --only "restrovia-$a" --update-env
done
pm2 save

# Each deployed app must answer within a minute: the API with a 200 from /healthz (which also
# checks the database), the admin and owner apps with any response that is not a server error.
check_health() {
  local app url code ok
  for app in "${APPS[@]}"; do
    case "$app" in
      api) url="http://127.0.0.1:4000/healthz" ;;
      admin) url="http://127.0.0.1:3100/sign-in" ;;
      owner) url="http://127.0.0.1:3200/sign-in" ;;
    esac
    ok=0; code=""
    for _ in $(seq 1 20); do
      code="$(curl -s -o /dev/null -m 10 -w '%{http_code}' "$url" || true)"
      if [ "$app" = api ]; then
        [ "$code" = 200 ] && { ok=1; break; }
      elif [ "$code" -ge 200 ] 2>/dev/null && [ "$code" -lt 500 ]; then
        ok=1; break
      fi
      sleep 3
    done
    if [ "$ok" = 1 ]; then
      echo "$app ok"
    else
      echo "$app health FAILED (last status: ${code:-none}; see: pm2 logs restrovia-$app)" >&2
      return 1
    fi
  done
}

echo "==> health check"
if ! check_health; then
  HEAD_NOW="$(git -C "$REPO" rev-parse HEAD)"
  if [ "$ROLLBACK" = 0 ] && [ "${AUTO_ROLLBACK:-1}" = 1 ] \
     && [ -f "$STATE" ] && [ "$(cat "$STATE")" != "$HEAD_NOW" ]; then
    echo "==> rolling back automatically to the last good release ($(cat "$STATE"))" >&2
    flock -u 9
    if "$SELF" --rollback "${APPS[@]}"; then
      echo "Rolled back: the last good release is serving. This release ($HEAD_NOW)" >&2
      echo "did NOT go live; fix it and deploy again." >&2
    else
      echo "ROLLBACK FAILED as well: the service needs attention now (pm2 logs)." >&2
    fi
  else
    echo "No automatic rollback (already rolling back, AUTO_ROLLBACK=0, or no other" >&2
    echo "good release recorded). The service needs attention now (pm2 logs)." >&2
  fi
  exit 1
fi

# Only a release that passed its health checks becomes the rollback target.
git -C "$REPO" rev-parse HEAD > "$STATE"
echo "done"
exit 0
}
