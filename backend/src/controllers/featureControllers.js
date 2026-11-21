const { asyncHandler } = require('../utils/asyncHandler');
const { ApiError } = require('../utils/ApiError');
const tripService = require('../services/tripService');
const ratingService = require('../services/ratingService');
const driverService = require('../services/driverService');
const shareService = require('../services/shareService');
const recurringService = require('../services/recurringService');
const adminService = require('../services/adminService');
const notificationService = require('../services/notificationService');
const { pool } = require('../config/db');

const page = (req) => {
  const num = (raw, name, min, max, fallback) => {
    if (raw === undefined) return fallback;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < min || n > max) throw new ApiError(422, `${name} must be an integer between ${min} and ${max}`);
    return n;
  };
  return { limit: num(req.query.limit, 'limit', 1, 100, 50), offset: num(req.query.offset, 'offset', 0, 1_000_000, 0) };
};

// ---- trips ----
const updateLocation = asyncHandler(async (req, res) => {
  await tripService.updateLocation(req.user.id, req.params.id, req.body?.latitude, req.body?.longitude);
  res.status(204).send();
});
const noShow = asyncHandler(async (req, res) => {
  res.json(await tripService.markNoShow(req.user.id, req.params.id, req.body?.requestId));
});
const receipt = asyncHandler(async (req, res) => res.json(await tripService.receipt(req.params.id, req.user)));
const earnings = asyncHandler(async (req, res) => res.json(await tripService.driverEarnings(req.user.id, { from: req.query.from, to: req.query.to })));

// ---- ratings ----
const rate = asyncHandler(async (req, res) => {
  await ratingService.rate(req.user, req.params.id, req.body?.stars, req.body?.comment);
  res.status(201).json({ ok: true });
});
const ratingSummary = asyncHandler(async (req, res) => res.json({ rating: await ratingService.summary(req.params.id) }));

// ---- share my trip ----
const createShare = asyncHandler(async (req, res) => res.status(201).json(await shareService.create(req.user, req.params.id)));
const revokeShare = asyncHandler(async (req, res) => {
  await shareService.revoke(req.user, req.params.id);
  res.status(204).send();
});
const publicTrip = asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(await shareService.publicView(req.params.token));
});

// ---- driver profile ----
const getDriverProfile = asyncHandler(async (req, res) => res.json({ profile: await driverService.getProfile(req.user.id) }));
const putDriverProfile = asyncHandler(async (req, res) => res.json({ profile: await driverService.submitProfile(req.user.id, req.body || {}) }));

// ---- recurring rides ----
const createRecurring = asyncHandler(async (req, res) => res.status(201).json({ recurringRide: await recurringService.create(req.user.id, req.body || {}) }));
const listRecurring = asyncHandler(async (req, res) => res.json({ recurringRides: await recurringService.list(req.user.id) }));
const setRecurringActive = asyncHandler(async (req, res) => {
  if (typeof req.body?.active !== 'boolean') throw new ApiError(422, 'active must be true or false');
  await recurringService.setActive(req.user.id, req.params.id, req.body.active);
  res.status(204).send();
});
const removeRecurring = asyncHandler(async (req, res) => {
  await recurringService.remove(req.user.id, req.params.id);
  res.status(204).send();
});

// ---- notifications ----
const listNotifications = asyncHandler(async (req, res) => {
  const { limit } = page(req);
  res.json(await notificationService.list(req.user.id, { limit, unreadOnly: req.query.unread === 'true' }));
});
const markNotificationsRead = asyncHandler(async (req, res) => {
  const ids = req.body?.ids;
  if (ids !== 'all' && !(Array.isArray(ids) && ids.length > 0 && ids.length <= 100 && ids.every((i) => typeof i === 'string'))) {
    throw new ApiError(422, 'ids must be "all" or a list of up to 100 notification ids');
  }
  await notificationService.markRead(req.user.id, ids);
  res.status(204).send();
});
const registerPushToken = asyncHandler(async (req, res) => {
  const { token, platform } = req.body || {};
  if (typeof token !== 'string' || token.length < 10 || token.length > 300) throw new ApiError(422, 'token is required');
  if (!['android', 'ios', 'web'].includes(platform)) throw new ApiError(422, 'platform must be android, ios or web');
  await notificationService.registerPushToken(req.user.id, token, platform);
  res.status(204).send();
});
const removePushToken = asyncHandler(async (req, res) => {
  if (typeof req.body?.token !== 'string') throw new ApiError(422, 'token is required');
  await notificationService.removePushToken(req.user.id, req.body.token);
  res.status(204).send();
});

// ---- profile ----
const updateProfile = asyncHandler(async (req, res) => {
  const { name, gender, locale } = req.body || {};
  if (name !== undefined && (typeof name !== 'string' || !name.trim() || name.length > 100)) throw new ApiError(422, 'name must be 1-100 characters');
  if (gender !== undefined && gender !== null && !['female', 'male', 'other'].includes(gender)) throw new ApiError(422, 'gender must be female, male or other');
  if (locale !== undefined && !['en', 'bn'].includes(locale)) throw new ApiError(422, 'locale must be en or bn');
  const { rows } = await pool.query(
    `UPDATE users SET name = COALESCE($2, name), gender = CASE WHEN $3::boolean THEN $4 ELSE gender END, locale = COALESCE($5, locale)
     WHERE id = $1 RETURNING id, name, email, phone, role, gender, locale, phone_verified_at`,
    [req.user.id, name?.trim() ?? null, gender !== undefined, gender ?? null, locale ?? null],
  );
  res.json({ user: rows[0] });
});

const meetingPoints = asyncHandler(async (req, res) => {
  const { rows } = await pool.query('SELECT id, name, latitude, longitude FROM meeting_points WHERE zone_id = $1 ORDER BY name', [Number(req.params.id) || 0]);
  res.json({ meetingPoints: rows });
});

// ---- admin ----
const adminStats = asyncHandler(async (req, res) => res.json(await adminService.stats()));
const adminRides = asyncHandler(async (req, res) => res.json({ rides: await adminService.listRides({ status: req.query.status, ...page(req) }) }));
const adminRide = asyncHandler(async (req, res) => res.json(await adminService.rideDetail(req.params.id)));
const adminReconcile = asyncHandler(async (req, res) => res.json(await adminService.reconcile()));
const adminDrivers = asyncHandler(async (req, res) => res.json({ drivers: await driverService.listForReview(req.query.status) }));
const adminReview = (decision) =>
  asyncHandler(async (req, res) => {
    await driverService.review(req.user.id, req.params.userId, decision, req.body?.note);
    res.status(204).send();
  });

module.exports = {
  updateLocation, noShow, receipt, earnings, rate, ratingSummary, createShare, revokeShare, publicTrip,
  getDriverProfile, putDriverProfile, createRecurring, listRecurring, setRecurringActive, removeRecurring,
  listNotifications, markNotificationsRead, registerPushToken, removePushToken, updateProfile, meetingPoints,
  adminStats, adminRides, adminRide, adminReconcile, adminDrivers, adminReview,
};
