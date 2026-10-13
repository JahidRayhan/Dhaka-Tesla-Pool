const { Router } = require('express');
const walletController = require('../controllers/walletController');
const { requireAuth } = require('../middleware/auth');

const router = Router();

router.use(requireAuth);
router.get('/', walletController.get);
router.post('/topup', walletController.topUp);

module.exports = router;
