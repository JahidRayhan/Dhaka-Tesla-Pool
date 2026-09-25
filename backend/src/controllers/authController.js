const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../config/db');
const { ApiError } = require('../utils/ApiError');
const { asyncHandler } = require('../utils/asyncHandler');

function issueToken(user) {
  return jwt.sign({ sub: user.id, role: user.role }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });
}

function publicUser(user) {
  const { password_hash, ...rest } = user;
  return rest;
}

const signup = asyncHandler(async (req, res) => {
  const { name, email, phone, password, role } = req.body;
  if (!name || !email || !password) {
    throw new ApiError(422, 'name, email and password are required');
  }
  const validRole = ['passenger', 'driver', 'both'].includes(role) ? role : 'passenger';

  const passwordHash = await bcrypt.hash(password, 10);
  const { rows } = await pool.query(
    `INSERT INTO users (name, email, phone, password_hash, role)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [name, email, phone || null, passwordHash, validRole],
  );
  const user = rows[0];
  await pool.query('INSERT INTO wallets (user_id, balance_paisa) VALUES ($1, 0)', [user.id]);

  res.status(201).json({ user: publicUser(user), token: issueToken(user) });
});

const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
  const user = rows[0];

  // Same generic error whether the email is unknown or the password is
  // wrong — don't leak which one it was.
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    throw new ApiError(401, 'Invalid email or password');
  }

  res.json({ user: publicUser(user), token: issueToken(user) });
});

const me = asyncHandler(async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
  if (rows.length === 0) throw new ApiError(404, 'User not found');
  res.json({ user: publicUser(rows[0]) });
});

module.exports = { signup, login, me };
