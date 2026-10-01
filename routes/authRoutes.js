const express = require('express');
const router = express.Router();
const { register, login, me, deleteAccount } = require('../controller/authController');
const { protect } = require('../middleware/auth');

router.post('/register', register);
router.post('/login', login);
router.get('/me', protect, me);
router.delete('/me', protect, deleteAccount);

module.exports = router;