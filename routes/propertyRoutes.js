const express = require('express');
const router = express.Router();
const {
  createProperty,
  getProperties,
  getMyProperties,
  getPropertyById,
  updateProperty,
  deleteProperty,
} = require('../controller/propertyController');
const { protect, authorize, optionalProtect } = require('../middleware/auth');

// Order matters: /mine must come before /:id or Express will treat
// "mine" as an :id value.
router.post('/', protect, authorize('provider'), createProperty);
router.get('/', getProperties);
router.get('/mine', protect, authorize('provider'), getMyProperties);
router.get('/:id', optionalProtect, getPropertyById);
router.put('/:id', protect, authorize('provider'), updateProperty);
router.delete('/:id', protect, authorize('provider'), deleteProperty);

module.exports = router;