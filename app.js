require('dotenv').config();
const express = require('express');
const path = require('path');
const session = require('express-session');

const helpers = require('./utils/helpers');
const paymentService = require('./services/payment');
const { flash, loadUser, csrf } = require('./middleware/auth');

const donationRoutes = require('./routes/donationRoutes');
const userRoutes = require('./routes/userRoutes');
const adminRoutes = require('./routes/adminRoutes');
const disasterRoutes = require('./routes/disasterRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');

const app = express();
const isProd = process.env.NODE_ENV === 'production';

if (isProd) {
  app.set('trust proxy', 1);
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.startsWith('super_secret')) {
    console.error('Refusing to start: set a strong SESSION_SECRET in production.');
    process.exit(1);
  }
}

app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// Payment webhook needs the raw request body for signature verification,
// so it is mounted before the body parsers, session and CSRF middleware.
app.post('/webhooks/payment', express.raw({ type: '*/*' }), paymentService.webhookHandler);

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Safe defaults so error pages can always render
app.use((req, res, next) => {
  res.locals.user = null;
  res.locals.flash = null;
  res.locals.csrfToken = '';
  res.locals.title = 'Disaster Relief Portal';
  res.locals.currency = helpers.CURRENCY;
  res.locals.fmtMoney = helpers.fmtMoney;
  res.locals.fmtDate = helpers.fmtDate;
  res.locals.fmtDateTime = helpers.fmtDateTime;
  res.locals.statusLabel = helpers.statusLabel;
  res.locals.typeLabel = helpers.typeLabel;
  res.locals.paymentMode = paymentService.provider;
  next();
});

app.use(
  session({
    name: 'drp.sid',
    secret: process.env.SESSION_SECRET || 'dev-only-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', secure: isProd, maxAge: 7 * 24 * 60 * 60 * 1000 }
  })
);
app.use(flash);
app.use(loadUser);
app.use(csrf);

app.use('/', disasterRoutes);
app.use('/', donationRoutes);
app.use('/', userRoutes);
app.use('/', dashboardRoutes);
app.use('/', adminRoutes);

app.use((req, res) => {
  res.status(404).render('error', { title: 'Page not found', status: 404, message: 'The page you are looking for does not exist.' });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(500).render('error', {
    title: 'Something went wrong',
    status: 500,
    message: 'Something went wrong. Please try again.'
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Disaster Relief Portal running at http://localhost:${PORT}`);
  console.log(`Payments: ${paymentService.provider} mode`);
});
