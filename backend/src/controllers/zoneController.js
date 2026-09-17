const { pool } = require('../config/db');
const { asyncHandler } = require('../utils/asyncHandler');

const listAll = asyncHandler(async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM zones ORDER BY name');
  res.json({ zones: rows });
});

module.exports = { listAll };
