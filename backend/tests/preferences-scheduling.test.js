const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { request, app, login } = require('./helpers');
const { pool, resetTransactionalTables } = require('./db');
const { pushOutbox } = require('../src/services/notificationService');
const rideRequestService = require('../src/services/rideRequestService');

let tokens = {};
let zones = {};
let ids = {};
let teslaId;
let points = {};

before(async () => {
  for (const n of ['jashim', 'nusrat', 'rafiq', 'shirin']) tokens[n] = await login(`${n}@dhakateslapool.test`);
  for (const z of (await pool.query('SELECT id, name FROM zones')).rows) zones[z.name] = z.id;
  for (const u of (await pool.query("SELECT id, split_part(email,'@',1) AS n FROM users")).rows) ids[u.n] = u.id;
  for (const p of (await pool.query('SELECT id, zone_id FROM meeting_points ORDER BY id')).rows) points[p.zone_id] ||= p.id;
  teslaId = (await request(app).get('/api/v1/teslas/mine').set('Authorization', `Bearer ${tokens.jashim}`)).body.teslas[0].id;
});
beforeEach(async () => {
  await resetTransactionalTables();
  await pool.query('TRUNCATE notifications, push_tokens');
  pushOutbox.length = 0;
});
after(async () => {
  await pool.end();
});

const authed = (m, p, t) => request(app)[m](p).set('Authorization', `Bearer ${t}`);
const ride = (who, extra = {}) =>
  authed('post', '/api/v1/ride-requests', tokens[who]).send({ pickupZoneId: zones.Banani, destinationZoneId: zones.Mohakhali, ...extra });
const accept = (rideId, body = {}) => authed('post', `/api/v1/ride-requests/${rideId}/accept`, tokens.jashim).send({ teslaId, ...body });
const statusOf = async (id) => (await pool.query('SELECT status, pool_id FROM ride_requests WHERE id = $1', [id])).rows[0];
const inbox = async (userId) => (await pool.query('SELECT type, title, body, data FROM notifications WHERE user_id = $1 ORDER BY created_at, id', [userId])).rows;
const settle = () => new Promise((r) => setTimeout(r, 120)); // notifications go out just after the commit

// ---------- validation of the new request options ----------

test('new request options are validated strictly', async () => {
  const bad = [
    { shareMax: 1 }, { shareMax: 7 }, { shareMax: 2.5 }, { womenOnly: 'yes' }, { maxWaitMinutes: 2 }, { maxWaitMinutes: 999 },
    { scheduledFor: 'not-a-date' }, { scheduledFor: new Date(Date.now() + 60_000).toISOString() }, { scheduledFor: new Date(Date.now() + 40 * 86400_000).toISOString() },
    { pickupPointId: 'x' }, { pickupPointId: 999999 },
  ];
  for (const extra of bad) {
    const res = await ride('nusrat', extra);
    assert.equal(res.status, 422, JSON.stringify(extra));
  }
  assert.equal(await pool.query('SELECT count(*)::int AS n FROM ride_requests').then((r) => r.rows[0].n), 0, 'nothing was created');
});

test('a meeting point must belong to the pickup zone and is shown to the driver', async () => {
  const wrongZone = await ride('nusrat', { pickupPointId: points[zones.Mohakhali] });
  assert.equal(wrongZone.status, 422);
  const ok = await ride('nusrat', { pickupPointId: points[zones.Banani] });
  assert.equal(ok.status, 201);
  const open = await authed('get', '/api/v1/ride-requests/open', tokens.jashim);
  assert.match(open.body.rideRequests[0].pickup_point_name, /Banani/);
});

// ---------- women-only ----------

test('women-only needs a declared gender, and pools only women together', async () => {
  // Rafiq (male) cannot ask for a women-only ride.
  assert.equal((await ride('rafiq', { womenOnly: true })).status, 422);

  const nusrat = await ride('nusrat', { womenOnly: true });
  assert.equal(nusrat.status, 201);
  const first = await accept(nusrat.body.rideRequest.id);
  const poolId = first.body.poolId;

  // A man cannot join a women-only pool...
  const rafiq = await ride('rafiq');
  const blocked = await accept(rafiq.body.rideRequest.id, { poolId });
  assert.equal(blocked.status, 422);
  assert.match(blocked.body.error, /women-only/);
  // ...but another woman can.
  const shirin = await ride('shirin');
  const joined = await accept(shirin.body.rideRequest.id, { poolId });
  assert.equal(joined.status, 200);
});

test('a passenger asking for women-only is never put into a pool with a man', async () => {
  const rafiq = await ride('rafiq');
  const first = await accept(rafiq.body.rideRequest.id);
  const nusrat = await ride('nusrat', { womenOnly: true });
  const res = await accept(nusrat.body.rideRequest.id, { poolId: first.body.poolId });
  assert.equal(res.status, 422);
  assert.match(res.body.error, /women-only/);
  assert.equal((await statusOf(nusrat.body.rideRequest.id)).status, 'REQUESTED');
});

// ---------- opt-in sharing ----------

test('when everyone pre-approved sharing, the newcomer is matched immediately with no questions asked', async () => {
  const nusrat = await ride('nusrat', { shareMax: 3 });
  const first = await accept(nusrat.body.rideRequest.id);
  const rafiq = await ride('rafiq', { shareMax: 3 });
  const joined = await accept(rafiq.body.rideRequest.id, { poolId: first.body.poolId });

  assert.equal(joined.status, 200);
  assert.equal(joined.body.rideRequestStatus, 'MATCHED');
  assert.equal((await statusOf(rafiq.body.rideRequest.id)).status, 'MATCHED');
  const { rows } = await pool.query(`SELECT DISTINCT decision FROM pool_join_consents`);
  assert.deepEqual(rows.map((r) => r.decision), ['ACCEPTED']);
  // The driver can go straight on: no open proposal blocks arrival.
  assert.equal((await authed('patch', `/api/v1/pools/${first.body.poolId}/arrive`, tokens.jashim)).status, 204);
});

test('pre-approval has a limit: a pool bigger than someone agreed to still asks them', async () => {
  // Nusrat is happy with up to 2 people in total. Rafiq makes 2: fine. Shirin would make 3: Nusrat is asked.
  const nusrat = await ride('nusrat', { shareMax: 2 });
  const first = await accept(nusrat.body.rideRequest.id);
  const rafiq = await ride('rafiq', { shareMax: 3 });
  assert.equal((await accept(rafiq.body.rideRequest.id, { poolId: first.body.poolId })).body.rideRequestStatus, 'MATCHED');

  const shirin = await ride('shirin', { shareMax: 3 });
  const third = await accept(shirin.body.rideRequest.id, { poolId: first.body.poolId });
  assert.equal(third.body.rideRequestStatus, 'PENDING_CONFIRMATION');
  const { rows } = await pool.query(
    `SELECT rr.passenger_id, c.decision FROM pool_join_consents c JOIN ride_requests rr ON rr.id = c.member_request_id
     WHERE c.joiner_request_id = $1`, [shirin.body.rideRequest.id]);
  const byUser = Object.fromEntries(rows.map((r) => [r.passenger_id, r.decision]));
  assert.equal(byUser[ids.nusrat], 'PENDING', 'Nusrat only agreed to 2 people');
  assert.equal(byUser[ids.rafiq], 'ACCEPTED', 'Rafiq agreed to 3');
  assert.equal(byUser[ids.shirin], 'ACCEPTED', 'so did the newcomer');
});

// ---------- scheduling and waiting ----------

test('a scheduled ride stays off the driver board until shortly before its time', async () => {
  const later = new Date(Date.now() + 3 * 3600_000).toISOString();
  const res = await ride('nusrat', { scheduledFor: later });
  assert.equal(res.status, 201);
  assert.equal((await authed('get', '/api/v1/ride-requests/open', tokens.jashim)).body.rideRequests.length, 0, 'hidden for now');

  // Move it to 10 minutes from now: inside the 20-minute lead window, so it appears.
  await pool.query(`UPDATE ride_requests SET scheduled_for = now() + interval '10 minutes', expires_at = now() + interval '40 minutes' WHERE id = $1`, [res.body.rideRequest.id]);
  assert.equal((await authed('get', '/api/v1/ride-requests/open', tokens.jashim)).body.rideRequests.length, 1);
});

test('an unmatched request lapses after the passenger\'s chosen wait, with a notification and an audit row', async () => {
  const res = await ride('nusrat', { maxWaitMinutes: 15 });
  const id = res.body.rideRequest.id;
  const stored = (await pool.query('SELECT max_wait_minutes, expires_at, requested_at FROM ride_requests WHERE id = $1', [id])).rows[0];
  assert.equal(stored.max_wait_minutes, 15);
  assert.ok(Math.abs(new Date(stored.expires_at) - new Date(stored.requested_at) - 15 * 60_000) < 5000);

  assert.equal(await rideRequestService.expireUnmatchedRequests(), 0, 'not yet');
  await pool.query(`UPDATE ride_requests SET expires_at = now() - interval '1 minute' WHERE id = $1`, [id]);
  assert.equal(await rideRequestService.expireUnmatchedRequests(), 1);
  assert.equal(await rideRequestService.expireUnmatchedRequests(), 0, 'idempotent');
  assert.equal((await authed('get', '/api/v1/ride-requests/open', tokens.jashim)).body.rideRequests.length, 0, 'and it is gone from the board');
  assert.equal((await statusOf(id)).status, 'CANCELLED');

  const hist = await pool.query(`SELECT note, changed_by FROM status_history WHERE entity_id = $1 AND to_status = 'CANCELLED'`, [id]);
  assert.match(hist.rows[0].note, /no pool found within 15 minutes/);
  assert.equal(hist.rows[0].changed_by, null);
  await settle();
  assert.equal((await inbox(ids.nusrat)).at(-1).type, 'REQUEST_EXPIRED');
});

test('a request that was matched in time is never expired', async () => {
  const res = await ride('nusrat', { maxWaitMinutes: 5 });
  await accept(res.body.rideRequest.id);
  await pool.query(`UPDATE ride_requests SET expires_at = now() - interval '1 hour' WHERE id = $1`, [res.body.rideRequest.id]);
  assert.equal(await rideRequestService.expireUnmatchedRequests(), 0);
  assert.equal((await statusOf(res.body.rideRequest.id)).status, 'MATCHED');
});

// ---------- notifications ----------

test('the trip lifecycle notifies each passenger, in their own language, only after it commits', async () => {
  await pool.query(`UPDATE users SET locale = 'bn' WHERE id = $1`, [ids.rafiq]);
  await pool.query(`INSERT INTO push_tokens (token, user_id, platform) VALUES ('ExponentPushToken[nusrat-phone]', $1, 'android')`, [ids.nusrat]);

  const nusrat = await ride('nusrat');
  const first = await accept(nusrat.body.rideRequest.id);
  const rafiq = await ride('rafiq');
  await accept(rafiq.body.rideRequest.id, { poolId: first.body.poolId });
  await settle();

  // Nusrat is asked about Rafiq; Rafiq is asked to confirm (in Bangla).
  const nusratInbox = await inbox(ids.nusrat);
  assert.deepEqual(nusratInbox.map((n) => n.type), ['POOL_MATCHED', 'SHARE_REQUEST']);
  assert.match(nusratInbox[1].body, /Rafiq wants to join your ride/);
  const rafiqInbox = await inbox(ids.rafiq);
  assert.equal(rafiqInbox[0].type, 'SHARE_CONFIRM');
  assert.match(rafiqInbox[0].title, /[\u0980-\u09FF]/, 'Bangla script');

  // A push went to Nusrat's registered phone (Rafiq has none).
  assert.ok(pushOutbox.some((m) => m.to === 'ExponentPushToken[nusrat-phone]' && m.data.type === 'POOL_MATCHED'));
  assert.ok(pushOutbox.every((m) => m.to.includes('nusrat-phone')));
});

test('a rolled-back change sends no notification', async () => {
  // Rafiq is male: the women-only rejection happens INSIDE the accept transaction.
  const nusrat = await ride('nusrat', { womenOnly: true });
  const first = await accept(nusrat.body.rideRequest.id);
  await settle();
  const before = (await inbox(ids.rafiq)).length;
  const rafiq = await ride('rafiq');
  assert.equal((await accept(rafiq.body.rideRequest.id, { poolId: first.body.poolId })).status, 422);
  await settle();
  assert.equal((await inbox(ids.rafiq)).length, before, 'nothing was sent for the failed attempt');
  assert.equal((await inbox(ids.nusrat)).filter((n) => n.type === 'SHARE_REQUEST').length, 0);
});

test('arrive, start and complete each notify the passengers', async () => {
  const nusrat = await ride('nusrat');
  const { body: { poolId } } = await accept(nusrat.body.rideRequest.id);
  for (const step of ['arrive', 'start', 'complete']) assert.equal((await authed('patch', `/api/v1/pools/${poolId}/${step}`, tokens.jashim)).status, 204);
  await settle();
  assert.deepEqual((await inbox(ids.nusrat)).map((n) => n.type), ['POOL_MATCHED', 'DRIVER_ARRIVED', 'TRIP_STARTED', 'TRIP_COMPLETED']);
  assert.match((await inbox(ids.nusrat)).at(-1).body, /৳\d+\.\d\d/);
});

test('a timed-out sharing proposal tells everyone involved', async () => {
  const nusrat = await ride('nusrat');
  const first = await accept(nusrat.body.rideRequest.id);
  const rafiq = await ride('rafiq');
  await accept(rafiq.body.rideRequest.id, { poolId: first.body.poolId });
  await pool.query(`UPDATE pool_join_consents SET created_at = now() - interval '6 minutes'`);
  await authed('get', '/api/v1/ride-requests/mine', tokens.rafiq); // any read expires it
  await settle();
  assert.ok((await inbox(ids.rafiq)).some((n) => n.type === 'SHARE_EXPIRED'));
  assert.ok((await inbox(ids.nusrat)).some((n) => n.type === 'SHARE_EXPIRED'));
});
