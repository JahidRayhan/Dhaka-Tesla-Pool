/**
 * Behaviour switches that depend on the environment, in one place so the rules
 * are easy to find (and to test) instead of scattered `process.env` reads.
 */

// The wallet top-up is a SIMULATION: it hands out free money. It is on by
// default everywhere except production, where it must be switched on
// explicitly (and only for a throwaway demo).
function simulatedPaymentsEnabled(env = process.env) {
  return env.NODE_ENV !== 'production' || env.SIMULATED_PAYMENTS === 'true';
}

// When on, a driver can only go online after an admin has verified their
// licence and vehicle plate. Off by default so a fresh install / demo still works;
// turn it on for any real launch.
function requireVerifiedDrivers(env = process.env) {
  return env.REQUIRE_VERIFIED_DRIVERS === 'true';
}

module.exports = { simulatedPaymentsEnabled, requireVerifiedDrivers };
