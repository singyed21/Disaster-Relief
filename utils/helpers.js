const crypto = require('crypto');

const CURRENCY = process.env.CURRENCY || 'BTN';

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const randomToken = () => crypto.randomBytes(32).toString('hex');
// Unguessable public reference, e.g. DR-3F9A1C07B2D4E586
const newReference = () => 'DR-' + crypto.randomBytes(8).toString('hex').toUpperCase();

const isEmail = (s) => typeof s === 'string' && s.length <= 255 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

const clean = (s, max = 255) => (typeof s === 'string' ? s.trim().slice(0, max) : '');

function fmtMoney(n, cur = CURRENCY) {
  const v = Number(n) || 0;
  return `${cur} ${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function fmtDate(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
function fmtDateTime(d) {
  if (!d) return '';
  return new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

const DONATION_TYPES = ['money', 'medical', 'rescue'];
const TYPE_LABELS = { money: 'Money', medical: 'Medical support', rescue: 'Rescue team' };

const STATUS_FLOW = {
  money: ['unverified', 'pending', 'verifying', 'completed', 'failed', 'refunded'],
  medical: ['unverified', 'pledged', 'received', 'dispatched', 'delivered', 'cancelled'],
  rescue: ['unverified', 'pledged', 'received', 'dispatched', 'delivered', 'cancelled']
};

const STATUS_LABELS = {
  money: {
    unverified: 'Email not verified',
    pending: 'Awaiting payment',
    verifying: 'Checking your bank transfer',
    completed: 'Received',
    failed: 'Payment failed',
    refunded: 'Refunded'
  },
  medical: {
    unverified: 'Email not verified',
    pledged: 'Pledged',
    received: 'Received at relief centre',
    dispatched: 'Dispatched to affected area',
    delivered: 'Delivered',
    cancelled: 'Cancelled'
  },
  rescue: {
    unverified: 'Email not verified',
    pledged: 'Offered',
    received: 'Accepted by coordinators',
    dispatched: 'Deployed',
    delivered: 'Mission completed',
    cancelled: 'Cancelled'
  }
};

const statusLabel = (type, status) => (STATUS_LABELS[type] && STATUS_LABELS[type][status]) || status;
const typeLabel = (type) => TYPE_LABELS[type] || type;

// Money is only marked Received by an admin for bank transfers (after checking the
// bank statement) or by a payment provider's confirmed callback.
function adminAllowedStatuses(type, current, provider) {
  if (type === 'money') {
    if (current === 'unverified') return ['failed'];
    if (current === 'pending') return provider === 'bank' ? ['completed', 'failed'] : ['failed'];
    if (current === 'verifying') return ['completed', 'failed'];
    if (current === 'completed') return ['refunded'];
    return [];
  }
  return STATUS_FLOW[type].filter((s) => s !== current && s !== 'unverified');
}

function safeNext(n) {
  return typeof n === 'string' && /^\/(?!\/)/.test(n) && !n.includes('\\') ? n : '/account';
}

function csvCell(v) {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // neutralise spreadsheet formula injection
  return `"${s.replace(/"/g, '""')}"`;
}

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const appUrl = () => (process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, '');

module.exports = {
  CURRENCY, sha256, randomToken, newReference, isEmail, clean, fmtMoney, fmtDate, fmtDateTime,
  DONATION_TYPES, TYPE_LABELS, STATUS_FLOW, statusLabel, typeLabel, adminAllowedStatuses,
  safeNext, csvCell, esc, appUrl
};