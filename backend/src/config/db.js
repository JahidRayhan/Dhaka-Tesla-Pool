const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

pool.on('error', (err) => {
  // A crashed idle client shouldn't crash the whole process.
  console.error('Unexpected error on idle PG client', err);
});

module.exports = { pool };
