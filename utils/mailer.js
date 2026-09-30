// utils/mailer.js
// Sends email through SMTP using nodemailer (npm i nodemailer).
// Env: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM
// In development with no SMTP_HOST set, the message is printed to the console
// so you can read the OTP. In production a missing SMTP config is an error.
async function sendMail({ to, subject, text }) {
  if (!process.env.SMTP_HOST) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('SMTP is not configured');
    }
    console.log(`\n[DEV MAIL] To: ${to}\nSubject: ${subject}\n${text}\n`);
    return;
  }

  const nodemailer = require('nodemailer'); // loaded lazily so dev works without it
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
  });

  await transporter.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to,
    subject,
    text,
  });
}

module.exports = { sendMail };