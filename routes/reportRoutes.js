const express = require('express');
const router = express.Router();
const { createReport, getMyReports } = require('../controller/reportController');
const { protect } = require('../middleware/auth');

// No role restriction — both students and providers can file a report
router.post('/', protect, createReport);
router.get('/mine', protect, getMyReports);

module.exports = router;