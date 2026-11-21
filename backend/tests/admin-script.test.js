const { test } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const { Client } = require('pg');
const { migrate } = require('../scripts/migrate');
const { createAdmin } = require('../scripts/create-admin');
const { request, app } = require('./helpers');
const { pool } = require('./db');

const base = new URL(process.env.DATABASE_URL);
const urlFor = (db) => { const u = new URL(base); u.pathname = `/${db}`; return u.toString(); };

async function withTempDb(fn) {
  const name = `admin_script_${process.pid}_${Math.floor(Math.random() * 1e6)}`;
  const admin = new Client({ connectionString: urlFor('postgres') });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  try {
    await migrate({ databaseUrl: urlFor(name), log: () => {} });
    await fn(urlFor(name));
  } finally {
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin.end();
  }
}
const q = async (url, sql, params) => { const c = new Client({ connectionString: url }); await c.connect(); try { return (await c.query(sql, params)).rows; } finally { await c.end(); } };

test('create-admin makes an operator with a wallet; weak passwords and bad emails are refused', async () => {
  await withTempDb(async (url) => {
    await assert.rejects(createAdmin({ databaseUrl: url, email: 'nope', password: 'a-long-enough-passphrase' }), /valid email/);
    await assert.rejects(createAdmin({ databaseUrl: url, email: 'ops@example.com', password: 'short' }), /12-72/);

    const made = await createAdmin({ databaseUrl: url, email: ' Ops@Example.com ', name: 'Ops', password: 'a-long-enough-passphrase' });
    assert.deepEqual([made.promoted, made.email], [false, 'ops@example.com']);
    const [row] = await q(url, 'SELECT role, password_hash FROM users WHERE email = $1', ['ops@example.com']);
    assert.equal(row.role, 'admin');
    assert.ok(await bcrypt.compare('a-long-enough-passphrase', row.password_hash));
    assert.equal((await q(url, 'SELECT count(*)::int AS n FROM wallets'))[0].n, 1);
  });
});

test('with no password given one is generated; promoting an existing account keeps its password', async () => {
  await withTempDb(async (url) => {
    const generated = await createAdmin({ databaseUrl: url, email: 'a@example.com' });
    assert.ok(generated.generated && generated.password.length >= 20);

    await q(url, `INSERT INTO users (name, email, password_hash, role) VALUES ('Pat', 'pat@example.com', $1, 'passenger')`, [await bcrypt.hash('patspassword123', 4)]);
    const promoted = await createAdmin({ databaseUrl: url, email: 'pat@example.com' });
    assert.deepEqual([promoted.promoted, promoted.password], [true, null]);
    const [row] = await q(url, `SELECT role, password_hash FROM users WHERE email = 'pat@example.com'`);
    assert.equal(row.role, 'admin');
    assert.ok(await bcrypt.compare('patspassword123', row.password_hash), 'password untouched');
  });
});

test('an operator created this way can use the admin API; a "both" account still cannot', async () => {
  // (Uses the shared dev database through the real API.)
  const res = await request(app).post('/api/v1/auth/login').send({ email: 'admin@dhakateslapool.test', password: 'password123' });
  assert.equal((await request(app).get('/api/v1/admin/stats').set('Authorization', `Bearer ${res.body.accessToken}`)).status, 200);
  const both = await request(app).post('/api/v1/auth/signup').send({ name: 'Both', email: `both-${Date.now()}@example.com`, password: 'password123', role: 'both' });
  assert.equal((await request(app).get('/api/v1/admin/stats').set('Authorization', `Bearer ${both.body.accessToken}`)).status, 403);
  await pool.end();
});
