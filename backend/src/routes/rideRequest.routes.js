const { Router } = require('express');
const featureControllers = require('../controllers/featureControllers');
const rideRequestController = require('../controllers/rideRequestController');
const poolController = require('../controllers/poolController');
const { requireAuth, requireRole } = require('../middleware/auth');
const { idempotent } = require('../middleware/idempotency');

const router = Router();

router.use(requireAuth);

router.post('/', requireRole('passenger'), idempotent(), rideRequestController.create);
router.get('/mine', requireRole('passenger'), rideRequestController.listMine);
router.get('/open', requireRole('driver'), rideRequestController.listOpen);
router.get('/:id/receipt', featureControllers.receipt);
router.post('/:id/rating', featureControllers.rate);
router.post('/:id/share', requireRole('passenger'), featureControllers.createShare);
router.delete('/:id/share', requireRole('passenger'), featureControllers.revokeShare);
router.get('/:id', rideRequestController.getById);
router.patch('/:id/cancel', requireRole('passenger'), rideRequestController.cancel);
// Driver accepts an open request into a new or existing pool.
router.post('/:id/accept', requireRole('driver'), idempotent(), poolController.accept);
// Passenger responds to being added to an existing pool with someone else already in it.
router.post('/:id/confirm', requireRole('passenger'), poolController.confirm);
router.post('/:id/decline', requireRole('passenger'), poolController.decline);

module.exports = router;
