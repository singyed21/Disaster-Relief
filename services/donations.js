const db = require('../config/db');
const payment = require('./payment');
const emails = require('./emails');

// Runs after the donor's email is confirmed. Returns { redirect } for the next step.
async function activate(donation, disaster) {
  const isMoney = donation.donation_type === 'money';
  const d = await db.oneOrNone(
    `UPDATE donations SET status = $1, email_verified = TRUE WHERE id = $2 AND status = 'unverified' RETURNING *`,
    [isMoney ? 'pending' : 'pledged', donation.id]
  );
  if (!d) return { redirect: `/donations/${donation.reference}` };

  const bank = isMoney && d.payment_provider === 'bank';
  const note = bank
    ? 'Email verified. Please transfer the amount to our bank account and submit your transfer details.'
    : isMoney
      ? 'Email verified. Waiting for payment confirmation.'
      : 'Email verified. Pledge received. Our coordinators will contact you to arrange the details.';
  await db.none('INSERT INTO donation_updates (donation_id, status, note) VALUES ($1, $2, $3)', [d.id, d.status, note]);

  if (!isMoney) {
    emails.sendPledgeConfirmation(d, disaster).catch(() => {});
    return { redirect: `/donations/${d.reference}/success` };
  }
  if (bank) return { redirect: `/donations/${d.reference}/pay-bank` };
  const { url } = await payment.createCheckout(d, disaster);
  return { redirect: url };
}

module.exports = { activate };