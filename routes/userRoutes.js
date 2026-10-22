const router = require('express').Router();
const bcrypt = require('bcryptjs');
const db = require('../config/db');
const emails = require('../services/emails');
const otp = require('../services/otp');
const { authLimiter } = require('../middleware/limiters');
const { requireLogin, guestOnly } = require('../middleware/auth');
const { clean, isEmail, safeNext } = require('../utils/helpers');

async function sendRegisterOtp(user) {
  const r = await otp.issue('register', user.email);
  if (r.code) await emails.sendOtp(user.email, user.name, r.code, 'verify your email address');
  return r;
}

// ---------- Register ----------
router.get('/register', guestOnly, (req, res) => res.render('register', { title: 'Create account', form: {}, errors: [] }));

router.post('/register', guestOnly, authLimiter, async (req, res) => {
  const form = { name: clean(req.body.name, 120), email: clean(req.body.email).toLowerCase(), phone: clean(req.body.phone, 40) };
  const password = String(req.body.password || '');
  const errors = [];
  if (!form.name) errors.push('Please enter your name.');
  if (!isEmail(form.email)) errors.push('Please enter a valid email address.');
  if (password.length < 8) errors.push('Password must be at least 8 characters.');
  if (password.length > 72) errors.push('Password must be 72 characters or fewer.');
  if (password !== req.body.confirm) errors.push('Passwords do not match.');
  if (errors.length) return res.status(400).render('register', { title: 'Create account', form, errors });

  const existing = await db.oneOrNone('SELECT id, name, email, email_verified FROM users WHERE email = $1', [form.email]);
  if (existing) {
    // Never reveal whether an email is already registered
    if (!existing.email_verified) await sendRegisterOtp(existing);
  } else {
    const hash = await bcrypt.hash(password, 12);
    const user = await db.one(
      `INSERT INTO users (name, email, phone, password_hash) VALUES ($1, $2, $3, $4) RETURNING id, name, email`,
      [form.name, form.email, form.phone || null, hash]
    );
    await sendRegisterOtp(user);
  }
  res.redirect('/verify-email?email=' + encodeURIComponent(form.email));
});

router.get('/verify-email', guestOnly, (req, res) =>
  res.render('verify-email', { title: 'Verify your email', email: clean(req.query.email).toLowerCase(), errors: [] })
);

router.post('/verify-email', guestOnly, authLimiter, async (req, res) => {
  const email = clean(req.body.email).toLowerCase();
  const fail = (msg) => res.status(400).render('verify-email', { title: 'Verify your email', email, errors: [msg] });
  const user = isEmail(email) ? await db.oneOrNone('SELECT id, email_verified FROM users WHERE email = $1', [email]) : null;
  if (!user || user.email_verified) return fail('That code is not valid. Please request a new one.');
  const r = await otp.verify('register', email, req.body.code);
  if (!r.ok) return fail(otp.message(r));
  await db.none('UPDATE users SET email_verified = TRUE WHERE id = $1', [user.id]);
  req.flash('success', 'Email verified. You can now log in.');
  res.redirect('/login');
});

router.post('/resend-verification', authLimiter, async (req, res) => {
  const email = clean(req.body.email).toLowerCase();
  const user = isEmail(email)
    ? await db.oneOrNone('SELECT id, name, email, email_verified FROM users WHERE email = $1', [email])
    : null;
  if (user && !user.email_verified) await sendRegisterOtp(user);
  req.flash('success', 'If that account exists and is not yet verified, a new code has been sent.');
  res.redirect('/verify-email?email=' + encodeURIComponent(email));
});

// ---------- Login / logout ----------
router.get('/login', guestOnly, (req, res) =>
  res.render('login', { title: 'Log in', form: {}, errors: [], next: req.query.next || '', unverifiedEmail: null })
);

router.post('/login', guestOnly, authLimiter, async (req, res) => {
  const email = clean(req.body.email).toLowerCase();
  const next = req.body.next || '';
  const fail = (errors, unverifiedEmail = null) =>
    res.status(401).render('login', { title: 'Log in', form: { email }, errors, next, unverifiedEmail });

  const user = await db.oneOrNone('SELECT * FROM users WHERE email = $1', [email]);
  const ok = user && (await bcrypt.compare(String(req.body.password || ''), user.password_hash));
  if (!ok) return fail(['Incorrect email or password.']);
  if (!user.email_verified) return fail(['Please verify your email address before logging in.'], user.email);

  await new Promise((resolve, reject) => req.session.regenerate((e) => (e ? reject(e) : resolve())));
  req.session.userId = user.id;
  // Attach earlier guest donations made with this (now verified) email to the account
  await db.none('UPDATE donations SET user_id = $1 WHERE user_id IS NULL AND LOWER(donor_email) = $2', [user.id, user.email]);
  res.redirect(safeNext(next));
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('drp.sid');
    res.redirect('/');
  });
});

// ---------- Password reset ----------
router.get('/forgot', guestOnly, (req, res) => res.render('forgot', { title: 'Forgot password' }));

router.post('/forgot', guestOnly, authLimiter, async (req, res) => {
  const email = clean(req.body.email).toLowerCase();
  const user = isEmail(email) ? await db.oneOrNone('SELECT id, name, email FROM users WHERE email = $1', [email]) : null;
  if (user) {
    const token = crypto.randomBytes(32).toString('hex');
    await db.none('UPDATE users SET reset_token_hash = $1, reset_expires = $2 WHERE id = $3', [
      sha256(token), new Date(Date.now() + 60 * 60 * 1000), user.id
    ]);
    await emails.sendPasswordReset(user, token);
  }
  res.render('message', {
    title: 'Check your email',
    heading: 'Check your email',
    text: 'If an account exists for that address, we sent a password reset link. It is valid for 1 hour.'
  });
});

async function validResetUser(token) {
  return db.oneOrNone('SELECT id FROM users WHERE reset_token_hash = $1 AND reset_expires > NOW()', [sha256(token)]);
}

router.get('/reset/:token', async (req, res) => {
  if (!(await validResetUser(req.params.token))) {
    return res.status(400).render('message', { title: 'Link invalid', heading: 'This link is invalid or expired', text: 'Please request a new password reset link.' });
  }
  res.render('reset', { title: 'Choose a new password', token: req.params.token, errors: [] });
});

router.post('/reset/:token', authLimiter, async (req, res) => {
  const user = await validResetUser(req.params.token);
  if (!user) {
    return res.status(400).render('message', { title: 'Link invalid', heading: 'This link is invalid or expired', text: 'Please request a new password reset link.' });
  }
  const password = String(req.body.password || '');
  const errors = [];
  if (password.length < 8) errors.push('Password must be at least 8 characters.');
  if (password.length > 72) errors.push('Password must be 72 characters or fewer.');
  if (password !== req.body.confirm) errors.push('Passwords do not match.');
  if (errors.length) return res.status(400).render('reset', { title: 'Choose a new password', token: req.params.token, errors });

  await db.none(
    `UPDATE users SET password_hash = $1, reset_token_hash = NULL, reset_expires = NULL, email_verified = TRUE WHERE id = $2`,
    [await bcrypt.hash(password, 12), user.id]
  );
  req.flash('success', 'Password updated. Please log in.');
  res.redirect('/login');
});

// ---------- Donor account ----------
router.get('/account', requireLogin, async (req, res) => {
  const donations = await db.any(
    `SELECT d.*, x.title AS disaster_title
       FROM donations d JOIN disasters x ON x.id = d.disaster_id
      WHERE d.user_id = $1 ORDER BY d.created_at DESC`,
    [req.user.id]
  );
  const total = donations
    .filter((d) => d.donation_type === 'money' && d.status === 'completed')
    .reduce((sum, d) => sum + d.amount, 0);
  res.render('account', { title: 'My account', donations, total });
});

module.exports = router;