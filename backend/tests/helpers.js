require('dotenv').config({ path: process.env.ENV_FILE || '.env.test' });

const request = require('supertest');
const app = require('../src/app');

async function login(email, password = 'password123') {
  const res = await request(app).post('/api/auth/login').send({ email, password });
  if (res.status !== 200) {
    throw new Error(`login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.token;
}

module.exports = { request, app, login };
