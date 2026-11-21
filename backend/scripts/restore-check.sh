#!/bin/sh
# Proves a backup is usable: restores it into a throwaway database and checks
# that the core tables came back.
#   ./scripts/restore-check.sh backups/<file>.sql.gz  postgresql://user:pass@host:5432/postgres
set -eu
FILE="${1:?backup file}"
ADMIN_URL="${2:?admin connection URL (to the maintenance database)}"
DB="restore_check_$$"
psql "$ADMIN_URL" -qc "CREATE DATABASE $DB"
TARGET="$(echo "$ADMIN_URL" | sed "s#/[^/]*\$#/$DB#")"
trap 'psql "$ADMIN_URL" -qc "DROP DATABASE IF EXISTS $DB" >/dev/null' EXIT
gunzip -c "$FILE" | psql "$TARGET" -q -v ON_ERROR_STOP=1 >/dev/null
for t in users ride_requests pools payments wallet_transactions; do
  n=$(psql "$TARGET" -tAc "SELECT count(*) FROM $t")
  echo "$t: $n rows"
done
echo "restore OK"
