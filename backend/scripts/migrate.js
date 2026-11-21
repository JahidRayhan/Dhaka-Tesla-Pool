#!/usr/bin/env node
/**
 * Tracked, forward-only SQL migrations.
 *
 *   node scripts/migrate.js              apply everything not yet applied
 *   node scripts/migrate.js --status     show applied / pending
 *   node scripts/migrate.js --baseline 007
 *                                        adopt an EXISTING database that was
 *                                        migrated by hand: mark files up to and
 *                                        including 007 as applied WITHOUT running
 *
 * Each file runs in its own transaction together with its bookkeeping row, so a
 * failed migration leaves nothing half-applied. A Postgres advisory lock stops
 * two instances starting at once from racing. A file edited after it was applied
 * is refused (checksum), because the database no longer matches the history.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Client } = require('pg');

const DEFAULT_DIR = path.join(__dirname, '..', 'db', 'migrations');
const LOCK_KEY = 7260101; // arbitrary constant shared by every runner

const checksum = (sql) => crypto.createHash('sha256').update(sql).digest('hex');

function listMigrations(dir) {
  return fs
    .readdirSync(dir)
    .filter((f) => /^\d+_.+\.sql$/.test(f))
    .sort()
    .map((file) => {
      const sql = fs.readFileSync(path.join(dir, file), 'utf8');
      return { file, sql, checksum: checksum(sql) };
    });
}

async function ensureTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   TEXT PRIMARY KEY,
      checksum   TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
}

async function migrate({ databaseUrl = process.env.DATABASE_URL, dir = DEFAULT_DIR, baseline = null, statusOnly = false, log = console.log } = {}) {
  if (!databaseUrl) throw new Error('DATABASE_URL is not set');
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
    await ensureTable(client);

    const files = listMigrations(dir);
    const { rows } = await client.query('SELECT filename, checksum FROM schema_migrations');
    const applied = new Map(rows.map((r) => [r.filename, r.checksum]));

    for (const m of files) {
      if (applied.has(m.file) && applied.get(m.file) !== m.checksum) {
        throw new Error(`${m.file} was modified after it was applied (checksum mismatch). Write a new migration instead of editing an old one.`);
      }
    }

    if (baseline) {
      if (applied.size > 0) throw new Error('--baseline is only for a database with no migration history');
      const prefix = String(baseline).padStart(3, '0');
      const toMark = files.filter((m) => m.file.slice(0, 3) <= prefix);
      if (toMark.length === 0) throw new Error(`No migration matches --baseline ${baseline}`);
      for (const m of toMark) {
        await client.query('INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)', [m.file, m.checksum]);
        log(`baselined ${m.file}`);
      }
      return { applied: [], baselined: toMark.map((m) => m.file) };
    }

    const pending = files.filter((m) => !applied.has(m.file));

    if (statusOnly) {
      for (const m of files) log(`${applied.has(m.file) ? 'applied' : 'PENDING'}  ${m.file}`);
      return { applied: [], pending: pending.map((m) => m.file) };
    }

    // Safety: a database that already has tables but no history was migrated by
    // hand. Running 001 on it would fail confusingly (or worse, half-succeed).
    if (applied.size === 0 && pending.length > 0) {
      const { rows: existing } = await client.query(
        `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'users'`,
      );
      if (existing.length > 0) {
        throw new Error('This database already has tables but no migration history. Run: node scripts/migrate.js --baseline <last-applied-number> (e.g. 007)');
      }
    }

    const done = [];
    for (const m of pending) {
      log(`applying ${m.file} ...`);
      try {
        await client.query('BEGIN');
        await client.query(m.sql);
        await client.query('INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)', [m.file, m.checksum]);
        await client.query('COMMIT');
        done.push(m.file);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`${m.file} failed and was rolled back: ${err.message}`);
      }
    }
    if (done.length === 0) log('database is up to date');
    return { applied: done };
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => {});
    await client.end();
  }
}

module.exports = { migrate, listMigrations };

if (require.main === module) {
  require('dotenv').config();
  const args = process.argv.slice(2);
  const bi = args.indexOf('--baseline');
  migrate({ baseline: bi >= 0 ? args[bi + 1] : null, statusOnly: args.includes('--status') })
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err.message);
      process.exit(1);
    });
}
