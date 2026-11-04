#!/usr/bin/env bash
# Nightly encrypted database backup. Run from cron on the server.
#   DATABASE_URL       database to back up
#   BACKUP_PASSPHRASE  encryption passphrase (keep a copy offline; without it backups are unreadable)
#   BACKUP_DIR         local folder for backups (default: ./backups)
#   BACKUP_REMOTE      optional rclone destination, e.g. "b2:restrovia-backups"
#   KEEP_DAYS          how long to keep local backups (default: 30)
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is not set}"
: "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE is not set}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
KEEP_DAYS="${KEEP_DAYS:-30}"

mkdir -p "$BACKUP_DIR"
file="$BACKUP_DIR/restrovia-cloud-$(date -u +%Y%m%dT%H%M%SZ).dump.enc"
tmp="$file.partial"

pg_dump --format=custom --no-owner "$DATABASE_URL" \
  | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass env:BACKUP_PASSPHRASE \
  > "$tmp"
mv "$tmp" "$file"
echo "Backup written: $file ($(du -h "$file" | cut -f1))"

if [[ -n "${BACKUP_REMOTE:-}" ]]; then
  rclone copy "$file" "$BACKUP_REMOTE"
  echo "Copied to $BACKUP_REMOTE"
fi

find "$BACKUP_DIR" -name 'restrovia-cloud-*.dump.enc' -mtime "+$KEEP_DAYS" -print -delete
