const router = require('express').Router();
const db = require('../config/db');
const q = require('../services/queries');
const { formLimiter } = require('../middleware/limiters');
const { clean, isEmail } = require('../utils/helpers');

router.get('/', async (req, res) => {
  const [disasters, stats] = await Promise.all([
    db.any(`${q.DISASTER_STATS} WHERE d.status = 'active' ORDER BY ${q.SEVERITY_ORDER}, d.created_at DESC LIMIT 6`),
    q.globalStats()
  ]);
  res.render('index', { title: 'Home', disasters, stats });
});

router.get('/disasters', async (req, res) => {
  const status = ['active', 'closed', 'all'].includes(req.query.status) ? req.query.status : 'active';
  const type = clean(req.query.type, 30);
  const search = clean(req.query.q, 100);

  const where = [];
  const params = [];
  if (status !== 'all') { params.push(status); where.push(`d.status = $${params.length}`); }
  if (type) { params.push(type); where.push(`d.disaster_type = $${params.length}`); }
  if (search) { params.push(`%${search}%`); where.push(`(d.title ILIKE $${params.length} OR d.location ILIKE $${params.length})`); }

  const disasters = await db.any(
    `${q.DISASTER_STATS} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${q.SEVERITY_ORDER}, d.created_at DESC`,
    params
  );
  res.render('disasters', { title: 'Disasters', disasters, filters: { status, type, q: search } });
});

router.get('/disasters/:id', async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return next();
  const d = await db.oneOrNone(`${q.DISASTER_STATS} WHERE d.id = $1`, [id]);
  if (!d) return next();

  const [updates, allocations, recent] = await Promise.all([
    db.any('SELECT * FROM disaster_updates WHERE disaster_id = $1 ORDER BY created_at DESC LIMIT 20', [id]),
    db.any('SELECT * FROM fund_allocations WHERE disaster_id = $1 ORDER BY spent_on DESC, id DESC LIMIT 20', [id]),
    db.any(
      `SELECT donation_type, amount, currency, status, created_at,
             CASE WHEN is_anonymous THEN 'Anonymous' ELSE donor_name END AS donor
        FROM donations
       WHERE disaster_id = $1 AND status NOT IN ('unverified','pending','verifying','failed','cancelled')
       ORDER BY created_at DESC LIMIT 8`,
      [id]
    )
  ]);
  res.render('disaster', { title: d.title, d, updates, allocations, recent });
});

router.get('/about', (req, res) => res.render('about', { title: 'About' }));

router.get('/contact', (req, res) => res.render('contact', { title: 'Contact', form: {}, errors: [] }));

router.post('/contact', formLimiter, async (req, res) => {
  const form = {
    name: clean(req.body.name, 120),
    email: clean(req.body.email).toLowerCase(),
    subject: clean(req.body.subject, 200),
    message: clean(req.body.message, 4000)
  };
  const errors = [];
  if (!form.name) errors.push('Please enter your name.');
  if (!isEmail(form.email)) errors.push('Please enter a valid email address.');
  if (!form.subject) errors.push('Please enter a subject.');
  if (form.message.length < 10) errors.push('Please write a message of at least 10 characters.');
  if (errors.length) return res.status(400).render('contact', { title: 'Contact', form, errors });

  await db.none('INSERT INTO contact_messages (name, email, subject, message) VALUES ($1, $2, $3, $4)', [
    form.name, form.email, form.subject, form.message
  ]);
  req.flash('success', 'Thank you. Your message was sent and our team will reply by email.');
  res.redirect('/contact');
});

module.exports = router;