const { Router } = require('express');
const walletController = require('../controllers/walletController');
const { requireAuth } = require('../middleware/auth');
const { idempotent } = require('../middleware/idempotency');

const router = Router();

router.use(requireAuth);
router.get('/', walletController.get);
router.post('/topup', idempotent(), walletController.topUp);

module.exports = router;
