const poolService = require('../services/poolService');
const consentService = require('../services/consentService');
const { asyncHandler } = require('../utils/asyncHandler');

const accept = asyncHandler(async (req, res) => {
  const { teslaId, poolId } = req.body;
  const result = await poolService.acceptRequest(req.user.id, req.params.id, { teslaId, poolId });
  res.status(200).json(result);
});

const confirm = asyncHandler(async (req, res) => {
  await poolService.confirmJoin(req.user.id, req.params.id);
  res.status(204).send();
});

const decline = asyncHandler(async (req, res) => {
  await poolService.declineJoin(req.user.id, req.params.id, req.body.reason);
  res.status(204).send();
});

const approveConsent = asyncHandler(async (req, res) => {
  await consentService.respond(req.user.id, req.params.id, 'ACCEPTED');
  res.status(204).send();
});

const rejectConsent = asyncHandler(async (req, res) => {
  await consentService.respond(req.user.id, req.params.id, 'DECLINED', req.body.reason);
  res.status(204).send();
});

const listMine = asyncHandler(async (req, res) => {
  const pools = await poolService.listMineForDriver(req.user.id);
  res.json({ pools });
});

const getById = asyncHandler(async (req, res) => {
  const poolDetail = await poolService.getPoolDetail(req.user.id, req.params.id);
  res.json({ pool: poolDetail });
});

const arrive = asyncHandler(async (req, res) => {
  await poolService.markArrived(req.user.id, req.params.id);
  res.status(204).send();
});

const start = asyncHandler(async (req, res) => {
  await poolService.startTrip(req.user.id, req.params.id);
  res.status(204).send();
});

const complete = asyncHandler(async (req, res) => {
  await poolService.completeTrip(req.user.id, req.params.id);
  res.status(204).send();
});

module.exports = { accept, confirm, decline, approveConsent, rejectConsent, listMine, getById, arrive, start, complete };
