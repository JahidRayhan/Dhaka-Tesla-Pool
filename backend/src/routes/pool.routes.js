const { Router } = require('express');
const featureControllers = require('../controllers/featureControllers');
const poolController = require('../controllers/poolController');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = Router();

router.use(requireAuth, requireRole('driver'));

router.get('/mine', poolController.listMine);
router.get('/:id', poolController.getById);
router.patch('/:id/arrive', poolController.arrive);
router.patch('/:id/start', poolController.start);
router.patch('/:id/complete', poolController.complete);
router.patch('/:id/cancel', poolController.cancel);
router.post('/:id/location', featureControllers.updateLocation);
router.post('/:id/no-show', featureControllers.noShow);

module.exports = router;
