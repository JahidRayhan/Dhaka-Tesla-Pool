const { Router } = require('express');
const rideRequestController = require('../controllers/rideRequestController');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = Router();

router.use(requireAuth);

router.post('/', requireRole('passenger'), rideRequestController.create);
router.get('/mine', requireRole('passenger'), rideRequestController.listMine);
router.get('/open', requireRole('driver'), rideRequestController.listOpen);
router.get('/:id', rideRequestController.getById);
router.patch('/:id/cancel', requireRole('passenger'), rideRequestController.cancel);

module.exports = router;
