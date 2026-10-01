const express = require('express');
const router = express.Router();
const { sendOtp, verifyOtp } = require('../controller/otpController');
const { protect, authorize } = require('../middleware/auth');

// Every route here requires a logged-in student or provider
router.use(protect, authorize('student', 'provider'));

router.post('/send', sendOtp);
router.post('/resend', sendOtp); // same handler — cooldown/hourly cap in otpController enforces the difference
router.post('/verify', verifyOtp);

module.exports = router;