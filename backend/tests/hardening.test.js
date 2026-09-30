const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { request, app, login } = require('./helpers');
const { pool, resetTransactionalTables } = require('./db');

let tokens = {};
let zones = {};
let teslaId;

before(async () => {
  tokens.jashim = await login('jashim@dhakateslapool.test');
  tokens.nusrat = await login('nusrat@dhakateslapool.test');
  tokens.rafiq = await login('rafiq@dhakateslapool.test');
  const { rows } = await pool.query('SELECT id, name FROM zones');
  for (const z of rows) zones[z.name] = z.id;
  const res = await request(app).get('/api/teslas/mine').set('Authorization', `Bearer ${tokens.jashim}`);
  teslaId = res.body.teslas[0].id;
});

beforeEach(async () => {
  await resetTransactionalTables();
});

after(async () => {
  await pool.end();
});

const uniqueEmail = (prefix) => `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@dhakateslapool.test`;
const authed = (method, path, token) => request(app)[method](path).set('Authorization', `Bearer ${token}`);
const requestRide = (token, destination = 'Mohakhali') =>
  authed('post', '/api/ride-requests', token).send({ pickupZoneId: zones.Banani, destinationZoneId: zones[destination] });
const accept = (rideId, body) => authed('post', `/api/ride-requests/${rideId}/accept`, tokens.jashim).send(body);

// ---------- 1. Empty pools ----------

test('last passenger cancelling closes the pool, so the Tesla can start a new one', async () => {
  const first = await requestRide(tokens.nusrat);
  const { body: accepted } = await accept(first.body.rideRequest.id, { teslaId });

  const cancel = await authed('patch', `/api/ride-requests/${first.body.rideRequest.id}/cancel`, tokens.nusrat).send({});
  assert.equal(cancel.status, 204);

  const { rows } = await pool.query('SELECT status, seats_occupied, cancelled_at FROM pools WHERE id = $1', [accepted.poolId]);
  assert.equal(rows[0].status, 'CANCELLED');
  assert.equal(rows[0].seats_occupied, 0);
  assert.ok(rows[0].cancelled_at);

  const history = await pool.query(
    `SELECT to_status FROM status_history WHERE entity_type = 'pool' AND entity_id = $1 ORDER BY id`,
    [accepted.poolId],
  );
  assert.deepEqual(history.rows.map((r) => r.to_status), ['MATCHED', 'CANCELLED']);

  // The bug: this used to 409 with "already has an active pool".
  const second = await requestRide(tokens.rafiq);
  const again = await accept(second.body.rideRequest.id, { teslaId });
  assert.equal(again.status, 200);
  assert.notEqual(again.body.poolId, accepted.poolId);
});

test('a pool that still has another passenger is NOT closed when one of them cancels', async () => {
  const nusrat = await requestRide(tokens.nusrat);
  const { body: accepted } = await accept(nusrat.body.rideRequest.id, { teslaId });
  // Rafiq joins the same route; both agree.
  const rafiq = await requestRide(tokens.rafiq);
  await accept(rafiq.body.rideRequest.id, { teslaId, poolId: accepted.poolId });
  await authed('post', `/api/ride-requests/${rafiq.body.rideRequest.id}/confirm`, tokens.rafiq);
  const asked = await authed('get', '/api/ride-requests/mine', tokens.nusrat);
  for (const c of asked.body.rideRequests.flatMap((r) => r.pendingConsents)) {
    await authed('post', `/api/pool-consents/${c.id}/approve`, tokens.nusrat);
  }

  await authed('patch', `/api/ride-requests/${rafiq.body.rideRequest.id}/cancel`, tokens.rafiq).send({});

  const { rows } = await pool.query('SELECT status, seats_occupied FROM pools WHERE id = $1', [accepted.poolId]);
  assert.equal(rows[0].status, 'MATCHED');
  assert.equal(rows[0].seats_occupied, 1);
});

// ---------- 2. Bad input -> 4xx, not 500 ----------

test('malformed UUID in the URL is a 400, not a 500', async () => {
  const res = await authed('get', '/api/ride-requests/not-a-uuid', tokens.nusrat);
  assert.equal(res.status, 400);
  assert.match(res.body.error, /invalid/i);
});

test('malformed JSON body is a 400 with a clear message, not a 500', async () => {
  const res = await request(app).post('/api/auth/login').set('Content-Type', 'application/json').send('{bad');
  assert.equal(res.status, 400);
  assert.match(res.body.error, /json/i);
});

test('login with non-string credentials is a generic 401, not a crash', async () => {
  const res = await request(app).post('/api/auth/login').send({ email: 'a@b.co', password: 12345 });
  assert.equal(res.status, 401);
  const res2 = await request(app).post('/api/auth/login').send({ email: { $ne: null }, password: 'x' });
  assert.equal(res2.status, 401);
});

// ---------- 3. Signup validation ----------

test('signup rejects short passwords, bad emails, and non-string fields with 422', async () => {
  const bad = [
    { name: 'X', email: uniqueEmail('a'), password: 'short' },
    { name: 'X', email: 'not-an-email', password: 'longenough1' },
    { name: 'X', email: uniqueEmail('b'), password: 12345678 },
    { name: 'X', email: ['a@b.co'], password: 'longenough1' },
    { name: '   ', email: uniqueEmail('c'), password: 'longenough1' },
    { name: 'X', email: uniqueEmail('d'), password: 'longenough1', phone: 123 },
  ];
  for (const payload of bad) {
    const res = await request(app).post('/api/auth/signup').send(payload);
    assert.equal(res.status, 422, JSON.stringify(payload));
  }
});

test('emails are case-insensitive: differing case is a duplicate, and login works in any case', async () => {
  const email = uniqueEmail('CaseTest');
  const first = await request(app).post('/api/auth/signup').send({ name: 'A', email, password: 'password123' });
  assert.equal(first.status, 201);
  assert.equal(first.body.user.email, email.toLowerCase());

  const dup = await request(app).post('/api/auth/signup').send({ name: 'B', email: email.toUpperCase(), password: 'password123' });
  assert.equal(dup.status, 409);

  const loggedIn = await request(app).post('/api/auth/login').send({ email: `  ${email.toUpperCase()} `, password: 'password123' });
  assert.equal(loggedIn.status, 200);
});

// ---------- 4. Signup is atomic ----------

test('if creating the wallet fails, the user row is rolled back too', async () => {
  const email = uniqueEmail('atomic');
  // Force the wallet insert to fail for this signup only.
  await pool.query(`
    CREATE OR REPLACE FUNCTION test_block_wallet() RETURNS trigger AS $$
    BEGIN RAISE EXCEPTION 'forced wallet failure'; END; $$ LANGUAGE plpgsql`);
  await pool.query('CREATE TRIGGER trg_test_block_wallet BEFORE INSERT ON wallets FOR EACH ROW EXECUTE FUNCTION test_block_wallet()');
  try {
    const res = await request(app).post('/api/auth/signup').send({ name: 'A', email, password: 'password123' });
    assert.equal(res.status, 500);
  } finally {
    await pool.query('DROP TRIGGER trg_test_block_wallet ON wallets');
    await pool.query('DROP FUNCTION test_block_wallet()');
  }
  const { rows } = await pool.query('SELECT 1 FROM users WHERE email = $1', [email.toLowerCase()]);
  assert.equal(rows.length, 0, 'user must not exist without a wallet');
});
