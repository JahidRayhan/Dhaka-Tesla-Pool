const { Router } = require('express');
const featureControllers = require('../controllers/featureControllers');
const authController = require('../controllers/authController');
const { requireAuth } = require('../middleware/auth');
const { loginRateLimit } = require('../middleware/loginRateLimit');

const router = Router();

router.post('/signup', authController.signup);
router.post('/login', loginRateLimit, authController.login);
router.get('/me', requireAuth, authController.me);

router.patch('/profile', requireAuth, featureControllers.updateProfile);
router.post('/refresh', authController.refresh);
router.post('/logout', authController.logout);
router.post('/logout-all', requireAuth, authController.logoutAll);

router.post('/phone/request-otp', requireAuth, authController.requestPhoneOtp);
router.post('/phone/verify-otp', requireAuth, authController.verifyPhoneOtp);
router.post('/forgot-password', authController.forgotPassword);
router.post('/reset-password', authController.resetPassword);

module.exports = router;
