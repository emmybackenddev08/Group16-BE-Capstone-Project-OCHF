// utils/reminders.js  (US-21 Automated Inspection Reminder)
// Every few minutes, finds confirmed/rescheduled inspections starting within
// REMINDER_HOURS (default 24) that have not been reminded yet, and emails
// BOTH the student and the landlord with property/date/time.
// It reads the platform's own Inspection record (the "booking record").
const { Inspection } = require('../model/collectionsModel');
const { notifyInspection } = require('./notify');

const REMINDER_HOURS = Number(process.env.REMINDER_HOURS) || 24;
const INTERVAL_MS = (Number(process.env.REMINDER_CHECK_MINUTES) || 10) * 60 * 1000;

async function sendDueReminders() {
  const now = new Date();
  const horizon = new Date(now.getTime() + REMINDER_HOURS * 60 * 60 * 1000);

  const due = await Inspection.find({
    status: { $in: ['confirmed', 'rescheduled'] },
    scheduledAt: { $gt: now, $lte: horizon },
    reminderSentAt: null, // matches missing or null
  }).select('_id');

  for (const { _id } of due) {
    // Claim atomically so two server instances can't both send it.
    const claimed = await Inspection.findOneAndUpdate(
      { _id, reminderSentAt: null, status: { $in: ['confirmed', 'rescheduled'] } },
      { $set: { reminderSentAt: new Date() } },
      { new: true }
    );
    if (!claimed) continue;

    const ok = await notifyInspection(claimed, 'inspection_reminder');
    if (!ok) {
      // Release the claim so the next run retries.
      await Inspection.updateOne({ _id }, { $set: { reminderSentAt: null } });
    }
  }
  return due.length;
}

function startReminderJob() {
  const run = () => sendDueReminders().catch((e) => console.error('[reminders] run failed:', e.message));
  run();
  const timer = setInterval(run, INTERVAL_MS);
  console.log(`Reminder job started (every ${INTERVAL_MS / 60000} min, window ${REMINDER_HOURS}h)`);
  return timer;
}

module.exports = { startReminderJob, sendDueReminders };