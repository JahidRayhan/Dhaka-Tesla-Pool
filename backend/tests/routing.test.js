require('dotenv').config({ path: process.env.ENV_FILE || '.env.test' });
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { pool } = require('../src/config/db');
const { shortestPath, routesAreCompatible } = require('../src/services/routeService');

after(async () => {
  await pool.end();
});

// ---------------------------------------------------------------------------
// The abstract scenario that motivated route-aware pooling: a trunk road
// a-b-c-d-e with a branch c-f-g-h splitting off at junction c. Reaching f
// from e means going back to c and turning off — no single forward-moving
// vehicle can do both. Pure functions, no database needed.
// ---------------------------------------------------------------------------

test('a->d and b->e overlap along the trunk and share one vehicle', () => {
  assert.equal(routesAreCompatible([['a', 'b', 'c', 'd']], ['b', 'c', 'd', 'e']), true);
});

test('c->g cannot join a->d: continuing to d and turning onto the branch are mutually exclusive at c', () => {
  assert.equal(routesAreCompatible([['a', 'b', 'c', 'd']], ['c', 'f', 'g']), false);
});

test('c->g cannot join b->e either', () => {
  assert.equal(routesAreCompatible([['b', 'c', 'd', 'e']], ['c', 'f', 'g']), false);
});

test('c->g cannot join a pool that already holds both a->d and b->e', () => {
  assert.equal(routesAreCompatible([['a', 'b', 'c', 'd'], ['b', 'c', 'd', 'e']], ['c', 'f', 'g']), false);
});

test('a->c and c->g DO chain: the first trip ends exactly at the junction, so nothing is left to continue along the trunk', () => {
  assert.equal(routesAreCompatible([['a', 'b', 'c']], ['c', 'f', 'g']), true);
});

test('two trips along the same road in opposite directions cannot share a vehicle', () => {
  assert.equal(routesAreCompatible([['a', 'b', 'c', 'd']], ['d', 'c', 'b']), false);
});

test('two unrelated trips that never touch cannot share a vehicle', () => {
  assert.equal(routesAreCompatible([['a', 'b']], ['g', 'h']), false);
});

test('identical routes are compatible', () => {
  assert.equal(routesAreCompatible([['a', 'b', 'c']], ['a', 'b', 'c']), true);
});

// ---------------------------------------------------------------------------
// The same rule against the real seeded Dhaka zone graph, where Banani
// (Gulshan 1 / Mohakhali / Bashundhara) and Mohakhali (Banani / Farmgate /
// Mirpur) are genuine junctions.
// ---------------------------------------------------------------------------

async function zoneIds() {
  const { rows } = await pool.query('SELECT id, name FROM zones');
  return Object.fromEntries(rows.map((r) => [r.name, r.id]));
}

test('shortest path Banani -> Farmgate goes through the Mohakhali junction', async () => {
  const z = await zoneIds();
  const route = await shortestPath(z['Banani'], z['Farmgate']);
  assert.deepEqual(route.zoneIds, [z['Banani'], z['Mohakhali'], z['Farmgate']]);
  assert.ok(Math.abs(route.distanceKm - 4.4384) < 0.001);
});

test('a directly connected pair is a single edge (distance unchanged from the old straight-line model)', async () => {
  const z = await zoneIds();
  const route = await shortestPath(z['Banani'], z['Mohakhali']);
  assert.deepEqual(route.zoneIds, [z['Banani'], z['Mohakhali']]);
  assert.ok(Math.abs(route.distanceKm - 1.4478) < 0.001);
});

test('Banani->Farmgate and Mohakhali->Farmgate pool: the second rider is picked up along the way', async () => {
  const z = await zoneIds();
  const a = await shortestPath(z['Banani'], z['Farmgate']);
  const b = await shortestPath(z['Mohakhali'], z['Farmgate']);
  assert.equal(routesAreCompatible([a.zoneIds], b.zoneIds), true);
});

test('Banani->Mohakhali and Banani->Gulshan 1 do NOT pool: same origin, but opposite sides of the Banani junction', async () => {
  const z = await zoneIds();
  const a = await shortestPath(z['Banani'], z['Mohakhali']);
  const b = await shortestPath(z['Banani'], z['Gulshan 1']);
  assert.equal(routesAreCompatible([a.zoneIds], b.zoneIds), false);
});

test('Banani->Mohakhali and Banani->Bashundhara do NOT pool (different branches off the Banani junction)', async () => {
  const z = await zoneIds();
  const a = await shortestPath(z['Banani'], z['Mohakhali']);
  const b = await shortestPath(z['Banani'], z['Bashundhara']);
  assert.equal(routesAreCompatible([a.zoneIds], b.zoneIds), false);
});

test('Banani->Mohakhali and Banani->Mirpur DO pool: Mirpur lies straight on past Mohakhali', async () => {
  const z = await zoneIds();
  const a = await shortestPath(z['Banani'], z['Mohakhali']);
  const b = await shortestPath(z['Banani'], z['Mirpur']);
  assert.equal(routesAreCompatible([a.zoneIds], b.zoneIds), true);
});
