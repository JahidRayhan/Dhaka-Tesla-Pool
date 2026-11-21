#!/usr/bin/env node
// Prints any disagreement between wallet balances and the ledger; exit code 1 if
// the books do not balance (usable from cron / CI).   node scripts/reconcile.js
require('dotenv').config();
const walletService = require('../src/services/walletService');
const { pool } = require('../src/config/db');

walletService
  .reconcile()
  .then(async (result) => {
    console.log(JSON.stringify(result, null, 2));
    await pool.end();
    process.exit(result.ok ? 0 : 1);
  })
  .catch((err) => {
    console.error(err.message);
    process.exit(2);
  });
