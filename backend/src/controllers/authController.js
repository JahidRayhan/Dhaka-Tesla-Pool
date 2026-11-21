const bcrypt = require('bcryptjs');
const { pool } = require('../config/db');
const { ApiError } = require('../utils/ApiError');
const { asyncHandler } = require('../utils/asyncHandler');
const { normalizePhone } = require('../utils/phone');
const sessionService = require('../services/sessionService');
const otpService = require('../services/otpService');

const sessionFor = (user, req) => sessionService.createSession(user, { userAgent: req.get('user-agent') || null });

function publicUser(user) {
  const { password_hash, ...rest } = user;
  return rest;
}

const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 72; // bcrypt silently ignores anything past 72 bytes
// Deliberately loose: one @, something on each side, a dot in the domain, no
// spaces. Real verification is a confirmation email, not a regex.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Emails are case-insensitive in practice; store and compare them lowercased
// so "Nusrat@x.com" and "nusrat@x.com" can't become two accounts.
const normalizeEmail = (email) => email.trim().toLowerCase();

const signup = asyncHandler(async (req, res) => {
  const { name, email, phone, password, role } = req.body;

  if (typeof name !== 'string' || typeof email !== 'string' || typeof password !== 'string'
      || !name.trim() || !email.trim() || !password) {
    throw new ApiError(422, 'name, email and password are required');
  }
  const cleanEmail = normalizeEmail(email);
  if (!EMAIL_PATTERN.test(cleanEmail)) {
    throw new ApiError(422, 'email is not a valid email address');
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new ApiError(422, `password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  if (Buffer.byteLength(password) > MAX_PASSWORD_LENGTH) {
    throw new ApiError(422, `password must be at most ${MAX_PASSWORD_LENGTH} bytes`);
  }
  if (phone != null && typeof phone !== 'string') {
    throw new ApiError(422, 'phone must be a string');
  }
  // Stored in one canonical form (+8801…), so "0171…" and "+88 0171…" are the same number.
  const cleanPhone = phone ? normalizePhone(phone) : null;
  if (phone && !cleanPhone) throw new ApiError(422, 'phone is not a valid phone number');
  const validRole = ['passenger', 'driver', 'both'].includes(role) ? role : 'passenger';

  const passwordHash = await bcrypt.hash(password, 10);

  // User + wallet are one unit: a user without a wallet would break every
  // later payment path, so either both rows exist or neither does.
  const client = await pool.connect();
  let user;
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO users (name, email, phone, password_hash, role)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [name.trim(), cleanEmail, cleanPhone, passwordHash, validRole],
    );
    user = rows[0];
    await client.query('INSERT INTO wallets (user_id, balance_paisa) VALUES ($1, 0)', [user.id]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err; // a duplicate email surfaces as pg 23505 -> 409 via errorHandler
  } finally {
    client.release();
  }

  res.status(201).json({ user: publicUser(user), ...(await sessionFor(user, req)) });
});

const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  // Non-string input gets the same generic 401 as a wrong password; it must
  // never reach bcrypt.compare, which throws on non-strings.
  if (typeof email !== 'string' || typeof password !== 'string') {
    throw new ApiError(401, 'Invalid email or password');
  }

  // lower(email) so accounts created before normalization still match.
  const { rows } = await pool.query('SELECT * FROM users WHERE lower(email) = $1', [normalizeEmail(email)]);
  const user = rows[0];

  // Same generic error whether the email is unknown or the password is
  // wrong — don't leak which one it was.
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    throw new ApiError(401, 'Invalid email or password');
  }

  res.json({ user: publicUser(user), ...(await sessionFor(user, req)) });
});

const me = asyncHandler(async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
  if (rows.length === 0) throw new ApiError(404, 'User not found');
  res.json({ user: publicUser(rows[0]) });
});

const refresh = asyncHandler(async (req, res) => {
  res.json(await sessionService.refresh(req.body?.refreshToken, { userAgent: req.get('user-agent') || null }));
});

const logout = asyncHandler(async (req, res) => {
  await sessionService.logout(req.body?.refreshToken);
  res.status(204).send();
});

const logoutAll = asyncHandler(async (req, res) => {
  await sessionService.logoutAll(req.user.id);
  res.status(204).send();
});

const requestPhoneOtp = asyncHandler(async (req, res) => {
  await otpService.requestPhoneVerification(req.user.id, req.body?.phone);
  res.status(204).send();
});

const verifyPhoneOtp = asyncHandler(async (req, res) => {
  await otpService.verifyPhone(req.user.id, req.body?.code);
  res.status(204).send();
});

const forgotPassword = asyncHandler(async (req, res) => {
  await otpService.requestPasswordReset(req.body?.phone);
  res.status(204).send(); // identical whether or not the number is registered
});

const resetPassword = asyncHandler(async (req, res) => {
  await otpService.resetPassword({ phone: req.body?.phone, code: req.body?.code, newPassword: req.body?.newPassword });
  res.status(204).send();
});

module.exports = { signup, login, me, refresh, logout, logoutAll, requestPhoneOtp, verifyPhoneOtp, forgotPassword, resetPassword };
