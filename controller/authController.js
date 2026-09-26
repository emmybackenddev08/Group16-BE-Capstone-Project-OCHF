const bcrypt = require('bcrypt');
const { User, StudentProfile, ProviderProfile } = require('../model/collectionsModel');
const generateToken = require('../utils/token');

// POST /auth/register
// body: { email, password, role: 'student'|'provider', fullName?, phone, schoolId?, businessName? }
// Public registration only allows 'student' and 'provider' — admin accounts
// are created separately (e.g. seeded or created by an existing admin).
async function register(req, res) {
  try {
    const { email, password, role, fullName, phone, schoolId, businessName } = req.body;

    if (!email || !password || !role) {
      return res.status(400).json({ message: 'email, password and role are required' });
    }
    if (!['student', 'provider'].includes(role)) {
      return res.status(400).json({ message: 'role must be student or provider' });
    }

    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
      return res.status(409).json({ message: 'Email already registered' });
    }

    // Hash here for both roles — student and provider both flow through
    // this same register() function, so this one hash covers both.
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const user = await User.create({ email, passwordHash: hashedPassword, role });

    if (role === 'student') {
      if (!fullName) {
        return res.status(400).json({ message: 'fullName is required for students' });
      }
      await StudentProfile.create({ userId: user._id, fullName, phone, schoolId });
    } else {
      if (!phone) {
        return res.status(400).json({ message: 'phone is required for providers' });
      }
      await ProviderProfile.create({ userId: user._id, businessName, phone });
    }

    const token = generateToken(user._id, user.role);

    return res.status(201).json({
      token,
      user: { id: user._id, email: user.email, role: user.role },
      verificationStatus: 'pending', // every new student/provider profile starts unverified
    });
  } catch (err) {
    return res.status(500).json({ message: 'Registration failed', error: err.message });
  }
}

// POST /auth/login
// body: { email, password }
async function login(req, res) {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: 'email and password are required' });
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }
    if (!user.isActive) {
      return res.status(403).json({ message: 'Account is deactivated' });
    }

    const token = generateToken(user._id, user.role);
    return res.json({ token, user: { id: user._id, email: user.email, role: user.role } });
  } catch (err) {
    return res.status(500).json({ message: 'Login failed', error: err.message });
  }
}

// GET /auth/me  (protected — requires the `protect` middleware first)
async function me(req, res) {
  return res.json({ user: req.user });
}

module.exports = { register, login, me };