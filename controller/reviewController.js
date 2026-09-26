const { Review, Inspection, StudentProfile } = require('../model/collectionsModel');

async function getStudentProfile(userId) {
  return StudentProfile.findOne({ userId });
}

// POST /reviews  (student only)  body: { propertyId, rating, comment }
// Only a student with an ACCEPTED inspection on this property can review it —
// prevents reviews from anyone who never actually proceeded with the listing.
async function createReview(req, res) {
  try {
    const student = await getStudentProfile(req.user._id);
    if (!student) return res.status(404).json({ message: 'Student profile not found' });

    const { propertyId, rating, comment } = req.body;
    if (!propertyId || rating == null) {
      return res.status(400).json({ message: 'propertyId and rating are required' });
    }
    if (rating < 1 || rating > 5) {
      return res.status(400).json({ message: 'rating must be between 1 and 5' });
    }

    const hasAccepted = await Inspection.findOne({
      propertyId,
      studentId: student._id,
      decision: 'accepted',
    });
    if (!hasAccepted) {
      return res.status(403).json({ message: 'You can only review a property you have proceeded with' });
    }

    const existing = await Review.findOne({ propertyId, studentId: student._id });
    if (existing) {
      return res.status(409).json({ message: 'You have already reviewed this property' });
    }

    const review = await Review.create({ propertyId, studentId: student._id, rating, comment });
    return res.status(201).json({ review });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to create review', error: err.message });
  }
}

// GET /reviews/property/:propertyId  (public) — all reviews + average rating
async function getPropertyReviews(req, res) {
  try {
    const reviews = await Review.find({ propertyId: req.params.propertyId }).populate(
      'studentId',
      'fullName'
    );
    const avgRating = reviews.length
      ? Number((reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length).toFixed(2))
      : null;
    return res.json({ reviews, avgRating, count: reviews.length });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to fetch reviews', error: err.message });
  }
}

// GET /reviews/mine  (student — reviews they've written)
async function getMyReviews(req, res) {
  try {
    const student = await getStudentProfile(req.user._id);
    if (!student) return res.status(404).json({ message: 'Student profile not found' });

    const reviews = await Review.find({ studentId: student._id }).populate('propertyId', 'title');
    return res.json({ reviews });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to fetch reviews', error: err.message });
  }
}

// PUT /reviews/:id  (student, owner only)  body: { rating?, comment? }
async function updateReview(req, res) {
  try {
    const review = await Review.findById(req.params.id);
    if (!review) return res.status(404).json({ message: 'Review not found' });

    const student = await getStudentProfile(req.user._id);
    if (!student || !student._id.equals(review.studentId)) {
      return res.status(403).json({ message: 'Not your review' });
    }

    const { rating, comment } = req.body;
    if (rating != null) {
      if (rating < 1 || rating > 5) {
        return res.status(400).json({ message: 'rating must be between 1 and 5' });
      }
      review.rating = rating;
    }
    if (comment !== undefined) review.comment = comment;

    await review.save();
    return res.json({ review });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to update review', error: err.message });
  }
}

// DELETE /reviews/:id  (student, owner only)
async function deleteReview(req, res) {
  try {
    const review = await Review.findById(req.params.id);
    if (!review) return res.status(404).json({ message: 'Review not found' });

    const student = await getStudentProfile(req.user._id);
    if (!student || !student._id.equals(review.studentId)) {
      return res.status(403).json({ message: 'Not your review' });
    }

    await review.deleteOne();
    return res.json({ message: 'Review deleted' });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to delete review', error: err.message });
  }
}

module.exports = { createReview, getPropertyReviews, getMyReviews, updateReview, deleteReview };