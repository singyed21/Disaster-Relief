// Creates the database (if missing), applies sql/schema.sql and optionally sql/seed.sql.
// Usage: npm run db:init        (schema only)
//        npm run db:seed        (schema + sample disasters)
require('dotenv').config();
const path = require('path');
const pgp = require('pg-promise')();

const dbName = process.env.DB_NAME || 'Disaster relief';
const base = {
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 5432,
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASS
};

(async () => {
  try {
    const admin = pgp({ ...base, database: 'postgres' });
    const exists = await admin.oneOrNone('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
    if (!exists) {
      await admin.none('CREATE DATABASE $1:name', [dbName]);
      console.log(`Created database "${dbName}"`);
    }

    const db = pgp({ ...base, database: dbName });
    const run = (file) => db.none(new pgp.QueryFile(path.join(__dirname, '..', 'sql', file), { minify: false }));

    await run('schema.sql');
    console.log('Schema applied.');
    if (process.argv.includes('--seed')) {
      await run('seed.sql');
      console.log('Sample disasters added (only if the table was empty).');
    }
    console.log('Done. Next: npm run admin:create -- "Your Name" you@example.com "a-strong-password"');
  } catch (err) {
    console.error('Database setup failed:', err.message);
    process.exitCode = 1;
  } finally {
    pgp.end();
  }
})();
