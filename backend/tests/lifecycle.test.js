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
  tokens.shirin = await login('shirin@dhakateslapool.test');

  const { rows } = await pool.query('SELECT id, name FROM zones');
  for (const z of rows) zones[z.name] = z.id;

  const teslaRes = await request(app).get('/api/teslas/mine').set('Authorization', `Bearer ${tokens.jashim}`);
  teslaId = teslaRes.body.teslas[0].id;
});

beforeEach(async () => {
  await resetTransactionalTables();
});

after(async () => {
  await pool.end();
});

function requestRide(token, { destination, seats = 1, pickup = 'Banani' }) {
  return request(app)
    .post('/api/ride-requests')
    .set('Authorization', `Bearer ${token}`)
    .send({ pickupZoneId: zones[pickup], destinationZoneId: zones[destination], seatsRequested: seats });
}

function acceptRide(rideRequestId, body) {
  return request(app)
    .post(`/api/ride-requests/${rideRequestId}/accept`)
    .set('Authorization', `Bearer ${tokens.jashim}`)
    .send(body);
}

test('passenger sees an estimated fare immediately, before any match (no discount yet)', async () => {
  const res = await requestRide(tokens.nusrat, { destination: 'Mohakhali' });
  assert.equal(res.status, 201);
  assert.equal(res.body.rideRequest.status, 'REQUESTED');
  assert.equal(res.body.rideRequest.final_fare_paisa, '5172'); // 3000 + 2172, discount = 0
});

test('a 2-seat request costs exactly double a 1-seat request on the same route', async () => {
  const oneSeat = await requestRide(tokens.nusrat, { destination: 'Mohakhali', seats: 1 });
  const twoSeats = await requestRide(tokens.rafiq, { destination: 'Mohakhali', seats: 2 });
  assert.equal(Number(twoSeats.body.rideRequest.final_fare_paisa), Number(oneSeat.body.rideRequest.final_fare_paisa) * 2);
});

test('pooled fares finalize with the 20% discount only once the trip STARTS, not at MATCHED', async () => {
  const nusratReq = await requestRide(tokens.nusrat, { destination: 'Mohakhali' });
  const rafiqReq = await requestRide(tokens.rafiq, { destination: 'Gulshan 1' });

  const accept1 = await acceptRide(nusratReq.body.rideRequest.id, { teslaId });
  assert.equal(accept1.status, 200);
  const poolId = accept1.body.poolId;

  const accept2 = await acceptRide(rafiqReq.body.rideRequest.id, { teslaId, poolId });
  assert.equal(accept2.status, 200);

  // Right after MATCHED: no discount applied yet — this is the bug caught
  // and fixed earlier (see DESIGN.md's "Correction" note).
  const beforeStart = await request(app)
    .get(`/api/ride-requests/${nusratReq.body.rideRequest.id}`)
    .set('Authorization', `Bearer ${tokens.nusrat}`);
  assert.equal(beforeStart.body.rideRequest.pool_discount_paisa, '0');

  await request(app).patch(`/api/pools/${poolId}/arrive`).set('Authorization', `Bearer ${tokens.jashim}`);
  await request(app).patch(`/api/pools/${poolId}/start`).set('Authorization', `Bearer ${tokens.jashim}`);

  const nusratFinal = await request(app)
    .get(`/api/ride-requests/${nusratReq.body.rideRequest.id}`)
    .set('Authorization', `Bearer ${tokens.nusrat}`);
  const rafiqFinal = await request(app)
    .get(`/api/ride-requests/${rafiqReq.body.rideRequest.id}`)
    .set('Authorization', `Bearer ${tokens.rafiq}`);

  assert.equal(nusratFinal.body.rideRequest.final_fare_paisa, '4738');
  assert.equal(rafiqFinal.body.rideRequest.final_fare_paisa, '5054');
});

test('matching rule rejects an incompatible route from joining an existing pool', async () => {
  const nusratReq = await requestRide(tokens.nusrat, { destination: 'Mohakhali' });
  const accept1 = await acceptRide(nusratReq.body.rideRequest.id, { teslaId });
  const poolId = accept1.body.poolId;

  // Shirin -> Mirpur is a different cluster to Nusrat's Mohakhali trip.
  const shirinReq = await requestRide(tokens.shirin, { destination: 'Mirpur' });
  const rejected = await acceptRide(shirinReq.body.rideRequest.id, { teslaId, poolId });

  assert.equal(rejected.status, 422);
});

test("Bullet's capacity is never exceeded, including under concurrent accepts for the last seat", async () => {
  // Fill 2 of 3 seats with a single 2-seat booking.
  const first = await requestRide(tokens.nusrat, { destination: 'Mohakhali', seats: 2 });
  const accept1 = await acceptRide(first.body.rideRequest.id, { teslaId });
  const poolId = accept1.body.poolId;

  const reqA = await requestRide(tokens.rafiq, { destination: 'Mohakhali' });
  const reqB = await requestRide(tokens.shirin, { destination: 'Mohakhali' });

  const [resA, resB] = await Promise.all([
    acceptRide(reqA.body.rideRequest.id, { teslaId, poolId }),
    acceptRide(reqB.body.rideRequest.id, { teslaId, poolId }),
  ]);

  // Exactly one of the two concurrent requests for the last seat succeeds.
  const statuses = [resA.status, resB.status].sort();
  assert.deepEqual(statuses, [200, 409]);

  const { rows } = await pool.query('SELECT seats_occupied FROM pools WHERE id = $1', [poolId]);
  assert.equal(rows[0].seats_occupied, 3); // never 4 — capacity is 3
});

test('invalid state transitions are rejected: cannot START before the driver has ARRIVED', async () => {
  const req = await requestRide(tokens.nusrat, { destination: 'Mohakhali' });
  const accept = await acceptRide(req.body.rideRequest.id, { teslaId });
  const poolId = accept.body.poolId;

  const res = await request(app).patch(`/api/pools/${poolId}/start`).set('Authorization', `Bearer ${tokens.jashim}`);
  assert.equal(res.status, 409);
});

test('invalid state transitions are rejected: cannot accept a request that is already MATCHED', async () => {
  const req = await requestRide(tokens.nusrat, { destination: 'Mohakhali' });
  const first = await acceptRide(req.body.rideRequest.id, { teslaId });
  assert.equal(first.status, 200);

  const second = await acceptRide(req.body.rideRequest.id, { teslaId });
  assert.equal(second.status, 409);
});

test("a passenger can't read or cancel another passenger's ride", async () => {
  const req = await requestRide(tokens.nusrat, { destination: 'Mohakhali' });
  const id = req.body.rideRequest.id;

  const read = await request(app).get(`/api/ride-requests/${id}`).set('Authorization', `Bearer ${tokens.rafiq}`);
  assert.equal(read.status, 403);

  const cancel = await request(app)
    .patch(`/api/ride-requests/${id}/cancel`)
    .set('Authorization', `Bearer ${tokens.rafiq}`);
  assert.equal(cancel.status, 403);
});

test('cancellation is allowed while REQUESTED or MATCHED, and frees the seat it held', async () => {
  const req = await requestRide(tokens.nusrat, { destination: 'Mohakhali' });
  const accept = await acceptRide(req.body.rideRequest.id, { teslaId });
  const poolId = accept.body.poolId;

  const cancel = await request(app)
    .patch(`/api/ride-requests/${req.body.rideRequest.id}/cancel`)
    .set('Authorization', `Bearer ${tokens.nusrat}`);
  assert.equal(cancel.status, 204);

  const { rows } = await pool.query('SELECT seats_occupied FROM pools WHERE id = $1', [poolId]);
  assert.equal(rows[0].seats_occupied, 0);
});

test('cancellation is rejected once the driver has ARRIVED ("cancel while valid" only)', async () => {
  const req = await requestRide(tokens.nusrat, { destination: 'Mohakhali' });
  const accept = await acceptRide(req.body.rideRequest.id, { teslaId });
  const poolId = accept.body.poolId;

  await request(app).patch(`/api/pools/${poolId}/arrive`).set('Authorization', `Bearer ${tokens.jashim}`);

  const cancel = await request(app)
    .patch(`/api/ride-requests/${req.body.rideRequest.id}/cancel`)
    .set('Authorization', `Bearer ${tokens.nusrat}`);
  assert.equal(cancel.status, 409);
});

test('every status transition is written to status_history (audit trail)', async () => {
  const req = await requestRide(tokens.nusrat, { destination: 'Mohakhali' });
  const accept = await acceptRide(req.body.rideRequest.id, { teslaId });
  const poolId = accept.body.poolId;
  await request(app).patch(`/api/pools/${poolId}/arrive`).set('Authorization', `Bearer ${tokens.jashim}`);

  const { rows } = await pool.query(
    `SELECT to_status FROM status_history WHERE entity_type = 'ride_request' AND entity_id = $1 ORDER BY changed_at`,
    [req.body.rideRequest.id],
  );
  assert.deepEqual(
    rows.map((r) => r.to_status),
    ['REQUESTED', 'MATCHED', 'DRIVER_ARRIVED'],
  );
});

test('a driver cannot accept requests using a Tesla that is not theirs', async () => {
  const req = await requestRide(tokens.nusrat, { destination: 'Mohakhali' });
  const fakeTeslaId = '00000000-0000-0000-0000-000000000000';

  const res = await acceptRide(req.body.rideRequest.id, { teslaId: fakeTeslaId });
  assert.equal(res.status, 404);
});

test('a Tesla can only run one active pool at a time', async () => {
  const first = await requestRide(tokens.nusrat, { destination: 'Mohakhali' });
  const accept1 = await acceptRide(first.body.rideRequest.id, { teslaId });
  assert.equal(accept1.status, 200);

  // Rafiq's request is route-compatible, but this driver tries to start a
  // SECOND new pool on the same Tesla instead of joining the first one.
  const second = await requestRide(tokens.rafiq, { destination: 'Gulshan 1' });
  const accept2 = await acceptRide(second.body.rideRequest.id, { teslaId }); // no poolId — attempts a new pool
  assert.equal(accept2.status, 409);

  const { rows } = await pool.query("SELECT count(*) FROM pools WHERE tesla_id = $1 AND status NOT IN ('COMPLETED','CANCELLED')", [teslaId]);
  assert.equal(rows[0].count, '1');
});
