const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { request, app, login } = require('./helpers');
const { pool, resetTransactionalTables } = require('./db');
const { withRetry, isRetryable } = require('../src/utils/retryTx');
const { simulatedPaymentsEnabled } = require('../src/config/features');
const walletService = require('../src/services/walletService');
const { errorHandler } = require('../src/middleware/errorHandler');

let tokens = {};
let zones = {};
let ids = {};
let teslaId;

before(async () => {
  for (const n of ['jashim', 'nusrat', 'rafiq']) tokens[n] = await login(`${n}@dhakateslapool.test`);
  const { rows } = await pool.query('SELECT id, name FROM zones');
  for (const z of rows) zones[z.name] = z.id;
  const u = await pool.query("SELECT id, split_part(email,'@',1) AS n FROM users");
  for (const r of u.rows) ids[r.n] = r.id;
  teslaId = (await request(app).get('/api/teslas/mine').set('Authorization', `Bearer ${tokens.jashim}`)).body.teslas[0].id;
});
beforeEach(async () => {
  await resetTransactionalTables();
  await pool.query('TRUNCATE idempotency_keys');
});
after(async () => {
  await pool.end();
});

const authed = (m, p, t) => request(app)[m](p).set('Authorization', `Bearer ${t}`);
const key = () => crypto.randomUUID();
const ride = (token, k, extra = {}) =>
  authed('post', '/api/v1/ride-requests', token)
    .set('Idempotency-Key', k)
    .send({ pickupZoneId: zones.Banani, destinationZoneId: zones.Mohakhali, ...extra });
const rideCount = async () => (await pool.query('SELECT count(*)::int AS n FROM ride_requests')).rows[0].n;

// ---------- idempotency ----------

test('a retried POST with the same Idempotency-Key creates one ride and replays the first answer', async () => {
  const k = key();
  const first = await ride(tokens.nusrat, k);
  assert.equal(first.status, 201);
  const second = await ride(tokens.nusrat, k);
  assert.equal(second.status, 201);
  assert.equal(second.headers['idempotent-replayed'], 'true');
  assert.equal(second.body.rideRequest.id, first.body.rideRequest.id);
  assert.equal(await rideCount(), 1);
});

test('two simultaneous requests with one key run the action exactly once', async () => {
  const k = key();
  const results = await Promise.all([ride(tokens.nusrat, k), ride(tokens.nusrat, k)]);
  assert.equal(await rideCount(), 1);
  const statuses = results.map((r) => r.status).sort();
  assert.ok(statuses[0] === 201 && (statuses[1] === 201 || statuses[1] === 409), `got ${statuses}`);
});

test('reusing a key for a different request is rejected; keys are private to each user', async () => {
  const k = key();
  assert.equal((await ride(tokens.nusrat, k)).status, 201);
  const different = await ride(tokens.nusrat, k, { seatsRequested: 2 });
  assert.equal(different.status, 422);
  const other = await ride(tokens.rafiq, k);
  assert.equal(other.status, 201);
  assert.notEqual(other.headers['idempotent-replayed'], 'true');
  assert.equal(await rideCount(), 2);
});

test('a failed attempt is not stored, so the same key can be retried after fixing the request', async () => {
  const k = key();
  const bad = await ride(tokens.nusrat, k, { seatsRequested: 99 });
  assert.equal(bad.status, 422);
  const fixed = await ride(tokens.nusrat, k, { seatsRequested: 1 });
  assert.equal(fixed.status, 201);
});

test('malformed keys are rejected, and no key means normal behaviour', async () => {
  assert.equal((await ride(tokens.nusrat, 'short')).status, 422);
  const plain = await authed('post', '/api/v1/ride-requests', tokens.nusrat).send({ pickupZoneId: zones.Banani, destinationZoneId: zones.Mohakhali });
  assert.equal(plain.status, 201);
});

test('a replayed top-up never pays twice', async () => {
  const k = key();
  const send = () => authed('post', '/api/v1/wallet/topup', tokens.nusrat).set('Idempotency-Key', k).send({ amountPaisa: 25000 });
  const a = await send();
  const b = await send();
  assert.equal(a.status, 201);
  assert.equal(b.body.balancePaisa, a.body.balancePaisa);
  const w = await authed('get', '/api/v1/wallet', tokens.nusrat);
  assert.equal(w.body.balancePaisa, 125000);
  assert.equal(w.body.transactions.length, 1);
});

test('a crashed first attempt (stale in-flight key) does not block the key forever', async () => {
  const k = key();
  await pool.query(`INSERT INTO idempotency_keys (user_id, key, request_hash, created_at) VALUES ($1, $2, 'x', now() - interval '5 minutes')`, [ids.nusrat, k]);
  assert.equal((await ride(tokens.nusrat, k)).status, 201);
});

// ---------- production safety ----------

test('the simulated top-up is off in production unless explicitly enabled', async () => {
  assert.equal(simulatedPaymentsEnabled({ NODE_ENV: 'development' }), true);
  assert.equal(simulatedPaymentsEnabled({ NODE_ENV: 'production' }), false);
  assert.equal(simulatedPaymentsEnabled({ NODE_ENV: 'production', SIMULATED_PAYMENTS: 'true' }), true);

  const original = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    const res = await authed('post', '/api/v1/wallet/topup', tokens.nusrat).send({ amountPaisa: 25000 });
    assert.equal(res.status, 403);
    assert.match(res.body.error, /not available yet/);
    assert.equal((await authed('get', '/api/v1/wallet', tokens.nusrat)).body.balancePaisa, 100000, 'no money was created');
  } finally {
    process.env.NODE_ENV = original;
  }
});

// ---------- retry on collisions ----------

test('withRetry re-runs a unit that lost a deadlock, and gives up after the limit', async () => {
  let calls = 0;
  const flaky = async () => {
    calls += 1;
    if (calls < 3) throw Object.assign(new Error('deadlock'), { code: '40P01' });
    return 'done';
  };
  assert.equal(await withRetry(flaky), 'done');
  assert.equal(calls, 3);

  let always = 0;
  await assert.rejects(withRetry(async () => { always += 1; throw Object.assign(new Error('x'), { code: '40001' }); }, { attempts: 3 }), /x/);
  assert.equal(always, 3);

  let other = 0;
  await assert.rejects(withRetry(async () => { other += 1; throw new Error('not retryable'); }), /not retryable/);
  assert.equal(other, 1, 'ordinary errors are never retried');
  assert.equal(isRetryable({ code: '23505' }), false);
});

test('a passenger cancelling at the same moment as the driver never produces a server error', async () => {
  const outcomes = [];
  for (let i = 0; i < 10; i++) {
    await resetTransactionalTables();
    const r = await authed('post', '/api/v1/ride-requests', tokens.nusrat).send({ pickupZoneId: zones.Banani, destinationZoneId: zones.Mohakhali });
    const a = await authed('post', `/api/v1/ride-requests/${r.body.rideRequest.id}/accept`, tokens.jashim).send({ teslaId });
    const [x, y] = await Promise.all([
      authed('patch', `/api/v1/ride-requests/${r.body.rideRequest.id}/cancel`, tokens.nusrat).send({}),
      authed('patch', `/api/v1/pools/${a.body.poolId}/cancel`, tokens.jashim).send({}),
    ]);
    outcomes.push(x.status, y.status);
  }
  assert.deepEqual(outcomes.filter((s) => s >= 500), []);
});

// ---------- accounting ----------

test('the books balance after a full TeslaPay trip, and reconciliation catches any drift', async () => {
  const r = await authed('post', '/api/v1/ride-requests', tokens.nusrat).send({ pickupZoneId: zones.Banani, destinationZoneId: zones.Mohakhali, paymentMethod: 'TESLAPAY' });
  const a = await authed('post', `/api/v1/ride-requests/${r.body.rideRequest.id}/accept`, tokens.jashim).send({ teslaId });
  for (const step of ['arrive', 'start', 'complete']) await authed('patch', `/api/v1/pools/${a.body.poolId}/${step}`, tokens.jashim);
  await authed('post', '/api/v1/wallet/topup', tokens.rafiq).send({ amountPaisa: 10000 });

  const clean = await walletService.reconcile();
  assert.deepEqual(clean, { ok: true, walletMismatches: [], paymentMismatches: [] });

  await pool.query('UPDATE wallets SET balance_paisa = balance_paisa + 500 WHERE user_id = $1', [ids.nusrat]);
  const drifted = await walletService.reconcile();
  assert.equal(drifted.ok, false);
  assert.equal(drifted.walletMismatches.length, 1);
  assert.equal(drifted.walletMismatches[0].userId, ids.nusrat);
  assert.equal(drifted.walletMismatches[0].balancePaisa - drifted.walletMismatches[0].expectedPaisa, 500);
  await pool.query('UPDATE wallets SET balance_paisa = balance_paisa - 500 WHERE user_id = $1', [ids.nusrat]);

  await pool.query(`DELETE FROM wallet_transactions WHERE kind = 'RIDE_EARNING'`);
  const broken = await walletService.reconcile();
  assert.equal(broken.paymentMismatches.length, 1);
  assert.ok(broken.walletMismatches.length >= 1, 'the driver wallet no longer matches its ledger either');
});

// ---------- operability ----------

test('every response carries a request id; a supplied one is honoured; versioned and legacy paths both work', async () => {
  const a = await request(app).get('/api/v1/zones');
  assert.match(a.headers['x-request-id'], /^[0-9a-f-]{36}$/);
  assert.equal(a.headers['x-api-version'], '1');
  assert.equal(a.headers.deprecation, undefined);

  const mine = await request(app).get('/api/v1/zones').set('X-Request-Id', 'trace-abc-12345');
  assert.equal(mine.headers['x-request-id'], 'trace-abc-12345');
  const hostile = await request(app).get('/api/v1/zones').set('X-Request-Id', 'bad id with spaces\tand tabs');
  assert.notEqual(hostile.headers['x-request-id'], 'bad id with spaces\tand tabs');

  const legacy = await request(app).get('/api/zones');
  assert.equal(legacy.status, 200);
  assert.equal(legacy.headers.deprecation, 'true');
  assert.match(legacy.headers.link, /successor-version/);
});

test('an unexpected 500 tells the caller its request id and nothing else', () => {
  let sent;
  const res = { status(s) { sent = { status: s }; return this; }, json(b) { sent.body = b; return this; } };
  errorHandler(Object.assign(new Error('secret SQL detail'), { code: 'XX000' }), { id: 'req-123456789', method: 'GET', originalUrl: '/x' }, res, () => {});
  assert.equal(sent.status, 500);
  assert.deepEqual(sent.body, { error: 'Internal server error', requestId: 'req-123456789' });
});

test('/ready reports the schema is in place', async () => {
  assert.equal((await request(app).get('/ready')).status, 200);
});
