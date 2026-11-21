/**
 * Fixed (not configurable) timeouts. They are plain constants on purpose: a
 * rule the product promises to users ("you have 5 minutes to answer") should
 * not drift per environment.
 */

// How long a pool-join proposal stays open before it counts as a "no".
const CONSENT_TIMEOUT_MINUTES = 5;

// How often the background sweep looks for expired proposals. Correctness does
// not depend on it — every read and write path also expires stale proposals on
// the spot — it just tidies up when nobody is looking (and Render's free tier
// may be asleep, which is another reason the lazy path exists).
const CONSENT_SWEEP_INTERVAL_MS = 30 * 1000;

module.exports = { CONSENT_TIMEOUT_MINUTES, CONSENT_SWEEP_INTERVAL_MS };
