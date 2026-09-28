const bcrypt = require('bcrypt');
const mongoose = require('mongoose');
const { User, StudentProfile, ProviderProfile } = require('../model/collectionsModel');
const generateToken = require('../utils/token');

const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

// Returns the student/provider profile for a user (null for admins).
async function getProfileForUser(user) {
  if (user.role === 'student') return StudentProfile.findOne({ userId: user._id });
  if (user.role === 'provider') return ProviderProfile.findOne({ userId: user._id });
  return null;
}

// POST /auth/register
// body: { email, password, confirmPassword?, role: 'student'|'provider',
//         fullName (student), phone, schoolId?, businessName?, verificationDocUrl? }
// Public registration only allows 'student' and 'provider' — admin accounts
// are created separately (e.g. seeded or created by an existing admin).
async function register(req, res) {
  let user = null;
  try {
    const {
      email, password, confirmPassword, role,
      fullName, phone, schoolId, businessName, verificationDocUrl,
    } = req.body;

    // ---- Validate EVERYTHING before touching the database ----------------
    if (!email || !password || !role) {
      return res.status(400).json({ message: 'email, password and role are required' });
    }
    if (!['student', 'provider'].includes(role)) {
      return res.status(400).json({ message: 'role must be student or provider' });
    }
    if (typeof email !== 'string' || !EMAIL_RX.test(email.trim())) {
      return res.status(400).json({ message: 'A valid email is required' });
    }
    if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({ message: `password must be at least ${MIN_PASSWORD_LENGTH} characters` });
    }
    if (confirmPassword !== undefined && confirmPassword !== password) {
      return res.status(400).json({ message: 'Passwords do not match' });
    }
    if (role === 'student') {
      if (!fullName) return res.status(400).json({ message: 'fullName is required for students' });
      if (schoolId && !mongoose.isValidObjectId(schoolId)) {
        return res.status(400).json({ message: 'Invalid schoolId' });
      }
    } else if (!phone) {
      return res.status(400).json({ message: 'phone is required for providers' });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const existing = await User.findOne({ email: normalizedEmail });
    if (existing) {
      return res.status(409).json({ message: 'Email already registered' });
    }

    // ---- Create user + profile -------------------------------------------
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    user = await User.create({ email: normalizedEmail, passwordHash: hashedPassword, role });

    let profile;
    if (role === 'student') {
      profile = await StudentProfile.create({
        userId: user._id, fullName, phone, schoolId, verificationDocUrl,
      });
    } else {
      profile = await ProviderProfile.create({
        userId: user._id, businessName, phone, verificationDocUrl,
      });
    }

    const token = generateToken(user._id, user.role);

    return res.status(201).json({
      token,
      user: { id: user._id, email: user.email, role: user.role },
      verificationStatus: profile.verificationStatus, // 'pending' for every new profile
      // Tells the client where to send the user next.
      // NOTE: student OTP endpoints (US-09) are not part of these files yet.
      nextStep: role === 'student' ? 'otp_verification' : 'property_submission',
    });
  } catch (err) {
    // Roll back the half-created account so the email isn't locked out.
    if (user) {
      await User.deleteOne({ _id: user._id }).catch(() => {});
    }
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

    const user = await User.findOne({ email: String(email).toLowerCase() });
    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }
    if (!user.isActive) {
      return res.status(403).json({ message: 'Account is deactivated' });
    }

    const profile = await getProfileForUser(user);
    const token = generateToken(user._id, user.role);
    return res.json({
      token,
      user: { id: user._id, email: user.email, role: user.role },
      verificationStatus: profile ? profile.verificationStatus : null,
    });
  } catch (err) {
    return res.status(500).json({ message: 'Login failed', error: err.message });
  }
}

// GET /auth/me  (protected — requires the `protect` middleware first)
// Returns the user plus their profile and verification status so the client
// can render locked/unlocked states (US-11) and the landlord dashboard (US-15).
async function me(req, res) {
  try {
    const profile = await getProfileForUser(req.user);
    return res.json({
      user: req.user,
      profile,
      verificationStatus: profile ? profile.verificationStatus : null,
    });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to load account', error: err.message });
  }
}

module.exports = { register, login, me };