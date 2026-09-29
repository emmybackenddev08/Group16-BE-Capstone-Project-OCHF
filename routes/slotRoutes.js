const express = require('express');
const router = express.Router();
const {
  createSlots,
  getMySlots,
  getPropertySlots,
  deleteSlot,
} = require('../controller/slotController');
const { protect, authorize, requireVerifiedStudent } = require('../middleware/auth');

// /mine and /property/:propertyId must come before /:id
router.post('/', protect, authorize('provider'), createSlots);
router.get('/mine', protect, authorize('provider'), getMySlots);
router.get('/property/:propertyId', protect, authorize('student'), requireVerifiedStudent, getPropertySlots);
router.delete('/:id', protect, authorize('provider'), deleteSlot);

module.exports = router;