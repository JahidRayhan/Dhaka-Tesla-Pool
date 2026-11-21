const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Client } = require('pg');
const { migrate, listMigrations } = require('../scripts/migrate');
const { seed } = require('../scripts/seed');

const base = new URL(process.env.DATABASE_URL);
const urlFor = (db) => { const u = new URL(base); u.pathname = `/${db}`; return u.toString(); };
const quiet = () => {};
const DIR = path.join(__dirname, '..', 'db', 'migrations');

async function withTempDb(fn) {
  const name = `migrate_test_${process.pid}_${Math.floor(Math.random() * 1e6)}`;
  const admin = new Client({ connectionString: urlFor('postgres') });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  try {
    await fn(urlFor(name), name);
  } finally {
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin.end();
  }
}
const query = async (url, sql, params) => {
  const c = new Client({ connectionString: url });
  await c.connect();
  try { return (await c.query(sql, params)).rows; } finally { await c.end(); }
};

test('migrate applies every file once, in order, and a second run is a no-op', async () => {
  await withTempDb(async (url) => {
    const first = await migrate({ databaseUrl: url, log: quiet });
    assert.deepEqual(first.applied, listMigrations(DIR).map((m) => m.file));
    const second = await migrate({ databaseUrl: url, log: quiet });
    assert.deepEqual(second.applied, []);
    const rows = await query(url, 'SELECT count(*)::int AS n FROM schema_migrations');
    assert.equal(rows[0].n, first.applied.length);
  });
});

test('a database migrated by hand is refused until it is baselined, then only newer files run', async () => {
  await withTempDb(async (url) => {
    // Simulate the existing deployment: 001-007 applied by hand, no history table.
    for (const m of listMigrations(DIR).filter((f) => f.file.slice(0, 3) <= '007')) await query(url, m.sql);

    await assert.rejects(migrate({ databaseUrl: url, log: quiet }), /baseline/);
    const baselined = await migrate({ databaseUrl: url, baseline: '007', log: quiet });
    assert.equal(baselined.baselined.length, 7);
    const after = await migrate({ databaseUrl: url, log: quiet });
    assert.ok(after.applied.length >= 1 && after.applied.every((f) => f.slice(0, 3) > '007'));
    await assert.rejects(migrate({ databaseUrl: url, baseline: '007', log: quiet }), /no migration history/);
  });
});

test('editing an already-applied migration is refused', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-'));
  fs.writeFileSync(path.join(dir, '001_a.sql'), 'CREATE TABLE a (id int);');
  await withTempDb(async (url) => {
    await migrate({ databaseUrl: url, dir, log: quiet });
    fs.writeFileSync(path.join(dir, '001_a.sql'), 'CREATE TABLE a (id int, sneaky int);');
    await assert.rejects(migrate({ databaseUrl: url, dir, log: quiet }), /modified after it was applied/);
  });
});

test('a failing migration is rolled back completely and recorded as not applied', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-'));
  fs.writeFileSync(path.join(dir, '001_ok.sql'), 'CREATE TABLE ok_table (id int);');
  fs.writeFileSync(path.join(dir, '002_bad.sql'), 'CREATE TABLE half_done (id int); SELECT 1/0;');
  await withTempDb(async (url) => {
    await assert.rejects(migrate({ databaseUrl: url, dir, log: quiet }), /002_bad.sql failed and was rolled back/);
    const tables = (await query(url, `SELECT table_name FROM information_schema.tables WHERE table_schema='public'`)).map((r) => r.table_name);
    assert.ok(tables.includes('ok_table'), 'the earlier migration stays applied');
    assert.ok(!tables.includes('half_done'), 'nothing from the failed file survives');
    const applied = (await query(url, 'SELECT filename FROM schema_migrations')).map((r) => r.filename);
    assert.deepEqual(applied, ['001_ok.sql']);
  });
});

test('two runners starting at once do not race (advisory lock)', async () => {
  await withTempDb(async (url) => {
    const [a, b] = await Promise.all([migrate({ databaseUrl: url, log: quiet }), migrate({ databaseUrl: url, log: quiet })]);
    assert.equal(a.applied.length + b.applied.length, listMigrations(DIR).length, 'each file applied exactly once across both');
  });
});

test('reference seed is idempotent; demo seed is refused in production', async () => {
  await withTempDb(async (url) => {
    await migrate({ databaseUrl: url, log: quiet });
    await seed('reference', { databaseUrl: url, log: quiet });
    await seed('reference', { databaseUrl: url, log: quiet });
    const counts = await query(url, `SELECT (SELECT count(*) FROM zones)::int AS zones, (SELECT count(*) FROM zone_edges)::int AS edges, (SELECT count(*) FROM users)::int AS users`);
    assert.deepEqual(counts[0], { zones: 9, edges: 8, users: 0 });
    assert.equal((await query(url, 'SELECT count(*)::int AS n FROM meeting_points'))[0].n, 18, 'two placeholder points per zone, and re-seeding did not duplicate them');

    await assert.rejects(seed('demo', { databaseUrl: url, env: { NODE_ENV: 'production' }, log: quiet }), /Refusing to load DEMO data in production/);
    assert.equal((await query(url, 'SELECT count(*)::int AS n FROM users'))[0].n, 0);

    await seed('demo', { databaseUrl: url, env: { NODE_ENV: 'development' }, log: quiet });
    await seed('demo', { databaseUrl: url, env: { NODE_ENV: 'development' }, log: quiet });
    assert.equal((await query(url, 'SELECT count(*)::int AS n FROM users'))[0].n, 5, 'Jashim, Nusrat, Rafiq, Shirin and the demo admin');
    // The opening demo balance is accounted for, so reconciliation starts clean.
    const w = await query(url, 'SELECT balance_paisa, ledger_baseline_paisa FROM wallets LIMIT 1');
    assert.equal(Number(w[0].balance_paisa), Number(w[0].ledger_baseline_paisa));
  });
});
