// Covers PRD Section 3, Driver/Tesla row: "go online/offline", "Own a Tesla
// with fixed capacity". Also covers the role-guard requirement implicit in
// Section 6 (passengers and drivers can't use each other's endpoints).
const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { request, app, pool, login, resetTransactionalTables } = require('./helpers');

let jashimToken;
let nusratToken;

before(async () => {
  jashimToken = await login('jashim@dhakateslapool.test');
  nusratToken = await login('nusrat@dhakateslapool.test');
});

beforeEach(async () => {
  await resetTransactionalTables();
});

after(async () => {
  await pool.end();
});

test('a driver can register a Tesla with a valid capacity', async () => {
  const res = await request(app)
    .post('/api/teslas')
    .set('Authorization', `Bearer ${jashimToken}`)
    .send({ name: 'Acceptance Tesla', capacity: 2 });
  assert.equal(res.status, 201);
  assert.equal(res.body.tesla.capacity, 2);
  assert.equal(res.body.tesla.is_active, false); // starts offline until explicitly toggled
});

test('a Tesla capacity outside 1-6 is rejected (fixed capacity must be sane)', async () => {
  const tooBig = await request(app)
    .post('/api/teslas')
    .set('Authorization', `Bearer ${jashimToken}`)
    .send({ name: 'Too Big', capacity: 12 });
  assert.equal(tooBig.status, 422);

  const zero = await request(app)
    .post('/api/teslas')
    .set('Authorization', `Bearer ${jashimToken}`)
    .send({ name: 'Zero Seats', capacity: 0 });
  assert.equal(zero.status, 422);
});

test('a driver can toggle their Tesla online and offline', async () => {
  const mine = await request(app).get('/api/teslas/mine').set('Authorization', `Bearer ${jashimToken}`);
  const teslaId = mine.body.teslas[0].id;

  const offline = await request(app)
    .patch(`/api/teslas/${teslaId}/active`)
    .set('Authorization', `Bearer ${jashimToken}`)
    .send({ isActive: false });
  assert.equal(offline.status, 200);
  assert.equal(offline.body.tesla.is_active, false);

  const online = await request(app)
    .patch(`/api/teslas/${teslaId}/active`)
    .set('Authorization', `Bearer ${jashimToken}`)
    .send({ isActive: true });
  assert.equal(online.status, 200);
  assert.equal(online.body.tesla.is_active, true);
});

test('a passenger cannot register a Tesla or use driver-only endpoints (role guard)', async () => {
  const create = await request(app)
    .post('/api/teslas')
    .set('Authorization', `Bearer ${nusratToken}`)
    .send({ name: 'Should Not Work', capacity: 3 });
  assert.equal(create.status, 403);

  const openList = await request(app).get('/api/ride-requests/open').set('Authorization', `Bearer ${nusratToken}`);
  assert.equal(openList.status, 403);
});

test('a driver cannot use passenger-only endpoints (role guard, reverse direction)', async () => {
  const res = await request(app)
    .post('/api/ride-requests')
    .set('Authorization', `Bearer ${jashimToken}`)
    .send({ pickupZoneId: 1, destinationZoneId: 2, seatsRequested: 1 });
  assert.equal(res.status, 403);
});
