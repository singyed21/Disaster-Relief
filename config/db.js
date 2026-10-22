require('dotenv').config();
const pgp = require('pg-promise')();

// Return bigint (COUNT) and numeric (SUM, money) as JS numbers instead of strings
pgp.pg.types.setTypeParser(20, (v) => parseInt(v, 10));
pgp.pg.types.setTypeParser(1700, (v) => parseFloat(v));

const db = pgp({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'Disaster relief',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASS,
  max: 10
});

module.exports = db;
