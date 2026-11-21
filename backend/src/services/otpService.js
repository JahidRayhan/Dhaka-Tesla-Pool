const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { pool } = require('../config/db');
const { ApiError } = require('../utils/ApiError');
const { normalizePhone } = require('../utils/phone');
const { sendSms } = require('./smsService');
const { logoutAll } = require('./sessionService');

const CODE_TTL_MINUTES = 10;
const MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_SECONDS = 60;
const MAX_CODES_PER_HOUR = 5;
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 72;
const INVALID_CODE = 'That code is invalid or has expired';

const newCode = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
// HMAC with the server secret: a leaked table of hashes cannot be brute-forced
// offline (a 6-digit code has only a million possibilities) without that secret.
const hashCode = (code, phone, purpose) => crypto.createHmac('sha256', process.env.JWT_SECRET).update(`${purpose}|${phone}|${code}`).digest('hex');
const safeEqual = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

async function issueCode({ userId, phone, purpose, message }) {
  const { rows: recent } = await pool.query(
    `SELECT count(*) FILTER (WHERE created_at > now() - interval '1 hour')::int AS last_hour,
            count(*) FILTER (WHERE created_at > now() - make_interval(secs => $3))::int AS last_minute
     FROM otp_codes WHERE user_id = $1 AND purpose = $2`,
    [userId, purpose, RESEND_COOLDOWN_SECONDS],
  );
  if (recent[0].last_minute > 0) throw new ApiError(429, `Please wait ${RESEND_COOLDOWN_SECONDS} seconds before asking for another code`);
  if (recent[0].last_hour >= MAX_CODES_PER_HOUR) throw new ApiError(429, 'Too many codes requested. Try again later');

  const code = newCode();
  // Only the newest code is valid.
  await pool.query(`UPDATE otp_codes SET consumed_at = now() WHERE user_id = $1 AND purpose = $2 AND consumed_at IS NULL`, [userId, purpose]);
  await pool.query(
    `INSERT INTO otp_codes (purpose, user_id, phone, code_hash, expires_at) VALUES ($1, $2, $3, $4, now() + make_interval(mins => $5))`,
    [purpose, userId, phone, hashCode(code, phone, purpose), CODE_TTL_MINUTES],
  );
  await sendSms(phone, message(code));
}

/**
 * Checks a code; burns an attempt on every wrong guess and locks after MAX_ATTEMPTS.
 * @param {{ userId: string, phone: string, purpose: string, code: any }} args
 * @param {import('pg').PoolClient} client
 */
async function consumeCode({ userId, phone, purpose, code }, client) {
  const { rows } = await client.query(
    `SELECT * FROM otp_codes WHERE user_id = $1 AND purpose = $2 AND consumed_at IS NULL AND expires_at > now()
     ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
    [userId, purpose],
  );
  const otp = rows[0];
  if (!otp || otp.attempts >= MAX_ATTEMPTS || typeof code !== 'string' || !/^\d{6}$/.test(code)) {
    if (otp && typeof code === 'string') await client.query('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = $1', [otp.id]);
    return false;
  }
  if (!safeEqual(otp.code_hash, hashCode(code, phone, purpose))) {
    await client.query('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = $1', [otp.id]);
    return false;
  }
  await client.query('UPDATE otp_codes SET consumed_at = now() WHERE id = $1', [otp.id]);
  return true;
}

// ---- phone verification (signed-in user) ----

async function requestPhoneVerification(userId, phoneInput) {
  const { rows } = await pool.query('SELECT phone FROM users WHERE id = $1', [userId]);
  let phone = rows[0]?.phone ? normalizePhone(rows[0].phone) : null;
  if (phoneInput !== undefined) {
    phone = normalizePhone(phoneInput);
    if (!phone) throw new ApiError(422, 'phone is not a valid phone number');
  }
  if (!phone) throw new ApiError(422, 'Add a phone number first');
  try {
    // Changing the number clears the verified flag; re-sending to the same number keeps it.
    await pool.query(
      `UPDATE users SET phone_verified_at = CASE WHEN phone = $2::varchar THEN phone_verified_at ELSE NULL END, phone = $2::varchar WHERE id = $1`,
      [userId, phone],
    );
  } catch (err) {
    if (err.code === '23505') throw new ApiError(409, 'That phone number is already registered to another account');
    throw err;
  }
  await issueCode({ userId, phone, purpose: 'VERIFY_PHONE', message: (c) => `Dhaka Tesla Pool: your verification code is ${c}. It expires in ${CODE_TTL_MINUTES} minutes.` });
}

async function verifyPhone(userId, code) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT phone FROM users WHERE id = $1', [userId]);
    const phone = rows[0]?.phone;
    const ok = phone && (await consumeCode({ userId, phone, purpose: 'VERIFY_PHONE', code }, client));
    if (ok) await client.query('UPDATE users SET phone_verified_at = now() WHERE id = $1', [userId]);
    await client.query('COMMIT'); // commit even on failure: the burned attempt must persist
    if (!ok) throw new ApiError(400, INVALID_CODE);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// ---- password reset (signed-out user, by phone) ----

/** Always succeeds from the caller's view, so it cannot be used to discover who has an account. */
async function requestPasswordReset(phoneInput) {
  const phone = normalizePhone(phoneInput);
  if (!phone) return;
  const { rows } = await pool.query('SELECT id FROM users WHERE phone = $1 AND phone_verified_at IS NOT NULL', [phone]);
  if (rows.length === 0) return;
  try {
    await issueCode({ userId: rows[0].id, phone, purpose: 'RESET_PASSWORD', message: (c) => `Dhaka Tesla Pool: your password reset code is ${c}. If you didn't ask for it, ignore this message.` });
  } catch (err) {
    if (!(err instanceof ApiError)) throw err; // rate-limit answers are swallowed too: same response either way
  }
}

async function resetPassword({ phone: phoneInput, code, newPassword }) {
  if (typeof newPassword !== 'string' || newPassword.length < MIN_PASSWORD_LENGTH || Buffer.byteLength(newPassword) > MAX_PASSWORD_LENGTH) {
    throw new ApiError(422, `newPassword must be ${MIN_PASSWORD_LENGTH}-${MAX_PASSWORD_LENGTH} bytes`);
  }
  const phone = normalizePhone(phoneInput);
  const hash = await bcrypt.hash(newPassword, 10);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = phone ? await client.query('SELECT id FROM users WHERE phone = $1 AND phone_verified_at IS NOT NULL', [phone]) : { rows: [] };
    const ok = rows.length > 0 && (await consumeCode({ userId: rows[0].id, phone, purpose: 'RESET_PASSWORD', code }, client));
    if (ok) {
      await client.query('UPDATE users SET password_hash = $2 WHERE id = $1', [rows[0].id, hash]);
      await logoutAll(rows[0].id, client); // whoever had the old password loses their sessions
    }
    await client.query('COMMIT');
    if (!ok) throw new ApiError(400, INVALID_CODE);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { requestPhoneVerification, verifyPhone, requestPasswordReset, resetPassword };
