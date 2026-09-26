const { Report } = require('../model/collectionsModel');

// POST /reports  (any authenticated user)  body: { propertyId?, transactionId?, reason }
// Must reference a property or a transaction — enforced again here (in
// addition to the schema-level check) so the error message is clear.
async function createReport(req, res) {
  try {
    const { propertyId, transactionId, reason } = req.body;
    if (!reason) {
      return res.status(400).json({ message: 'reason is required' });
    }
    if (!propertyId && !transactionId) {
      return res.status(400).json({ message: 'propertyId or transactionId is required' });
    }

    const report = await Report.create({
      reporterId: req.user._id,
      propertyId,
      transactionId,
      reason,
    });
    return res.status(201).json({ report });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to create report', error: err.message });
  }
}

// GET /reports/mine  (any authenticated user — reports they've filed)
async function getMyReports(req, res) {
  try {
    const reports = await Report.find({ reporterId: req.user._id })
      .populate('propertyId')
      .populate('transactionId');
    return res.json({ reports });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to fetch reports', error: err.message });
  }
}

module.exports = { createReport, getMyReports };