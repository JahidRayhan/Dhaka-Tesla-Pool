const { Router } = require('express');
const c = require('../controllers/featureControllers');
const { requireAuth, requireRole, requireAdmin } = require('../middleware/auth');

/** Routers for the newer areas, each mounted by app.js under its own prefix. */
const drivers = Router();
drivers.use(requireAuth, requireRole('driver'));
drivers.get('/me/profile', c.getDriverProfile);
drivers.put('/me/profile', c.putDriverProfile);
drivers.get('/me/earnings', c.earnings);

const users = Router();
users.get('/:id/rating', requireAuth, c.ratingSummary);

const recurring = Router();
recurring.use(requireAuth, requireRole('passenger'));
recurring.post('/', c.createRecurring);
recurring.get('/', c.listRecurring);
recurring.patch('/:id', c.setRecurringActive);
recurring.delete('/:id', c.removeRecurring);

const notifications = Router();
notifications.use(requireAuth);
notifications.get('/', c.listNotifications);
notifications.post('/read', c.markNotificationsRead);

const pushTokens = Router();
pushTokens.use(requireAuth);
pushTokens.post('/', c.registerPushToken);
pushTokens.delete('/', c.removePushToken);

// Public, no account needed: follow a trip a passenger chose to share.
const trips = Router();
trips.get('/:token', c.publicTrip);

const admin = Router();
admin.use(requireAuth, requireAdmin);
admin.get('/stats', c.adminStats);
admin.get('/rides', c.adminRides);
admin.get('/rides/:id', c.adminRide);
admin.get('/reconcile', c.adminReconcile);
admin.get('/drivers', c.adminDrivers);
admin.post('/drivers/:userId/verify', c.adminReview('VERIFIED'));
admin.post('/drivers/:userId/reject', c.adminReview('REJECTED'));

module.exports = { drivers, users, recurring, notifications, pushTokens, trips, admin };
