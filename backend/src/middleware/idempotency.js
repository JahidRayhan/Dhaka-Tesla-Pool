const crypto = require('crypto');
const { pool } = require('../config/db');
const { ApiError } = require('../utils/ApiError');

const KEY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;
const STALE_IN_FLIGHT_SECONDS = 60; // a crashed first attempt must not block the key forever

const hashRequest = (req) =>
  crypto.createHash('sha256').update(`${req.method} ${req.baseUrl}${req.path}\n${JSON.stringify(req.body ?? null)}`).digest('hex');

/**
 * Optional `Idempotency-Key` header. Without it the route behaves exactly as
 * before. With it, the action runs at most once per (user, key):
 *   - first request: runs normally; a SUCCESSFUL (2xx) result is stored
 *   - repeat while the first is still running: 409
 *   - repeat after it finished: the stored result, marked `Idempotent-Replayed: true`
 *   - same key, different request: 422 (a client bug worth surfacing)
 * Failures (4xx/5xx) are NOT stored, so a request that failed for a fixable or
 * transient reason can simply be retried with the same key.
 * Must be mounted after requireAuth.
 */
function idempotent() {
  return async function idempotencyMiddleware(req, res, next) {
    const key = req.get('idempotency-key');
    if (!key) return next();
    try {
      if (!KEY_PATTERN.test(key)) throw new ApiError(422, 'Idempotency-Key must be 8-128 characters: letters, digits and . _ : -');
      const hash = hashRequest(req);
      const userId = req.user.id;

      await pool.query(
        `DELETE FROM idempotency_keys
         WHERE user_id = $1 AND key = $2 AND completed_at IS NULL
           AND created_at < now() - make_interval(secs => $3)`,
        [userId, key, STALE_IN_FLIGHT_SECONDS],
      );
      const claimed = await pool.query(
        `INSERT INTO idempotency_keys (user_id, key, request_hash) VALUES ($1, $2, $3)
         ON CONFLICT (user_id, key) DO NOTHING RETURNING 1`,
        [userId, key, hash],
      );

      if (claimed.rowCount === 0) {
        const { rows } = await pool.query(
          'SELECT request_hash, status_code, response_body FROM idempotency_keys WHERE user_id = $1 AND key = $2',
          [userId, key],
        );
        const existing = rows[0];
        if (!existing) return next(); // vanished between the two statements: treat as a first request
        if (existing.request_hash !== hash) throw new ApiError(422, 'This Idempotency-Key was already used for a different request');
        if (existing.status_code === null) throw new ApiError(409, 'A request with this Idempotency-Key is still being processed');
        res.set('Idempotent-Replayed', 'true');
        return existing.response_body === null ? res.status(existing.status_code).end() : res.status(existing.status_code).json(existing.response_body);
      }

      // We own the key: capture the outcome to store (or release) it.
      let body = null;
      const originalJson = res.json.bind(res);
      res.json = (payload) => {
        body = payload;
        return originalJson(payload);
      };
      res.on('finish', () => {
        const done =
          res.statusCode >= 200 && res.statusCode < 300
            ? pool.query(
                `UPDATE idempotency_keys SET status_code = $3, response_body = $4, completed_at = now() WHERE user_id = $1 AND key = $2`,
                [userId, key, res.statusCode, body === null ? null : JSON.stringify(body)],
              )
            : pool.query('DELETE FROM idempotency_keys WHERE user_id = $1 AND key = $2', [userId, key]);
        done.catch(() => {}); // bookkeeping failure must never affect the response already sent
      });
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

module.exports = { idempotent };
