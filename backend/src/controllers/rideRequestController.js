const rideRequestService = require('../services/rideRequestService');
const { asyncHandler } = require('../utils/asyncHandler');

const create = asyncHandler(async (req, res) => {
  const { pickupZoneId, destinationZoneId, seatsRequested } = req.body;
  const rideRequest = await rideRequestService.createRequest(req.user.id, {
    pickupZoneId,
    destinationZoneId,
    seatsRequested,
  });
  res.status(201).json({ rideRequest });
});

const listMine = asyncHandler(async (req, res) => {
  const rideRequests = await rideRequestService.listMine(req.user.id);
  res.json({ rideRequests });
});

const listOpen = asyncHandler(async (req, res) => {
  const rideRequests = await rideRequestService.listOpen();
  res.json({ rideRequests });
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
