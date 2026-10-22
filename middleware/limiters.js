const { rateLimit } = require('express-rate-limit');

const handler = (req, res) =>
  res.status(429).render('error', {
    title: 'Too many requests',
    status: 429,
    message: 'Too many attempts. Please wait a few minutes and try again.'
  });

// Login, register, password reset
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false, handler });
// Donation + contact forms
const formLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 40, standardHeaders: true, legacyHeaders: false, handler });

module.exports = { authLimiter, formLimiter };
