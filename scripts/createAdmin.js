// Creates (or promotes) an admin account.
// Usage: npm run admin:create -- "Full Name" admin@example.com "StrongPassword123"
require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('../config/db');

(async () => {
  const [name, emailRaw, password] = process.argv.slice(2);
  if (!name || !emailRaw || !password) {
    console.error('Usage: npm run admin:create -- "Full Name" admin@example.com "Password"');
    process.exitCode = 1;
    return db.$pool.end();
  }
  if (password.length < 8) {
    console.error('Password must be at least 8 characters.');
    process.exitCode = 1;
    return db.$pool.end();
  }
  try {
    const email = emailRaw.trim().toLowerCase();
    const hash = await bcrypt.hash(password, 12);
    await db.none(
      `INSERT INTO users (name, email, password_hash, role, email_verified)
       VALUES ($1, $2, $3, 'admin', TRUE)
       ON CONFLICT (email) DO UPDATE
         SET role = 'admin', email_verified = TRUE, password_hash = EXCLUDED.password_hash, name = EXCLUDED.name`,
      [name.trim(), email, hash]
    );
    console.log(`Admin ready: ${email}`);
  } catch (err) {
    console.error('Failed:', err.message);
    process.exitCode = 1;
  } finally {
    db.$pool.end();
  }
})();
