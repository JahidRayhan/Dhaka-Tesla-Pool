const walletService = require('../services/walletService');
const { asyncHandler } = require('../utils/asyncHandler');

const get = asyncHandler(async (req, res) => {
  res.json(await walletService.getWallet(req.user.id));
});

const topUp = asyncHandler(async (req, res) => {
  res.status(201).json(await walletService.topUp(req.user.id, req.body.amountPaisa));
});

module.exports = { get, topUp };
