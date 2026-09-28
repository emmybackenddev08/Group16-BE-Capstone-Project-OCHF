const jwt = require('jsonwebtoken');
const { User, StudentProfile } = require('../model/collectionsModel');

// Verifies the JWT on the request and attaches the user to req.user.
// Use on any route that requires a logged-in user.
async function protect(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'Not authenticated' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const user = await User.findById(decoded.id).select('-passwordHash');
    if (!user || !user.isActive) {
      return res.status(401).json({ message: 'User not found or inactive' });
    }

    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
}

// Restricts a route to specific roles. Use AFTER protect.
// e.g. router.post('/properties', protect, authorize('provider'), createProperty)
function authorize(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ message: 'Forbidden: insufficient role' });
    }
    next();
  };
}

// Restricts a route to students whose account has been verified by an admin.
// Use AFTER protect + authorize('student'). Attaches req.studentProfile.
async function requireVerifiedStudent(req, res, next) {
  try {
    const profile = await StudentProfile.findOne({ userId: req.user._id });
    if (!profile) {
      return res.status(404).json({ message: 'Student profile not found' });
    }
    if (profile.verificationStatus !== 'verified') {
      return res.status(403).json({
        message: 'Student verification required',
        verificationStatus: profile.verificationStatus,
      });
    }
    req.studentProfile = profile;
    next();
  } catch (err) {
    return res.status(500).json({ message: 'Verification check failed', error: err.message });
  }
}

async function optionalProtect(req, res, next) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      const token = authHeader.split(' ')[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.id).select('-passwordHash');
      if (user && user.isActive) {
        req.user = user;
      }
      next();
    } catch (err) {
      // If token is invalid or expired, we just don't attach req.user (proceed to logout)
      next();
    }
  } else {
    // No token at all: guest access, continue without req.user
    next();
  }
}
module.exports = { protect, authorize, optionalProtect, requireVerifiedStudent };