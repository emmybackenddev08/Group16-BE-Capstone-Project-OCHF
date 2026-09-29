const { StudentProfile, ProviderProfile, Property, Inspection, Report } = require('../model/collectionsModel');

const { notifyUser, notifyPropertyOwner } = require('../utils/notify');

const VALID_REVIEW_STATUSES = ['verified', 'rejected'];

// GET /admin/students?status=pending  (default: pending; pass status=all for everything)
async function getStudentVerifications(req, res) {
  try {
    const { status = 'pending' } = req.query;
    const filter = status === 'all' ? {} : { verificationStatus: status };
    const students = await StudentProfile.find(filter).populate('userId', 'email role isActive');
    return res.json({ students });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to fetch student verifications', error: err.message });
  }
}

// PUT /admin/students/:id  body: { status: 'verified' | 'rejected' }
async function reviewStudent(req, res) {
  try {
    const { status } = req.body;
    if (!VALID_REVIEW_STATUSES.includes(status)) {
      return res.status(400).json({ message: 'status must be verified or rejected' });
    }
    const student = await StudentProfile.findById(req.params.id);
    if (!student) return res.status(404).json({ message: 'Student profile not found' });

    student.verificationStatus = status;
    await student.save();
    notifyUser(student.userId, status === 'verified' ? 'account_verified' : 'account_rejected', { reason: req.body.reason });
    return res.json({ student });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to update verification', error: err.message });
  }
}

// GET /admin/providers?status=pending
async function getProviderVerifications(req, res) {
  try {
    const { status = 'pending' } = req.query;
    const filter = status === 'all' ? {} : { verificationStatus: status };
    const providers = await ProviderProfile.find(filter).populate('userId', 'email role isActive');
    return res.json({ providers });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to fetch provider verifications', error: err.message });
  }
}

// PUT /admin/providers/:id  body: { status: 'verified' | 'rejected' }
async function reviewProvider(req, res) {
  try {
    const { status } = req.body;
    if (!VALID_REVIEW_STATUSES.includes(status)) {
      return res.status(400).json({ message: 'status must be verified or rejected' });
    }
    const provider = await ProviderProfile.findById(req.params.id);
    if (!provider) return res.status(404).json({ message: 'Provider profile not found' });

    provider.verificationStatus = status;
    await provider.save();
    notifyUser(provider.userId, status === 'verified' ? 'account_verified' : 'account_rejected', { reason: req.body.reason });
    return res.json({ provider });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to update verification', error: err.message });
  }
}

// GET /admin/properties?status=pending
async function getPropertyVerifications(req, res) {
  try {
    const { status = 'pending' } = req.query;
    const filter = status === 'all' ? {} : { verificationStatus: status };
    const properties = await Property.find(filter).populate('providerId');
    return res.json({ properties });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to fetch property verifications', error: err.message });
  }
}

// PUT /admin/properties/:id  body: { status: 'verified' | 'rejected' }
async function reviewProperty(req, res) {
  try {
    const { status } = req.body;
    if (!VALID_REVIEW_STATUSES.includes(status)) {
      return res.status(400).json({ message: 'status must be verified or rejected' });
    }
    const property = await Property.findById(req.params.id);
    if (!property) return res.status(404).json({ message: 'Property not found' });

    property.verificationStatus = status;
    await property.save();
    // 'rejected' = the landlord must correct the listing (body.reason says what)
    notifyPropertyOwner(property, status === 'verified' ? 'property_verified' : 'property_correction', { reason: req.body.reason });
    return res.json({ property });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to update verification', error: err.message });
  }
}

// GET /admin/inspections?status=requested  (omit status to see every inspection)
// Platform-wide visibility — unlike the student/provider inspection routes,
// this isn't scoped to "mine" or "received", it's everything.
async function getInspections(req, res) {
  try {
    const { status } = req.query;
    const filter = status ? { status } : {};
    const inspections = await Inspection.find(filter)
      .populate('propertyId')
      .populate({ path: 'studentId', populate: { path: 'userId', select: 'email' } });
    return res.json({ inspections });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to fetch inspections', error: err.message });
  }
}

// GET /admin/reports?status=open  (default: open; pass status=all for everything)
async function getReports(req, res) {
  try {
    const { status = 'open' } = req.query;
    const filter = status === 'all' ? {} : { status };
    const reports = await Report.find(filter)
      .populate('reporterId', 'email role')
      .populate('propertyId')
      .populate('transactionId');
    return res.json({ reports });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to fetch reports', error: err.message });
  }
}

// PUT /admin/reports/:id  body: { status: 'reviewed' | 'resolved' }
async function updateReportStatus(req, res) {
  try {
    const { status } = req.body;
    if (!['reviewed', 'resolved'].includes(status)) {
      return res.status(400).json({ message: 'status must be reviewed or resolved' });
    }
    const report = await Report.findById(req.params.id);
    if (!report) return res.status(404).json({ message: 'Report not found' });

    report.status = status;
    await report.save();
    return res.json({ report });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to update report', error: err.message });
  }
}

module.exports = {
  getStudentVerifications,
  reviewStudent,
  getProviderVerifications,
  reviewProvider,
  getPropertyVerifications,
  reviewProperty,
  getInspections,
  getReports,
  updateReportStatus,
};