const express = require('express');
const router = express.Router();
const {
  createReview,
  getPropertyReviews,
  getMyReviews,
  updateReview,
  deleteReview,
} = require('../controller/reviewController');
const { protect, authorize } = require('../middleware/auth');

router.post('/', protect, authorize('student'), createReview);
router.get('/mine', protect, authorize('student'), getMyReviews);
router.get('/property/:propertyId', getPropertyReviews); // public
router.put('/:id', protect, authorize('student'), updateReview);
router.delete('/:id', protect, authorize('student'), deleteReview);

module.exports = router;