const { pool } = require('../config/db');
const { ApiError } = require('../utils/ApiError');
const { asyncHandler } = require('../utils/asyncHandler');

const create = asyncHandler(async (req, res) => {
  const { name, capacity } = req.body;
  if (!name || !Number.isInteger(capacity) || capacity < 1 || capacity > 6) {
    throw new ApiError(422, 'name and capacity (1-6) are required');
  }
  const { rows } = await pool.query(
    `INSERT INTO teslas (driver_id, name, capacity) VALUES ($1, $2, $3) RETURNING *`,
    [req.user.id, name, capacity],
  );
  res.status(201).json({ tesla: rows[0] });
});

const listMine = asyncHandler(async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM teslas WHERE driver_id = $1 ORDER BY created_at', [
    req.user.id,
  ]);
  res.json({ teslas: rows });
});

const setActive = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { isActive } = req.body;
  const { rows } = await pool.query(
    `UPDATE teslas SET is_active = $2 WHERE id = $1 AND driver_id = $3 RETURNING *`,
    [id, !!isActive, req.user.id],
  );
  if (rows.length === 0) throw new ApiError(404, 'Tesla not found');
  res.json({ tesla: rows[0] });
});

module.exports = { create, listMine, setActive };
