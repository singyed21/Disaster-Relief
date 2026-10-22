const router = require('express').Router();
const db = require('../config/db');
const payment = require('../services/payment');
const emails = require('../services/emails');
const otp = require('../services/otp');
const donations = require('../services/donations');
const { getSettings, bankConfigured } = require('../services/settings');
const { formLimiter, authLimiter } = require('../middleware/limiters');
const { clean, isEmail, newReference, DONATION_TYPES, CURRENCY } = require('../utils/helpers');

const MIN_DONATION = Number(process.env.MIN_DONATION) || 10;
const MAX_DONATION = 10000000;

const paymentMethods = () => (payment.provider === 'bank' ? ['bank'] : ['online', 'bank']);
const activeDisasters = () => db.any(`SELECT id, title, location FROM disasters WHERE status = 'active' ORDER BY created_at DESC`);
const findDonation = (ref) =>
  db.oneOrNone(
    `SELECT d.*, x.title AS disaster_title FROM donations d JOIN disasters x ON x.id = d.disaster_id WHERE d.reference = $1`,
    [String(ref).toUpperCase()]
  );
const maskEmail = (e) => e.replace(/^(.).*(@.*)$/, '$1***$2');

async function renderForm(res, status, form, errors) {
  const disasters = await activeDisasters();
  res.status(status).render('donate', { title: 'Donate', disasters, form, errors, minDonation: MIN_DONATION, methods: paymentMethods() });
}

// Moves a verified donation to its next step (bank details, payment page, or pledge confirmation)
async function proceed(req, res, donation, disaster) {
  try {
    const { redirect } = await donations.activate(donation, disaster);
    return res.redirect(redirect);
  } catch (err) {
    console.error('Could not continue donation:', err.message);
    await payment.failDonation(donation.reference, 'Could not start the payment session.');
    req.flash('error', 'We could not start the payment. Nothing was charged. Please try again.');
    return res.redirect(`/donate?disaster=${donation.disaster_id}`);
  }
}

router.get('/donate', async (req, res) => {
  const form = {
    disaster_id: req.query.disaster || '',
    donation_type: DONATION_TYPES.includes(req.query.type) ? req.query.type : 'money',
    payment_method: paymentMethods()[0],
    donor_name: req.user ? req.user.name : '',
    donor_email: req.user ? req.user.email : ''
  };
  await renderForm(res, 200, form, []);
});

router.post('/donate', formLimiter, async (req, res) => {
  const b = req.body;
  const methods = paymentMethods();
  const form = {
    disaster_id: clean(b.disaster_id, 10),
    donation_type: clean(b.donation_type, 10),
    payment_method: methods.includes(b.payment_method) ? b.payment_method : methods[0],
    donor_name: clean(b.donor_name, 120),
    donor_email: clean(b.donor_email).toLowerCase(),
    donor_phone: clean(b.donor_phone, 40),
    is_anonymous: b.is_anonymous === 'on',
    message: clean(b.message, 1000),
    amount: clean(b.amount, 20),
    item_description: clean(b.item_description, 1000),
    quantity: clean(b.quantity, 10),
    skills: clean(b.skills, 1000),
    team_size: clean(b.team_size, 10),
    availability: clean(b.availability, 500)
  };
  const errors = [];

  const disasterId = Number(form.disaster_id);
  const disaster = Number.isInteger(disasterId)
    ? await db.oneOrNone(`SELECT * FROM disasters WHERE id = $1 AND status = 'active'`, [disasterId])
    : null;
  if (!disaster) errors.push('Please choose an active disaster to support.');
  if (!DONATION_TYPES.includes(form.donation_type)) errors.push('Please choose how you want to help.');
  if (!form.donor_name) errors.push('Please enter your name.');
  if (!isEmail(form.donor_email)) errors.push('Please enter a valid email address.');

  let amount = null, quantity = null, teamSize = null;
  if (form.donation_type === 'money') {
    amount = Math.round(parseFloat(form.amount) * 100) / 100;
    if (!Number.isFinite(amount) || amount < MIN_DONATION) errors.push(`The minimum donation is ${CURRENCY} ${MIN_DONATION}.`);
    else if (amount > MAX_DONATION) errors.push('That amount is too large for an online donation. Please contact us.');
    if (form.payment_method === 'bank' && !bankConfigured(await getSettings())) {
      errors.push('Bank transfer is not available yet. Please try again later or contact us.');
    }
  } else if (form.donation_type === 'medical') {
    quantity = parseInt(form.quantity, 10);
    if (!form.item_description) errors.push('Please describe the medical supplies or support you are offering.');
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 1000000) errors.push('Please enter a valid quantity.');
  } else if (form.donation_type === 'rescue') {
    teamSize = parseInt(form.team_size, 10);
    if (!form.skills) errors.push('Please describe the skills or equipment your team offers.');
    if (!Number.isInteger(teamSize) || teamSize < 1 || teamSize > 1000) errors.push('Please enter a team size between 1 and 1000.');
    if (!form.availability) errors.push('Please tell us when your team is available.');
    if (!form.donor_phone) errors.push('A phone number is required so coordinators can reach your team.');
  }
  if (errors.length) return renderForm(res, 400, form, errors);

  const isMoney = form.donation_type === 'money';
  const reference = newReference();
  const donation = await db.one(
    `INSERT INTO donations
       (reference, user_id, disaster_id, donation_type, donor_name, donor_email, donor_phone, is_anonymous, message,
        amount, currency, payment_provider, item_description, quantity, skills, team_size, availability, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'unverified')
     RETURNING *`,
    [
      reference, req.user ? req.user.id : null, disaster.id, form.donation_type, form.donor_name, form.donor_email,
      form.donor_phone || null, form.is_anonymous, form.message || null,
      amount, isMoney ? CURRENCY : null,
      isMoney ? (form.payment_method === 'bank' ? 'bank' : payment.provider) : null,
      form.item_description || null, quantity, form.skills || null, teamSize, form.availability || null
    ]
  );
  await db.none('INSERT INTO donation_updates (donation_id, status, note) VALUES ($1, $2, $3)', [
    donation.id, 'unverified', 'Donation started. Waiting for the donor to confirm their email with a code.'
  ]);

  // A logged-in donor whose email is already verified can skip the code
  if (req.user && req.user.email_verified && req.user.email === form.donor_email) {
    return proceed(req, res, donation, disaster);
  }
  const r = await otp.issue('donation', reference);
  if (r.code) await emails.sendOtp(donation.donor_email, donation.donor_name, r.code, 'confirm your donation');
  res.redirect(`/donations/${reference}/verify`);
});

// ---------- Email code for a donation ----------
router.get('/donations/:ref/verify', async (req, res, next) => {
  const d = await findDonation(req.params.ref);
  if (!d) return next();
  if (d.status !== 'unverified') return res.redirect(`/donations/${d.reference}`);
  res.render('donation-verify', { title: 'Confirm your email', d, errors: [], maskedEmail: maskEmail(d.donor_email) });
});

router.post('/donations/:ref/verify', authLimiter, async (req, res, next) => {
  const d = await findDonation(req.params.ref);
  if (!d) return next();
  if (d.status !== 'unverified') return res.redirect(`/donations/${d.reference}`);
  const r = await otp.verify('donation', d.reference, req.body.code);
  if (!r.ok) {
    return res.status(400).render('donation-verify', { title: 'Confirm your email', d, errors: [otp.message(r)], maskedEmail: maskEmail(d.donor_email) });
  }
  const disaster = await db.one('SELECT * FROM disasters WHERE id = $1', [d.disaster_id]);
  await proceed(req, res, d, disaster);
});

router.post('/donations/:ref/resend-otp', authLimiter, async (req, res, next) => {
  const d = await findDonation(req.params.ref);
  if (!d) return next();
  if (d.status !== 'unverified') return res.redirect(`/donations/${d.reference}`);
  const r = await otp.issue('donation', d.reference);
  if (r.tooSoon) {
    req.flash('info', 'Please wait a minute before asking for another code.');
  } else {
    await emails.sendOtp(d.donor_email, d.donor_name, r.code, 'confirm your donation');
    req.flash('success', 'A new code was sent to your email.');
  }
  res.redirect(`/donations/${d.reference}/verify`);
});

// ---------- Bank transfer ----------
async function bankDonation(req) {
  const d = await findDonation(req.params.ref);
  return d && d.donation_type === 'money' && d.payment_provider === 'bank' ? d : null;
}

router.get('/donations/:ref/pay-bank', async (req, res, next) => {
  const d = await bankDonation(req);
  if (!d) return next();
  if (d.status === 'unverified') return res.redirect(`/donations/${d.reference}/verify`);
  if (!['pending', 'verifying'].includes(d.status)) return res.redirect(`/donations/${d.reference}`);
  res.render('pay-bank', { title: 'Bank transfer', d, bank: await getSettings(), errors: [], form: {} });
});

router.post('/donations/:ref/pay-bank', formLimiter, async (req, res, next) => {
  const d = await bankDonation(req);
  if (!d) return next();
  if (d.status !== 'pending') return res.redirect(`/donations/${d.reference}`);

  const form = { transfer_reference: clean(req.body.transfer_reference, 80), transfer_date: clean(req.body.transfer_date, 10) };
  const errors = [];
  if (form.transfer_reference.length < 4) errors.push('Please enter the transaction or journal number from your bank.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.transfer_date) || form.transfer_date > new Date().toISOString().slice(0, 10)) {
    errors.push('Please enter the date you made the transfer (not in the future).');
  }
  if (!errors.length) {
    try {
      await db.none(`UPDATE donations SET status = 'verifying', transfer_reference = $1, transfer_date = $2 WHERE id = $3 AND status = 'pending'`, [
        form.transfer_reference, form.transfer_date, d.id
      ]);
      await db.none('INSERT INTO donation_updates (donation_id, status, note) VALUES ($1, $2, $3)', [
        d.id, 'verifying', 'Transfer details received. Our team is checking them against the bank statement.'
      ]);
      req.flash('success', 'Thank you. We are checking your transfer and will email you once it is confirmed.');
      return res.redirect(`/donations/${d.reference}`);
    } catch (err) {
      if (err.code !== '23505') throw err;
      errors.push('That transfer reference has already been used on another donation. Please check it.');
    }
  }
  res.status(400).render('pay-bank', { title: 'Bank transfer', d, bank: await getSettings(), errors, form });
});

// ---------- Built-in sandbox checkout (testing only) ----------
function sandboxOnly(req, res, next) {
  if (!payment.isSandbox()) return next('route');
  next();
}

router.get('/pay/sandbox/:ref', sandboxOnly, async (req, res, next) => {
  const d = await db.oneOrNone(
    `SELECT d.*, x.title AS disaster_title FROM donations d JOIN disasters x ON x.id = d.disaster_id
      WHERE d.reference = $1 AND d.donation_type = 'money' AND d.status = 'pending'`,
    [req.params.ref]
  );
  if (!d) return next();
  res.render('sandbox-pay', { title: 'Test payment', d });
});

router.post('/pay/sandbox/:ref', sandboxOnly, async (req, res, next) => {
  const ref = req.params.ref;
  if (req.body.outcome === 'success') {
    const done = await payment.completeDonation(ref, 'sandbox_' + Date.now());
    if (!done) return next();
  } else {
    await payment.failDonation(ref, 'Test payment was cancelled or declined.');
  }
  res.redirect(`/donations/${ref}/success`);
});

// ---------- Tracing ----------
router.get('/track', (req, res) => res.render('track', { title: 'Track a donation' }));

router.post('/track', async (req, res) => {
  const ref = clean(req.body.reference, 40).toUpperCase();
  const found = ref ? await db.oneOrNone('SELECT reference FROM donations WHERE reference = $1', [ref]) : null;
  if (!found) {
    req.flash('error', 'We could not find a donation with that reference. Check the code in your confirmation email.');
    return res.redirect('/track');
  }
  res.redirect(`/donations/${found.reference}`);
});

async function showDonation(req, res, next, justDonated) {
  const d = await findDonation(req.params.ref);
  if (!d) return next();
  const timeline = await db.any('SELECT * FROM donation_updates WHERE donation_id = $1 ORDER BY created_at ASC, id ASC', [d.id]);
  res.render('donation', { title: `Donation ${d.reference}`, d, timeline, justDonated });
}
router.get('/donations/:ref/success', (req, res, next) => showDonation(req, res, next, true));
router.get('/donations/:ref', (req, res, next) => showDonation(req, res, next, false));

module.exports = router;