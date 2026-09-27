// Covers PRD Section 3, Driver row: "Mark arrival, start, complete trip"
// (COMPLETED specifically — backend/tests/lifecycle.test.js exercises
// arrive and start, but nothing previously called PATCH /pools/:id/complete
// at all) and "See passengers/seats and ride history" (GET /pools/mine,
// GET /pools/:id). Also covers Section 5: "Payment: Cash or simulated
// TeslaPay wallet" — nothing previously checked that a payment record is
// actually created when a trip completes.
const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { request, app, pool, login, resetTransactionalTables } = require('./helpers');

let jashimToken, nusratToken, rafiqToken;
let zones = {};
let teslaId;

before(async () => {
  jashimToken = await login('jashim@dhakateslapool.test');
  nusratToken = await login('nusrat@dhakateslapool.test');
  rafiqToken = await login('rafiq@dhakateslapool.test');
  const { rows } = await pool.query('SELECT id, name FROM zones');
  for (const z of rows) zones[z.name] = z.id;
  const mine = await request(app).get('/api/teslas/mine').set('Authorization', `Bearer ${jashimToken}`);
  teslaId = mine.body.teslas[0].id;
});

beforeEach(async () => {
  await resetTransactionalTables();
});

after(async () => {
  await pool.end();
});

async function requestAndAccept(token, destination, poolId) {
  const req = await request(app)
    .post('/api/ride-requests')
    .set('Authorization', `Bearer ${token}`)
    .send({ pickupZoneId: zones['Banani'], destinationZoneId: zones[destination], seatsRequested: 1 });
  const accept = await request(app)
    .post(`/api/ride-requests/${req.body.rideRequest.id}/accept`)
    .set('Authorization', `Bearer ${jashimToken}`)
    .send({ teslaId, poolId });

  // Joining an EXISTING pool (poolId given) now requires the passenger's own
  // confirmation before the driver can arrive — see poolService.acceptRequest.
  // A brand-new pool's first member is auto-consented and skips this.
  if (poolId) {
    await request(app)
      .post(`/api/ride-requests/${req.body.rideRequest.id}/confirm`)
      .set('Authorization', `Bearer ${token}`);
  }

  return { rideRequestId: req.body.rideRequest.id, poolId: accept.body.poolId };
}

test('a driver can see their active pool via GET /pools/mine', async () => {
  const { poolId } = await requestAndAccept(nusratToken, 'Mohakhali');
  const res = await request(app).get('/api/pools/mine').set('Authorization', `Bearer ${jashimToken}`);
  assert.equal(res.status, 200);
  assert.ok(res.body.pools.some((p) => p.id === poolId));
});

test('GET /pools/:id shows every member with their own individual fare', async () => {
  const { poolId: p1 } = await requestAndAccept(nusratToken, 'Mohakhali');
  await requestAndAccept(rafiqToken, 'Gulshan 1', p1);

  const res = await request(app).get(`/api/pools/${p1}`).set('Authorization', `Bearer ${jashimToken}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.pool.members.length, 2);
  assert.equal(res.body.pool.seats_occupied, 2);
  const names = res.body.pool.members.map((m) => m.passenger_name).sort();
  assert.deepEqual(names, ['Nusrat', 'Rafiq']);
});

test('completing a full trip moves both the pool and every passenger to COMPLETED, and creates a payment per passenger', async () => {
  const { rideRequestId: nusratReqId, poolId } = await requestAndAccept(nusratToken, 'Mohakhali');
  const { rideRequestId: rafiqReqId } = await requestAndAccept(rafiqToken, 'Gulshan 1', poolId);

  await request(app).patch(`/api/pools/${poolId}/arrive`).set('Authorization', `Bearer ${jashimToken}`);
  await request(app).patch(`/api/pools/${poolId}/start`).set('Authorization', `Bearer ${jashimToken}`);
  const complete = await request(app).patch(`/api/pools/${poolId}/complete`).set('Authorization', `Bearer ${jashimToken}`);
  assert.equal(complete.status, 204);

  const poolRow = (await pool.query('SELECT status FROM pools WHERE id = $1', [poolId])).rows[0];
  assert.equal(poolRow.status, 'COMPLETED');

  const nusratRow = (await pool.query('SELECT status, final_fare_paisa FROM ride_requests WHERE id = $1', [nusratReqId])).rows[0];
  const rafiqRow = (await pool.query('SELECT status, final_fare_paisa FROM ride_requests WHERE id = $1', [rafiqReqId])).rows[0];
  assert.equal(nusratRow.status, 'COMPLETED');
  assert.equal(rafiqRow.status, 'COMPLETED');

  // The PRD's payment requirement (Section 5) — untested until now.
  const nusratPayment = (await pool.query('SELECT * FROM payments WHERE ride_request_id = $1', [nusratReqId])).rows[0];
  const rafiqPayment = (await pool.query('SELECT * FROM payments WHERE ride_request_id = $1', [rafiqReqId])).rows[0];

  assert.ok(nusratPayment, 'expected a payment record for Nusrat after completion');
  assert.ok(rafiqPayment, 'expected a payment record for Rafiq after completion');
  assert.equal(String(nusratPayment.amount_paisa), String(nusratRow.final_fare_paisa));
  assert.equal(String(rafiqPayment.amount_paisa), String(rafiqRow.final_fare_paisa));
  assert.equal(nusratPayment.method, 'CASH');
  assert.equal(nusratPayment.status, 'PENDING');
});

test('cannot complete a trip that has not been started yet', async () => {
  const { poolId } = await requestAndAccept(nusratToken, 'Mohakhali');
  const res = await request(app).patch(`/api/pools/${poolId}/complete`).set('Authorization', `Bearer ${jashimToken}`);
  assert.equal(res.status, 409);
});

test("a driver cannot view or advance another driver's pool", async () => {
  const { poolId } = await requestAndAccept(nusratToken, 'Mohakhali');

  // A second, unrelated driver — distinct from the role-guard tests in
  // 02-teslas-and-roles.test.js, this specifically checks the ownership
  // check inside poolService.getPoolDetail, not just "are you a driver".
  const email = `acceptance-other-driver-${Date.now()}@dhakateslapool.test`;
  const signup = await request(app)
    .post('/api/auth/signup')
    .send({ name: 'Other Driver', email, password: 'password123', role: 'driver' });
  const otherDriverToken = signup.body.token;

  const res = await request(app).get(`/api/pools/${poolId}`).set('Authorization', `Bearer ${otherDriverToken}`);
  assert.equal(res.status, 403);

  const arrive = await request(app).patch(`/api/pools/${poolId}/arrive`).set('Authorization', `Bearer ${otherDriverToken}`);
  assert.equal(arrive.status, 403);
});
