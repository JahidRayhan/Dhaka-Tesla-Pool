process.env.PUSH_PROVIDER = 'memory';
const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { request, app, login } = require('./helpers');
const { pool, resetTransactionalTables } = require('./db');
const { NO_SHOW_FEE_PAISA } = require('../src/config/tracking');
const walletService = require('../src/services/walletService');

let tokens = {};
let zones = {};
let ids = {};
let teslaId;

before(async () => {
  for (const n of ['jashim', 'nusrat', 'rafiq', 'shirin', 'admin']) tokens[n] = await login(`${n}@dhakateslapool.test`);
  for (const z of (await pool.query('SELECT id, name FROM zones')).rows) zones[z.name] = z.id;
  for (const u of (await pool.query("SELECT id, split_part(email,'@',1) AS n FROM users")).rows) ids[u.n] = u.id;
  teslaId = (await request(app).get('/api/v1/teslas/mine').set('Authorization', `Bearer ${tokens.jashim}`)).body.teslas[0].id;
});
beforeEach(async () => {
  await resetTransactionalTables();
  await pool.query('TRUNCATE notifications, ratings, trip_shares');
  await pool.query(`UPDATE pools SET last_latitude = NULL`); // (pools were truncated; harmless)
});
after(async () => {
  await pool.end();
});

const authed = (m, p, t) => request(app)[m](p).set('Authorization', `Bearer ${t}`);
const ride = (who, extra = {}) => authed('post', '/api/v1/ride-requests', tokens[who]).send({ pickupZoneId: zones.Banani, destinationZoneId: zones.Mohakhali, ...extra });
const accept = (rideId, body = {}) => authed('post', `/api/v1/ride-requests/${rideId}/accept`, tokens.jashim).send({ teslaId, ...body });
const step = (poolId, s) => authed('patch', `/api/v1/pools/${poolId}/${s}`, tokens.jashim);
const mine = async (who) => (await authed('get', '/api/v1/ride-requests/mine', tokens[who])).body.rideRequests;
const settle = () => new Promise((r) => setTimeout(r, 120));

/** One passenger's ride, accepted into a new pool. */
async function matched(who = 'nusrat', extra = {}) {
  const r = await ride(who, extra);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const a = await accept(r.body.rideRequest.id);
  assert.equal(a.status, 200, JSON.stringify(a.body));
  return { rideId: r.body.rideRequest.id, poolId: a.body.poolId };
}
async function completed(who = 'nusrat', extra = {}) {
  const m = await matched(who, extra);
  for (const s of ['arrive', 'start', 'complete']) assert.equal((await step(m.poolId, s)).status, 204);
  return m;
}

// ---------- location, ETA, geofence ----------

test('the driver reports a location; the passenger sees the vehicle and an ETA; stale positions are ignored', async () => {
  const { rideId, poolId } = await matched();
  const banani = (await pool.query('SELECT latitude, longitude FROM zones WHERE name = $1', ['Banani'])).rows[0];

  for (const bad of [{}, { latitude: 'x', longitude: 1 }, { latitude: 95, longitude: 0 }, { latitude: 0, longitude: 190 }, { latitude: NaN, longitude: 0 }]) {
    assert.equal((await authed('post', `/api/v1/pools/${poolId}/location`, tokens.jashim).send(bad)).status, 422, JSON.stringify(bad));
  }
  assert.equal((await authed('post', `/api/v1/pools/${poolId}/location`, tokens.nusrat).send({ latitude: 1, longitude: 1 })).status, 403, 'a passenger cannot report');

  // 1.5 km north of Banani at 15 km/h = 6 minutes.
  assert.equal((await authed('post', `/api/v1/pools/${poolId}/location`, tokens.jashim).send({ latitude: banani.latitude + 0.0135, longitude: banani.longitude })).status, 204);
  const trip = (await mine('nusrat')).find((r) => r.id === rideId).trip;
  assert.equal(trip.driverName, 'Jashim');
  assert.equal(trip.teslaName, 'Bullet');
  assert.equal(trip.vehiclePlate, 'DHAKA-DEMO-01', 'shown because the driver is verified');
  assert.ok(trip.location && trip.etaMinutes >= 5 && trip.etaMinutes <= 8, `ETA ${trip.etaMinutes}`);

  await pool.query(`UPDATE pools SET last_location_at = now() - interval '10 minutes' WHERE id = $1`, [poolId]);
  const stale = (await mine('nusrat')).find((r) => r.id === rideId).trip;
  assert.equal(stale.location, null);
  assert.equal(stale.etaMinutes, null, 'no ETA from an old position');
});

test('arrival is blocked when a fresh position says the driver is far away, but never when there is no position', async () => {
  const { poolId } = await matched();
  const banani = (await pool.query('SELECT latitude, longitude FROM zones WHERE name = $1', ['Banani'])).rows[0];

  await authed('post', `/api/v1/pools/${poolId}/location`, tokens.jashim).send({ latitude: banani.latitude + 0.05, longitude: banani.longitude }); // ~5.5 km away
  const far = await step(poolId, 'arrive');
  assert.equal(far.status, 409);
  assert.match(far.body.error, /near the pickup/);

  await authed('post', `/api/v1/pools/${poolId}/location`, tokens.jashim).send({ latitude: banani.latitude + 0.002, longitude: banani.longitude });
  assert.equal((await step(poolId, 'arrive')).status, 204);
});

test('with no location ever reported, arrival is allowed (GPS must not be able to strand a ride)', async () => {
  const { poolId } = await matched();
  assert.equal((await step(poolId, 'arrive')).status, 204);
});

// ---------- no-show ----------

test('a no-show can only be marked after waiting, charges the fee in cash, and closes an empty pool', async () => {
  const { rideId, poolId } = await matched();
  const early = await authed('post', `/api/v1/pools/${poolId}/no-show`, tokens.jashim).send({ requestId: rideId });
  assert.equal(early.status, 409, 'driver has not even arrived yet');

  await step(poolId, 'arrive');
  const tooSoon = await authed('post', `/api/v1/pools/${poolId}/no-show`, tokens.jashim).send({ requestId: rideId });
  assert.equal(tooSoon.status, 409);
  assert.match(tooSoon.body.error, /wait/i);

  await pool.query(`UPDATE ride_requests SET driver_arrived_at = now() - interval '6 minutes' WHERE id = $1`, [rideId]);
  assert.equal((await authed('post', `/api/v1/pools/${poolId}/no-show`, tokens.nusrat).send({ requestId: rideId })).status, 403, 'only the pool\'s driver');
  const done = await authed('post', `/api/v1/pools/${poolId}/no-show`, tokens.jashim).send({ requestId: rideId });
  assert.equal(done.status, 200);
  assert.deepEqual(done.body, { feePaisa: NO_SHOW_FEE_PAISA, feeSettledWith: 'CASH' });

  const ridePost = (await pool.query('SELECT status, cancellation_reason FROM ride_requests WHERE id = $1', [rideId])).rows[0];
  assert.deepEqual([ridePost.status, ridePost.cancellation_reason], ['CANCELLED', 'no-show']);
  const pay = (await pool.query('SELECT kind, method, status, amount_paisa FROM payments WHERE ride_request_id = $1', [rideId])).rows[0];
  assert.deepEqual([pay.kind, pay.method, pay.status, Number(pay.amount_paisa)], ['NO_SHOW_FEE', 'CASH', 'PENDING', NO_SHOW_FEE_PAISA]);
  const p = (await pool.query('SELECT status, seats_occupied FROM pools WHERE id = $1', [poolId])).rows[0];
  assert.deepEqual([p.status, p.seats_occupied], ['CANCELLED', 0], 'nobody left, so the pool closes and the Tesla is free');
  await settle();
  assert.ok((await pool.query(`SELECT 1 FROM notifications WHERE user_id = $1 AND type = 'NO_SHOW'`, [ids.nusrat])).rows.length === 1);
  assert.equal((await authed('post', `/api/v1/pools/${poolId}/no-show`, tokens.jashim).send({ requestId: rideId })).status, 409, 'cannot be marked twice');
});

test('a TeslaPay no-show fee moves real money, once, and the books still balance', async () => {
  const { rideId, poolId } = await matched('nusrat', { paymentMethod: 'TESLAPAY' });
  await step(poolId, 'arrive');
  await pool.query(`UPDATE ride_requests SET driver_arrived_at = now() - interval '6 minutes' WHERE id = $1`, [rideId]);
  const before = { n: (await walletService.getWallet(ids.nusrat)).balancePaisa, j: (await walletService.getWallet(ids.jashim)).balancePaisa };
  const done = await authed('post', `/api/v1/pools/${poolId}/no-show`, tokens.jashim).send({ requestId: rideId });
  assert.equal(done.body.feeSettledWith, 'TESLAPAY');
  assert.equal((await walletService.getWallet(ids.nusrat)).balancePaisa, before.n - NO_SHOW_FEE_PAISA);
  assert.equal((await walletService.getWallet(ids.jashim)).balancePaisa, before.j + NO_SHOW_FEE_PAISA);
  assert.deepEqual(await walletService.reconcile(), { ok: true, walletMismatches: [], paymentMismatches: [] });
});

test('one passenger being a no-show does not end the pool for the others', async () => {
  const nusrat = await ride('nusrat', { shareMax: 3 });
  const first = await accept(nusrat.body.rideRequest.id);
  const rafiq = await ride('rafiq', { shareMax: 3 });
  await accept(rafiq.body.rideRequest.id, { poolId: first.body.poolId });
  await step(first.body.poolId, 'arrive');
  await pool.query(`UPDATE ride_requests SET driver_arrived_at = now() - interval '6 minutes' WHERE id = $1`, [nusrat.body.rideRequest.id]);
  assert.equal((await authed('post', `/api/v1/pools/${first.body.poolId}/no-show`, tokens.jashim).send({ requestId: nusrat.body.rideRequest.id })).status, 200);
  const p = (await pool.query('SELECT status, seats_occupied FROM pools WHERE id = $1', [first.body.poolId])).rows[0];
  assert.deepEqual([p.status, p.seats_occupied], ['DRIVER_ARRIVED', 1], 'Rafiq is still riding');
  assert.equal((await step(first.body.poolId, 'start')).status, 204);
});

// ---------- receipts and earnings ----------

test('a receipt breaks the fare down, names no co-passengers, and is private to the people involved', async () => {
  const nusrat = await ride('nusrat', { shareMax: 3 });
  const first = await accept(nusrat.body.rideRequest.id);
  const rafiq = await ride('rafiq', { shareMax: 3 });
  await accept(rafiq.body.rideRequest.id, { poolId: first.body.poolId });
  const id = nusrat.body.rideRequest.id;

  assert.equal((await authed('get', `/api/v1/ride-requests/${id}/receipt`, tokens.nusrat)).status, 409, 'not yet completed');
  for (const s of ['arrive', 'start', 'complete']) await step(first.body.poolId, s);

  const res = await authed('get', `/api/v1/ride-requests/${id}/receipt`, tokens.nusrat);
  assert.equal(res.status, 200);
  const r = res.body.receipt;
  assert.equal(r.kind, 'FARE');
  assert.deepEqual([r.route.pickup, r.route.destination], ['Banani', 'Mohakhali']);
  assert.equal(r.sharedWith, 1);
  assert.ok(r.fare.poolDiscountPaisa > 0, 'a pooled ride shows its discount');
  assert.equal(r.fare.totalPaisa, r.fare.basePaisa + r.fare.distancePaisa - r.fare.poolDiscountPaisa);
  assert.equal(r.driver.name, 'Jashim');
  assert.ok(!JSON.stringify(res.body).includes('Rafiq'), 'the co-passenger is never named');

  assert.equal((await authed('get', `/api/v1/ride-requests/${id}/receipt`, tokens.jashim)).status, 200, 'the driver may see it');
  assert.equal((await authed('get', `/api/v1/ride-requests/${id}/receipt`, tokens.shirin)).status, 403);
  assert.equal((await authed('get', `/api/v1/ride-requests/${id}/receipt`, tokens.rafiq)).status, 403, 'even a co-passenger');
  assert.equal((await authed('get', `/api/v1/ride-requests/${id}/receipt`, tokens.admin)).status, 200);
});

test('driver earnings split wallet-paid money from cash still to collect, and include no-show fees', async () => {
  await completed('nusrat', { paymentMethod: 'TESLAPAY' });
  const cash = await completed('rafiq');
  void cash;
  const noShow = await matched('shirin');
  await step(noShow.poolId, 'arrive');
  await pool.query(`UPDATE ride_requests SET driver_arrived_at = now() - interval '6 minutes' WHERE id = $1`, [noShow.rideId]);
  await authed('post', `/api/v1/pools/${noShow.poolId}/no-show`, tokens.jashim).send({ requestId: noShow.rideId });

  const res = await authed('get', '/api/v1/drivers/me/earnings', tokens.jashim);
  assert.equal(res.status, 200);
  const t = res.body.totals;
  assert.equal(t.ridesCompleted, 2);
  assert.equal(t.noShowFeesPaisa, NO_SHOW_FEE_PAISA);
  assert.equal(t.grossPaisa, t.walletPaidPaisa + t.cashToCollectPaisa);
  assert.ok(t.walletPaidPaisa > 0 && t.cashToCollectPaisa > NO_SHOW_FEE_PAISA - 1);
  assert.equal(res.body.byDay.reduce((s, d) => s + d.grossPaisa, 0), t.grossPaisa);

  assert.equal((await authed('get', '/api/v1/drivers/me/earnings?from=garbage', tokens.jashim)).status, 422);
  assert.equal((await authed('get', '/api/v1/drivers/me/earnings', tokens.nusrat)).status, 403, 'passengers have no earnings');
});

// ---------- ratings ----------

test('both sides can rate a completed ride exactly once, and averages show up where they matter', async () => {
  const done = await matched();
  assert.equal((await authed('post', `/api/v1/ride-requests/${done.rideId}/rating`, tokens.nusrat).send({ stars: 5 })).status, 409, 'not completed yet');
  for (const s of ['arrive', 'start', 'complete']) await step(done.poolId, s);

  for (const bad of [{ stars: 0 }, { stars: 6 }, { stars: 4.5 }, { stars: '5' }, {}, { stars: 5, comment: 'x'.repeat(501) }]) {
    assert.equal((await authed('post', `/api/v1/ride-requests/${done.rideId}/rating`, tokens.nusrat).send(bad)).status, 422, JSON.stringify(bad).slice(0, 40));
  }
  assert.equal((await authed('post', `/api/v1/ride-requests/${done.rideId}/rating`, tokens.shirin).send({ stars: 1 })).status, 403, 'a stranger cannot rate');
  assert.equal((await authed('post', `/api/v1/ride-requests/${done.rideId}/rating`, tokens.nusrat).send({ stars: 5, comment: 'Smooth ride' })).status, 201);
  assert.equal((await authed('post', `/api/v1/ride-requests/${done.rideId}/rating`, tokens.nusrat).send({ stars: 1 })).status, 409, 'only once');
  assert.equal((await authed('post', `/api/v1/ride-requests/${done.rideId}/rating`, tokens.jashim).send({ stars: 4 })).status, 201, 'the driver rates the passenger');

  assert.deepEqual((await authed('get', `/api/v1/users/${ids.jashim}/rating`, tokens.nusrat)).body.rating, { average: 5, count: 1 });
  assert.deepEqual((await authed('get', `/api/v1/users/${ids.nusrat}/rating`, tokens.jashim)).body.rating, { average: 4, count: 1 });
  assert.equal((await mine('nusrat')).find((r) => r.id === done.rideId).rated, true, 'the app can hide the prompt');

  // A second ride: the driver sees the passenger's average on the open board; the passenger sees the driver's.
  const next = await ride('nusrat');
  const open = (await authed('get', '/api/v1/ride-requests/open', tokens.jashim)).body.rideRequests.find((r) => r.id === next.body.rideRequest.id);
  assert.equal(Number(open.passenger_rating), 4);
  await accept(next.body.rideRequest.id);
  assert.deepEqual((await mine('nusrat')).find((r) => r.id === next.body.rideRequest.id).trip.driverRating, { average: 5, count: 1 });
});

// ---------- driver verification ----------

test('with verification required, a driver cannot go online until an admin approves, and the review is audited and notified', async () => {
  process.env.REQUIRE_VERIFIED_DRIVERS = 'true';
  try {
    const signup = await request(app).post('/api/v1/auth/signup').send({ name: 'New Driver', email: `nd-${Date.now()}@dhakateslapool.test`, password: 'password123', role: 'driver' });
    const t = signup.body.accessToken;
    const driverId = signup.body.user.id;
    const tesla = (await authed('post', '/api/v1/teslas', t).send({ name: 'Rocket', capacity: 3 })).body.tesla;
    const goOnline = () => authed('patch', `/api/v1/teslas/${tesla.id}/active`, t).send({ isActive: true });

    assert.equal((await goOnline()).status, 403, 'never submitted');
    assert.equal((await authed('put', '/api/v1/drivers/me/profile', t).send({ licenseNumber: 'ab', vehiclePlate: 'DHK-1' })).status, 422);
    const submitted = await authed('put', '/api/v1/drivers/me/profile', t).send({ licenseNumber: 'DL-998877', vehiclePlate: 'dhaka-metro-1' });
    assert.equal(submitted.body.profile.status, 'PENDING');
    assert.equal(submitted.body.profile.vehicle_plate, 'DHAKA-METRO-1', 'normalised');
    const pending = await goOnline();
    assert.equal(pending.status, 403);
    assert.match(pending.body.error, /still being verified/);

    // Only an administrator can review — not a passenger, not the driver, not a "both" account.
    const both = await request(app).post('/api/v1/auth/signup').send({ name: 'Both', email: `both-${Date.now()}@dhakateslapool.test`, password: 'password123', role: 'both' });
    for (const who of [tokens.nusrat, tokens.jashim, t, both.body.accessToken]) {
      assert.equal((await authed('get', '/api/v1/admin/drivers', who)).status, 403);
      assert.equal((await authed('post', `/api/v1/admin/drivers/${driverId}/verify`, who).send({})).status, 403);
    }
    assert.equal((await request(app).get('/api/v1/admin/stats')).status, 401);

    assert.equal((await authed('post', `/api/v1/admin/drivers/${driverId}/reject`, tokens.admin).send({})).status, 422, 'a rejection must say why');
    assert.equal((await authed('post', `/api/v1/admin/drivers/${driverId}/reject`, tokens.admin).send({ note: 'Plate photo unreadable' })).status, 204);
    const rejected = await goOnline();
    assert.equal(rejected.status, 403);
    assert.match(rejected.body.error, /Plate photo unreadable/);

    const list = await authed('get', '/api/v1/admin/drivers?status=REJECTED', tokens.admin);
    assert.equal(list.body.drivers.find((d) => d.user_id === driverId).license_number, 'DL-998877');
    assert.equal((await authed('get', '/api/v1/admin/drivers?status=BOGUS', tokens.admin)).status, 422);

    // Resubmitting the SAME details keeps a rejection; CHANGED details go back to review.
    await authed('put', '/api/v1/drivers/me/profile', t).send({ licenseNumber: 'DL-998877', vehiclePlate: 'DHAKA-METRO-2' });
    assert.equal((await authed('get', '/api/v1/drivers/me/profile', t)).body.profile.status, 'PENDING');

    assert.equal((await authed('post', `/api/v1/admin/drivers/${driverId}/verify`, tokens.admin).send({})).status, 204);
    assert.equal((await goOnline()).status, 200);
    await settle();
    const types = (await pool.query('SELECT type FROM notifications WHERE user_id = $1 ORDER BY created_at', [driverId])).rows.map((r) => r.type);
    assert.deepEqual(types, ['DRIVER_REJECTED', 'DRIVER_VERIFIED']);

    // Switching the requirement off restores the open demo behaviour.
    process.env.REQUIRE_VERIFIED_DRIVERS = 'false';
    const fresh = await request(app).post('/api/v1/auth/signup').send({ name: 'Open Driver', email: `od-${Date.now()}@dhakateslapool.test`, password: 'password123', role: 'driver' });
    const t2 = (await authed('post', '/api/v1/teslas', fresh.body.accessToken).send({ name: 'Free', capacity: 2 })).body.tesla;
    assert.equal((await authed('patch', `/api/v1/teslas/${t2.id}/active`, fresh.body.accessToken).send({ isActive: true })).status, 200);
  } finally {
    delete process.env.REQUIRE_VERIFIED_DRIVERS;
  }
});

// ---------- share my trip ----------

test('a shared trip link works without an account, shows only safe details, and can be revoked', async () => {
  const { rideId, poolId } = await matched('nusrat');
  assert.equal((await authed('post', `/api/v1/ride-requests/${rideId}/share`, tokens.rafiq).send({})).status, 403, "not someone else's ride");
  assert.equal((await authed('post', `/api/v1/ride-requests/${rideId}/share`, tokens.jashim).send({})).status, 403, 'drivers cannot create it');
  const created = await authed('post', `/api/v1/ride-requests/${rideId}/share`, tokens.nusrat).send({});
  assert.equal(created.status, 201);
  const { token } = created.body;
  assert.ok(token.length >= 30);
  const stored = (await pool.query('SELECT token_hash FROM trip_shares')).rows;
  assert.ok(stored.every((s) => s.token_hash !== token && s.token_hash.length === 64), 'only a hash is stored');

  const banani = (await pool.query('SELECT latitude, longitude FROM zones WHERE name = $1', ['Banani'])).rows[0];
  await authed('post', `/api/v1/pools/${poolId}/location`, tokens.jashim).send({ latitude: banani.latitude, longitude: banani.longitude });

  const view = await request(app).get(`/api/v1/trips/${token}`); // NO Authorization header
  assert.equal(view.status, 200);
  assert.equal(view.headers['cache-control'], 'no-store');
  const t = view.body.trip;
  assert.deepEqual([t.passengerFirstName, t.pickup, t.destination, t.status], ['Nusrat', 'Banani', 'Mohakhali', 'MATCHED']);
  assert.deepEqual([t.driverFirstName, t.teslaName, t.vehiclePlate], ['Jashim', 'Bullet', 'DHAKA-DEMO-01']);
  assert.ok(t.location);
  const raw = JSON.stringify(view.body);
  for (const secret of ['@dhakateslapool', '+88017', 'password', 'email', 'phone', ids.nusrat, ids.jashim, rideId]) assert.ok(!raw.includes(secret), `leaked: ${secret}`);

  // A new link replaces the old one.
  const second = await authed('post', `/api/v1/ride-requests/${rideId}/share`, tokens.nusrat).send({});
  assert.equal((await request(app).get(`/api/v1/trips/${token}`)).status, 404, 'the first link is dead');
  assert.equal((await request(app).get(`/api/v1/trips/${second.body.token}`)).status, 200);

  assert.equal((await authed('delete', `/api/v1/ride-requests/${rideId}/share`, tokens.nusrat)).status, 204);
  assert.equal((await request(app).get(`/api/v1/trips/${second.body.token}`)).status, 404);
  for (const bad of ['nope', 'x'.repeat(40), '../../etc/passwd']) assert.equal((await request(app).get(`/api/v1/trips/${bad}`)).status, 404, bad);
});

test('a share link stops working when it expires or the trip ended a while ago', async () => {
  const done = await completed('nusrat');
  // A completed ride cannot get a NEW link...
  assert.equal((await authed('post', `/api/v1/ride-requests/${done.rideId}/share`, tokens.nusrat).send({})).status, 409);
  // ...and an old one goes dark an hour after the trip, or at its expiry.
  const live = await matched('rafiq');
  const link = (await authed('post', `/api/v1/ride-requests/${live.rideId}/share`, tokens.rafiq).send({})).body.token;
  assert.equal((await request(app).get(`/api/v1/trips/${link}`)).status, 200);
  await pool.query(`UPDATE trip_shares SET expires_at = now() - interval '1 minute'`);
  assert.equal((await request(app).get(`/api/v1/trips/${link}`)).status, 404, 'expired');
});

// ---------- admin ----------

test('the admin console shows service health, lists rides, and tells the full story of one ride', async () => {
  const done = await completed('nusrat', { paymentMethod: 'TESLAPAY' });
  const stats = (await authed('get', '/api/v1/admin/stats', tokens.admin)).body;
  assert.equal(stats.users.admin, 1);
  assert.ok(stats.ridesLast30Days.COMPLETED >= 1);
  assert.ok(stats.payments.some((p) => p.method === 'TESLAPAY' && p.status === 'PAID'));

  const rides = (await authed('get', '/api/v1/admin/rides?status=COMPLETED&limit=5', tokens.admin)).body.rides;
  assert.ok(rides.length >= 1 && rides.every((r) => r.status === 'COMPLETED'));
  assert.equal((await authed('get', '/api/v1/admin/rides?status=NOPE', tokens.admin)).status, 422);
  assert.equal((await authed('get', '/api/v1/admin/rides?limit=0', tokens.admin)).status, 422);

  const detail = (await authed('get', `/api/v1/admin/rides/${done.rideId}`, tokens.admin)).body;
  assert.equal(detail.payment.method, 'TESLAPAY');
  assert.equal(detail.ledger.length, 2);
  assert.ok(detail.history.some((h) => h.to_status === 'COMPLETED'));
  assert.ok(!JSON.stringify(detail).includes('password_hash'));

  assert.equal((await authed('get', '/api/v1/admin/reconcile', tokens.admin)).body.ok, true);
  assert.equal((await authed('get', '/api/v1/admin/rides/00000000-0000-0000-0000-000000000000', tokens.admin)).status, 404);
});
