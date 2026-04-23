#!/usr/bin/env bash
# Supabase DB backup — run manually (weekly is a sensible cadence).
#
# Supabase Pro plan: daily auto-backups with 7-day retention. If you're
# on Pro, this script is belt-and-suspenders. If you're on Free, this
# IS your backup.
#
# Usage:
#   1. Get your DB password from Supabase Dashboard →
#        Project Settings → Database → Connection string → [Reset password]
#        (save the generated password in 1Password; Supabase doesn't
#         show it again)
#   2. Export it once per shell session:
#        export SUPABASE_DB_PASSWORD='your-password-here'
#   3. Run:
#        ./scripts/backup-supabase.sh
#
# Output:
#   ./backups/residata-YYYY-MM-DD-HHMM.sql.gz
#
# Verify the dump is valid:
#   gunzip -c backups/residata-....sql.gz | head
#
# Restore (TO A FRESH DB — never to production unless you know what you're doing):
#   gunzip -c backups/residata-....sql.gz | psql "$NEW_DB_URL"

set -euo pipefail

PROJECT_REF="mtclsrswxtjseewyrcbx"
DB_HOST="db.${PROJECT_REF}.supabase.co"
DB_PORT="5432"
DB_NAME="postgres"
DB_USER="postgres"
BACKUP_DIR="$(dirname "$0")/../backups"
TIMESTAMP="$(date +%Y-%m-%d-%H%M)"
OUTFILE="${BACKUP_DIR}/residata-${TIMESTAMP}.sql.gz"

if [ -z "${SUPABASE_DB_PASSWORD:-}" ]; then
  echo "ERROR: SUPABASE_DB_PASSWORD not set" >&2
  echo "  Run: export SUPABASE_DB_PASSWORD='...'" >&2
  echo "  (get password from Supabase Dash → Project Settings → Database → Connection string → Reset password)" >&2
  exit 1
fi

if ! command -v pg_dump >/dev/null 2>&1; then
  echo "ERROR: pg_dump not installed" >&2
  echo "  macOS: brew install postgresql@16" >&2
  echo "  Linux: apt-get install postgresql-client-16" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"

echo "Starting backup → $OUTFILE"
PGPASSWORD="$SUPABASE_DB_PASSWORD" pg_dump \
  --host="$DB_HOST" \
  --port="$DB_PORT" \
  --username="$DB_USER" \
  --dbname="$DB_NAME" \
  --no-owner \
  --no-privileges \
  --format=plain \
  --clean --if-exists \
  | gzip -9 > "$OUTFILE"

size=$(du -h "$OUTFILE" | cut -f1)
echo "Done. File size: $size"
echo ""
echo "TODO: move this to off-site storage. Options:"
echo "  - Upload to a private Google Drive folder"
echo "  - Copy to an encrypted USB drive"
echo "  - Upload to iCloud Drive / Dropbox (with device encryption)"
echo ""
echo "Never commit backups to git."
