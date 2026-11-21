const { pool } = require('../src/config/db');

async function resetTransactionalTables() {
  await pool.query('TRUNCATE payments, wallet_transactions, status_history, ride_requests, pools RESTART IDENTITY CASCADE');
  // Every wallet back to its own opening balance (the ledger was just emptied),
  // so wallet tests don't leak into each other and reconciliation stays valid.
  await pool.query('UPDATE wallets SET balance_paisa = ledger_baseline_paisa');
  await pool.query('UPDATE teslas SET is_active = true');
}

module.exports = { pool, resetTransactionalTables };
