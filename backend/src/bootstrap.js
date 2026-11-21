const { migrate } = require('../scripts/migrate');
const { seed } = require('../scripts/seed');

/**
 * Runs before the server accepts traffic. Everything is opt-in by environment
 * variable so a plain `node src/server.js` against a prepared database behaves
 * exactly as before.
 *
 *   RUN_MIGRATIONS=true   apply pending migrations (safe: advisory-locked, transactional)
 *   SEED_REFERENCE=true   zones + road graph (idempotent, safe in production)
 *   SEED_DEMO=true        fake users with a PUBLIC password — refused in production
 */
async function bootstrap(env = process.env, log = console.log) {
  if (env.RUN_MIGRATIONS === 'true') await migrate({ log });
  if (env.SEED_REFERENCE === 'true') await seed('reference', { env, log });
  if (env.SEED_DEMO === 'true') await seed('demo', { env, log });
}

module.exports = { bootstrap };
