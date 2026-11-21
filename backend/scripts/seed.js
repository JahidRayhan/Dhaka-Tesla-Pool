#!/usr/bin/env node
/**
 *   node scripts/seed.js reference   zones + road graph (every environment, idempotent)
 *   node scripts/seed.js demo        fake users with a PUBLIC password (never in production)
 *   node scripts/seed.js all         both
 */
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const SEEDS = path.join(__dirname, '..', 'db', 'seeds');

async function seed(which, { databaseUrl = process.env.DATABASE_URL, env = process.env, log = console.log } = {}) {
  const wanted = which === 'all' ? ['reference', 'demo'] : [which];
  if (wanted.some((w) => !['reference', 'demo'].includes(w))) throw new Error(`Unknown seed "${which}" (use reference, demo or all)`);
  if (wanted.includes('demo') && env.NODE_ENV === 'production' && env.ALLOW_DEMO_SEED !== 'true') {
    throw new Error('Refusing to load DEMO data in production: it creates accounts with a publicly known password. Set ALLOW_DEMO_SEED=true only for a throwaway demo.');
  }
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    for (const name of wanted) {
      await client.query(fs.readFileSync(path.join(SEEDS, `${name}.sql`), 'utf8'));
      log(`seeded ${name}`);
    }
  } finally {
    await client.end();
  }
}

module.exports = { seed };

if (require.main === module) {
  require('dotenv').config();
  seed(process.argv[2] || 'reference')
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err.message);
      process.exit(1);
    });
}
