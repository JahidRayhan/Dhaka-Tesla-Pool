const { test, before, after } = require('node:test');
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
  const { rows } = await pool.query('SELECT id, name FROM zones');
  for (const z of rows) zones[z.name] = z.id;
  const res = await request(app).get('/api/teslas/mine').set('Authorization', `Bearer ${tokens.jashim}`);
  teslaId = res.body.teslas[0].id;
});

after(async () => {
  await pool.end();
});

const authed = (method, path, token) => request(app)[method](path).set('Authorization', `Bearer ${token}`);
const activePools = async () =>
  (await pool.query(`SELECT count(*)::int AS n FROM pools WHERE tesla_id = $1 AND status NOT IN ('COMPLETED', 'CANCELLED')`, [teslaId])).rows[0].n;

test('two simultaneous accepts of different requests never put one Tesla in two pools', async () => {
  const outcomes = [];
  for (let i = 0; i < 12; i++) {
    await resetTransactionalTables();
    const rides = [];
    for (const who of ['nusrat', 'rafiq']) {
      const r = await authed('post', '/api/ride-requests', tokens[who]).send({ pickupZoneId: zones.Banani, destinationZoneId: zones.Mohakhali });
      rides.push(r.body.rideRequest.id);
    }
    const results = await Promise.all(
      rides.map((id) => authed('post', `/api/ride-requests/${id}/accept`, tokens.jashim).send({ teslaId })),
    );
    outcomes.push(results.map((r) => r.status).sort().join('/'));
    assert.equal(await activePools(), 1, 'exactly one active pool, however the race fell');
  }
  // One accept wins (200); the loser is told cleanly (409), never a 5xx.
  assert.ok(outcomes.every((o) => o === '200/409'), `unexpected outcomes: ${[...new Set(outcomes)]}`);
});

test('the database itself refuses a second live pool for the same Tesla (backstop)', async () => {
  await resetTransactionalTables();
  await pool.query(`INSERT INTO pools (tesla_id, status, seats_occupied) VALUES ($1, 'MATCHED', 1)`, [teslaId]);
  await assert.rejects(
    pool.query(`INSERT INTO pools (tesla_id, status, seats_occupied) VALUES ($1, 'DRIVER_ARRIVED', 1)`, [teslaId]),
    (err) => err.code === '23505',
  );
  // Finished pools do not count, so history can pile up.
  await pool.query(`UPDATE pools SET status = 'COMPLETED'`);
  await pool.query(`INSERT INTO pools (tesla_id, status, seats_occupied) VALUES ($1, 'MATCHED', 1)`, [teslaId]);
  assert.equal(await activePools(), 1);
});
