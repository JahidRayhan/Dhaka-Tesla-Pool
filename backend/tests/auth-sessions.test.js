process.env.SMS_PROVIDER = 'memory';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const express = require('express');
const { request, app } = require('./helpers');
const { pool } = require('./db');
const { outbox } = require('../src/services/smsService');
const { normalizePhone } = require('../src/utils/phone');
const { createLoginRateLimiter, createPostgresStore } = require('../src/middleware/loginRateLimit');
const { errorHandler } = require('../src/middleware/errorHandler');

after(async () => {
  await pool.end();
});

const uniq = () => `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
const randomPhone = () => `01${['7', '8', '9'][Math.floor(Math.random() * 3)]}${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
async function newUser({ phone } = {}) {
  const email = `sess-${uniq()}@dhakateslapool.test`;
  const body = { name: 'Sess User', email, password: 'password123', ...(phone ? { phone } : {}) };
  const res = await request(app).post('/api/v1/auth/signup').send(body);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return { email, password: 'password123', ...res.body };
}
const lastCode = (to) => {
  const msg = [...outbox].reverse().find((m) => m.to === to);
  return msg?.message.match(/\b(\d{6})\b/)?.[1];
};
const expireCooldown = (phone) => pool.query(`UPDATE otp_codes SET created_at = created_at - interval '2 minutes' WHERE phone = $1`, [phone]);

test('phone numbers are normalised to one canonical form, and junk is rejected', () => {
  for (const same of ['01712345678', '+8801712345678', '8801712345678', '+88 017-1234 5678', '008801712345678']) {
    assert.equal(normalizePhone(same), '+8801712345678', same);
  }
  for (const bad of ['', 'abc', '12345', '+0123', null, 12345678901, '0171234567']) assert.equal(normalizePhone(bad), null, String(bad));
});

test('login returns a short-lived access token plus a refresh token', async () => {
  const u = await newUser();
  assert.ok(u.refreshToken && u.refreshToken.length >= 40);
  const decoded = jwt.decode(u.accessToken);
  assert.equal(decoded.exp - decoded.iat, 15 * 60);
  assert.equal(u.expiresIn, 900);
  assert.equal(u.token, u.accessToken, 'legacy "token" field kept for older clients');
  const login = await request(app).post('/api/v1/auth/login').send({ email: u.email, password: u.password });
  assert.ok(login.body.refreshToken && login.body.refreshToken !== u.refreshToken);
  assert.equal((await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${u.accessToken}`)).status, 200);
});

test('refreshing rotates the token: the old one dies, and replaying it revokes the whole session', async () => {
  const u = await newUser();
  const r1 = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: u.refreshToken });
  assert.equal(r1.status, 200);
  assert.notEqual(r1.body.refreshToken, u.refreshToken);
  assert.equal((await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${r1.body.accessToken}`)).status, 200);

  const replay = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: u.refreshToken });
  assert.equal(replay.status, 401);
  const afterReplay = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: r1.body.refreshToken });
  assert.equal(afterReplay.status, 401);
});

test('garbage, missing and expired refresh tokens are all a plain 401', async () => {
  for (const body of [{}, { refreshToken: 'nope' }, { refreshToken: 'x'.repeat(64) }, { refreshToken: 12345 }]) {
    assert.equal((await request(app).post('/api/v1/auth/refresh').send(body)).status, 401, JSON.stringify(body));
  }
  const u = await newUser();
  await pool.query(`UPDATE refresh_tokens SET expires_at = now() - interval '1 minute' WHERE user_id = $1`, [u.user.id]);
  assert.equal((await request(app).post('/api/v1/auth/refresh').send({ refreshToken: u.refreshToken })).status, 401);
});

test('logout revokes that device; logout-all revokes every device; refresh tokens are stored hashed', async () => {
  const u = await newUser();
  const second = (await request(app).post('/api/v1/auth/login').send({ email: u.email, password: u.password })).body;

  assert.equal((await request(app).post('/api/v1/auth/logout').send({ refreshToken: u.refreshToken })).status, 204);
  assert.equal((await request(app).post('/api/v1/auth/refresh').send({ refreshToken: u.refreshToken })).status, 401);
  assert.equal((await request(app).post('/api/v1/auth/refresh').send({ refreshToken: second.refreshToken })).status, 200, 'the other device is unaffected');
  assert.equal((await request(app).post('/api/v1/auth/logout').send({ refreshToken: 'unknown-token-value-0000000000' })).status, 204, 'unknown tokens are ignored');

  const third = (await request(app).post('/api/v1/auth/login').send({ email: u.email, password: u.password })).body;
  assert.equal((await request(app).post('/api/v1/auth/logout-all').set('Authorization', `Bearer ${third.accessToken}`)).status, 204);
  assert.equal((await request(app).post('/api/v1/auth/refresh').send({ refreshToken: third.refreshToken })).status, 401);

  const { rows } = await pool.query('SELECT token_hash FROM refresh_tokens WHERE user_id = $1', [u.user.id]);
  assert.ok(rows.every((r) => r.token_hash !== u.refreshToken && /^[0-9a-f]{64}$/.test(r.token_hash)));
});

test('phone verification: code is sent, wrong guesses burn attempts, then the right code verifies', async () => {
  const raw = randomPhone();
  const phone = normalizePhone(raw);
  const u = await newUser({ phone: raw });
  assert.equal(u.user.phone, phone, 'stored in canonical form');
  assert.equal(u.user.phone_verified_at, null);
  const auth = { Authorization: `Bearer ${u.accessToken}` };

  assert.equal((await request(app).post('/api/v1/auth/phone/request-otp').set(auth).send({})).status, 204);
  const code = lastCode(phone);
  assert.match(code, /^\d{6}$/);

  const { rows } = await pool.query('SELECT code_hash FROM otp_codes WHERE phone = $1', [phone]);
  assert.ok(!rows[0].code_hash.includes(code) && rows[0].code_hash.length === 64, 'the code itself is never stored');

  const wrong = code === '000000' ? '111111' : '000000';
  assert.equal((await request(app).post('/api/v1/auth/phone/verify-otp').set(auth).send({ code: wrong })).status, 400);
  assert.equal((await request(app).post('/api/v1/auth/phone/verify-otp').set(auth).send({ code: 'abc' })).status, 400);

  assert.equal((await request(app).post('/api/v1/auth/phone/verify-otp').set(auth).send({ code })).status, 204);
  const me = await request(app).get('/api/v1/auth/me').set(auth);
  assert.ok(me.body.user.phone_verified_at);
  assert.equal((await request(app).post('/api/v1/auth/phone/verify-otp').set(auth).send({ code })).status, 400, 'a code works once');
});

test('a code cannot be brute-forced: five wrong guesses lock it, even for the right code', async () => {
  const raw = randomPhone();
  const phone = normalizePhone(raw);
  const u = await newUser({ phone: raw });
  const auth = { Authorization: `Bearer ${u.accessToken}` };
  await request(app).post('/api/v1/auth/phone/request-otp').set(auth).send({});
  const code = lastCode(phone);
  const wrong = code === '123456' ? '654321' : '123456';
  for (let i = 0; i < 5; i++) assert.equal((await request(app).post('/api/v1/auth/phone/verify-otp').set(auth).send({ code: wrong })).status, 400);
  assert.equal((await request(app).post('/api/v1/auth/phone/verify-otp').set(auth).send({ code })).status, 400, 'locked out');
  assert.equal((await request(app).post('/api/v1/auth/phone/request-otp').set(auth).send({})).status, 429, 'cooldown applies');
  await expireCooldown(phone);
  assert.equal((await request(app).post('/api/v1/auth/phone/request-otp').set(auth).send({})).status, 204);
  assert.equal((await request(app).post('/api/v1/auth/phone/verify-otp').set(auth).send({ code: lastCode(phone) })).status, 204);
});

test('code requests are rate limited, and a phone number belongs to one account', async () => {
  const raw = randomPhone();
  const phone = normalizePhone(raw);
  const u = await newUser({ phone: raw });
  const auth = { Authorization: `Bearer ${u.accessToken}` };
  for (let i = 0; i < 5; i++) {
    assert.equal((await request(app).post('/api/v1/auth/phone/request-otp').set(auth).send({})).status, 204, `request ${i + 1}`);
    await expireCooldown(phone);
  }
  await pool.query(`UPDATE otp_codes SET created_at = now() - interval '2 minutes' WHERE phone = $1`, [phone]);
  assert.equal((await request(app).post('/api/v1/auth/phone/request-otp').set(auth).send({})).status, 429, 'hourly cap');

  const other = await newUser();
  const clash = await request(app).post('/api/v1/auth/phone/request-otp').set({ Authorization: `Bearer ${other.accessToken}` }).send({ phone: raw });
  assert.equal(clash.status, 409);
});

test('password reset by SMS: only verified numbers, single-use code, signs out every device, old password dies', async () => {
  const raw = randomPhone();
  const phone = normalizePhone(raw);
  const u = await newUser({ phone: raw });
  const auth = { Authorization: `Bearer ${u.accessToken}` };

  const before = outbox.length;
  assert.equal((await request(app).post('/api/v1/auth/forgot-password').send({ phone: raw })).status, 204);
  assert.equal(outbox.length, before, 'no SMS for an unverified number');

  await request(app).post('/api/v1/auth/phone/request-otp').set(auth).send({});
  await request(app).post('/api/v1/auth/phone/verify-otp').set(auth).send({ code: lastCode(phone) });
  await expireCooldown(phone);

  assert.equal((await request(app).post('/api/v1/auth/forgot-password').send({ phone: '01799999999' })).status, 204);
  assert.equal((await request(app).post('/api/v1/auth/forgot-password').send({ phone: 'garbage' })).status, 204);

  assert.equal((await request(app).post('/api/v1/auth/forgot-password').send({ phone: raw })).status, 204);
  const resetCode = lastCode(phone);
  assert.match(resetCode, /^\d{6}$/);

  const wrong = resetCode === '000000' ? '111111' : '000000';
  assert.equal((await request(app).post('/api/v1/auth/reset-password').send({ phone: raw, code: wrong, newPassword: 'brandnew-pass-1' })).status, 400);
  assert.equal((await request(app).post('/api/v1/auth/reset-password').send({ phone: raw, code: resetCode, newPassword: 'short' })).status, 422);
  assert.equal((await request(app).post('/api/v1/auth/reset-password').send({ phone: raw, code: resetCode, newPassword: 'brandnew-pass-1' })).status, 204);

  assert.equal((await request(app).post('/api/v1/auth/login').send({ email: u.email, password: 'brandnew-pass-1' })).status, 200);
  assert.equal((await request(app).post('/api/v1/auth/login').send({ email: u.email, password: u.password })).status, 401);
  assert.equal((await request(app).post('/api/v1/auth/refresh').send({ refreshToken: u.refreshToken })).status, 401, 'old sessions were revoked');
  assert.equal((await request(app).post('/api/v1/auth/reset-password').send({ phone: raw, code: resetCode, newPassword: 'another-pass-22' })).status, 400, 'code is single use');
});

test('the Postgres throttle store is shared between "instances" and fails open when it is down', async () => {
  await pool.query('TRUNCATE rate_limits');
  const make = (store) => {
    const limiter = createLoginRateLimiter({ maxPerAccount: 3, maxPerIp: 100, windowMs: 60_000, store });
    const mini = express();
    mini.use(express.json());
    mini.post('/login', limiter, (req, res) => (req.body.password === 'right' ? res.json({ ok: true }) : res.status(401).json({ error: 'no' })));
    mini.use(errorHandler);
    return mini;
  };
  const instanceA = make(createPostgresStore());
  const instanceB = make(createPostgresStore());
  const settle = () => new Promise((r) => setTimeout(r, 60));

  for (let i = 0; i < 2; i++) { await request(instanceA).post('/login').send({ email: 'x@y.co', password: 'bad' }); await settle(); }
  await request(instanceB).post('/login').send({ email: 'x@y.co', password: 'bad' });
  await settle();
  const blocked = await request(instanceA).post('/login').send({ email: 'x@y.co', password: 'right' });
  assert.equal(blocked.status, 429, 'failures counted on B limit A');
  assert.ok(Number(blocked.headers['retry-after']) > 0);
  assert.equal((await request(instanceA).post('/login').send({ email: 'someone@else.co', password: 'right' })).status, 200);

  const brokenStore = { get: async () => { throw new Error('db down'); }, increment: async () => { throw new Error('db down'); }, clear: async () => {} };
  assert.equal((await request(make(brokenStore)).post('/login').send({ email: 'x@y.co', password: 'right' })).status, 200, 'fails open');
});
