const express = require('express');
const router = express.Router();
const {
  getStudentVerifications,
  reviewStudent,
  getProviderVerifications,
  reviewProvider,
  getPropertyVerifications,
  reviewProperty,
  getInspections,
  getReports,
  updateReportStatus,
} = require('../controller/adminController');
const { protect, authorize } = require('../middleware/auth');

// Every route below requires a logged-in admin
router.use(protect, authorize('admin'));

router.get('/students', getStudentVerifications);
router.put('/students/:id', reviewStudent);

router.get('/providers', getProviderVerifications);
router.put('/providers/:id', reviewProvider);

router.get('/properties', getPropertyVerifications);
router.put('/properties/:id', reviewProperty);

router.get('/inspections', getInspections);

router.get('/reports', getReports);
router.put('/reports/:id', updateReportStatus);

module.exports = router;