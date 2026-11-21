process.env.PUSH_PROVIDER = 'memory';
const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { request, app, login } = require('./helpers');
const { pool, resetTransactionalTables } = require('./db');
const recurringService = require('../src/services/recurringService');

let tokens = {};
let zones = {};
let ids = {};
let teslaId;

before(async () => {
  for (const n of ['jashim', 'nusrat', 'rafiq', 'shirin']) tokens[n] = await login(`${n}@dhakateslapool.test`);
  for (const z of (await pool.query('SELECT id, name FROM zones')).rows) zones[z.name] = z.id;
  for (const u of (await pool.query("SELECT id, split_part(email,'@',1) AS n FROM users")).rows) ids[u.n] = u.id;
  teslaId = (await request(app).get('/api/v1/teslas/mine').set('Authorization', `Bearer ${tokens.jashim}`)).body.teslas[0].id;
});
beforeEach(async () => {
  await resetTransactionalTables();
  await pool.query('TRUNCATE notifications, push_tokens, recurring_rides');
  await pool.query(`UPDATE users SET locale = 'en'`);
});
after(async () => {
  await pool.end();
});

const authed = (m, p, t) => request(app)[m](p).set('Authorization', `Bearer ${t}`);
const ride = (who, extra = {}) => authed('post', '/api/v1/ride-requests', tokens[who]).send({ pickupZoneId: zones.Banani, destinationZoneId: zones.Mohakhali, ...extra });
const accept = (rideId, body = {}) => authed('post', `/api/v1/ride-requests/${rideId}/accept`, tokens.jashim).send({ teslaId, ...body });
const settle = () => new Promise((r) => setTimeout(r, 120));
const newPassenger = async (extra = {}) => {
  const res = await request(app).post('/api/v1/auth/signup').send({ name: 'Temp Rider', email: `tmp-${Date.now()}-${Math.floor(Math.random() * 1e6)}@dhakateslapool.test`, password: 'password123', ...extra });
  return res.body.accessToken;
};

// Bangladesh is UTC+6 with no daylight saving.
const dhaka = (d) => new Date(d.getTime() + 6 * 3600_000);
const hhmm = (d) => `${String(dhaka(d).getUTCHours()).padStart(2, '0')}:${String(dhaka(d).getUTCMinutes()).padStart(2, '0')}`;
const sameDhakaDate = (a, b) => dhaka(a).toISOString().slice(0, 10) === dhaka(b).toISOString().slice(0, 10);

// ---------- recurring rides ----------

test('recurring rides validate their input, belong to one passenger, and are capped', async () => {
  const base = { pickupZoneId: zones.Banani, destinationZoneId: zones.Mohakhali, daysOfWeek: [1, 2, 3, 4, 5], timeOfDay: '08:30' };
  const bad = [{ daysOfWeek: [] }, { daysOfWeek: [0] }, { daysOfWeek: [1, 1] }, { daysOfWeek: [8] }, { timeOfDay: '8:30' }, { timeOfDay: '25:00' }, { destinationZoneId: zones.Banani },
    { paymentMethod: 'BITCOIN' }, { seatsRequested: 9 }, { maxWaitMinutes: 1 }, { shareMax: 9 }, { womenOnly: 'no' }];
  for (const extra of bad) assert.equal((await authed('post', '/api/v1/recurring-rides', tokens.nusrat).send({ ...base, ...extra })).status, 422, JSON.stringify(extra));
  assert.equal((await authed('post', '/api/v1/recurring-rides', tokens.jashim).send(base)).status, 403, 'drivers do not book rides');

  const ok = await authed('post', '/api/v1/recurring-rides', tokens.nusrat).send(base);
  assert.equal(ok.status, 201);
  assert.equal(ok.body.recurringRide.time_of_day, '08:30');
  assert.deepEqual(ok.body.recurringRide.days_of_week, [1, 2, 3, 4, 5]);

  assert.equal((await authed('get', '/api/v1/recurring-rides', tokens.rafiq)).body.recurringRides.length, 0, 'private to its owner');
  assert.equal((await authed('delete', `/api/v1/recurring-rides/${ok.body.recurringRide.id}`, tokens.rafiq)).status, 404);
  assert.equal((await authed('patch', `/api/v1/recurring-rides/${ok.body.recurringRide.id}`, tokens.nusrat).send({ active: 'yes' })).status, 422);
  assert.equal((await authed('patch', `/api/v1/recurring-rides/${ok.body.recurringRide.id}`, tokens.nusrat).send({ active: false })).status, 204);

  // The first is switched off, so five more active ones fit; a sixth active one does not.
  for (let i = 0; i < 5; i++) assert.equal((await authed('post', '/api/v1/recurring-rides', tokens.nusrat).send(base)).status, 201, `active #${i + 1}`);
  const overLimit = await authed('post', '/api/v1/recurring-rides', tokens.nusrat).send(base);
  assert.equal(overLimit.status, 409);
  assert.match(overLimit.body.error, /at most 5/);
  assert.equal((await authed('delete', `/api/v1/recurring-rides/${ok.body.recurringRide.id}`, tokens.nusrat)).status, 204);
});

test('a due commute is booked exactly once a day, as a scheduled ride, and again the next day', async (t) => {
  const now = new Date();
  const due = new Date(now.getTime() + 2 * 60_000);
  if (!sameDhakaDate(now, due)) return t.skip('too close to midnight in Dhaka for this clock-based test');
  const created = await authed('post', '/api/v1/recurring-rides', tokens.nusrat).send({
    pickupZoneId: zones.Banani, destinationZoneId: zones.Mohakhali, daysOfWeek: [1, 2, 3, 4, 5, 6, 7], timeOfDay: hhmm(due), maxWaitMinutes: 20, shareMax: 3,
  });
  assert.equal(created.status, 201);

  assert.deepEqual(await recurringService.generateDue({ at: now }), { booked: 1, failed: 0 });
  const rides = (await pool.query('SELECT status, scheduled_for, max_wait_minutes, share_max FROM ride_requests')).rows;
  assert.equal(rides.length, 1);
  assert.equal(rides[0].status, 'REQUESTED');
  assert.ok(Math.abs(new Date(rides[0].scheduled_for) - due) < 90_000, 'scheduled for the commute time in Dhaka');
  assert.deepEqual([rides[0].max_wait_minutes, rides[0].share_max], [20, 3], 'carries the commute\'s preferences');

  assert.deepEqual(await recurringService.generateDue({ at: now }), { booked: 0, failed: 0 }, 'not booked twice the same day');
  await settle();
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM notifications WHERE type = 'RECURRING_RIDE_CREATED'`)).rows[0].n, 1);

  const tomorrow = new Date(now.getTime() + 24 * 3600_000);
  assert.deepEqual(await recurringService.generateDue({ at: tomorrow }), { booked: 1, failed: 0 });
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM ride_requests')).rows[0].n, 2);
});

test('commutes outside their booking window, on other weekdays, or switched off are left alone', async (t) => {
  const now = new Date();
  const due = new Date(now.getTime() + 2 * 60_000);
  if (!sameDhakaDate(now, due)) return t.skip('too close to midnight in Dhaka for this clock-based test');
  const body = { pickupZoneId: zones.Banani, destinationZoneId: zones.Mohakhali, timeOfDay: hhmm(due) };
  const isoDow = ((dhaka(now).getUTCDay() + 6) % 7) + 1;
  const otherDay = isoDow === 7 ? 1 : isoDow + 1;

  const a = (await authed('post', '/api/v1/recurring-rides', tokens.nusrat).send({ ...body, daysOfWeek: [otherDay] })).body.recurringRide;
  assert.deepEqual(await recurringService.generateDue({ at: now }), { booked: 0, failed: 0 }, 'wrong weekday');
  await authed('delete', `/api/v1/recurring-rides/${a.id}`, tokens.nusrat);

  const b = (await authed('post', '/api/v1/recurring-rides', tokens.nusrat).send({ ...body, daysOfWeek: [1, 2, 3, 4, 5, 6, 7] })).body.recurringRide;
  assert.deepEqual(await recurringService.generateDue({ at: new Date(now.getTime() - 3 * 3600_000) }), { booked: 0, failed: 0 }, 'three hours early: not yet booked');
  await authed('patch', `/api/v1/recurring-rides/${b.id}`, tokens.nusrat).send({ active: false });
  assert.deepEqual(await recurringService.generateDue({ at: now }), { booked: 0, failed: 0 }, 'switched off');
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM ride_requests')).rows[0].n, 0);
});

test('a commute that cannot be booked (no TeslaPay balance) tells the passenger and is not retried all day', async (t) => {
  const now = new Date();
  const due = new Date(now.getTime() + 2 * 60_000);
  if (!sameDhakaDate(now, due)) return t.skip('too close to midnight in Dhaka for this clock-based test');
  await pool.query(`UPDATE wallets SET balance_paisa = 0, ledger_baseline_paisa = 0 WHERE user_id = $1`, [ids.nusrat]);
  try {
    await authed('post', '/api/v1/recurring-rides', tokens.nusrat).send({
      pickupZoneId: zones.Banani, destinationZoneId: zones.Mohakhali, daysOfWeek: [1, 2, 3, 4, 5, 6, 7], timeOfDay: hhmm(due), paymentMethod: 'TESLAPAY',
    });
    assert.deepEqual(await recurringService.generateDue({ at: now }), { booked: 0, failed: 1 });
    assert.deepEqual(await recurringService.generateDue({ at: now }), { booked: 0, failed: 0 }, 'claimed for today even though it failed');
  } finally {
    // Leave the shared demo wallet exactly as the seed made it, for every test that follows.
    await pool.query(`UPDATE wallets SET balance_paisa = 100000, ledger_baseline_paisa = 100000 WHERE user_id = $1`, [ids.nusrat]);
  }
  await settle();
  const n = (await pool.query(`SELECT body FROM notifications WHERE type = 'RECURRING_RIDE_FAILED'`)).rows;
  assert.equal(n.length, 1);
  assert.match(n[0].body, /Not enough TeslaPay balance/);
});

// ---------- profile ----------

test('profile settings are validated; gender unlocks women-only; locale switches notification language', async () => {
  for (const bad of [{ name: '' }, { name: 'x'.repeat(101) }, { gender: 'robot' }, { locale: 'fr' }, { name: 5 }]) {
    assert.equal((await authed('patch', '/api/v1/auth/profile', tokens.rafiq).send(bad)).status, 422, JSON.stringify(bad));
  }
  assert.equal((await ride('rafiq', { womenOnly: true })).status, 422, 'no gender declared');

  const set = await authed('patch', '/api/v1/auth/profile', tokens.rafiq).send({ gender: 'female', locale: 'bn', name: 'Rafiqa' });
  assert.equal(set.status, 200);
  assert.deepEqual([set.body.user.gender, set.body.user.locale, set.body.user.name], ['female', 'bn', 'Rafiqa']);
  assert.equal(set.body.user.password_hash, undefined);
  assert.equal((await ride('rafiq', { womenOnly: true })).status, 201, 'now allowed');

  const cleared = await authed('patch', '/api/v1/auth/profile', tokens.rafiq).send({ gender: null });
  assert.equal(cleared.body.user.gender, null, 'null clears it');
  assert.equal(cleared.body.user.locale, 'bn', 'untouched fields stay as they were');
  await pool.query(`UPDATE users SET name = 'Rafiq', gender = 'male', locale = 'en' WHERE id = $1`, [ids.rafiq]);
});

// ---------- driver-side fit ranking ----------

test('the open board can say which requests fit the live pool, why the others do not, and puts the fits first', async () => {
  const nusrat = await ride('nusrat');
  const { poolId } = (await accept(nusrat.body.rideRequest.id)).body;

  const opposite = await request(app).post('/api/v1/auth/signup').send({ name: 'Opp', email: `opp-${Date.now()}@dhakateslapool.test`, password: 'password123' });
  const farmgate = await ride('rafiq', { destinationZoneId: zones.Farmgate });                                  // same direction: fits
  const wrongWay = await authed('post', '/api/v1/ride-requests', opposite.body.accessToken).send({ pickupZoneId: zones.Mohakhali, destinationZoneId: zones.Banani }); // opposite: route
  const big = await ride('shirin', { seatsRequested: 3 });                                                       // 3 seats > 2 free

  const board = await authed('get', `/api/v1/ride-requests/open?poolId=${poolId}`, tokens.jashim);
  assert.equal(board.status, 200);
  const by = Object.fromEntries(board.body.rideRequests.map((r) => [r.id, r.fit]));
  assert.deepEqual(by[farmgate.body.rideRequest.id], { fits: true, reason: null, detourPercent: 0 });
  assert.equal(by[wrongWay.body.rideRequest.id].reason, 'ROUTE');
  assert.equal(by[big.body.rideRequest.id].reason, 'SEATS');
  assert.equal(board.body.rideRequests[0].fit.fits, true, 'fits come first');
  assert.equal(board.body.rideRequests.at(-1).fit.fits, false);

  // The suggestion is honest: the one marked as fitting really can join.
  assert.equal((await accept(wrongWay.body.rideRequest.id, { poolId })).status, 422, 'marked ROUTE, and really refused');
  assert.equal((await accept(farmgate.body.rideRequest.id, { poolId })).status, 200, 'marked as fitting, and really accepted');

  assert.equal((await authed('get', '/api/v1/ride-requests/open?poolId=not-a-uuid', tokens.jashim)).status, 422);
  const other = await request(app).post('/api/v1/auth/signup').send({ name: 'Other', email: `od2-${Date.now()}@dhakateslapool.test`, password: 'password123', role: 'driver' });
  assert.equal((await authed('get', `/api/v1/ride-requests/open?poolId=${poolId}`, other.body.accessToken)).status, 403, "not another driver's pool");
  // Without poolId the board is exactly as before.
  assert.equal((await authed('get', '/api/v1/ride-requests/open', tokens.jashim)).body.rideRequests.every((r) => r.fit === undefined), true);
});

test('the fit ranking knows about women-only pools and an unanswered proposal', async () => {
  const nusrat = await ride('nusrat', { womenOnly: true });
  const { poolId } = (await accept(nusrat.body.rideRequest.id)).body;
  const man = await ride('rafiq');
  const woman = await ride('shirin');
  let board = (await authed('get', `/api/v1/ride-requests/open?poolId=${poolId}`, tokens.jashim)).body.rideRequests;
  assert.equal(board.find((r) => r.id === man.body.rideRequest.id).fit.reason, 'WOMEN_ONLY');
  assert.equal(board.find((r) => r.id === woman.body.rideRequest.id).fit.fits, true);

  await accept(woman.body.rideRequest.id, { poolId }); // opens a proposal, so the pool is busy
  const late = await ride('rafiq');
  void late;
  board = (await authed('get', `/api/v1/ride-requests/open?poolId=${poolId}`, tokens.jashim)).body.rideRequests;
  assert.ok(board.length >= 1 && board.every((r) => r.fit.reason === 'POOL_BUSY'));
});

// ---------- meeting points ----------

test('each zone lists its meeting points', async () => {
  const res = await request(app).get(`/api/v1/zones/${zones.Banani}/meeting-points`);
  assert.equal(res.status, 200);
  assert.equal(res.body.meetingPoints.length, 2);
  assert.ok(res.body.meetingPoints.every((p) => /Banani/.test(p.name) && typeof p.latitude === 'number'));
  assert.deepEqual((await request(app).get('/api/v1/zones/99999/meeting-points')).body.meetingPoints, []);
  assert.deepEqual((await request(app).get('/api/v1/zones/abc/meeting-points')).body.meetingPoints, []);
});

// ---------- notifications API ----------

test('the notification inbox lists, counts unread, marks read, and keeps people out of each other\'s', async () => {
  const r = await ride('nusrat');
  await accept(r.body.rideRequest.id);
  await settle();
  let inbox = (await authed('get', '/api/v1/notifications', tokens.nusrat)).body;
  assert.equal(inbox.unreadCount, 1);
  assert.equal(inbox.notifications[0].type, 'POOL_MATCHED');
  assert.equal((await authed('get', '/api/v1/notifications', tokens.rafiq)).body.notifications.length, 0, 'private');

  assert.equal((await authed('post', '/api/v1/notifications/read', tokens.nusrat).send({ ids: 'some' })).status, 422);
  assert.equal((await authed('post', '/api/v1/notifications/read', tokens.nusrat).send({ ids: [] })).status, 422);
  // Rafiq cannot mark Nusrat's notification read.
  await authed('post', '/api/v1/notifications/read', tokens.rafiq).send({ ids: [inbox.notifications[0].id] });
  assert.equal((await authed('get', '/api/v1/notifications', tokens.nusrat)).body.unreadCount, 1);
  assert.equal((await authed('post', '/api/v1/notifications/read', tokens.nusrat).send({ ids: [inbox.notifications[0].id] })).status, 204);
  inbox = (await authed('get', '/api/v1/notifications?unread=true', tokens.nusrat)).body;
  assert.deepEqual([inbox.unreadCount, inbox.notifications.length], [0, 0]);
  assert.equal((await authed('post', '/api/v1/notifications/read', tokens.nusrat).send({ ids: 'all' })).status, 204);
  assert.equal((await request(app).get('/api/v1/notifications')).status, 401);
});

test('push tokens: registered per device, move to whoever signed in last, and are validated', async () => {
  const token = 'ExponentPushToken[abcdefghij1234567890]';
  for (const bad of [{}, { token: 'short', platform: 'ios' }, { token, platform: 'blackberry' }]) {
    assert.equal((await authed('post', '/api/v1/push-tokens', tokens.nusrat).send(bad)).status, 422, JSON.stringify(bad));
  }
  assert.equal((await authed('post', '/api/v1/push-tokens', tokens.nusrat).send({ token, platform: 'android' })).status, 204);
  assert.equal((await authed('post', '/api/v1/push-tokens', tokens.rafiq).send({ token, platform: 'android' })).status, 204, 'the phone changed hands');
  const rows = (await pool.query('SELECT user_id FROM push_tokens WHERE token = $1', [token])).rows;
  assert.deepEqual(rows.map((x) => x.user_id), [ids.rafiq]);
  assert.equal((await authed('delete', '/api/v1/push-tokens', tokens.nusrat).send({ token })).status, 204, 'removing someone else\'s token does nothing');
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM push_tokens')).rows[0].n, 1);
  assert.equal((await authed('delete', '/api/v1/push-tokens', tokens.rafiq).send({ token })).status, 204);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM push_tokens')).rows[0].n, 0);
});
