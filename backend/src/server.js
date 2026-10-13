require('dotenv').config();
const { assertEnv } = require('./config/validateEnv');

assertEnv(); // exit before binding a port if the config is unusable

const app = require('./app');

const port = process.env.PORT || 4000;

app.listen(port, () => {
  console.log(`Dhaka Tesla Pool API listening on :${port}`);
});

// Tidy up expired sharing proposals even when nobody is polling. Correctness
// does not depend on this — every read/write path expires stale proposals
// itself — so a missed tick (or a sleeping free-tier instance) is harmless.
const { expireStaleProposals } = require('./services/consentService');
const { CONSENT_SWEEP_INTERVAL_MS } = require('./config/timeouts');

setInterval(() => {
  expireStaleProposals().catch((err) => console.error('Consent expiry sweep failed:', err));
}, CONSENT_SWEEP_INTERVAL_MS).unref();
