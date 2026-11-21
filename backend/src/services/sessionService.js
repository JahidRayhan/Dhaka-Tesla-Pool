const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { pool } = require('../config/db');
const { ApiError } = require('../utils/ApiError');

const REFRESH_TTL_DAYS = 30;
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const newRefreshToken = () => crypto.randomBytes(48).toString('base64url');
const SESSION_EXPIRED = 'Your session has expired. Please sign in again.';

function signAccessToken(user) {
  return jwt.sign({ sub: user.id, role: user.role }, process.env.JWT_SECRET, {
    expiresIn: /** @type {any} */ (process.env.JWT_EXPIRES_IN || '15m'),
  });
}

function expiresInSeconds(accessToken) {
  const { exp, iat } = /** @type {import('jsonwebtoken').JwtPayload} */ (jwt.decode(accessToken));
  return exp - iat;
}

/**
 * Start a new session (one sign-in = one token family).
 * @param {{ id: string, role: string }} user
 * @param {{ userAgent?: string | null, client?: import('pg').PoolClient | import('pg').Pool }} [options]
 */
async function createSession(user, { userAgent = null, client = pool } = {}) {
  const refreshToken = newRefreshToken();
  await client.query(
    `INSERT INTO refresh_tokens (user_id, family_id, token_hash, expires_at, user_agent)
     VALUES ($1, gen_random_uuid(), $2, now() + make_interval(days => $3), $4)`,
    [user.id, sha256(refreshToken), REFRESH_TTL_DAYS, userAgent],
  );
  const accessToken = signAccessToken(user);
  return { token: accessToken, accessToken, refreshToken, expiresIn: expiresInSeconds(accessToken) };
}

/**
 * Exchange a refresh token for a new access token AND a new refresh token (the
 * old one stops working). If an already-used token is presented, someone is
 * replaying a stolen token: kill the whole family so both the thief and the
 * real owner must sign in again.
 */
async function refresh(refreshToken, { userAgent = null } = {}) {
  if (typeof refreshToken !== 'string' || refreshToken.length < 20) throw new ApiError(401, SESSION_EXPIRED);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT rt.*, u.role FROM refresh_tokens rt JOIN users u ON u.id = rt.user_id
       WHERE rt.token_hash = $1 FOR UPDATE OF rt`,
      [sha256(refreshToken)],
    );
    const row = rows[0];
    if (!row) throw new ApiError(401, SESSION_EXPIRED);

    if (row.revoked_at) {
      await client.query('UPDATE refresh_tokens SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL', [row.family_id]);
      await client.query('COMMIT');
      throw new ApiError(401, SESSION_EXPIRED);
    }
    if (new Date(row.expires_at) <= new Date()) throw new ApiError(401, SESSION_EXPIRED);

    const next = newRefreshToken();
    const { rows: inserted } = await client.query(
      `INSERT INTO refresh_tokens (user_id, family_id, token_hash, expires_at, user_agent)
       VALUES ($1, $2, $3, now() + make_interval(days => $4), $5) RETURNING id`,
      [row.user_id, row.family_id, sha256(next), REFRESH_TTL_DAYS, userAgent],
    );
    await client.query('UPDATE refresh_tokens SET revoked_at = now(), replaced_by = $2 WHERE id = $1', [row.id, inserted[0].id]);
    await client.query('COMMIT');

    const accessToken = signAccessToken({ id: row.user_id, role: row.role });
    return { token: accessToken, accessToken, refreshToken: next, expiresIn: expiresInSeconds(accessToken) };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Sign this device out: revoke its whole token family. Unknown tokens are ignored. */
async function logout(refreshToken) {
  if (typeof refreshToken !== 'string') return;
  await pool.query(
    `UPDATE refresh_tokens SET revoked_at = now()
     WHERE revoked_at IS NULL AND family_id IN (SELECT family_id FROM refresh_tokens WHERE token_hash = $1)`,
    [sha256(refreshToken)],
  );
}

/**
 * Sign out everywhere (after a password reset, or on demand).
 * @param {string} userId
 * @param {import('pg').PoolClient | import('pg').Pool} [client]
 */
async function logoutAll(userId, client = pool) {
  await client.query('UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [userId]);
}

module.exports = { createSession, refresh, logout, logoutAll, signAccessToken };
