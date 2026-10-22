const crypto = require('crypto');
const db = require('../config/db');
const emails = require('./emails');
const { appUrl } = require('../utils/helpers');

const provider = (process.env.PAYMENT_GATEWAY || 'bank').toLowerCase();

if (provider === 'sandbox' && process.env.NODE_ENV === 'production') {
  console.warn('WARNING: PAYMENT_GATEWAY=sandbox in production. Donations are NOT real payments.');
}

const isSandbox = () => provider === 'sandbox';

/**
 * Starts a payment for a pending money donation and returns { url } to redirect the donor to.
 * Providers: "sandbox" (built-in test checkout) and "stripe" (Stripe Checkout, hosted page).
 * To add a local provider, add a branch here and a webhook/callback that calls completeDonation().
 */
async function createCheckout(donation, disaster) {
  if (provider === 'sandbox') {
    return { url: `/pay/sandbox/${donation.reference}` };
  }

  if (provider === 'stripe') {
    const key = process.env.PAYMENT_API_KEY;
    if (!key || key.includes('placeholder')) throw new Error('PAYMENT_API_KEY is not configured');
    const body = new URLSearchParams({
      mode: 'payment',
      success_url: `${appUrl()}/donations/${donation.reference}/success`,
      cancel_url: `${appUrl()}/donate?disaster=${disaster.id}`,
      client_reference_id: donation.reference,
      customer_email: donation.donor_email,
      'line_items[0][quantity]': '1',
      'line_items[0][price_data][currency]': donation.currency.toLowerCase(),
      'line_items[0][price_data][unit_amount]': String(Math.round(donation.amount * 100)),
      'line_items[0][price_data][product_data][name]': `Donation: ${disaster.title}`.slice(0, 120)
    });
    const resp = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error((data.error && data.error.message) || 'Payment provider error');
    await db.none('UPDATE donations SET provider_ref = $1 WHERE id = $2', [data.id, donation.id]);
    return { url: data.url };
  }

  throw new Error(`Unsupported PAYMENT_GATEWAY "${provider}"`);
}

// Idempotent: only a pending money donation can be completed, and only once.
async function completeDonation(reference, providerRef) {
  const d = await db.oneOrNone(
    `UPDATE donations
        SET status = 'completed', completed_at = NOW(), provider_ref = COALESCE($2, provider_ref)
      WHERE reference = $1 AND status = 'pending' AND donation_type = 'money'
      RETURNING *`,
    [reference, providerRef || null]
  );
  if (!d) return null;
  const note = d.payment_provider === 'sandbox'
    ? 'Test payment confirmed (sandbox mode - no real money moved).'
    : 'Payment confirmed by the payment provider. Funds received.';
  await db.none(`INSERT INTO donation_updates (donation_id, status, note) VALUES ($1, 'completed', $2)`, [d.id, note]);
  const disaster = await db.one('SELECT * FROM disasters WHERE id = $1', [d.disaster_id]);
  emails.sendDonationReceipt(d, disaster).catch(() => {});
  return d;
}

async function failDonation(reference, note) {
  const d = await db.oneOrNone(
    `UPDATE donations SET status = 'failed' WHERE reference = $1 AND status = 'pending' AND donation_type = 'money' RETURNING *`,
    [reference]
  );
  if (d) {
    await db.none(`INSERT INTO donation_updates (donation_id, status, note) VALUES ($1, 'failed', $2)`, [d.id, note || 'Payment was not completed.']);
  }
  return d;
}

function verifyStripeSignature(rawBody, header, secret) {
  if (!header || !secret) return false;
  let t = null;
  const sigs = [];
  for (const part of header.split(',')) {
    const [k, v] = part.split('=');
    if (k === 't') t = v;
    if (k === 'v1') sigs.push(v);
  }
  if (!t || !sigs.length) return false;
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false; // replay protection
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  return sigs.some((s) => s.length === expected.length && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(expected)));
}

// Mounted in app.js with express.raw() so the signature can be verified against the exact bytes.
async function webhookHandler(req, res) {
  if (provider !== 'stripe') return res.status(404).end();
  const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
  if (!verifyStripeSignature(raw, req.get('stripe-signature'), process.env.PAYMENT_WEBHOOK_SECRET)) {
    return res.status(400).send('Invalid signature');
  }
  let event;
  try { event = JSON.parse(raw); } catch { return res.status(400).send('Bad payload'); }

  try {
    const obj = event.data && event.data.object;
    if (event.type === 'checkout.session.completed' && obj && obj.payment_status === 'paid') {
      const don = await db.oneOrNone('SELECT * FROM donations WHERE reference = $1', [obj.client_reference_id]);
      // Only confirm when the provider-reported amount and currency match what we recorded
      if (don && obj.amount_total === Math.round(don.amount * 100) && String(obj.currency).toUpperCase() === don.currency.toUpperCase()) {
        await completeDonation(don.reference, obj.payment_intent || obj.id);
      } else {
        console.error('Webhook amount/currency mismatch for', obj.client_reference_id);
      }
    } else if (event.type === 'checkout.session.expired' && obj) {
      await failDonation(obj.client_reference_id, 'Checkout session expired before payment.');
    }
    res.json({ received: true });
  } catch (err) {
    console.error('Webhook processing error:', err);
    res.status(500).end();
  }
}

module.exports = { provider, isSandbox, createCheckout, completeDonation, failDonation, webhookHandler };