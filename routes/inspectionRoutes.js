const express = require('express');
const router = express.Router();
const {
  requestInspection,
  getMyInspections,
  getReceivedInspections,
  getInspectionById,
  scheduleInspection,
  declineInspection,
  rescheduleInspection,
  missedInspection,
  completeInspection,
  decideInspection,
  cancelInspection,
} = require('../controller/inspectionController');
const { protect, authorize } = require('../middleware/auth');

// /mine and /received must come before /:id or Express reads them as an id
router.post('/', protect, authorize('student'), requestInspection);
router.get('/mine', protect, authorize('student'), getMyInspections);
router.get('/received', protect, authorize('provider'), getReceivedInspections);
router.get('/:id', protect, getInspectionById);
router.put('/:id/schedule', protect, authorize('provider'), scheduleInspection);
router.put('/:id/decline', protect, authorize('provider'), declineInspection);
router.put('/:id/reschedule', protect, authorize('provider'), rescheduleInspection);
router.put('/:id/missed', protect, authorize('provider'), missedInspection);
router.put('/:id/complete', protect, authorize('provider'), completeInspection);
router.put('/:id/decision', protect, authorize('student'), decideInspection);
router.delete('/:id', protect, authorize('student'), cancelInspection);

module.exports = router;