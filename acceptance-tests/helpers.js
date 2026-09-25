require('dotenv').config({ path: process.env.ENV_FILE || '.env.test' });

const path = require('path');
const request = require('supertest');
// Reaches into the backend from a sibling folder deliberately — this suite
// exercises the real app, not a copy of it.
const app = require(path.join(__dirname, '..', 'backend', 'src', 'app'));
const { pool } = require(path.join(__dirname, '..', 'backend', 'src', 'config', 'db'));

async function login(email, password = 'password123') {
  const res = await request(app).post('/api/auth/login').send({ email, password });
  if (res.status !== 200) {
    throw new Error(`login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.token;
}

async function resetTransactionalTables() {
  await pool.query('TRUNCATE payments, status_history, ride_requests, pools RESTART IDENTITY CASCADE');
  await pool.query('UPDATE teslas SET is_active = true');
}

module.exports = { request, app, pool, login, resetTransactionalTables };
