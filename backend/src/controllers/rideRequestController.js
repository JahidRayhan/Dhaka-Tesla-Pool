const { ApiError } = require('../utils/ApiError');
const rideRequestService = require('../services/rideRequestService');
const fitService = require('../services/fitService');
const { asyncHandler } = require('../utils/asyncHandler');

const create = asyncHandler(async (req, res) => {
  const { pickupZoneId, destinationZoneId, seatsRequested, paymentMethod, shareMax, womenOnly, pickupPointId, scheduledFor, maxWaitMinutes } = req.body;
  const rideRequest = await rideRequestService.createRequest(req.user.id, {
    pickupZoneId,
    destinationZoneId,
    seatsRequested,
    paymentMethod,
    ...(shareMax !== undefined && { shareMax }),
    ...(womenOnly !== undefined && { womenOnly }),
    ...(pickupPointId !== undefined && { pickupPointId }),
    ...(scheduledFor !== undefined && { scheduledFor }),
    ...(maxWaitMinutes !== undefined && { maxWaitMinutes }),
  });
  res.status(201).json({ rideRequest });
});

const listMine = asyncHandler(async (req, res) => {
  const rideRequests = await rideRequestService.listMine(req.user.id);
  res.json({ rideRequests });
});

// Optional ?limit= (1-100, default 50) and ?offset= (>= 0, default 0).
// Oldest-first, so paging forward walks the queue in the order drivers
// should see it.
function parsePageParam(raw, { name, min, max, fallback }) {
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new ApiError(422, `${name} must be an integer between ${min} and ${max}`);
  }
  return n;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const listOpen = asyncHandler(async (req, res) => {
  const limit = parsePageParam(req.query.limit, { name: 'limit', min: 1, max: 100, fallback: 50 });
  const offset = parsePageParam(req.query.offset, { name: 'offset', min: 0, max: 1_000_000, fallback: 0 });
  let rideRequests = await rideRequestService.listOpen({ limit, offset });
  // ?poolId=<your live pool> marks which requests could join it, and why not, best first.
  if (req.query.poolId !== undefined) {
    if (typeof req.query.poolId !== 'string' || !UUID.test(req.query.poolId)) throw new ApiError(422, 'poolId must be a pool id');
    rideRequests = await fitService.annotateFit(req.user.id, req.query.poolId, rideRequests);
  }
  res.json({ rideRequests, limit, offset });
});

const getById = asyncHandler(async (req, res) => {
  const rideRequest = await rideRequestService.getByIdForUser(req.params.id, req.user);
  res.json({ rideRequest });
});

const cancel = asyncHandler(async (req, res) => {
  await rideRequestService.cancel(req.user.id, req.params.id, req.body.reason);
  res.status(204).send();
});

module.exports = { create, listMine, listOpen, getById, cancel };
