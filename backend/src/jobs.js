/**
 * Periodic background work. Every job is idempotent and safe to run on several
 * instances at once (each takes row locks or is a pure cleanup), and none is
 * required for correctness — request paths do the same work lazily — so a
 * missed tick, a restart, or a sleeping free-tier instance is harmless.
 */
const { pool } = require('./config/db');
const logger = require('./utils/logger');
const { CONSENT_SWEEP_INTERVAL_MS } = require('./config/timeouts');
const consentService = require('./services/consentService');
const walletService = require('./services/walletService');
const rideRequestService = require('./services/rideRequestService');
const recurringService = require('./services/recurringService');

const IDEMPOTENCY_TTL_HOURS = 24;
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

async function guarded(name, fn) {
  try {
    await fn();
  } catch (err) {
    logger.error(`job failed: ${name}`, { err });
  }
}

const jobs = [
  { name: 'expire-consent-proposals', everyMs: CONSENT_SWEEP_INTERVAL_MS, run: () => consentService.expireStaleProposals() },
  { name: 'book-recurring-rides', everyMs: MINUTE, run: () => recurringService.generateDue() },
  { name: 'expire-unmatched-requests', everyMs: MINUTE, run: () => rideRequestService.expireUnmatchedRequests() },
  {
    name: 'purge-idempotency-keys',
    everyMs: HOUR,
    run: () => pool.query(`DELETE FROM idempotency_keys WHERE created_at < now() - make_interval(hours => $1)`, [IDEMPOTENCY_TTL_HOURS]),
  },
  { name: 'purge-rate-limits', everyMs: HOUR, run: () => pool.query('DELETE FROM rate_limits WHERE reset_at < now()') },
  {
    name: 'purge-expired-auth',
    everyMs: 6 * HOUR,
    run: async () => {
      await pool.query(`DELETE FROM otp_codes WHERE created_at < now() - interval '1 day'`);
      await pool.query(`DELETE FROM refresh_tokens WHERE expires_at < now() - interval '7 days'`);
    },
  },
  {
    name: 'reconcile-wallets',
    everyMs: 24 * HOUR,
    run: async () => {
      const result = await walletService.reconcile();
      if (!result.ok) logger.error('WALLET RECONCILIATION FAILED — books do not balance', result);
      else logger.info('wallet reconciliation ok');
    },
  },
];

function startJobs() {
  const timers = jobs.map((job) => {
    const timer = setInterval(() => guarded(job.name, job.run), job.everyMs);
    timer.unref();
    return timer;
  });
  return () => timers.forEach(clearInterval);
}

module.exports = { startJobs, jobs };
