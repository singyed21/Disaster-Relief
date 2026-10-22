const multer = require('multer');
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { getSettings, saveSettings } = require('../services/settings');
const router = require('express').Router();
const db = require('../config/db');
const emails = require('../services/emails');
const q = require('../services/queries');
const { requireAdmin, audit } = require('../middleware/auth');
const {
  clean, csvCell, DONATION_TYPES, STATUS_FLOW, adminAllowedStatuses, statusLabel, typeLabel
} = require('../utils/helpers');

router.use('/admin', requireAdmin);

const PAGE_SIZE = 50;
const DISASTER_TYPES = ['flood', 'earthquake', 'landslide', 'fire', 'storm', 'drought', 'other'];
const SEVERITIES = ['low', 'medium', 'high', 'critical'];
const toId = (v) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };

const validUrl = (u) => !u || /^https?:\/\/\S+$/i.test(u) || /^\/uploads\/[a-f0-9]+\.(jpg|png|webp)$/.test(u);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });

function uploadImage(req, res, next) {
  upload.single('image')(req, res, (err) => {
    if (err) req.uploadError = err.code === 'LIMIT_FILE_SIZE' ? 'The photo must be 5 MB or smaller.' : 'The photo could not be uploaded.';
    next();
  });
}

// Check the real file contents, not just the file name
function imageType(buf) {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return 'webp';
  return null;
}

async function saveUpload(file) {
  const ext = imageType(file.buffer);
  if (!ext) return null;
  const dir = path.join(__dirname, '..', 'public', 'uploads');
  await fs.mkdir(dir, { recursive: true });
  const name = crypto.randomBytes(12).toString('hex') + '.' + ext;
  await fs.writeFile(path.join(dir, name), file.buffer);
  return '/uploads/' + name;
}

// ---------- Overview ----------
router.get('/admin', async (req, res) => {
  const [stats, pendingActions, recent, unread, verifying, auditLog] = await Promise.all([
    q.globalStats(),
    db.any(
      `SELECT d.id, d.reference, d.donation_type, d.status, d.donor_name, d.created_at, x.title AS disaster_title
         FROM donations d JOIN disasters x ON x.id = d.disaster_id
        WHERE (d.donation_type IN ('medical','rescue') AND d.status IN ('pledged','received','dispatched'))
           OR (d.donation_type = 'money' AND d.status = 'verifying')
        ORDER BY d.created_at ASC LIMIT 15`
    ),
    db.any(
      `SELECT d.id, d.reference, d.donation_type, d.amount, d.currency, d.status, d.donor_name, d.created_at
         FROM donations d WHERE d.status <> 'unverified' ORDER BY d.created_at DESC LIMIT 8`
    ),
    db.one('SELECT COUNT(*) AS n FROM contact_messages WHERE is_read = FALSE'),
    db.one(`SELECT COUNT(*) AS n FROM donations WHERE donation_type = 'money' AND status = 'verifying'`),
    db.any(`SELECT a.*, u.name AS admin_name FROM audit_log a LEFT JOIN users u ON u.id = a.user_id ORDER BY a.created_at DESC LIMIT 10`)
  ]);
  res.render('admin/dashboard', { title: 'Admin', stats, pendingActions, recent, unread: unread.n, verifying: verifying.n, auditLog });
});

// ---------- Disasters ----------
router.get('/admin/disasters', async (req, res) => {
  const disasters = await db.any(`${q.DISASTER_STATS} ORDER BY d.status ASC, d.created_at DESC`);
  res.render('admin/disasters', { title: 'Manage disasters', disasters });
});

const blankDisaster = { title: '', disaster_type: 'flood', location: '', description: '', severity: 'medium', status: 'active', image_url: '', image_credit: '', needs_medical: '', needs_rescue: '', started_on: new Date() };

router.get('/admin/disasters/new', (req, res) =>
  res.render('admin/disaster-form', { title: 'New disaster', d: blankDisaster, isNew: true, errors: [], updates: [], DISASTER_TYPES, SEVERITIES })
);

function parseDisaster(b) {
  const d = {
    title: clean(b.title, 200),
    disaster_type: clean(b.disaster_type, 30),
    location: clean(b.location, 200),
    description: clean(b.description, 10000),
    severity: clean(b.severity, 10),
    status: clean(b.status, 10),
    image_url: clean(b.image_url, 500),
    image_credit: clean(b.image_credit, 200),
    needs_medical: clean(b.needs_medical, 2000),
    needs_rescue: clean(b.needs_rescue, 2000),
    started_on: clean(b.started_on, 10)
  };
  const errors = [];
  if (!d.title) errors.push('Title is required.');
  if (!d.location) errors.push('Location is required.');
  if (!d.description) errors.push('Description is required.');
  if (!DISASTER_TYPES.includes(d.disaster_type)) errors.push('Invalid disaster type.');
  if (!SEVERITIES.includes(d.severity)) errors.push('Invalid severity.');
  if (!['active', 'closed'].includes(d.status)) errors.push('Invalid status.');
  if (!validUrl(d.image_url)) errors.push('Image address must start with http:// or https://');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.started_on)) errors.push('Start date is required.');
  return { d, errors };
}

// Handles the optional uploaded photo; adds to errors or sets d.image_url
async function applyUpload(req, d, errors) {
  if (req.uploadError) errors.push(req.uploadError);
  if (req.file && !errors.length) {
    const url = await saveUpload(req.file);
    if (url) d.image_url = url;
    else errors.push('Only JPG, PNG or WebP photos are allowed.');
  }
}

router.post('/admin/disasters', uploadImage, async (req, res) => {
  const { d, errors } = parseDisaster(req.body);
  await applyUpload(req, d, errors);
  if (errors.length) return res.status(400).render('admin/disaster-form', { title: 'New disaster', d, isNew: true, errors, updates: [], DISASTER_TYPES, SEVERITIES });
  const row = await db.one(
    `INSERT INTO disasters (title, disaster_type, location, description, severity, status, image_url, image_credit, needs_medical, needs_rescue, started_on) 
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
    [d.title, d.disaster_type, d.location, d.description, d.severity, d.status, d.image_url || null, d.image_credit || null, d.needs_medical || null, d.needs_rescue || null, d.started_on]
  );
  await audit(req, 'disaster.create', `#${row.id} ${d.title}`);
  req.flash('success', 'Disaster campaign created.');
  res.redirect(`/admin/disasters/${row.id}/edit`);
});

router.get('/admin/disasters/:id/edit', async (req, res, next) => {
  const id = toId(req.params.id);
  const d = id && (await db.oneOrNone('SELECT * FROM disasters WHERE id = $1', [id]));
  if (!d) return next();
  const updates = await db.any('SELECT * FROM disaster_updates WHERE disaster_id = $1 ORDER BY created_at DESC', [id]);
  res.render('admin/disaster-form', { title: 'Edit disaster', d, isNew: false, errors: [], updates, DISASTER_TYPES, SEVERITIES });
});

router.post('/admin/disasters/:id', uploadImage, async (req, res, next) => {
  const id = toId(req.params.id);
  if (!id || !(await db.oneOrNone('SELECT 1 FROM disasters WHERE id = $1', [id]))) return next();
  const { d, errors } = parseDisaster(req.body);
  await applyUpload(req, d, errors);
  if (errors.length) {
    const updates = await db.any('SELECT * FROM disaster_updates WHERE disaster_id = $1 ORDER BY created_at DESC', [id]);
    return res.status(400).render('admin/disaster-form', { title: 'Edit disaster', d: { ...d, id }, isNew: false, errors, updates, DISASTER_TYPES, SEVERITIES });
  }
  await db.none(
    `UPDATE disasters SET title=$1, disaster_type=$2, location=$3, description=$4, severity=$5, status=$6, 
            image_url=$7, image_credit=$8, needs_medical=$9, needs_rescue=$10, started_on=$11 WHERE id=$12`,
    [d.title, d.disaster_type, d.location, d.description, d.severity, d.status, d.image_url || null, d.image_credit || null, d.needs_medical || null, d.needs_rescue || null, d.started_on, id]
  );
  await audit(req, 'disaster.update', `#${id} ${d.title}`);
  req.flash('success', 'Disaster updated.');
  res.redirect(`/admin/disasters/${id}/edit`);
});

router.post('/admin/disasters/:id/updates', async (req, res, next) => {
  const id = toId(req.params.id);
  if (!id || !(await db.oneOrNone('SELECT 1 FROM disasters WHERE id = $1', [id]))) return next();
  const title = clean(req.body.title, 200);
  const body = clean(req.body.body, 5000);
  if (!title || !body) {
    req.flash('error', 'Both a title and details are required for a situation update.');
  } else {
    await db.none('INSERT INTO disaster_updates (disaster_id, title, body) VALUES ($1, $2, $3)', [id, title, body]);
    await audit(req, 'disaster.update_post', `#${id} ${title}`);
    req.flash('success', 'Situation update published.');
  }
  res.redirect(`/admin/disasters/${id}/edit`);
});

router.post('/admin/disasters/:id/delete', async (req, res, next) => {
  const id = toId(req.params.id);
  if (!id) return next();
  const { n } = await db.one('SELECT COUNT(*) AS n FROM donations WHERE disaster_id = $1', [id]);
  if (n > 0) {
    req.flash('error', 'This campaign has donations and cannot be deleted. Set its status to Closed instead.');
    return res.redirect('/admin/disasters');
  }
  await db.none('DELETE FROM disasters WHERE id = $1', [id]);
  await audit(req, 'disaster.delete', `#${id}`);
  req.flash('success', 'Disaster campaign deleted.');
  res.redirect('/admin/disasters');
});

// ---------- Donations ----------
function donationFilters(query) {
  const where = [];
  const params = [];
  const f = { type: clean(query.type, 10), status: clean(query.status, 12), disaster: toId(query.disaster), q: clean(query.q, 100) };
  if (DONATION_TYPES.includes(f.type)) { params.push(f.type); where.push(`d.donation_type = $${params.length}`); } else f.type = '';
  if (f.status) { params.push(f.status); where.push(`d.status = $${params.length}`); }
  if (f.disaster) { params.push(f.disaster); where.push(`d.disaster_id = $${params.length}`); }
  if (f.q) {
    params.push(`%${f.q}%`);
    where.push(`(d.reference ILIKE $${params.length} OR d.donor_name ILIKE $${params.length} OR d.donor_email ILIKE $${params.length})`);
  }
  return { f, params, clause: where.length ? 'WHERE ' + where.join(' AND ') : '' };
}

router.get('/admin/donations', async (req, res) => {
  const { f, params, clause } = donationFilters(req.query);
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const [{ n }, rows, disasters] = await Promise.all([
    db.one(`SELECT COUNT(*) AS n FROM donations d ${clause}`, params),
    db.any(
      `SELECT d.*, x.title AS disaster_title FROM donations d JOIN disasters x ON x.id = d.disaster_id
         ${clause} ORDER BY d.created_at DESC LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}`,
      params
    ),
    db.any('SELECT id, title FROM disasters ORDER BY title')
  ]);
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
  res.render('admin/donations', {
    title: 'Donations', donations: rows, disasters, f, page, pages: Math.max(1, Math.ceil(n / PAGE_SIZE)), total: n, qs,
    allStatuses: [...new Set(Object.values(STATUS_FLOW).flat())]
  });
});

router.get('/admin/donations.csv', async (req, res) => {
  const { params, clause } = donationFilters(req.query);
  const rows = await db.any(
    `SELECT d.*, x.title AS disaster_title FROM donations d JOIN disasters x ON x.id = d.disaster_id ${clause} ORDER BY d.created_at DESC`,
    params
  );
  const header = ['Reference', 'Date', 'Disaster', 'Type', 'Status', 'Donor', 'Email', 'Phone', 'Anonymous', 'Amount', 'Currency', 'Provider', 'Item / skills', 'Quantity / team size', 'Message'];
  const lines = [header.map(csvCell).join(',')];
  for (const r of rows) {
    lines.push([
      r.reference, new Date(r.created_at).toISOString(), r.disaster_title, typeLabel(r.donation_type), statusLabel(r.donation_type, r.status),
      r.donor_name, r.donor_email, r.donor_phone, r.is_anonymous ? 'yes' : 'no', r.amount, r.currency, r.payment_provider,
      r.item_description || r.skills, r.quantity || r.team_size, r.message
    ].map(csvCell).join(','));
  }
  await audit(req, 'donations.export', `${rows.length} rows`);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="donations.csv"');
  res.send('\ufeff' + lines.join('\r\n'));
});

router.get('/admin/donations/:id', async (req, res, next) => {
  const id = toId(req.params.id);
  const d = id && (await db.oneOrNone(
    `SELECT d.*, x.title AS disaster_title FROM donations d JOIN disasters x ON x.id = d.disaster_id WHERE d.id = $1`, [id]
  ));
  if (!d) return next();
  const timeline = await db.any(
    `SELECT u.*, a.name AS admin_name FROM donation_updates u LEFT JOIN users a ON a.id = u.created_by
      WHERE u.donation_id = $1 ORDER BY u.created_at ASC, u.id ASC`, [id]
  );
  res.render('admin/donation', { title: `Donation ${d.reference}`, d, timeline, allowed: adminAllowedStatuses(d.donation_type, d.status, d.payment_provider) });
});

router.post('/admin/donations/:id/status', async (req, res, next) => {
  const id = toId(req.params.id);
  const d = id && (await db.oneOrNone('SELECT * FROM donations WHERE id = $1', [id]));
  if (!d) return next();
  const status = clean(req.body.status, 12);
  const note = clean(req.body.note, 1000);
  const redirect = `/admin/donations/${id}`;
  if (status) {
    if (!adminAllowedStatuses(d.donation_type, d.status, d.payment_provider).includes(status)) {
      req.flash('error', 'That status change is not allowed for this donation.');
      return res.redirect(redirect);
    }
    if (status === 'completed' && !note) {
      req.flash('error', 'To confirm a bank transfer, write the bank statement date or line number in the note (never the full account number).');
      return res.redirect(redirect);
    }
    const sets = ['delivered', 'completed'].includes(status)
      ? `UPDATE donations SET status = $1, completed_at = NOW() WHERE id = $2 RETURNING *`
      : `UPDATE donations SET status = $1 WHERE id = $2 RETURNING *`;
    const updated = await db.one(sets, [status, id]);
    await db.none('INSERT INTO donation_updates (donation_id, status, note, created_by) VALUES ($1,$2,$3,$4)', [
      id, status, note || statusLabel(d.donation_type, status), req.user.id
    ]);
    await audit(req, 'donation.status', `${d.reference}: ${d.status} -> ${status}`);
    const disaster = await db.one('SELECT * FROM disasters WHERE id = $1', [d.disaster_id]);
    if (status === 'completed') emails.sendDonationReceipt(updated, disaster).catch(() => {});
    else emails.sendStatusUpdate(updated, disaster, note).catch(() => {});
    req.flash('success', 'Status updated and the donor was notified by email.');
  } else if (note) {
    await db.none('INSERT INTO donation_updates (donation_id, status, note, created_by) VALUES ($1,$2,$3,$4)', [id, d.status, note, req.user.id]);
    await audit(req, 'donation.note', d.reference);
    req.flash('success', 'Note added to the public timeline.');
  }
  res.redirect(redirect);
});

// ---------- Fund allocations (how money was spent) ----------
router.get('/admin/allocations', async (req, res) => {
  const [allocations, disasters] = await Promise.all([
    db.any(`SELECT a.*, x.title AS disaster_title FROM fund_allocations a JOIN disasters x ON x.id = a.disaster_id ORDER BY a.spent_on DESC, a.id DESC`),
    db.any(`${q.DISASTER_STATS} ORDER BY d.title`)
  ]);
  res.render('admin/allocations', { title: 'Fund allocations', allocations, disasters });
});

router.post('/admin/allocations', async (req, res) => {
  const disasterId = toId(req.body.disaster_id);
  const title = clean(req.body.title, 200);
  const description = clean(req.body.description, 2000);
  const amount = Math.round(parseFloat(req.body.amount) * 100) / 100;
  const spentOn = clean(req.body.spent_on, 10);
  if (!disasterId || !title || !Number.isFinite(amount) || amount <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(spentOn)) {
    req.flash('error', 'Please choose a disaster and enter a title, a positive amount and a date.');
    return res.redirect('/admin/allocations');
  }
  const stats = await db.oneOrNone(`${q.DISASTER_STATS} WHERE d.id = $1`, [disasterId]);
  if (!stats) {
    req.flash('error', 'Unknown disaster.');
    return res.redirect('/admin/allocations');
  }
  if (stats.allocated + amount > stats.raised) {
    req.flash('error', 'This would record more spending than the money actually received for this disaster.');
    return res.redirect('/admin/allocations');
  }
  await db.none('INSERT INTO fund_allocations (disaster_id, title, description, amount, spent_on, created_by) VALUES ($1,$2,$3,$4,$5,$6)', [
    disasterId, title, description || null, amount, spentOn, req.user.id
  ]);
  await audit(req, 'allocation.create', `${title} (${amount}) for disaster #${disasterId}`);
  req.flash('success', 'Allocation recorded and published on the transparency dashboard.');
  res.redirect('/admin/allocations');
});

router.post('/admin/allocations/:id/delete', async (req, res, next) => {
  const id = toId(req.params.id);
  if (!id) return next();
  await db.none('DELETE FROM fund_allocations WHERE id = $1', [id]);
  await audit(req, 'allocation.delete', `#${id}`);
  req.flash('success', 'Allocation removed.');
  res.redirect('/admin/allocations');
});

// ---------- Users ----------
router.get('/admin/users', async (req, res) => {
  const users = await db.any(
    `SELECT u.id, u.name, u.email, u.role, u.email_verified, u.created_at,
            (SELECT COUNT(*) FROM donations d WHERE d.user_id = u.id) AS donation_count
       FROM users u ORDER BY u.created_at DESC`
  );
  res.render('admin/users', { title: 'Users', users });
});

router.post('/admin/users/:id/role', async (req, res, next) => {
  const id = toId(req.params.id);
  if (!id) return next();
  if (id === req.user.id) {
    req.flash('error', 'You cannot change your own role.');
    return res.redirect('/admin/users');
  }
  const role = req.body.role === 'admin' ? 'admin' : 'donor';
  await db.none('UPDATE users SET role = $1 WHERE id = $2', [role, id]);
  await audit(req, 'user.role', `#${id} -> ${role}`);
  req.flash('success', 'Role updated.');
  res.redirect('/admin/users');
});

// ---------- Contact messages ----------
router.get('/admin/messages', async (req, res) => {
  const messages = await db.any('SELECT * FROM contact_messages ORDER BY is_read ASC, created_at DESC LIMIT 200');
  res.render('admin/messages', { title: 'Messages', messages });
});

router.post('/admin/messages/:id/read', async (req, res, next) => {
  const id = toId(req.params.id);
  if (!id) return next();
  await db.none('UPDATE contact_messages SET is_read = TRUE WHERE id = $1', [id]);
  res.redirect('/admin/messages');
});

// ---------- Settings: bank account shown to donors ----------
router.get('/admin/settings', async (req, res) => {
  res.render('admin/settings', { title: 'Settings', s: await getSettings(), errors: [] });
});

router.post('/admin/settings', async (req, res) => {
  const s = {
    bank_name: clean(req.body.bank_name, 100),
    bank_account_name: clean(req.body.bank_account_name, 120),
    bank_account_number: clean(req.body.bank_account_number, 40),
    bank_branch: clean(req.body.bank_branch, 100),
    bank_instructions: clean(req.body.bank_instructions, 1000)
  };
  const errors = [];
  if (!s.bank_name || !s.bank_account_name || !s.bank_account_number) errors.push('Bank name, account name and account number are required.');
  if (s.bank_account_number && !/^[0-9A-Za-z \-\/]{4,40}$/.test(s.bank_account_number)) errors.push('The account number may only contain letters, numbers, spaces, / and -.');
  if (errors.length) return res.status(400).render('admin/settings', { title: 'Settings', s, errors });
  await saveSettings(s);
  await audit(req, 'settings.bank', `Bank details set to ${s.bank_name}, ${s.bank_account_name}, account ending ${s.bank_account_number.slice(-4)}`);
  req.flash('success', 'Bank details saved. Donors will now see them.');
  res.redirect('/admin/settings');
});

module.exports = router;