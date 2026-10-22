const crypto = require('crypto');
const db = require('../config/db');
const { randomToken } = require('../utils/helpers');

function flash(req, res, next) {
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;
  req.flash = (type, msg) => { req.session.flash = { type, msg }; };
  next();
}

async function loadUser(req, res, next) {
  res.locals.user = null;
  if (req.session.userId) {
    const u = await db.oneOrNone(
      'SELECT id, name, email, role, email_verified FROM users WHERE id = $1',
      [req.session.userId]
    );
    if (u) {
      req.user = u;
      res.locals.user = u;
    } else {
      delete req.session.userId;
    }
  }
  next();
}

// Synchroniser-token CSRF protection for every state-changing request
function csrf(req, res, next) {
  if (!req.session.csrf) req.session.csrf = randomToken();
  res.locals.csrfToken = req.session.csrf;
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    const sent = String((req.body && req.body._csrf) || req.query._csrf || '');
    const real = req.session.csrf;
    const ok = sent.length === real.length && crypto.timingSafeEqual(Buffer.from(sent), Buffer.from(real));
    if (!ok) {
      return res.status(403).render('error', {
        title: 'Session expired',
        status: 403,
        message: 'Your form session expired. Please go back, refresh the page and try again.'
      });
    }
  }
  next();
}

function requireLogin(req, res, next) {
  if (!req.user) {
    req.flash('info', 'Please log in to continue.');
    return res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user) return requireLogin(req, res, next);
  if (req.user.role !== 'admin') {
    return res.status(403).render('error', {
      title: 'Forbidden',
      status: 403,
      message: 'You do not have access to this page.'
    });
  }
  next();
}

function guestOnly(req, res, next) {
  if (req.user) return res.redirect('/account');
  next();
}

async function audit(req, action, details) {
  try {
    await db.none('INSERT INTO audit_log (user_id, action, details) VALUES ($1, $2, $3)', [
      req.user ? req.user.id : null, action, details || null
    ]);
  } catch (e) {
    console.error('audit log failed:', e.message);
  }
}

module.exports = { flash, loadUser, csrf, requireLogin, requireAdmin, guestOnly, audit };