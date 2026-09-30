const express = require('express');
const router = express.Router();
const { register, login, me, deleteAccount } = require('../controller/authController');
const { sendOtp, verifyOtp } = require('../controller/otpController');
const { protect, authorize } = require('../middleware/auth');

router.post('/register', register);
router.post('/login', login);
router.get('/me', protect, me);
router.delete('/me',protect, deleteAccount)

//Student email OTP
router.post('/otp/send', protect, authorize('student'), sendOtp);
router.post('/otp/resend', protect, authorize('student'), sendOtp); // same handler; cooldown applies
router.post('/otp/verify', protect, authorize('student'), verifyOtp);

module.exports = router;