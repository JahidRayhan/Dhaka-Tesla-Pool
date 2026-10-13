const { ApiError } = require('../utils/ApiError');

/**
 * Brute-force protection for login: counts FAILED attempts only (HTTP 401
 * from the login handler), so a legitimate user logging in repeatedly is
 * never throttled, while someone guessing passwords is.
 *
 * Two counters:
 *  - per (ip, email): stops guessing one account's password
 *  - per ip: stops spraying many accounts from one address
 * A successful login clears that (ip, email) counter.
 *
 * In-memory, so it is per-process and resets on restart. That is right for a
 * single-instance MVP; with several instances this would move to Redis or the
 * database (documented as the scaling change, not built now).
 */
function createLoginRateLimiter({ windowMs = 15 * 60 * 1000, maxPerAccount = 10, maxPerIp = 50, now = () => Date.now() } = {}) {
  const buckets = new Map(); // key -> { count, resetAt }

  const prune = (t) => {
    for (const [key, b] of buckets) {
      if (b.resetAt <= t) buckets.delete(key);
    }
  };

  const get = (key, t) => {
    const b = buckets.get(key);
    if (!b || b.resetAt <= t) return { count: 0, resetAt: t + windowMs };
    return b;
  };

  const fail = (key, t) => {
    const b = get(key, t);
    b.count += 1;
    buckets.set(key, b);
  };

  function middleware(req, res, next) {
    const t = now();
    if (buckets.size > 5000) prune(t);

    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const accountKey = `acct:${req.ip}|${email}`;
    const ipKey = `ip:${req.ip}`;

    const account = get(accountKey, t);
    const ip = get(ipKey, t);
    if (account.count >= maxPerAccount || ip.count >= maxPerIp) {
      const resetAt = Math.max(account.count >= maxPerAccount ? account.resetAt : 0, ip.count >= maxPerIp ? ip.resetAt : 0);
      const retryAfterSec = Math.max(1, Math.ceil((resetAt - t) / 1000));
      res.set('Retry-After', String(retryAfterSec));
      return next(new ApiError(429, 'Too many failed login attempts. Try again later.'));
    }

    res.on('finish', () => {
      const ts = now();
      if (res.statusCode === 401) {
        fail(accountKey, ts);
        fail(ipKey, ts);
      } else if (res.statusCode === 200) {
        buckets.delete(accountKey);
      }
    });
    next();
  }

  middleware.reset = () => buckets.clear();
  return middleware;
}

const defaultLimiter = createLoginRateLimiter({
  maxPerAccount: Number(process.env.LOGIN_RATE_LIMIT_MAX) || 10,
  windowMs: (Number(process.env.LOGIN_RATE_LIMIT_WINDOW_MIN) || 15) * 60 * 1000,
});

module.exports = { createLoginRateLimiter, loginRateLimit: defaultLimiter };
