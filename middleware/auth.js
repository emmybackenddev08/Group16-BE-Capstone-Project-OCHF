const jwt = require('jsonwebtoken');
const { User } = require('../model/collectionsModel');

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
module.exports = { protect, authorize, optionalProtect };