// Covers PRD Section 3, Passenger row: "View history", and the request-
// validation edge cases implied by "Request ride: pickup, destination,
// seats". Also covers the Driver row's "See relevant requests" — the open-
// requests LISTING endpoint itself, as opposed to accepting from it (which
// backend/tests/lifecycle.test.js does cover).
const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { request, app, pool, login, resetTransactionalTables } = require('./helpers');

let nusratToken;
let jashimToken;
let zones = {};

before(async () => {
  nusratToken = await login('nusrat@dhakateslapool.test');
  jashimToken = await login('jashim@dhakateslapool.test');
  const { rows } = await pool.query('SELECT id, name FROM zones');
  for (const z of rows) zones[z.name] = z.id;
});

beforeEach(async () => {
  await resetTransactionalTables();
});

after(async () => {
  await pool.end();
});

test('GET /zones returns the fixed zone list used to build request forms', async () => {
  const res = await request(app).get('/api/zones');
  assert.equal(res.status, 200);
  assert.ok(res.body.zones.length > 0);
  assert.ok(res.body.zones.some((z) => z.name === 'Banani'));
});

test("a passenger's ride history shows their own past and current requests", async () => {
  await request(app)
    .post('/api/ride-requests')
    .set('Authorization', `Bearer ${nusratToken}`)
    .send({ pickupZoneId: zones['Banani'], destinationZoneId: zones['Mohakhali'], seatsRequested: 1 });
  await request(app)
    .post('/api/ride-requests')
    .set('Authorization', `Bearer ${nusratToken}`)
    .send({ pickupZoneId: zones['Banani'], destinationZoneId: zones['Uttara'], seatsRequested: 2 });

  const res = await request(app).get('/api/ride-requests/mine').set('Authorization', `Bearer ${nusratToken}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.rideRequests.length, 2);
  // Newest first
  assert.equal(res.body.rideRequests[0].destination_zone_name, 'Uttara');
});

test('requesting a ride with the same pickup and destination is rejected', async () => {
  const res = await request(app)
    .post('/api/ride-requests')
    .set('Authorization', `Bearer ${nusratToken}`)
    .send({ pickupZoneId: zones['Banani'], destinationZoneId: zones['Banani'], seatsRequested: 1 });
  assert.equal(res.status, 422);
});

test('requesting zero or negative seats is rejected', async () => {
  const res = await request(app)
    .post('/api/ride-requests')
    .set('Authorization', `Bearer ${nusratToken}`)
    .send({ pickupZoneId: zones['Banani'], destinationZoneId: zones['Mohakhali'], seatsRequested: 0 });
  assert.equal(res.status, 422);
});

test('requesting a ride against a zone id that does not exist is rejected, not a 500', async () => {
  const res = await request(app)
    .post('/api/ride-requests')
    .set('Authorization', `Bearer ${nusratToken}`)
    .send({ pickupZoneId: zones['Banani'], destinationZoneId: 999999, seatsRequested: 1 });
  assert.equal(res.status, 422);
});

test("the driver's open-requests list shows unmatched requests with passenger name and route", async () => {
  await request(app)
    .post('/api/ride-requests')
    .set('Authorization', `Bearer ${nusratToken}`)
    .send({ pickupZoneId: zones['Banani'], destinationZoneId: zones['Mohakhali'], seatsRequested: 1 });

  const res = await request(app).get('/api/ride-requests/open').set('Authorization', `Bearer ${jashimToken}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.rideRequests.length, 1);
  assert.equal(res.body.rideRequests[0].passenger_name, 'Nusrat');
  assert.equal(res.body.rideRequests[0].status, 'REQUESTED');
});
