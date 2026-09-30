const { User, StudentProfile, ProviderProfile, Property, Inspection, Report } = require('../model/collectionsModel');

const { notifyUser, notifyPropertyOwner } = require('../utils/notify');

const VALID_REVIEW_STATUSES = ['verified', 'rejected'];

// ------------------------------------------------------------
// US-28 — User Management
// ------------------------------------------------------------

// GET /admin/users?role=student&status=active&q=jane
// Lists every user with their linked profile's verification status folded
// in, so the admin doesn't have to cross-reference /admin/students and
// /admin/providers separately. Supports optional filtering/search.
//   role   - 'student' | 'provider' | 'admin' (omit for all roles)
//   status - 'active' | 'suspended' (omit for all)
//   q      - case-insensitive match against email
async function getAllUsers(req, res) {
  try {
    const { role, status, q } = req.query;

    const filter = {};
    if (role) {
      if (!['student', 'provider', 'admin'].includes(role)) {
        return res.status(400).json({ message: 'role must be student, provider or admin' });
      }
      filter.role = role;
    }
    if (status) {
      if (!['active', 'suspended'].includes(status)) {
        return res.status(400).json({ message: 'status must be active or suspended' });
      }
      filter.isActive = status === 'active';
    }
    if (q) {
      filter.email = { $regex: String(q).trim(), $options: 'i' };
    }

    const users = await User.find(filter).select('-passwordHash').sort({ createdAt: -1 });

    // Attach each user's student/provider profile (name + verification
    // status) in two batched queries instead of one query per user.
    const userIds = users.map((u) => u._id);
    const [students, providers] = await Promise.all([
      StudentProfile.find({ userId: { $in: userIds } }).select('userId fullName verificationStatus'),
      ProviderProfile.find({ userId: { $in: userIds } }).select('userId businessName verificationStatus'),
    ]);
    const studentByUser = new Map(students.map((s) => [String(s.userId), s]));
    const providerByUser = new Map(providers.map((p) => [String(p.userId), p]));

    const out = users.map((u) => {
      const profile = studentByUser.get(String(u._id)) || providerByUser.get(String(u._id)) || null;
      return {
        id: u._id,
        email: u.email,
        role: u.role,
        isActive: u.isActive,
        createdAt: u.createdAt,
        name: profile ? profile.fullName || profile.businessName || null : null,
        verificationStatus: profile ? profile.verificationStatus : null,
      };
    });

    return res.json({ users: out });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to fetch users', error: err.message });
  }
}

// PUT /admin/users/:id/status  body: { status: 'active' | 'suspended', reason? }
// Suspending sets isActive: false, which `protect` middleware already
// checks on every request — a suspended user is logged out immediately,
// not just blocked from new logins.
async function updateUserStatus(req, res) {
  try {
    const { status, reason } = req.body;
    if (!['active', 'suspended'].includes(status)) {
      return res.status(400).json({ message: 'status must be active or suspended' });
    }

    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    if (user.role === 'admin' && String(user._id) === String(req.user._id)) {
      return res.status(400).json({ message: 'You cannot change your own account status' });
    }

    user.isActive = status === 'active';
    await user.save();

    notifyUser(user._id, status === 'active' ? 'account_reactivated' : 'account_suspended', { reason });

    return res.json({
      user: { id: user._id, email: user.email, role: user.role, isActive: user.isActive },
    });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to update user status', error: err.message });
  }
}

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
  getAllUsers,
  updateUserStatus,
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