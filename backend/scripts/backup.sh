#!/bin/sh
# Logical backup of the database: a compressed pg_dump with a timestamp.
#   DATABASE_URL=... ./scripts/backup.sh [output-dir]
# Run it on a schedule AND keep copies off the database host. A backup you have
# never restored is a hope, not a backup: see scripts/restore-check.sh.
set -eu
: "${DATABASE_URL:?DATABASE_URL is required}"
OUT_DIR="${1:-./backups}"
mkdir -p "$OUT_DIR"
FILE="$OUT_DIR/dhaka-tesla-pool-$(date -u +%Y%m%dT%H%M%SZ).sql.gz"
pg_dump --no-owner --no-privileges "$DATABASE_URL" | gzip > "$FILE"
echo "$FILE"
