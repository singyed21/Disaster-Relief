const nodemailer = require('nodemailer');
const { esc, appUrl, fmtMoney, statusLabel, typeLabel } = require('../utils/helpers');

let transporter = null;
if (process.env.SMTP_HOST) {
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined
  });
}

if (!process.env.SMTP_HOST && process.env.NODE_ENV === 'production') {
  console.warn('WARNING: SMTP_HOST is not set. Verification codes will NOT reach donors.');
}

// Never throws: a mail failure must not break registration or a donation.
async function sendMail({ to, subject, text, html }) {
  const from = process.env.MAIL_FROM || 'Disaster Relief Portal <no-reply@localhost>';
  if (!transporter) {
    console.log(`\n--- EMAIL (SMTP not configured - printed here instead of sent) ---\nTo: ${to}\nSubject: ${subject}\n\n${text}\n------------------------------------------------------------------\n`);
    return { dev: true };
  }
  try {
    await transporter.sendMail({ from, to, subject, text, html });
    return { sent: true };
  } catch (err) {
    console.error('Email failed:', err.message);
    return { error: err.message };
  }
}

const wrap = (heading, body) => `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#1c2b2d">
<h2 style="color:#0f5c5c">${heading}</h2>${body}
<hr style="border:none;border-top:1px solid #ddd;margin:24px 0"><p style="font-size:12px;color:#777">Disaster Relief Portal</p></div>`;

const button = (url, label) =>
  `<p><a href="${esc(url)}" style="background:#0f5c5c;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;display:inline-block">${esc(label)}</a></p>`;

exports.sendPasswordReset = (user, token) => {
  const url = `${appUrl()}/reset/${token}`;
  return sendMail({
    to: user.email,
    subject: 'Reset your password - Disaster Relief Portal',
    text: `Hello ${user.name},\n\nReset your password using this link (valid for 1 hour):\n${url}\n\nIf you did not request this, ignore this email.`,
    html: wrap('Reset your password', `<p>Hello ${esc(user.name)},</p><p>Use the button below to choose a new password. The link is valid for 1 hour.</p>${button(url, 'Reset password')}`)
  });
};

exports.sendDonationReceipt = (d, disaster) => {
  const url = `${appUrl()}/donations/${d.reference}`;
  const amount = fmtMoney(d.amount, d.currency);
  return sendMail({
    to: d.donor_email,
    subject: `Donation received (${d.reference})`,
    text: `Thank you ${d.donor_name}.\n\nWe received your donation of ${amount} for "${disaster.title}".\nReference: ${d.reference}\nTrack where it goes: ${url}`,
    html: wrap('Thank you for your donation', `<p>Dear ${esc(d.donor_name)},</p><p>We received your donation of <strong>${esc(amount)}</strong> for <strong>${esc(disaster.title)}</strong>.</p><p>Reference: <strong>${esc(d.reference)}</strong></p>${button(url, 'Track my donation')}`)
  });
};

exports.sendPledgeConfirmation = (d, disaster) => {
  const url = `${appUrl()}/donations/${d.reference}`;
  const what = d.donation_type === 'medical' ? `medical support (${d.item_description})` : `a rescue team offer (${d.skills})`;
  return sendMail({
    to: d.donor_email,
    subject: `Pledge received (${d.reference})`,
    text: `Thank you ${d.donor_name}.\n\nWe received your pledge of ${what} for "${disaster.title}".\nReference: ${d.reference}\nOur coordinators will contact you. Track progress: ${url}`,
    html: wrap('Thank you for your pledge', `<p>Dear ${esc(d.donor_name)},</p><p>We received your pledge of <strong>${esc(what)}</strong> for <strong>${esc(disaster.title)}</strong>. Our coordinators will contact you shortly.</p><p>Reference: <strong>${esc(d.reference)}</strong></p>${button(url, 'Track my pledge')}`)
  });
};

exports.sendStatusUpdate = (d, disaster, note) => {
  const url = `${appUrl()}/donations/${d.reference}`;
  const label = statusLabel(d.donation_type, d.status);
  return sendMail({
    to: d.donor_email,
    subject: `Update on your ${typeLabel(d.donation_type).toLowerCase()} donation (${d.reference})`,
    text: `Hello ${d.donor_name},\n\nYour donation ${d.reference} for "${disaster.title}" is now: ${label}.\n${note ? 'Note: ' + note + '\n' : ''}\nFull timeline: ${url}`,
    html: wrap('Your donation was updated', `<p>Hello ${esc(d.donor_name)},</p><p>Your donation <strong>${esc(d.reference)}</strong> for <strong>${esc(disaster.title)}</strong> is now: <strong>${esc(label)}</strong>.</p>${note ? `<p>${esc(note)}</p>` : ''}${button(url, 'See full timeline')}`)
  });
};

exports.sendOtp = (to, name, code, purpose) =>
  sendMail({
    to,
    subject: `Your verification code: ${code}`,
    text: `Hello ${name},\n\nYour code to ${purpose} is: ${code}\n\nIt expires in 10 minutes. Never share it with anyone. If you did not request it, ignore this email.`,
    html: wrap('Your verification code', `<p>Hello ${esc(name)},</p><p>Use this code to ${esc(purpose)}:</p><p style="font-size:32px;letter-spacing:8px;font-weight:bold;color:#0f5c5c">${esc(code)}</p><p>It expires in 10 minutes. Never share it with anyone. If you did not request it, ignore this email.</p>`)
  });