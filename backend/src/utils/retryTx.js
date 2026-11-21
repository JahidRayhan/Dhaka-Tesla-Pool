/**
 * Re-runs a whole transactional unit when Postgres aborted it because two
 * transactions collided (40P01 deadlock_detected / 40001 serialization_failure).
 * The aborted transaction wrote nothing, so running the unit again from the top
 * is safe — and invisible to the user, who gets the retry's result, not an error.
 * Only wrap functions that open their own transaction and have no side effects
 * outside it.
 */
const isRetryable = (err) => err && (err.code === '40P01' || err.code === '40001');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function withRetry(fn, { attempts = 4 } = {}) {
  for (let i = 0; ; i += 1) {
    try {
      return await fn();
    } catch (err) {
      if (!isRetryable(err) || i >= attempts - 1) throw err;
      await sleep(15 * 2 ** i + Math.random() * 25); // small jittered backoff
    }
  }
}

/** Wrap each named function of a service object so it retries on collisions. */
function retrying(service, names) {
  const out = { ...service };
  for (const name of names) {
    const original = service[name];
    out[name] = (...args) => withRetry(() => original(...args));
  }
  return out;
}

module.exports = { withRetry, retrying, isRetryable };
