const { pool } = require('../src/config/db');

async function resetTransactionalTables() {
  await pool.query('TRUNCATE payments, status_history, ride_requests, pools RESTART IDENTITY CASCADE');
  await pool.query('UPDATE teslas SET is_active = true');
}

module.exports = { pool, resetTransactionalTables };
