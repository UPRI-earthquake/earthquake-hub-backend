// Knex configuration, shared by the backend (src/db/knex.js), the migration CLI
// (npm run db:pg:migrate / db:pg:rollback) and the test fixture. Connection comes from the PG_* keys.
const path = require('path');

// The Knex CLI changes into this file's directory, so point dotenv at the repo root's .env explicitly
try { require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') }); } catch (_) { /* prod images don't ship dotenv; env comes from compose */ }

// Read when a connection opens, not when this file loads, so whoever sets PG_* last wins
// (integration tests point them at a throwaway container after this file is already loaded)
const connectionSettings = () => ({
  host: process.env.PG_HOST,
  port: Number(process.env.PG_PORT) || 5432,
  database: process.env.PG_DATABASE,
  user: process.env.PG_USER,
  password: process.env.PG_PASSWORD,
});

module.exports = {
  client: 'pg',
  connection: connectionSettings,
  // min 0 lets idle connections close instead of holding them open forever
  pool: { min: 0, max: 10 },
  migrations: {
    directory: path.join(__dirname, 'migrations'),
    tableName: 'knex_migrations',
  },
};
