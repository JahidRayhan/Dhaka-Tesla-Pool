const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { request, app, login } = require('./helpers');
const { pool, resetTransactionalTables } = require('./db');
const { expireStaleProposals } = require('../src/services/consentService');
const { CONSENT_TIMEOUT_MINUTES } = require('../src/config/timeouts');

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

const authed = (method, path, token) => request(app)[method](path).set('Authorization', `Bearer ${token}`);
const requestRide = (token) =>
  authed('post', '/api/ride-requests', token).send({ pickupZoneId: zones.Banani, destinationZoneId: zones.Mohakhali });
const accept = (rideId, body) => authed('post', `/api/ride-requests/${rideId}/accept`, tokens.jashim).send({ teslaId, ...body });
const backdate = (minutes) =>
  pool.query(`UPDATE pool_join_consents SET created_at = now() - make_interval(mins => $1) WHERE decision = 'PENDING'`, [minutes]);
const rideRow = async (id) => (await pool.query('SELECT status, pool_id, matched_at, driver_arrived_at FROM ride_requests WHERE id = $1', [id])).rows[0];
const poolRow = async (id) => (await pool.query('SELECT status, seats_occupied, cancelled_at FROM pools WHERE id = $1', [id])).rows[0];

/** Nusrat is MATCHED in Bullet; Rafiq has been proposed and nobody has answered yet. */
async function openProposal() {
  const nusrat = await requestRide(tokens.nusrat);
  const first = await accept(nusrat.body.rideRequest.id);
  const poolId = first.body.poolId;
  const rafiq = await requestRide(tokens.rafiq);
  const joined = await accept(rafiq.body.rideRequest.id, { poolId });
  assert.equal(joined.status, 200);
  assert.equal((await rideRow(rafiq.body.rideRequest.id)).status, 'PENDING_CONFIRMATION');
  return { poolId, nusratId: nusrat.body.rideRequest.id, rafiqId: rafiq.body.rideRequest.id };
}

// ---------- consent timeout ----------

test('the timeout is a fixed 5 minutes', () => {
  assert.equal(CONSENT_TIMEOUT_MINUTES, 5);
});

test('an unanswered proposal past the timeout counts as a no: newcomer re-queued, seat freed, audit says why', async () => {
  const { poolId, nusratId, rafiqId } = await openProposal();
  await backdate(CONSENT_TIMEOUT_MINUTES + 1);

  // Nobody calls expire explicitly — just reading their rides is enough.
  const mine = await authed('get', '/api/ride-requests/mine', tokens.rafiq);
  assert.equal(mine.status, 200);
  assert.equal(mine.body.rideRequests[0].status, 'REQUESTED');
  assert.equal(mine.body.rideRequests[0].consentExpiresAt, null);

  assert.deepEqual(await rideRow(rafiqId).then((r) => [r.status, r.pool_id]), ['REQUESTED', null]);
  const p = await poolRow(poolId);
  assert.equal(p.status, 'MATCHED');
  assert.equal(p.seats_occupied, 1, "only Nusrat's seat is still held");
  assert.equal((await rideRow(nusratId)).status, 'MATCHED', 'the existing member is unaffected');

  const { rows: decisions } = await pool.query('SELECT decision FROM pool_join_consents');
  assert.ok(decisions.every((d) => d.decision === 'EXPIRED'), 'recorded as EXPIRED, not DECLINED');

  const { rows: history } = await pool.query(
    `SELECT note, changed_by FROM status_history WHERE entity_id = $1 AND from_status = 'PENDING_CONFIRMATION' AND to_status = 'REQUESTED'`,
    [rafiqId],
  );
  assert.equal(history.length, 1);
  assert.match(history[0].note, /timed out/);
  assert.equal(history[0].changed_by, null, 'recorded as the system, not a person');
});

test('before the timeout nothing changes, and both sides can see when it runs out', async () => {
  const { rafiqId } = await openProposal();
  await backdate(CONSENT_TIMEOUT_MINUTES - 1);

  const rafiqView = await authed('get', '/api/ride-requests/mine', tokens.rafiq);
  assert.equal(rafiqView.body.rideRequests[0].status, 'PENDING_CONFIRMATION');
  const expiresAt = new Date(rafiqView.body.rideRequests[0].consentExpiresAt).getTime();
  assert.ok(Math.abs(expiresAt - (Date.now() + 60_000)) < 15_000, 'about one minute left');

  const nusratView = await authed('get', '/api/ride-requests/mine', tokens.nusrat);
  assert.ok(nusratView.body.rideRequests[0].pendingConsents[0].expiresAt);
  assert.equal((await rideRow(rafiqId)).status, 'PENDING_CONFIRMATION');
});

test('answering after the timeout is rejected with 409', async () => {
  const { rafiqId } = await openProposal();
  const nusratView = await authed('get', '/api/ride-requests/mine', tokens.nusrat);
  const consentId = nusratView.body.rideRequests[0].pendingConsents[0].id;

  await backdate(CONSENT_TIMEOUT_MINUTES + 1);

  const lateMember = await authed('post', `/api/pool-consents/${consentId}/approve`, tokens.nusrat);
  assert.equal(lateMember.status, 409);
  const lateJoiner = await authed('post', `/api/ride-requests/${rafiqId}/confirm`, tokens.rafiq);
  assert.equal(lateJoiner.status, 409);
  assert.equal((await rideRow(rafiqId)).status, 'REQUESTED');
});

test('an expired proposal stops blocking the driver from marking arrival', async () => {
  const { poolId } = await openProposal();
  const blocked = await authed('patch', `/api/pools/${poolId}/arrive`, tokens.jashim);
  assert.equal(blocked.status, 409);

  await backdate(CONSENT_TIMEOUT_MINUTES + 1);
  const arrived = await authed('patch', `/api/pools/${poolId}/arrive`, tokens.jashim);
  assert.equal(arrived.status, 204);
  assert.equal((await poolRow(poolId)).status, 'DRIVER_ARRIVED');
});

test('the background sweep expires proposals on its own, and is idempotent', async () => {
  const { rafiqId } = await openProposal();
  assert.equal(await expireStaleProposals(), 0, 'nothing is stale yet');
  await backdate(CONSENT_TIMEOUT_MINUTES + 1);
  assert.equal(await expireStaleProposals(), 1);
  assert.equal(await expireStaleProposals(), 0, 'running it again changes nothing');
  assert.equal((await rideRow(rafiqId)).status, 'REQUESTED');
});

test('a proposal everyone already agreed to is never expired afterwards', async () => {
  const { rafiqId } = await openProposal();
  const nusratView = await authed('get', '/api/ride-requests/mine', tokens.nusrat);
  const consentId = nusratView.body.rideRequests[0].pendingConsents[0].id;
  assert.equal((await authed('post', `/api/ride-requests/${rafiqId}/confirm`, tokens.rafiq)).status, 204);
  assert.equal((await authed('post', `/api/pool-consents/${consentId}/approve`, tokens.nusrat)).status, 204);
  assert.equal((await rideRow(rafiqId)).status, 'MATCHED');

  await pool.query(`UPDATE pool_join_consents SET created_at = now() - interval '1 hour'`);
  assert.equal(await expireStaleProposals(), 0);
  assert.equal((await rideRow(rafiqId)).status, 'MATCHED');
});

// ---------- driver cancels a pool ----------

test('driver cancels a MATCHED pool: passengers go back to the queue, Tesla is free again', async () => {
  const nusrat = await requestRide(tokens.nusrat);
  const first = await accept(nusrat.body.rideRequest.id);
  const poolId = first.body.poolId;

  const res = await authed('patch', `/api/pools/${poolId}/cancel`, tokens.jashim).send({ reason: 'flat tyre' });
  assert.equal(res.status, 204);

  const p = await poolRow(poolId);
  assert.deepEqual([p.status, p.seats_occupied], ['CANCELLED', 0]);
  assert.ok(p.cancelled_at);
  const r = await rideRow(nusrat.body.rideRequest.id);
  assert.deepEqual([r.status, r.pool_id, r.matched_at], ['REQUESTED', null, null]);

  const { rows: history } = await pool.query(
    `SELECT entity_type, to_status, note FROM status_history WHERE note LIKE '%cancelled the pool%' ORDER BY id`,
  );
  assert.deepEqual(history.map((h) => [h.entity_type, h.to_status]), [['pool', 'CANCELLED'], ['ride_request', 'REQUESTED']]);
  assert.ok(history.every((h) => /flat tyre/.test(h.note)));

  // The passenger can be picked up again — by a new pool.
  const again = await accept(nusrat.body.rideRequest.id);
  assert.equal(again.status, 200);
  assert.notEqual(again.body.poolId, poolId);
});

test('cancelling a pool with an open proposal re-queues everyone and withdraws the questions', async () => {
  const { poolId, nusratId, rafiqId } = await openProposal();
  assert.equal((await authed('patch', `/api/pools/${poolId}/cancel`, tokens.jashim).send({})).status, 204);

  assert.equal((await rideRow(nusratId)).status, 'REQUESTED');
  assert.equal((await rideRow(rafiqId)).status, 'REQUESTED');
  const { rows } = await pool.query(`SELECT DISTINCT decision FROM pool_join_consents`);
  assert.deepEqual(rows.map((r) => r.decision), ['VOID']);
  assert.equal((await poolRow(poolId)).seats_occupied, 0);
});

test('a pool can be cancelled after the driver arrives, but never once the trip has started', async () => {
  const nusrat = await requestRide(tokens.nusrat);
  const { body: { poolId } } = await accept(nusrat.body.rideRequest.id);
  assert.equal((await authed('patch', `/api/pools/${poolId}/arrive`, tokens.jashim)).status, 204);
  assert.equal((await authed('patch', `/api/pools/${poolId}/start`, tokens.jashim)).status, 204);

  const tooLate = await authed('patch', `/api/pools/${poolId}/cancel`, tokens.jashim).send({});
  assert.equal(tooLate.status, 409);
  assert.equal((await poolRow(poolId)).status, 'STARTED');
  assert.equal((await rideRow(nusrat.body.rideRequest.id)).status, 'STARTED');

  // And a DRIVER_ARRIVED pool can still be cancelled.
  await authed('patch', `/api/pools/${poolId}/complete`, tokens.jashim);
  const second = await requestRide(tokens.rafiq);
  const { body: { poolId: secondPool } } = await accept(second.body.rideRequest.id);
  await authed('patch', `/api/pools/${secondPool}/arrive`, tokens.jashim);
  assert.equal((await authed('patch', `/api/pools/${secondPool}/cancel`, tokens.jashim).send({})).status, 204);
  assert.equal((await rideRow(second.body.rideRequest.id)).driver_arrived_at, null);

  // Cancelling twice is a conflict, not a silent success.
  assert.equal((await authed('patch', `/api/pools/${secondPool}/cancel`, tokens.jashim).send({})).status, 409);
});

test('only the pool\'s own driver can cancel it, and input is validated', async () => {
  const nusrat = await requestRide(tokens.nusrat);
  const { body: { poolId } } = await accept(nusrat.body.rideRequest.id);

  assert.equal((await authed('patch', `/api/pools/${poolId}/cancel`, tokens.nusrat).send({})).status, 403, 'a passenger');
  const stranger = await request(app).post('/api/auth/signup').send({
    name: 'Other Driver', email: `other-${Date.now()}@dhakateslapool.test`, password: 'password123', role: 'driver',
  });
  assert.equal((await authed('patch', `/api/pools/${poolId}/cancel`, stranger.body.token).send({})).status, 403, 'another driver');
  assert.equal((await request(app).patch(`/api/pools/${poolId}/cancel`).send({})).status, 401, 'no token');

  assert.equal((await authed('patch', '/api/pools/not-a-uuid/cancel', tokens.jashim).send({})).status, 400);
  assert.equal((await authed('patch', '/api/pools/00000000-0000-0000-0000-000000000000/cancel', tokens.jashim).send({})).status, 404);
  assert.equal((await authed('patch', `/api/pools/${poolId}/cancel`, tokens.jashim).send({ reason: 'x'.repeat(201) })).status, 422);
  assert.equal((await poolRow(poolId)).status, 'MATCHED', 'none of the rejected attempts changed anything');
});

// ---------- concurrency: opposite lock orders used to deadlock ----------

test('a passenger cancelling at the same instant as the driver cancels the pool never causes a server error', async () => {
  const statuses = [];
  for (let i = 0; i < 15; i++) {
    await resetTransactionalTables();
    const r = await requestRide(tokens.nusrat);
    const a = await accept(r.body.rideRequest.id);
    const [byPassenger, byDriver] = await Promise.all([
      authed('patch', `/api/ride-requests/${r.body.rideRequest.id}/cancel`, tokens.nusrat).send({}),
      authed('patch', `/api/pools/${a.body.poolId}/cancel`, tokens.jashim).send({}),
    ]);
    statuses.push(byPassenger.status, byDriver.status);
    // Whoever lost the race gets a clean 409; the end state is consistent either way.
    const ride = await rideRow(r.body.rideRequest.id);
    assert.ok(['CANCELLED', 'REQUESTED'].includes(ride.status), `ride ended as ${ride.status}`);
    assert.equal((await poolRow(a.body.poolId)).status, 'CANCELLED');
  }
  assert.deepEqual(statuses.filter((s) => s >= 500), [], 'no 5xx — deadlocks must surface as a retryable 409');
});

test('a member cancelling while the newcomer answers the proposal leaves consistent state and no server error', async () => {
  const statuses = [];
  for (let i = 0; i < 10; i++) {
    await resetTransactionalTables();
    const { nusratId, rafiqId, poolId } = await openProposal();
    const [cancelled, confirmed] = await Promise.all([
      authed('patch', `/api/ride-requests/${nusratId}/cancel`, tokens.nusrat).send({}),
      authed('post', `/api/ride-requests/${rafiqId}/confirm`, tokens.rafiq),
    ]);
    statuses.push(cancelled.status, confirmed.status);
    const p = await poolRow(poolId);
    const { rows } = await pool.query(
      `SELECT COALESCE(SUM(seats_requested), 0)::int AS held FROM ride_requests
       WHERE pool_id = $1 AND status IN ('PENDING_CONFIRMATION', 'MATCHED')`,
      [poolId],
    );
    assert.equal(p.seats_occupied >= rows[0].held, true, 'seats held never fall below live members');
    assert.ok(p.seats_occupied <= 3, 'never above capacity');
  }
  assert.deepEqual(statuses.filter((s) => s >= 500), []);
});

test('deadlocks and serialization failures are reported as a retryable 409, not a 500', () => {
  const { errorHandler } = require('../src/middleware/errorHandler');
  for (const code of ['40P01', '40001']) {
    let sent;
    const res = { status(s) { sent = { status: s }; return this; }, json(b) { sent.body = b; return this; } };
    errorHandler(Object.assign(new Error('x'), { code }), {}, res, () => {});
    assert.equal(sent.status, 409, code);
    assert.match(sent.body.error, /try again/);
  }
});
