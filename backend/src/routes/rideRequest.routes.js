const { Router } = require('express');
const rideRequestController = require('../controllers/rideRequestController');
const poolController = require('../controllers/poolController');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = Router();

router.use(requireAuth);

router.post('/', requireRole('passenger'), rideRequestController.create);
router.get('/mine', requireRole('passenger'), rideRequestController.listMine);
router.get('/open', requireRole('driver'), rideRequestController.listOpen);
router.get('/:id', rideRequestController.getById);
router.patch('/:id/cancel', requireRole('passenger'), rideRequestController.cancel);
// Driver accepts an open request into a new or existing pool.
router.post('/:id/accept', requireRole('driver'), poolController.accept);
// Passenger responds to being added to an existing pool with someone else already in it.
router.post('/:id/confirm', requireRole('passenger'), poolController.confirm);
router.post('/:id/decline', requireRole('passenger'), poolController.decline);

module.exports = router;
