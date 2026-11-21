const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { request, app, login } = require('./helpers');
const { pool, resetTransactionalTables } = require('./db');
const { findEnvProblems } = require('../src/config/validateEnv');
const { buildCorsOptions, parseOrigins } = require('../src/config/cors');
const cors = require('cors');
const { createLoginRateLimiter, loginRateLimit } = require('../src/middleware/loginRateLimit');
const { errorHandler } = require('../src/middleware/errorHandler');

let tokens = {};
let zones = {};

before(async () => {
  tokens.nusrat = await login('nusrat@dhakateslapool.test');
  tokens.rafiq = await login('rafiq@dhakateslapool.test');
  tokens.shirin = await login('shirin@dhakateslapool.test');
  tokens.jashim = await login('jashim@dhakateslapool.test');
  const { rows } = await pool.query('SELECT id, name FROM zones');
  for (const z of rows) zones[z.name] = z.id;
});

beforeEach(async () => {
  await resetTransactionalTables();
  loginRateLimit.reset();
});

after(async () => {
  await pool.end();
});

const authed = (method, path, token) => request(app)[method](path).set('Authorization', `Bearer ${token}`);
const requestRide = (token, extra = {}) =>
  authed('post', '/api/ride-requests', token).send({ pickupZoneId: zones.Banani, destinationZoneId: zones.Mohakhali, ...extra });

// ---------- startup configuration ----------

test('env validation: missing secret or database is reported', () => {
  const problems = findEnvProblems({});
  assert.ok(problems.some((p) => /JWT_SECRET/.test(p)));
  assert.ok(problems.some((p) => /DATABASE_URL/.test(p)));
});

test('env validation: placeholder and short secrets are rejected in production only', () => {
  const base = { DATABASE_URL: 'postgres://x', JWT_SECRET: 'change_me_dev_only' };
  assert.deepEqual(findEnvProblems({ ...base, NODE_ENV: 'development' }), []);
  const prod = findEnvProblems({ ...base, NODE_ENV: 'production' });
  assert.ok(prod.some((p) => /at least 32/.test(p)));
  assert.ok(prod.some((p) => /placeholder/.test(p)));
  assert.deepEqual(findEnvProblems({ ...base, NODE_ENV: 'production', JWT_SECRET: 'a'.repeat(48) }), []);
});

// ---------- CORS allow-list ----------

test('cors: unset allows any origin; a list allows only listed origins', async () => {
  assert.deepEqual(parseOrigins(' https://a.app/ , http://localhost:3000,, '), ['https://a.app', 'http://localhost:3000']);

  const build = (env) => {
    const a = express();
    a.use(cors(buildCorsOptions(env)));
    a.get('/x', (req, res) => res.json({ ok: true }));
    return a;
  };

  const open = await request(build({})).get('/x').set('Origin', 'https://evil.example');
  assert.equal(open.headers['access-control-allow-origin'], '*');

  const restricted = build({ CORS_ORIGINS: 'https://dhaka-tesla-pool.netlify.app' });
  const ok = await request(restricted).get('/x').set('Origin', 'https://dhaka-tesla-pool.netlify.app/');
  assert.equal(ok.headers['access-control-allow-origin'], 'https://dhaka-tesla-pool.netlify.app/');
  const bad = await request(restricted).get('/x').set('Origin', 'https://evil.example');
  assert.equal(bad.headers['access-control-allow-origin'], undefined);
});

// ---------- login rate limiting ----------

test('rate limit: failed attempts are throttled per account, with Retry-After', async () => {
  let clock = 1_000_000;
  const limiter = createLoginRateLimiter({ maxPerAccount: 3, maxPerIp: 100, windowMs: 60_000, now: () => clock });
  const mini = express();
  mini.use(express.json());
  mini.post('/login', limiter, (req, res) => (req.body.password === 'right' ? res.json({ ok: true }) : res.status(401).json({ error: 'no' })));
  mini.use(errorHandler);

  for (let i = 0; i < 3; i++) {
    assert.equal((await request(mini).post('/login').send({ email: 'a@b.co', password: 'bad' })).status, 401);
  }
  const blocked = await request(mini).post('/login').send({ email: 'a@b.co', password: 'right' });
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers['retry-after']) > 0);

  // A different account is unaffected.
  assert.equal((await request(mini).post('/login').send({ email: 'other@b.co', password: 'right' })).status, 200);

  // After the window passes, the account can try again.
  clock += 61_000;
  assert.equal((await request(mini).post('/login').send({ email: 'a@b.co', password: 'right' })).status, 200);
});

test('rate limit: successful logins never count, and the real endpoint throttles after repeated failures', async () => {
  for (let i = 0; i < 15; i++) {
    const ok = await request(app).post('/api/auth/login').send({ email: 'nusrat@dhakateslapool.test', password: 'password123' });
    assert.equal(ok.status, 200);
  }
  let last;
  for (let i = 0; i < 11; i++) {
    last = await request(app).post('/api/auth/login').send({ email: 'rafiq@dhakateslapool.test', password: 'wrong-password' });
  }
  assert.equal(last.status, 429);
  // Rafiq's account is locked out for now, but Nusrat can still sign in.
  assert.equal((await request(app).post('/api/auth/login').send({ email: 'nusrat@dhakateslapool.test', password: 'password123' })).status, 200);
});

// ---------- seat cap ----------

test('a request for more seats than any Tesla can hold is rejected up front', async () => {
  const tooMany = await requestRide(tokens.nusrat, { seatsRequested: 9999 });
  assert.equal(tooMany.status, 422);
  assert.match(tooMany.body.error, /cannot exceed 6/);
  const seven = await requestRide(tokens.nusrat, { seatsRequested: 7 });
  assert.equal(seven.status, 422);
  const six = await requestRide(tokens.nusrat, { seatsRequested: 6 });
  assert.equal(six.status, 201);
});

// ---------- pagination ----------

test('open requests are paged oldest-first, with validated limit and offset', async () => {
  const a = await requestRide(tokens.nusrat);
  const b = await requestRide(tokens.rafiq);
  const c = await requestRide(tokens.shirin);
  const ids = [a, b, c].map((r) => r.body.rideRequest.id);

  const all = await authed('get', '/api/ride-requests/open', tokens.jashim);
  assert.equal(all.status, 200);
  assert.deepEqual(all.body.rideRequests.map((r) => r.id), ids);

  const first = await authed('get', '/api/ride-requests/open?limit=1', tokens.jashim);
  assert.deepEqual(first.body.rideRequests.map((r) => r.id), [ids[0]]);
  const second = await authed('get', '/api/ride-requests/open?limit=1&offset=1', tokens.jashim);
  assert.deepEqual(second.body.rideRequests.map((r) => r.id), [ids[1]]);
  const past = await authed('get', '/api/ride-requests/open?offset=5', tokens.jashim);
  assert.deepEqual(past.body.rideRequests, []);

  for (const bad of ['limit=0', 'limit=101', 'limit=abc', 'offset=-1', 'offset=1.5']) {
    const res = await authed('get', `/api/ride-requests/open?${bad}`, tokens.jashim);
    assert.equal(res.status, 422, bad);
  }
});
