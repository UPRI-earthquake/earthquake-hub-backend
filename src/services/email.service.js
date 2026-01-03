const nodemailer = require('nodemailer');

const DEFAULT_FROM = 'UPRI Earthquake Hub <no-reply@upri.edu.ph>';

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes';
}

let transporterPromise = null;

async function getTransporter() {
  if (transporterPromise) return transporterPromise;

  const transport = process.env.EMAIL_TRANSPORT || 'smtp';
  if (transport !== 'smtp') {
    throw new Error(`Unsupported EMAIL_TRANSPORT "${transport}". Only "smtp" is supported right now.`);
  }

  const host = process.env.EMAIL_HOST || 'localhost';
  const port = Number(process.env.EMAIL_PORT || 1025);
  const secure = parseBoolean(process.env.EMAIL_SECURE, false);
  const user = process.env.EMAIL_USER;
  const pass = process.env.EMAIL_PASS;

  const auth = user || pass ? { user, pass } : undefined;

  transporterPromise = nodemailer.createTransport({
    host,
    port,
    secure,
    auth,
  });

  return transporterPromise;
}

/**
 * Send an email using the configured transport. Defaults are tuned for local
 * SMTP testing (e.g., MailHog/Mailpit).
 * @param {object} options - Nodemailer mail options
 */
async function sendMail(options = {}) {
  const transporter = await getTransporter();
  const mailOptions = {
    from: process.env.EMAIL_FROM || DEFAULT_FROM,
    ...options,
  };

  if (!mailOptions.to) {
    throw new Error('Email recipient (to) is required.');
  }

  const info = await transporter.sendMail(mailOptions);
  if (process.env.NODE_ENV !== 'production') {
    console.log(`[email] message sent to ${mailOptions.to} (id: ${info?.messageId || 'n/a'})`);
  }
  return info;
}

module.exports = {
  sendMail,
};
