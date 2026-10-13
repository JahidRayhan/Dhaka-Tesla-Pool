const { Router } = require('express');
const authController = require('../controllers/authController');
const { requireAuth } = require('../middleware/auth');
const { loginRateLimit } = require('../middleware/loginRateLimit');

const router = Router();

router.post('/signup', authController.signup);
router.post('/login', loginRateLimit, authController.login);
router.get('/me', requireAuth, authController.me);

module.exports = router;
