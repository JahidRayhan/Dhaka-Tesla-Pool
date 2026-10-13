const { pool } = require('../src/config/db');

async function resetTransactionalTables() {
  await pool.query('TRUNCATE payments, wallet_transactions, status_history, ride_requests, pools RESTART IDENTITY CASCADE');
  // Back to the seeded ৳1000 demo balance so wallet tests don't leak into each other.
  await pool.query('UPDATE wallets SET balance_paisa = 100000');
  await pool.query('UPDATE teslas SET is_active = true');
}

module.exports = { pool, resetTransactionalTables };
