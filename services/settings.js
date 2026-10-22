const db = require('../config/db');

async function getSettings() {
  const rows = await db.any('SELECT key, value FROM settings');
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

async function saveSettings(obj) {
  await db.tx((t) =>
    t.batch(
      Object.entries(obj).map(([k, v]) =>
        t.none('INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value', [k, v])
      )
    )
  );
}

const bankConfigured = (s) => !!(s.bank_name && s.bank_account_name && s.bank_account_number);

module.exports = { getSettings, saveSettings, bankConfigured };