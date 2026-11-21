const { ApiError } = require('../utils/ApiError');
const { pool } = require('../config/db');
const logger = require('../utils/logger');

/**
 * Brute-force protection for login: counts FAILED attempts only (HTTP 401 from
 * the login handler), so a legitimate user logging in repeatedly is never
 * throttled, while someone guessing passwords is.
 *
 * Two counters: per (ip, email) stops guessing one account's password; per ip
 * stops spraying many accounts from one address. A successful login clears that
 * (ip, email) counter.
 *
 * Where the counters live is pluggable:
 *  - memory   (default)  fast, but each API instance only sees its own traffic
 *  - postgres            shared by every instance — set RATE_LIMIT_STORE=postgres
 *                        for any deployment with more than one process
 * If the shared store itself is unreachable the limiter fails OPEN (logs and lets
 * the request through): the throttle being down must not lock everyone out.
 */
function createMemoryStore({ now = () => Date.now() } = {}) {
  const buckets = new Map(); // key -> { count, resetAt(ms) }
  return {
    async get(key) {
      const b = buckets.get(key);
      return !b || b.resetAt <= now() ? { count: 0, resetAt: 0 } : b;
    },
    async increment(key, windowMs) {
      const current = await this.get(key);
      const b = { count: current.count + 1, resetAt: current.count === 0 ? now() + windowMs : current.resetAt };
      buckets.set(key, b);
      if (buckets.size > 5000) for (const [k, v] of buckets) if (v.resetAt <= now()) buckets.delete(k);
    },
    async clear(key) {
      buckets.delete(key);
    },
    reset() {
      buckets.clear();
    },
  };
}

function createPostgresStore() {
  return {
    async get(key) {
      const { rows } = await pool.query('SELECT count, reset_at FROM rate_limits WHERE key = $1 AND reset_at > now()', [key]);
      return rows[0] ? { count: rows[0].count, resetAt: new Date(rows[0].reset_at).getTime() } : { count: 0, resetAt: 0 };
    },
    async increment(key, windowMs) {
      // One atomic statement: start a fresh window if the old one ended, else count up.
      await pool.query(
        `INSERT INTO rate_limits (key, count, reset_at) VALUES ($1, 1, now() + make_interval(secs => $2))
         ON CONFLICT (key) DO UPDATE SET
           count    = CASE WHEN rate_limits.reset_at <= now() THEN 1 ELSE rate_limits.count + 1 END,
           reset_at = CASE WHEN rate_limits.reset_at <= now() THEN now() + make_interval(secs => $2) ELSE rate_limits.reset_at END`,
        [key, windowMs / 1000],
      );
    },
    async clear(key) {
      await pool.query('DELETE FROM rate_limits WHERE key = $1', [key]);
    },
    reset() {
      return pool.query('TRUNCATE rate_limits');
    },
  };
}

function createLoginRateLimiter({ windowMs = 15 * 60 * 1000, maxPerAccount = 10, maxPerIp = 50, now = () => Date.now(), store = createMemoryStore({ now }) } = {}) {
  async function middleware(req, res, next) {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const accountKey = `login:acct:${req.ip}|${email}`;
    const ipKey = `login:ip:${req.ip}`;

    try {
      const [account, ip] = await Promise.all([store.get(accountKey), store.get(ipKey)]);
      const accountBlocked = account.count >= maxPerAccount;
      const ipBlocked = ip.count >= maxPerIp;
      if (accountBlocked || ipBlocked) {
        const resetAt = Math.max(accountBlocked ? account.resetAt : 0, ipBlocked ? ip.resetAt : 0);
        res.set('Retry-After', String(Math.max(1, Math.ceil((resetAt - now()) / 1000))));
        return next(new ApiError(429, 'Too many failed login attempts. Try again later.'));
      }
    } catch (err) {
      logger.warn('rate limiter store unavailable; allowing request', { err });
    }

    res.on('finish', () => {
      const bookkeeping =
        res.statusCode === 401
          ? Promise.all([store.increment(accountKey, windowMs), store.increment(ipKey, windowMs)])
          : res.statusCode === 200
            ? store.clear(accountKey)
            : null;
      if (bookkeeping) bookkeeping.catch((err) => logger.warn('rate limiter bookkeeping failed', { err }));
    });
    return next();
  }

  middleware.reset = () => store.reset?.();
  return middleware;
}

const defaultStore = process.env.RATE_LIMIT_STORE === 'postgres' ? createPostgresStore() : undefined;
const defaultLimiter = createLoginRateLimiter({
  maxPerAccount: Number(process.env.LOGIN_RATE_LIMIT_MAX) || 10,
  windowMs: (Number(process.env.LOGIN_RATE_LIMIT_WINDOW_MIN) || 15) * 60 * 1000,
  ...(defaultStore ? { store: defaultStore } : {}),
});

module.exports = { createLoginRateLimiter, createMemoryStore, createPostgresStore, loginRateLimit: defaultLimiter };
