const crypto = require('crypto');
const { User, StudentProfile, Otp } = require('../model/collectionsModel');
const { sendMail } = require('../utils/mailer');

// ---- US-09 limits (MVP) ------------------------------------------------------
const CODE_TTL_MS = 10 * 60 * 1000;      // a code works for 10 minutes
const RESEND_COOLDOWN_MS = 60 * 1000;    // wait 60s between sends
const MAX_SENDS_PER_HOUR = 5;            // hourly cap (survives code expiry via purgeAt)
const HOUR_MS = 60 * 60 * 1000;
const MAX_ATTEMPTS = 5;                  // wrong guesses per code
// MVP: no university API / matriculation check. A correct OTP proves the
// student controls the email, and marks a still-pending profile as verified.
// Set OTP_AUTO_VERIFY=false to only set emailVerified and leave the admin
// review (US-11) as the only way to reach 'verified'.
const AUTO_VERIFY = process.env.OTP_AUTO_VERIFY !== 'false';
// -----------------------------------------------------------------------------

const hashCode = (userId, code) =>
  crypto
    .createHmac('sha256', process.env.JWT_SECRET || 'dev-secret')
    .update(`${userId}:${code}`)
    .digest('hex');

const secondsLeft = (ms) => Math.max(1, Math.ceil(ms / 1000));

// POST /auth/otp/send  and  POST /auth/otp/resend  (student only)
// Emails a fresh 6-digit code. Enforces a resend cooldown and an hourly cap.
async function sendOtp(req, res) {
  try {
    const user = req.user;
    const profile = await StudentProfile.findOne({ userId: user._id });
    if (!profile) return res.status(404).json({ message: 'Student profile not found' });
    if (user.emailVerified) return res.status(409).json({ message: 'Email is already verified' });

    const now = new Date();
    const existing = await Otp.findOne({ userId: user._id });

    let sendCount = 1;
    let windowStartedAt = now;
    if (existing) {
      const sinceLast = now - existing.lastSentAt;
      if (sinceLast < RESEND_COOLDOWN_MS) {
        const wait = secondsLeft(RESEND_COOLDOWN_MS - sinceLast);
        res.set('Retry-After', String(wait));
        return res.status(429).json({ message: `Please wait ${wait}s before requesting another code`, retryAfterSeconds: wait });
      }
      if (now - existing.windowStartedAt < HOUR_MS) {
        if (existing.sendCount >= MAX_SENDS_PER_HOUR) {
          const wait = secondsLeft(HOUR_MS - (now - existing.windowStartedAt));
          res.set('Retry-After', String(wait));
          return res.status(429).json({ message: 'Too many codes requested. Try again later.', retryAfterSeconds: wait });
        }
        sendCount = existing.sendCount + 1;
        windowStartedAt = existing.windowStartedAt;
      }
    }

    const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');

    // Email first: if SMTP fails the student isn't charged a cooldown/send.
    try {
      await sendMail({
        to: user.email,
        subject: 'Your verification code',
        text: `Your verification code is ${code}. It expires in ${CODE_TTL_MS / 60000} minutes.\nIf you did not request this, ignore this email.`,
      });
    } catch (mailErr) {
      return res.status(502).json({ message: 'Could not send the verification email. Please try again.' });
    }

    const codeExpiresAt = new Date(now.getTime() + CODE_TTL_MS);
    const purgeAt = new Date(Math.max(windowStartedAt.getTime() + HOUR_MS, codeExpiresAt.getTime()));
    await Otp.findOneAndUpdate(
      { userId: user._id },
      {
        $set: {
          codeHash: hashCode(user._id, code),
          codeExpiresAt,
          attempts: 0,
          lastSentAt: now,
          sendCount,
          windowStartedAt,
          purgeAt,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    return res.json({
      message: 'Verification code sent',
      expiresInMinutes: CODE_TTL_MS / 60000,
      resendAvailableInSeconds: RESEND_COOLDOWN_MS / 1000,
    });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to send code', error: err.message });
  }
}

// POST /auth/otp/verify  (student only)  body: { code }
async function verifyOtp(req, res) {
  try {
    const user = req.user;
    const code = String((req.body && req.body.code) || '').trim();
    if (!/^\d{6}$/.test(code)) return res.status(400).json({ message: 'code must be 6 digits' });
    if (user.emailVerified) return res.status(409).json({ message: 'Email is already verified' });

    // Count the attempt atomically BEFORE checking, so parallel guesses can't
    // sneak past the limit.
    const otp = await Otp.findOneAndUpdate(
      { userId: user._id, attempts: { $lt: MAX_ATTEMPTS } },
      { $inc: { attempts: 1 } },
      { new: true }
    );
    if (!otp) {
      const stillThere = await Otp.exists({ userId: user._id });
      return stillThere
        ? res.status(429).json({ message: 'Too many wrong attempts. Request a new code.' })
        : res.status(400).json({ message: 'No active code. Request a new one.' });
    }
    if (otp.codeExpiresAt <= new Date()) {
      return res.status(400).json({ message: 'Code expired. Request a new one.' });
    }

    const a = Buffer.from(otp.codeHash, 'hex');
    const b = Buffer.from(hashCode(user._id, code), 'hex');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return res.status(400).json({ message: 'Incorrect code', attemptsRemaining: Math.max(0, MAX_ATTEMPTS - otp.attempts) });
    }

    // Success
    await Otp.deleteOne({ userId: user._id });
    await User.updateOne({ _id: user._id }, { $set: { emailVerified: true, emailVerifiedAt: new Date() } });

    let profile = null;
    if (AUTO_VERIFY) {
      profile = await StudentProfile.findOneAndUpdate(
        { userId: user._id, verificationStatus: 'pending' }, // never overrides 'rejected'
        { $set: { verificationStatus: 'verified' } },
        { new: true }
      );
    }
    if (!profile) profile = await StudentProfile.findOne({ userId: user._id });

    return res.json({
      verified: true,
      emailVerified: true,
      verificationStatus: profile ? profile.verificationStatus : null,
    });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to verify code', error: err.message });
  }
}

module.exports = { sendOtp, verifyOtp };