const { Router } = require('express');
const poolController = require('../controllers/poolController');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = Router();

router.use(requireAuth, requireRole('driver'));

router.get('/mine', poolController.listMine);
router.get('/:id', poolController.getById);
router.patch('/:id/arrive', poolController.arrive);
router.patch('/:id/start', poolController.start);
router.patch('/:id/complete', poolController.complete);

module.exports = router;
