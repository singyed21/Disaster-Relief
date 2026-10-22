# Disaster Relief Portal

A donation portal for disaster relief. Donors can give **money**, **medical support** or a **rescue team**, then trace every donation through to delivery. Admins control campaigns, donations and spending. Includes email verification, receipts and a payment gateway layer.

## Features

| Area | What it does |
|---|---|
| Disasters | Campaign pages with severity, needs, goal progress, situation updates and public spending |
| Donations | Money (online payment), medical support pledges, rescue-team offers |
| Tracing | Each donation gets a reference code (`DR-…`) and a public timeline, plus email notices when status changes |
| Transparency | `/dashboard` shows money raised vs spent, what it was spent on, and a ledger of donations (anonymous donors hidden) |
| Accounts | Register, email verification, login, password reset, "my donations" |
| Admin | Manage disasters and updates, review/update donations, record fund allocations, manage users and messages, CSV export, audit log |
| Security | bcrypt passwords, CSRF protection, session fixation protection, rate limiting, parameterised SQL, hashed email/reset tokens, webhook signature verification |

## Setup

1. Install Node.js 18+ and PostgreSQL.
2. Copy `.env.example` to `.env` (or add the new variables to your existing `.env`) and fill in your values.
3. Install and create the database:

```bash
npm install
npm run db:seed        # creates the database and tables, adds sample disasters
# (use `npm run db:init` instead to create tables without sample data)
```

4. Create your first admin account:

```bash
npm run admin:create -- "Your Name" you@example.com "a-strong-password"
```

5. Start the server and open http://localhost:3000

```bash
npm start        # or: npm run dev   (auto-restart with nodemon)
```

Log in at `/login` with the admin account, then open **Admin** in the top bar.

## Pages

Public: `/`, `/disasters`, `/disasters/:id`, `/donate`, `/donations/:ref`, `/track`, `/dashboard`, `/about`, `/contact`
Accounts: `/register`, `/login`, `/forgot`, `/account`
Admin: `/admin`, `/admin/disasters`, `/admin/donations`, `/admin/allocations`, `/admin/users`, `/admin/messages`

## How a donation is traced

- **Money**: starts as *Awaiting payment*. It only becomes *Received* when the payment provider confirms it (sandbox button, or Stripe webhook). Admins cannot mark money as received by hand.
- **Medical / rescue**: *Pledged → Received/Accepted → Dispatched/Deployed → Delivered/Completed*. Each admin update adds a timeline note and emails the donor.
- Admins then record **fund allocations** (what the money was spent on). The system refuses to record more spending than has been received for a disaster.

## Email

With `SMTP_HOST` empty (default in development), emails are **printed in the terminal** instead of sent, so you can copy the verification link from the console. For real email, fill in `SMTP_*` and `MAIL_FROM` in `.env`. Gmail, Brevo, Mailgun, SendGrid and Amazon SES all work with SMTP credentials. Use a provider where your domain is verified so mail does not land in spam.

## Payments

`PAYMENT_GATEWAY` selects the provider:

- `sandbox` (default): a built-in test checkout. **No real money moves.** A yellow banner shows on every page while this is on.
- `stripe`: real card payments through Stripe Checkout. Set `PAYMENT_API_KEY` (secret key) and `PAYMENT_WEBHOOK_SECRET`, and add a webhook in the Stripe dashboard pointing to `https://YOUR-DOMAIN/webhooks/payment` for `checkout.session.completed` and `checkout.session.expired`. Set `APP_URL` to your public HTTPS address.

Important notes:
- Stripe does not support Bhutanese ngultrum (BTN). If you use Stripe, set `CURRENCY` to a currency Stripe supports (e.g. `USD`). Check that your Stripe account country supports charging in it.
- For local Bhutanese payment methods (bank or mobile wallet), add a provider branch in `services/payment.js`: create a checkout in `createCheckout()`, then call `completeDonation(reference, providerRef)` only after the provider's confirmed callback. Contact your bank or payment provider for their merchant API.
- Never mark a money donation complete from the browser redirect alone. Only provider-confirmed callbacks should do it.

## Going to production checklist

- `NODE_ENV=production`, a long random `SESSION_SECRET` (the app refuses to start otherwise), and HTTPS (cookies are `secure` in production).
- Replace the default in-memory session store with a persistent one, e.g. `connect-pg-simple`. The in-memory store loses sessions on restart and does not scale.
- Use a dedicated Postgres user with a strong password instead of `postgres`, and keep `.env` out of git (it is in `.gitignore`).
- Replace the sample disasters with real campaigns, and set real SMTP and payment credentials.
- Back up the database regularly: it is your donation ledger.

## Project structure

```
app.js                 server setup, middleware, route mounting
config/db.js           PostgreSQL connection (pg-promise)
routes/                disaster, donation, user, dashboard, admin routes
services/              payment gateway, emails, shared queries
middleware/            auth, CSRF, flash, rate limiters
sql/schema.sql         tables      sql/seed.sql   sample campaigns
scripts/               initDb.js, createAdmin.js
views/                 EJS pages (views/admin for the admin area)
public/                CSS and browser JavaScript
```
