const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const { sendMail } = require('../utils/mailer');
const { notifyUser } = require('../utils/notify');

// POST /notifications/test  (admin) body: { to }
// Quick way to confirm SMTP is configured correctly.
router.post('/test', protect, authorize('admin'), async (req, res) => {
  try {
    const { to } = req.body;
    if (!to) return res.status(400).json({ message: 'to is required' });
    await sendMail({ to, subject: 'SMTP test', text: 'If you can read this, email sending works.' });
    return res.json({ message: 'Test email sent' });
  } catch (err) {
    return res.status(500).json({ message: 'Test email failed', error: err.message });
  }
});

// POST /notifications/announce  (admin) body: { userId, title, body }
// Important platform update to one user.
router.post('/announce', protect, authorize('admin'), async (req, res) => {
  const { userId, title, body } = req.body;
  if (!userId || !body) return res.status(400).json({ message: 'userId and body are required' });
  const ok = await notifyUser(userId, 'platform_update', { title, body });
  return res.status(ok ? 200 : 502).json({ sent: ok });
});

module.exports = router;