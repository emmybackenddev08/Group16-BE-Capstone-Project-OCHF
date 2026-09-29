// utils/notify.js  (US-31 System Notifications)
// One place that turns platform events into emails. Uses utils/mailer.js.
// notify* helpers NEVER throw: a failed email must not break the request
// that triggered it. They resolve to true/false so callers (e.g. the
// reminder job) can retry.
const { sendMail } = require('./mailer');
const { User, StudentProfile, ProviderProfile, Property } = require('../model/collectionsModel');

const TZ = process.env.APP_TIMEZONE || 'Africa/Lagos';
const fmt = (d) =>
  new Date(d).toLocaleString('en-GB', { timeZone: TZ, dateStyle: 'full', timeStyle: 'short' });

const propLine = (p) => (p && p.title ? `Property: ${p.title}${p.address ? ` (${p.address})` : ''}\n` : '');

// Covers: account verification, property verification/correction, booking
// confirmation, inspection reminder, cancellation, rescheduling, platform
// updates. (OTP emails are sent by the OTP controller via sendMail directly.)
const templates = {
  account_verified: () => ({
    subject: 'Your account has been verified',
    text: 'Good news - your account has been verified. You can now use all platform features.',
  }),
  account_rejected: ({ reason }) => ({
    subject: 'Your account verification was not approved',
    text: `We could not verify your account.${reason ? `\nReason: ${reason}` : ''}\nPlease update your details and try again.`,
  }),
  property_verified: ({ property }) => ({
    subject: 'Your property listing is now live',
    text: `${propLine(property)}Your listing has been verified and is now visible to verified students.`,
  }),
  property_correction: ({ property, reason }) => ({
    subject: 'Your property listing needs corrections',
    text: `${propLine(property)}Your listing was not approved yet.${reason ? `\nWhat to fix: ${reason}` : ''}\nEdit the listing and it will be re-reviewed.`,
  }),
  booking_confirmed: ({ property, scheduledAt, role }) => ({
    subject: 'Inspection booking confirmed',
    text: `${propLine(property)}When: ${fmt(scheduledAt)}\n${
      role === 'provider' ? 'A student has booked this slot.' : 'Your inspection is confirmed. No landlord approval is needed.'
    }`,
  }),
  inspection_reminder: ({ property, scheduledAt, role }) => ({
    subject: 'Reminder: upcoming property inspection',
    text: `${propLine(property)}When: ${fmt(scheduledAt)}\n${
      role === 'provider' ? 'A student is due to inspect this property.' : 'Your inspection is coming up.'
    }`,
  }),
  inspection_cancelled: ({ property, scheduledAt, role }) => ({
    subject: 'Inspection cancelled',
    text: `${propLine(property)}${scheduledAt ? `Was scheduled for: ${fmt(scheduledAt)}\n` : ''}${
      role === 'provider' ? 'The student cancelled this inspection. The slot is open again.' : 'This inspection has been cancelled.'
    }`,
  }),
  inspection_rescheduled: ({ property, scheduledAt }) => ({
    subject: 'Inspection rescheduled',
    text: `${propLine(property)}New time: ${fmt(scheduledAt)}`,
  }),
  platform_update: ({ title, body }) => ({
    subject: title || 'Platform update',
    text: body || '',
  }),
};

async function send(to, type, data) {
  try {
    if (!to) return false;
    const build = templates[type];
    if (!build) throw new Error(`Unknown notification type: ${type}`);
    const { subject, text } = build(data || {});
    await sendMail({ to, subject, text });
    return true;
  } catch (err) {
    console.error(`[notify] ${type} to ${to} failed:`, err.message);
    return false;
  }
}

async function emailForUser(userId) {
  const u = await User.findById(userId).select('email');
  return u ? u.email : null;
}

async function inspectionParties(inspection) {
  const property = await Property.findById(inspection.propertyId._id || inspection.propertyId);
  const student = await StudentProfile.findById(inspection.studentId._id || inspection.studentId);
  const provider = property ? await ProviderProfile.findById(property.providerId) : null;
  return {
    property,
    studentEmail: student ? await emailForUser(student.userId) : null,
    providerEmail: provider ? await emailForUser(provider.userId) : null,
  };
}

async function notifyUser(userId, type, data) {
  try {
    return await send(await emailForUser(userId), type, data);
  } catch (err) {
    console.error('[notify] notifyUser failed:', err.message);
    return false;
  }
}

// Tell the landlord who owns `property` (a Property document).
async function notifyPropertyOwner(property, type, data) {
  try {
    const provider = await ProviderProfile.findById(property.providerId);
    if (!provider) return false;
    return await send(await emailForUser(provider.userId), type, { property, ...data });
  } catch (err) {
    console.error('[notify] notifyPropertyOwner failed:', err.message);
    return false;
  }
}

// Sends `type` to student AND landlord. Returns true only if both sent.
async function notifyInspection(inspection, type, extra = {}) {
  try {
    const { property, studentEmail, providerEmail } = await inspectionParties(inspection);
    const base = { property, scheduledAt: inspection.scheduledAt, ...extra };
    const results = await Promise.all([
      send(studentEmail, type, { ...base, role: 'student' }),
      send(providerEmail, type, { ...base, role: 'provider' }),
    ]);
    return results.every(Boolean);
  } catch (err) {
    console.error('[notify] notifyInspection failed:', err.message);
    return false;
  }
}

module.exports = { notifyUser, notifyPropertyOwner, notifyInspection, templates };