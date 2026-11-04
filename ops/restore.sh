#!/usr/bin/env bash
# Restores an encrypted backup into an EMPTY database. Refuses to touch a database that has tables.
#   usage: BACKUP_PASSPHRASE=... ops/restore.sh <backup.dump.enc> <target DATABASE_URL>
set -euo pipefail

file="${1:?usage: restore.sh <backup.dump.enc> <target DATABASE_URL>}"
target="${2:?usage: restore.sh <backup.dump.enc> <target DATABASE_URL>}"
: "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE is not set}"

tables=$(psql "$target" -Atc "select count(*) from information_schema.tables where table_schema = 'public'")
if [[ "$tables" != "0" ]]; then
  echo "Refusing to restore: the target database already has $tables tables." >&2
  exit 1
fi

openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:BACKUP_PASSPHRASE -in "$file" \
  | pg_restore --no-owner --exit-on-error --dbname="$target"
echo "Restored $file"
psql "$target" -Atc "select 'stores: ' || count(*) from stores"
