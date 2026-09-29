const { Router } = require('express');
const poolController = require('../controllers/poolController');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = Router();

router.use(requireAuth, requireRole('passenger'));

// A passenger already in a pool answering "are you OK sharing with this
// newcomer?" — the joiner's own answer goes through /ride-requests/:id/confirm
// and /decline instead, but resolves through the same consent logic.
router.post('/:id/approve', poolController.approveConsent);
router.post('/:id/reject', poolController.rejectConsent);

module.exports = router;
