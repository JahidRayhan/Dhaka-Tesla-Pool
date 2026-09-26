const poolService = require('../services/poolService');
const { asyncHandler } = require('../utils/asyncHandler');

const accept = asyncHandler(async (req, res) => {
  const { teslaId, poolId } = req.body;
  const result = await poolService.acceptRequest(req.user.id, req.params.id, { teslaId, poolId });
  res.status(200).json(result);
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

module.exports = { accept, listMine, getById, arrive, start, complete };
