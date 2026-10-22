const crypto = require('crypto');
const db = require('../config/db');

const TTL_MIN = 10;
const MAX_ATTEMPTS = 5;
const COOLDOWN_SEC = 60;

const secret = () => process.env.SESSION_SECRET || 'dev-only-secret-change-me';
const hash = (purpose, subject, code) =>
  crypto.createHmac('sha256', secret()).update(`${purpose}:${subject}:${code}`).digest('hex');

// Creates a 6-digit code. Returns { code } or { tooSoon: true } if asked again within a minute.
async function issue(purpose, subject) {
  const last = await db.oneOrNone(
    'SELECT created_at FROM email_otps WHERE purpose = $1 AND subject = $2 ORDER BY created_at DESC LIMIT 1',
    [purpose, subject]
  );
  if (last && Date.now() - new Date(last.created_at).getTime() < COOLDOWN_SEC * 1000) return { tooSoon: true };

  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  await db.none('UPDATE email_otps SET consumed = TRUE WHERE purpose = $1 AND subject = $2 AND consumed = FALSE', [purpose, subject]);
  await db.none(
    `INSERT INTO email_otps (purpose, subject, code_hash, expires_at) VALUES ($1, $2, $3, NOW() + INTERVAL '${TTL_MIN} minutes')`,
    [purpose, subject, hash(purpose, subject, code)]
  );
  return { code };
}

async function verify(purpose, subject, input) {
  const code = String(input || '').trim();
  if (!/^\d{6}$/.test(code)) return { ok: false, reason: 'format' };
  const row = await db.oneOrNone(
    'SELECT * FROM email_otps WHERE purpose = $1 AND subject = $2 AND consumed = FALSE ORDER BY created_at DESC LIMIT 1',
    [purpose, subject]
  );
  if (!row || new Date(row.expires_at) < new Date()) return { ok: false, reason: 'expired' };
  if (row.attempts >= MAX_ATTEMPTS) return { ok: false, reason: 'locked' };

  const a = Buffer.from(row.code_hash);
  const b = Buffer.from(hash(purpose, subject, code));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    await db.none('UPDATE email_otps SET attempts = attempts + 1 WHERE id = $1', [row.id]);
    return { ok: false, reason: 'wrong', left: MAX_ATTEMPTS - row.attempts - 1 };
  }
  await db.none('UPDATE email_otps SET consumed = TRUE WHERE id = $1', [row.id]);
  return { ok: true };
}

const message = (r) =>
  ({
    format: 'Enter the 6-digit code from your email.',
    expired: 'This code has expired or was not found. Please request a new one.',
    locked: 'Too many wrong attempts. Please request a new code.',
    wrong: `Incorrect code. ${r.left} attempt${r.left === 1 ? '' : 's'} left.`
  }[r.reason] || 'Invalid code.');

module.exports = { issue, verify, message };