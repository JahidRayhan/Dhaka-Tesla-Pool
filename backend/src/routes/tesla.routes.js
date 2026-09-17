const { Router } = require('express');
const teslaController = require('../controllers/teslaController');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = Router();

router.use(requireAuth, requireRole('driver'));

router.post('/', teslaController.create);
router.get('/mine', teslaController.listMine);
router.patch('/:id/active', teslaController.setActive);

module.exports = router;
