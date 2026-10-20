// Knex configuration, shared by the backend (src/db/knex.js), the migration CLI
// (npm run db:pg:migrate / db:pg:rollback) and the test fixture. Connection comes from the PG_* keys.
const path = require('path');

// The Knex CLI changes into this file's directory, so point dotenv at the repo root's .env explicitly
try { require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') }); } catch (_) { /* prod images don't ship dotenv; env comes from compose */ }

const { PG_HOST, PG_PORT, PG_DATABASE, PG_USER, PG_PASSWORD } = process.env;

module.exports = {
  client: 'pg',
  connection: {
    host: PG_HOST,
    port: Number(PG_PORT) || 5432,
    database: PG_DATABASE,
    user: PG_USER,
    password: PG_PASSWORD,
  },
  // min 0 lets idle connections close instead of holding them open forever
  pool: { min: 0, max: 10 },
  migrations: {
    directory: path.join(__dirname, 'migrations'),
    tableName: 'knex_migrations',
  },
};
