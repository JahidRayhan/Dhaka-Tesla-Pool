const express = require('express');
const cors = require('cors');
const compression = require('compression');
const { pool } = require('./config/db');
const { errorHandler } = require('./middleware/errorHandler');
const { buildCorsOptions } = require('./config/cors');
const { requestContext } = require('./middleware/requestContext');

const authRoutes = require('./routes/auth.routes');
const rideRequestRoutes = require('./routes/rideRequest.routes');
const poolRoutes = require('./routes/pool.routes');
const teslaRoutes = require('./routes/tesla.routes');
const zoneRoutes = require('./routes/zone.routes');
const consentRoutes = require('./routes/consent.routes');
const walletRoutes = require('./routes/wallet.routes');
const feature = require('./routes/feature.routes');

const app = express();

// Behind Render/Netlify-style proxies req.ip is the proxy unless this is set;
// the login rate limiter keys on the real client address.
app.set('trust proxy', 1);

app.use(requestContext);
app.use(cors(buildCorsOptions(process.env)));
// Gzip responses: a real saving on the slow mobile connections this is built for.
app.use(compression());
app.use(express.json());

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

// Readiness is stricter than liveness: the process is up AND the schema is
// current, so an orchestrator doesn't route traffic to an instance that started
// before its migration finished.
app.get('/ready', async (req, res) => {
  try {
    await pool.query('SELECT 1 FROM schema_migrations LIMIT 1');
    res.json({ status: 'ready' });
  } catch (err) {
    res.status(503).json({ status: 'not_ready' });
  }
});

// The API lives at /api/v1. The unversioned /api prefix is kept so apps already
// installed on people's phones (which can't be force-updated) keep working; it
// is flagged deprecated, and a future /api/v2 can change behaviour without
// breaking them.
const api = express.Router();
api.use('/auth', authRoutes);
api.use('/ride-requests', rideRequestRoutes);
api.use('/pools', poolRoutes);
api.use('/teslas', teslaRoutes);
api.use('/zones', zoneRoutes);
api.use('/pool-consents', consentRoutes);
api.use('/wallet', walletRoutes);
api.use('/drivers', feature.drivers);
api.use('/users', feature.users);
api.use('/recurring-rides', feature.recurring);
api.use('/notifications', feature.notifications);
api.use('/push-tokens', feature.pushTokens);
api.use('/trips', feature.trips);
api.use('/admin', feature.admin);

app.use('/api/v1', (req, res, next) => { res.set('X-API-Version', '1'); next(); }, api);
app.use('/api', (req, res, next) => { res.set('X-API-Version', '1'); res.set('Deprecation', 'true'); res.set('Link', '</api/v1>; rel="successor-version"'); next(); }, api);

app.use((req, res) => res.status(404).json({ error: 'Not found' }));
app.use(errorHandler);

module.exports = app;
