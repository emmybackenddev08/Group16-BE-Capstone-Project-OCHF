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
      // Both roles must verify their email before they can log in — the
      // client should call POST /auth/otp/send with this token right after
      // registering (see otpController.js). Registration itself does not
      // send the first code automatically. A provider proceeds to property
      // submission only AFTER verifying (see nextStep from /auth/otp/verify
      // handling on the client, or just route to 'property_submission' once
      // GET /auth/me shows emailVerified: true).
      nextStep: 'otp_verification',
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

    // US-09: students AND providers must verify their email via OTP before
    // they can log in. Admins have no OTP step. We still hand back a token
    // here — not a real session, but enough for the frontend to call
    // POST /auth/otp/send (or /resend) and /auth/otp/verify, which both
    // require `protect`. Without this, anyone who closed the tab after
    // registering without verifying would have no way to ever get a token
    // again and would be locked out permanently.
    if (['student', 'provider'].includes(user.role) && !user.emailVerified) {
      const otpToken = generateToken(user._id, user.role);
      return res.status(403).json({
        message: 'Please verify your email before logging in',
        emailVerified: false,
        otpToken, // use only with /auth/otp/send, /auth/otp/resend, /auth/otp/verify
      });
    }

    const profile = await getProfileForUser(user);
    const token = generateToken(user._id, user.role);
    return res.json({
      token,
      user: { id: user._id, email: user.email, role: user.role, emailVerified: user.emailVerified },
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

// DELETE /auth/me  (protected)  body: { password }
// Deletes the logged-in user's own account. Requires the current password
// as confirmation — a valid token alone shouldn't be enough for something
// this irreversible. Also removes the linked profile so nothing is orphaned.
async function deleteAccount(req, res) {
  try {
    const { password } = req.body;
    if (!password) {
      return res.status(400).json({ message: 'password is required to confirm account deletion' });
    }

    const user = await User.findById(req.user._id);
    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({ message: 'Incorrect password' });
    }

    if (user.role === 'student') {
      await StudentProfile.deleteOne({ userId: user._id });
    } else if (user.role === 'provider') {
      await ProviderProfile.deleteOne({ userId: user._id });
    }
    await user.deleteOne();

    return res.json({ message: 'Account deleted' });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to delete account', error: err.message });
  }
}

module.exports = { register, login, me, deleteAccount };