#!/usr/bin/env node
/**
 * Run once on any real environment that was ever seeded with the demo data:
 * locks the publicly-known demo accounts (random unusable password + wallet
 * zeroed). Does not delete them, so existing rides and the audit trail keep
 * their references.   node scripts/disable-demo-accounts.js
 */
require('dotenv').config();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { Client } = require('pg');

const DEMO_EMAILS = ['jashim', 'nusrat', 'rafiq', 'shirin', 'admin'].map((n) => `${n}@dhakateslapool.test`);

(async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const hash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10);
    await client.query('BEGIN');
    const users = await client.query('UPDATE users SET password_hash = $1 WHERE email = ANY($2) RETURNING id', [hash, DEMO_EMAILS]);
    const ids = users.rows.map((u) => u.id);
    await client.query(`UPDATE wallets SET ledger_baseline_paisa = ledger_baseline_paisa - balance_paisa, balance_paisa = 0 WHERE user_id = ANY($1::uuid[])`, [ids]);
    await client.query(`UPDATE teslas SET is_active = false WHERE driver_id = ANY($1::uuid[])`, [ids]);
    await client.query(`UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = ANY($1::uuid[]) AND revoked_at IS NULL`, [ids]);
    await client.query('COMMIT');
    console.log(`Locked ${users.rowCount} demo account(s).`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
})();
