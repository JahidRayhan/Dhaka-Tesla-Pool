#!/bin/bash
# Creates and seeds a dedicated test database so the test suite never
# touches dev data. Assumes a local Postgres reachable with `psql`/`createdb`
# under the current user, matching DATABASE_URL in .env.test.example.
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
DB_NAME="${TEST_DB_NAME:-dhaka_tesla_pool_test}"

echo "Setting up $DB_NAME ..."
createdb "$DB_NAME" 2>/dev/null || echo "  (database already exists, continuing)"
psql -d "$DB_NAME" -f "$PROJECT_ROOT/migrations/001_init.sql"
psql -d "$DB_NAME" -f "$PROJECT_ROOT/migrations/002_add_pending_confirmation_status.sql"
psql -d "$DB_NAME" -f "$PROJECT_ROOT/seed/002_seed.sql"
echo "Done."
