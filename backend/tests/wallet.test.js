const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { request, app, login } = require('./helpers');
const { pool, resetTransactionalTables } = require('./db');

let tokens = {};
let zones = {};
let ids = {};
let teslaId;

before(async () => {
  tokens.nusrat = await login('nusrat@dhakateslapool.test');
  tokens.rafiq = await login('rafiq@dhakateslapool.test');
  tokens.jashim = await login('jashim@dhakateslapool.test');
  const { rows } = await pool.query('SELECT id, name FROM zones');
  for (const z of rows) zones[z.name] = z.id;
  const users = await pool.query("SELECT id, email FROM users WHERE email IN ('nusrat@dhakateslapool.test','jashim@dhakateslapool.test')");
  for (const u of users.rows) ids[u.email.split('@')[0]] = u.id;
  const teslas = await request(app).get('/api/teslas/mine').set('Authorization', `Bearer ${tokens.jashim}`);
  teslaId = teslas.body.teslas[0].id;
});

beforeEach(async () => {
  await resetTransactionalTables();
});

after(async () => {
  await pool.end();
});

const authed = (method, path, token) => request(app)[method](path).set('Authorization', `Bearer ${token}`);
const balanceOf = async (userId) => Number((await pool.query('SELECT balance_paisa FROM wallets WHERE user_id = $1', [userId])).rows[0].balance_paisa);
const requestRide = (token, extra = {}) =>
  authed('post', '/api/ride-requests', token).send({ pickupZoneId: zones.Banani, destinationZoneId: zones.Mohakhali, ...extra });

/** Request -> accept -> arrive -> start, leaving the trip ready to complete. */
async function startTripFor(token, extra = {}) {
  const created = await requestRide(token, extra);
  assert.equal(created.status, 201);
  const accepted = await authed('post', `/api/ride-requests/${created.body.rideRequest.id}/accept`, tokens.jashim).send({ teslaId });
  assert.equal(accepted.status, 200);
  const poolId = accepted.body.poolId;
  assert.equal((await authed('patch', `/api/pools/${poolId}/arrive`, tokens.jashim)).status, 204);
  assert.equal((await authed('patch', `/api/pools/${poolId}/start`, tokens.jashim)).status, 204);
  return { rideId: created.body.rideRequest.id, poolId };
}

const complete = (poolId) => authed('patch', `/api/pools/${poolId}/complete`, tokens.jashim);

test('wallet endpoints require authentication', async () => {
  assert.equal((await request(app).get('/api/wallet')).status, 401);
  assert.equal((await request(app).post('/api/wallet/topup').send({ amountPaisa: 500 })).status, 401);
});

test('top-up validates the amount, credits the wallet and writes a ledger row', async () => {
  for (const bad of [0, 99, 1_000_001, 12.5, '500', null, -100]) {
    const res = await authed('post', '/api/wallet/topup', tokens.nusrat).send({ amountPaisa: bad });
    assert.equal(res.status, 422, String(bad));
  }
  assert.equal(await balanceOf(ids.nusrat), 100000, 'rejected top-ups must not change the balance');

  const ok = await authed('post', '/api/wallet/topup', tokens.nusrat).send({ amountPaisa: 25000 });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.balancePaisa, 125000);

  const wallet = await authed('get', '/api/wallet', tokens.nusrat);
  assert.equal(wallet.body.balancePaisa, 125000);
  assert.equal(wallet.body.transactions.length, 1);
  assert.equal(wallet.body.transactions[0].kind, 'TOPUP');
  assert.equal(Number(wallet.body.transactions[0].amount_paisa), 25000);
});

test('payment method is validated, and TeslaPay needs enough balance up front', async () => {
  const bogus = await requestRide(tokens.nusrat, { paymentMethod: 'BITCOIN' });
  assert.equal(bogus.status, 422);

  await pool.query('UPDATE wallets SET balance_paisa = 100 WHERE user_id = $1', [ids.nusrat]);
  const poor = await requestRide(tokens.nusrat, { paymentMethod: 'TESLAPAY' });
  assert.equal(poor.status, 422);
  assert.match(poor.body.error, /Not enough TeslaPay balance/);

  // Cash does not care about the wallet.
  const cash = await requestRide(tokens.nusrat, { paymentMethod: 'CASH' });
  assert.equal(cash.status, 201);
  assert.equal(cash.body.rideRequest.payment_method, 'CASH');
});

test('a TeslaPay ride moves exactly the fare from passenger to driver, once, with a ledger', async () => {
  const { rideId, poolId } = await startTripFor(tokens.nusrat, { paymentMethod: 'TESLAPAY' });
  const passengerBefore = await balanceOf(ids.nusrat);
  const driverBefore = await balanceOf(ids.jashim);

  const done = await complete(poolId);
  assert.equal(done.status, 204);

  const { rows: [rr] } = await pool.query('SELECT final_fare_paisa FROM ride_requests WHERE id = $1', [rideId]);
  const fare = Number(rr.final_fare_paisa);
  assert.ok(fare > 0);

  assert.equal(await balanceOf(ids.nusrat), passengerBefore - fare);
  assert.equal(await balanceOf(ids.jashim), driverBefore + fare);
  assert.equal((await balanceOf(ids.nusrat)) + (await balanceOf(ids.jashim)), passengerBefore + driverBefore, 'money is moved, never created or destroyed');

  const { rows: payments } = await pool.query('SELECT method, status, amount_paisa, paid_at FROM payments WHERE ride_request_id = $1', [rideId]);
  assert.equal(payments.length, 1);
  assert.equal(payments[0].method, 'TESLAPAY');
  assert.equal(payments[0].status, 'PAID');
  assert.equal(Number(payments[0].amount_paisa), fare);
  assert.ok(payments[0].paid_at);

  const { rows: ledger } = await pool.query('SELECT user_id, kind, amount_paisa FROM wallet_transactions WHERE ride_request_id = $1', [rideId]);
  const byKind = Object.fromEntries(ledger.map((l) => [l.kind, l]));
  assert.equal(ledger.length, 2);
  assert.equal(byKind.RIDE_PAYMENT.user_id, ids.nusrat);
  assert.equal(Number(byKind.RIDE_PAYMENT.amount_paisa), -fare);
  assert.equal(byKind.RIDE_EARNING.user_id, ids.jashim);
  assert.equal(Number(byKind.RIDE_EARNING.amount_paisa), fare);

  const mine = await authed('get', '/api/ride-requests/mine', tokens.nusrat);
  assert.equal(mine.body.rideRequests[0].paid_with, 'TESLAPAY');
  assert.equal(mine.body.rideRequests[0].payment_status, 'PAID');

  // Completing again is rejected and cannot double-charge.
  const again = await complete(poolId);
  assert.ok(again.status >= 400);
  assert.equal(await balanceOf(ids.nusrat), passengerBefore - fare);
});

test('if the wallet ran short before completion, the trip still completes and falls back to pending cash', async () => {
  const { rideId, poolId } = await startTripFor(tokens.nusrat, { paymentMethod: 'TESLAPAY' });
  await pool.query('UPDATE wallets SET balance_paisa = 0 WHERE user_id = $1', [ids.nusrat]);
  const driverBefore = await balanceOf(ids.jashim);

  const done = await complete(poolId);
  assert.equal(done.status, 204);

  const { rows: payments } = await pool.query('SELECT method, status FROM payments WHERE ride_request_id = $1', [rideId]);
  assert.deepEqual(payments.map((p) => [p.method, p.status]), [['CASH', 'PENDING']]);
  assert.equal(await balanceOf(ids.nusrat), 0);
  assert.equal(await balanceOf(ids.jashim), driverBefore);
  const { rows: ledger } = await pool.query('SELECT 1 FROM wallet_transactions WHERE ride_request_id = $1', [rideId]);
  assert.equal(ledger.length, 0);
});

test('a cash ride leaves both wallets untouched and records a pending cash payment', async () => {
  const { rideId, poolId } = await startTripFor(tokens.nusrat);
  const before = [await balanceOf(ids.nusrat), await balanceOf(ids.jashim)];
  assert.equal((await complete(poolId)).status, 204);
  assert.deepEqual([await balanceOf(ids.nusrat), await balanceOf(ids.jashim)], before);
  const { rows } = await pool.query('SELECT method, status FROM payments WHERE ride_request_id = $1', [rideId]);
  assert.deepEqual(rows.map((p) => [p.method, p.status]), [['CASH', 'PENDING']]);
});

test('the ledger refuses a payment that adds money or a top-up tied to a ride', async () => {
  await assert.rejects(
    pool.query(`INSERT INTO wallet_transactions (user_id, kind, amount_paisa, ride_request_id)
                VALUES ($1, 'TOPUP', 500, gen_random_uuid())`, [ids.nusrat]),
  );
  await assert.rejects(
    pool.query(`INSERT INTO wallet_transactions (user_id, kind, amount_paisa) VALUES ($1, 'RIDE_PAYMENT', 500)`, [ids.nusrat]),
  );
});
