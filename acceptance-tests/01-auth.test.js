// Covers PRD Section 3: "Sign up/in" (both Passenger and Driver rows) and
// Section 6's auth requirement. None of this was exercised by backend/tests/
// — that suite only ever called login() as a fixture, never tested signup
// or login's failure paths directly.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { request, app, pool } = require('./helpers');

after(async () => {
  await pool.end();
});

test('a new passenger can sign up and receives a usable token', async () => {
  const email = `acceptance-signup-${Date.now()}@dhakateslapool.test`;
  const res = await request(app).post('/api/auth/signup').send({
    name: 'Acceptance Passenger',
    email,
    password: 'password123',
    role: 'passenger',
  });

  assert.equal(res.status, 201);
  assert.equal(res.body.user.email, email);
  assert.equal(res.body.user.role, 'passenger');
  assert.ok(res.body.token, 'expected a JWT in the signup response');
  assert.equal(res.body.user.password_hash, undefined, 'password hash must never be returned to the client');

  // The token from signup should work immediately, with no separate login step.
  const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${res.body.token}`);
  assert.equal(me.status, 200);
  assert.equal(me.body.user.email, email);
});

test('signing up with an email that already exists is rejected, not silently overwritten', async () => {
  const email = `acceptance-dup-${Date.now()}@dhakateslapool.test`;
  const first = await request(app).post('/api/auth/signup').send({ name: 'A', email, password: 'password123' });
  assert.equal(first.status, 201);

  const second = await request(app).post('/api/auth/signup').send({ name: 'B', email, password: 'password456' });
  assert.equal(second.status, 409); // unique_violation on users.email, translated by errorHandler
});

test('signup without a password is rejected with a clear validation error, not a 500', async () => {
  const res = await request(app)
    .post('/api/auth/signup')
    .send({ name: 'No Password', email: `acceptance-nopass-${Date.now()}@dhakateslapool.test` });
  assert.equal(res.status, 422);
});

test('login with a wrong password is rejected', async () => {
  const email = `acceptance-wrongpw-${Date.now()}@dhakateslapool.test`;
  await request(app).post('/api/auth/signup').send({ name: 'X', email, password: 'correct-password' });

  const res = await request(app).post('/api/auth/login').send({ email, password: 'wrong-password' });
  assert.equal(res.status, 401);
});

test('login with an unknown email gets the same generic error as a wrong password (no user enumeration)', async () => {
  const wrongPassword = await request(app)
    .post('/api/auth/login')
    .send({ email: 'jashim@dhakateslapool.test', password: 'definitely-wrong' });
  const unknownEmail = await request(app)
    .post('/api/auth/login')
    .send({ email: 'nobody-such-user@dhakateslapool.test', password: 'anything' });

  assert.equal(wrongPassword.status, 401);
  assert.equal(unknownEmail.status, 401);
  assert.equal(wrongPassword.body.error, unknownEmail.body.error);
});

test('protected routes reject requests with no token at all', async () => {
  const res = await request(app).get('/api/auth/me');
  assert.equal(res.status, 401);
});

test('protected routes reject a garbage/expired-looking token', async () => {
  const res = await request(app).get('/api/auth/me').set('Authorization', 'Bearer not-a-real-token');
  assert.equal(res.status, 401);
});
