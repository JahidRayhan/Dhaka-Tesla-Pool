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

// The joiner confirming for themselves.
function confirmAs(token, rideRequestId) {
  return request(app).post(`/api/ride-requests/${rideRequestId}/confirm`).set('Authorization', `Bearer ${token}`);
}

// An existing member answering "are you OK sharing with this newcomer?".
async function pendingConsentsOf(token) {
  const res = await request(app).get('/api/ride-requests/mine').set('Authorization', `Bearer ${token}`);
  return res.body.rideRequests.flatMap((r) => r.pendingConsents);
}
async function answerAll(token, verb) {
  const pending = await pendingConsentsOf(token);
  for (const c of pending) {
    await request(app).post(`/api/pool-consents/${c.id}/${verb}`).set('Authorization', `Bearer ${token}`);
  }
  return pending.length;
}
const statusOf = async (token, id) =>
  (await request(app).get(`/api/ride-requests/${id}`).set('Authorization', `Bearer ${token}`)).body.rideRequest;

// Nusrat rides Banani -> Farmgate (via the Mohakhali junction) in a fresh pool;
// returns the pool id and her request id.
async function nusratStartsPool() {
  const nusrat = await requestRide(tokens.nusrat, { destination: 'Farmgate' });
  const accept = await acceptRide(nusrat.body.rideRequest.id, { teslaId });
  return { poolId: accept.body.poolId, nusratId: nusrat.body.rideRequest.id };
}
// Rafiq is picked up ALONG THE WAY (at Mohakhali) and also heads to Farmgate.
const rafiqRequests = () => requestRide(tokens.rafiq, { pickup: 'Mohakhali', destination: 'Farmgate' });

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

test('pooled fares finalize with the 20% discount only once the trip STARTS, and only after ALL parties agree', async () => {
  const { poolId, nusratId } = await nusratStartsPool();
  const rafiq = await rafiqRequests();
  const rafiqId = rafiq.body.rideRequest.id;

  const join = await acceptRide(rafiqId, { teslaId, poolId });
  assert.equal(join.status, 200);
  assert.equal(join.body.rideRequestStatus, 'PENDING_CONFIRMATION');

  // Rafiq agreeing is not enough — Nusrat, already in the pool, has a say too.
  assert.equal((await confirmAs(tokens.rafiq, rafiqId)).status, 204);
  const midway = await statusOf(tokens.rafiq, rafiqId);
  assert.equal(midway.status, 'PENDING_CONFIRMATION');
  assert.deepEqual(midway.waitingOn, ['Nusrat']);
  assert.equal(midway.ownConsentPending, false);

  // Nusrat sees who is being proposed, and where they're going.
  const asked = await pendingConsentsOf(tokens.nusrat);
  assert.equal(asked.length, 1);
  assert.equal(asked[0].joinerName, 'Rafiq');
  assert.equal(asked[0].joinerDestination, 'Farmgate');

  assert.equal(await answerAll(tokens.nusrat, 'approve'), 1);
  assert.equal((await statusOf(tokens.rafiq, rafiqId)).status, 'MATCHED');

  // No discount yet — it only finalizes once the pool's membership is locked in.
  assert.equal((await statusOf(tokens.nusrat, nusratId)).pool_discount_paisa, '0');

  await request(app).patch(`/api/pools/${poolId}/arrive`).set('Authorization', `Bearer ${tokens.jashim}`);
  await request(app).patch(`/api/pools/${poolId}/start`).set('Authorization', `Bearer ${tokens.jashim}`);

  const nusratFinal = await statusOf(tokens.nusrat, nusratId);
  const rafiqFinal = await statusOf(tokens.rafiq, rafiqId);
  assert.equal(nusratFinal.final_fare_paisa, '8326'); // 3000 + 6658 - 1332
  assert.equal(rafiqFinal.final_fare_paisa, '6589'); // 3000 + 4486 - 897

  // Each can see the other, but never the other's fare.
  assert.deepEqual(nusratFinal.poolmates, [{ name: 'Rafiq', destination: 'Farmgate' }]);
});

test('with two people already in the pool, a newcomer needs BOTH of them to agree, not just one', async () => {
  const { poolId } = await nusratStartsPool();
  const rafiq = await rafiqRequests();
  await acceptRide(rafiq.body.rideRequest.id, { teslaId, poolId });
  await confirmAs(tokens.rafiq, rafiq.body.rideRequest.id);
  await answerAll(tokens.nusrat, 'approve');

  // Shirin's Banani -> Mohakhali is a stretch of the same road, same direction.
  const shirin = await requestRide(tokens.shirin, { destination: 'Mohakhali' });
  const shirinId = shirin.body.rideRequest.id;
  assert.equal((await acceptRide(shirinId, { teslaId, poolId })).status, 200);

  await confirmAs(tokens.shirin, shirinId);
  await answerAll(tokens.nusrat, 'approve');
  assert.equal((await statusOf(tokens.shirin, shirinId)).status, 'PENDING_CONFIRMATION'); // Rafiq hasn't answered

  assert.equal(await answerAll(tokens.rafiq, 'approve'), 1);
  assert.equal((await statusOf(tokens.shirin, shirinId)).status, 'MATCHED');
});

test('one existing member saying no is enough: the newcomer is removed and the seat freed', async () => {
  const { poolId } = await nusratStartsPool();
  const rafiq = await rafiqRequests();
  const rafiqId = rafiq.body.rideRequest.id;
  await acceptRide(rafiqId, { teslaId, poolId });
  await confirmAs(tokens.rafiq, rafiqId); // the newcomer is happy...

  assert.equal(await answerAll(tokens.nusrat, 'reject'), 1); // ...but Nusrat isn't

  const after = await statusOf(tokens.rafiq, rafiqId);
  assert.equal(after.status, 'REQUESTED');
  assert.equal(after.pool_id, null);
  const { rows } = await pool.query('SELECT seats_occupied FROM pools WHERE id = $1', [poolId]);
  assert.equal(rows[0].seats_occupied, 1); // only Nusrat's seat remains

  // The pool isn't left unresolved: the driver may propose someone else, or Rafiq again.
  assert.equal((await acceptRide(rafiqId, { teslaId, poolId })).status, 200);
});

test('a newcomer can decline for themselves, freeing the seat and returning to REQUESTED', async () => {
  const { poolId } = await nusratStartsPool();
  const rafiq = await rafiqRequests();
  const rafiqId = rafiq.body.rideRequest.id;
  await acceptRide(rafiqId, { teslaId, poolId });

  const decline = await request(app)
    .post(`/api/ride-requests/${rafiqId}/decline`)
    .set('Authorization', `Bearer ${tokens.rafiq}`);
  assert.equal(decline.status, 204);

  const after = await statusOf(tokens.rafiq, rafiqId);
  assert.equal(after.status, 'REQUESTED');
  assert.equal(after.pool_id, null);
  // Nusrat is no longer being asked about someone who withdrew.
  assert.equal((await pendingConsentsOf(tokens.nusrat)).length, 0);
});

test('a driver cannot mark arrival while a newcomer is still waiting on the pool to agree', async () => {
  const { poolId } = await nusratStartsPool();
  const rafiq = await rafiqRequests();
  await acceptRide(rafiq.body.rideRequest.id, { teslaId, poolId }); // nobody answers

  const arrive = await request(app).patch(`/api/pools/${poolId}/arrive`).set('Authorization', `Bearer ${tokens.jashim}`);
  assert.equal(arrive.status, 409);
});

test('the driver cannot propose a second newcomer while the first proposal is still unresolved', async () => {
  const { poolId } = await nusratStartsPool();
  const rafiq = await rafiqRequests();
  await acceptRide(rafiq.body.rideRequest.id, { teslaId, poolId });

  const shirin = await requestRide(tokens.shirin, { destination: 'Mohakhali' });
  const second = await acceptRide(shirin.body.rideRequest.id, { teslaId, poolId });
  assert.equal(second.status, 409);
});

test('if the last member whose answer was outstanding cancels, the newcomer is not left stuck waiting', async () => {
  const { poolId, nusratId } = await nusratStartsPool();
  const rafiq = await rafiqRequests();
  const rafiqId = rafiq.body.rideRequest.id;
  await acceptRide(rafiqId, { teslaId, poolId });
  await confirmAs(tokens.rafiq, rafiqId); // only Nusrat's answer is outstanding

  const cancel = await request(app)
    .patch(`/api/ride-requests/${nusratId}/cancel`)
    .set('Authorization', `Bearer ${tokens.nusrat}`);
  assert.equal(cancel.status, 204);

  // Nusrat can never answer now, so Rafiq isn't held hostage to a reply that won't come.
  assert.equal((await statusOf(tokens.rafiq, rafiqId)).status, 'MATCHED');
});

test('a newcomer who cancels while pending withdraws the question from everyone they were asking', async () => {
  const { poolId } = await nusratStartsPool();
  const rafiq = await rafiqRequests();
  const rafiqId = rafiq.body.rideRequest.id;
  await acceptRide(rafiqId, { teslaId, poolId });
  assert.equal((await pendingConsentsOf(tokens.nusrat)).length, 1);

  await request(app).patch(`/api/ride-requests/${rafiqId}/cancel`).set('Authorization', `Bearer ${tokens.rafiq}`);
  assert.equal((await pendingConsentsOf(tokens.nusrat)).length, 0);
});

test("a passenger cannot answer a sharing question that was put to someone else", async () => {
  const { poolId } = await nusratStartsPool();
  const rafiq = await rafiqRequests();
  await acceptRide(rafiq.body.rideRequest.id, { teslaId, poolId });
  const [question] = await pendingConsentsOf(tokens.nusrat);

  const res = await request(app)
    .post(`/api/pool-consents/${question.id}/approve`)
    .set('Authorization', `Bearer ${tokens.shirin}`);
  assert.equal(res.status, 403);
});

test('a sharing question can only be answered once', async () => {
  const { poolId } = await nusratStartsPool();
  const rafiq = await rafiqRequests();
  await acceptRide(rafiq.body.rideRequest.id, { teslaId, poolId });
  const [question] = await pendingConsentsOf(tokens.nusrat);

  const first = await request(app).post(`/api/pool-consents/${question.id}/approve`).set('Authorization', `Bearer ${tokens.nusrat}`);
  const again = await request(app).post(`/api/pool-consents/${question.id}/reject`).set('Authorization', `Bearer ${tokens.nusrat}`);
  assert.equal(first.status, 204);
  assert.equal(again.status, 409); // can't retroactively veto after the fact
});

test('a passenger cannot confirm or decline a ride that is not awaiting confirmation', async () => {
  const nusratReq = await requestRide(tokens.nusrat, { destination: 'Mohakhali' });
  const confirm = await confirmAs(tokens.nusrat, nusratReq.body.rideRequest.id); // still REQUESTED
  assert.equal(confirm.status, 409);
});

test("a passenger cannot confirm someone else's pending ride request", async () => {
  const { poolId } = await nusratStartsPool();
  const rafiq = await rafiqRequests();
  await acceptRide(rafiq.body.rideRequest.id, { teslaId, poolId });

  const res = await confirmAs(tokens.nusrat, rafiq.body.rideRequest.id); // Nusrat, not Rafiq
  assert.equal(res.status, 403);
});

test('matching rule: two riders who start at the SAME zone but head to opposite sides of a junction cannot pool', async () => {
  const nusrat = await requestRide(tokens.nusrat, { destination: 'Mohakhali' });
  const poolId = (await acceptRide(nusrat.body.rideRequest.id, { teslaId })).body.poolId;

  // Banani -> Gulshan 1 leaves Banani the other way from Banani -> Mohakhali.
  const rafiq = await requestRide(tokens.rafiq, { destination: 'Gulshan 1' });
  const rejected = await acceptRide(rafiq.body.rideRequest.id, { teslaId, poolId });
  assert.equal(rejected.status, 422);
});

test('matching rule: a trip onto a different branch of the junction cannot join a pool heading down another', async () => {
  const { poolId } = await nusratStartsPool(); // Banani > Mohakhali > Farmgate

  const shirin = await requestRide(tokens.shirin, { destination: 'Bashundhara' });
  const rejected = await acceptRide(shirin.body.rideRequest.id, { teslaId, poolId });
  assert.equal(rejected.status, 422);
});

test('matching rule: a trip further along the same road, in the same direction, is accepted', async () => {
  const nusrat = await requestRide(tokens.nusrat, { destination: 'Mohakhali' });
  const poolId = (await acceptRide(nusrat.body.rideRequest.id, { teslaId })).body.poolId;

  // Mirpur lies straight on past Mohakhali — the vehicle just keeps going.
  const shirin = await requestRide(tokens.shirin, { destination: 'Mirpur' });
  const joined = await acceptRide(shirin.body.rideRequest.id, { teslaId, poolId });
  assert.equal(joined.status, 200);
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

  // This driver tries to start a SECOND new pool on the same Tesla instead
  // of joining the first one — regardless of whether the routes would match.
  const second = await requestRide(tokens.rafiq, { destination: 'Gulshan 1' });
  const accept2 = await acceptRide(second.body.rideRequest.id, { teslaId }); // no poolId — attempts a new pool
  assert.equal(accept2.status, 409);

  const { rows } = await pool.query("SELECT count(*) FROM pools WHERE tesla_id = $1 AND status NOT IN ('COMPLETED','CANCELLED')", [teslaId]);
  assert.equal(rows[0].count, '1');
});
