#!/usr/bin/env node
/**
 * Creates (or promotes) an operator account for the admin console.
 *
 *   ADMIN_PASSWORD='a-long-passphrase' node scripts/create-admin.js you@example.com "Your Name"
 *
 * - If ADMIN_PASSWORD is not set, a random one is generated and printed ONCE.
 * - If the email already exists, that account is promoted and its password is
 *   left alone unless ADMIN_PASSWORD is given.
 * - The demo admin only exists in demo seeds; a real deployment uses this script.
 */
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { Client } = require('pg');

async function createAdmin({ databaseUrl = process.env.DATABASE_URL, email, name, password }) {
  const cleanEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) throw new Error('A valid email address is required');
  if (password !== undefined && (typeof password !== 'string' || password.length < 12 || Buffer.byteLength(password) > 72)) {
    throw new Error('ADMIN_PASSWORD must be 12-72 characters (an operator account deserves a long one)');
  }
  const generated = password === undefined;
  const finalPassword = password ?? crypto.randomBytes(18).toString('base64url');
  const hash = await bcrypt.hash(finalPassword, 12);

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query('BEGIN');
    const { rows: existing } = await client.query('SELECT id FROM users WHERE email = $1', [cleanEmail]);
    let id;
    if (existing.length > 0) {
      id = existing[0].id;
      await client.query(`UPDATE users SET role = 'admin'${generated ? '' : ', password_hash = $2'} WHERE id = $1`, generated ? [id] : [id, hash]);
    } else {
      const { rows } = await client.query(
        `INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, 'admin') RETURNING id`,
        [(name || 'Administrator').trim(), cleanEmail, hash],
      );
      id = rows[0].id;
      await client.query('INSERT INTO wallets (user_id, balance_paisa, ledger_baseline_paisa) VALUES ($1, 0, 0)', [id]);
    }
    await client.query('COMMIT');
    return { id, email: cleanEmail, promoted: existing.length > 0, password: existing.length > 0 && generated ? null : finalPassword, generated };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    await client.end();
  }
}

module.exports = { createAdmin };

if (require.main === module) {
  require('dotenv').config();
  const [email, name] = process.argv.slice(2);
  createAdmin({ email, name, password: process.env.ADMIN_PASSWORD })
    .then((r) => {
      console.log(r.promoted ? `Promoted ${r.email} to admin.` : `Created admin ${r.email}.`);
      if (r.password && r.generated) console.log(`Password (shown once — store it now): ${r.password}`);
      process.exit(0);
    })
    .catch((err) => {
      console.error(err.message);
      process.exit(1);
    });
}
