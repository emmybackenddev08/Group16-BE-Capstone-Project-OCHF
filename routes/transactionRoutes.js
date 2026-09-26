const express = require('express');
const router = express.Router();
const {
  getMyTransactions,
  getReceivedTransactions,
  getTransactionById,
  updateTransactionStatus,
} = require('../controller/transactionController');
const { protect, authorize } = require('../middleware/auth');

router.get('/mine', protect, authorize('student'), getMyTransactions);
router.get('/received', protect, authorize('provider'), getReceivedTransactions);
router.get('/:id', protect, getTransactionById);
router.put('/:id/status', protect, updateTransactionStatus);

module.exports = router;