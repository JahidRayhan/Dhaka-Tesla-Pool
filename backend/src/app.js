const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const { pool } = require('./config/db');
const { errorHandler } = require('./middleware/errorHandler');

const authRoutes = require('./routes/auth.routes');
const rideRequestRoutes = require('./routes/rideRequest.routes');
const poolRoutes = require('./routes/pool.routes');
const teslaRoutes = require('./routes/tesla.routes');
const zoneRoutes = require('./routes/zone.routes');
const consentRoutes = require('./routes/consent.routes');

const app = express();

app.use(cors());
app.use(express.json());
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// Used by docker-compose's healthcheck and by any uptime monitor. Actually
// pings the DB, not just "process is alive" — a DB outage should show as
// unhealthy, not as a false green.
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok' });
  } catch (err) {
    res.status(503).json({ status: 'db_unreachable' });
  }
});

app.use('/api/auth', authRoutes);
app.use('/api/ride-requests', rideRequestRoutes);
app.use('/api/pools', poolRoutes);
app.use('/api/teslas', teslaRoutes);
app.use('/api/zones', zoneRoutes);
app.use('/api/pool-consents', consentRoutes);

app.use((req, res) => res.status(404).json({ error: 'Not found' }));
app.use(errorHandler);

module.exports = app;
