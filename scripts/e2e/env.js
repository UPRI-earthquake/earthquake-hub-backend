// Where the end-to-end check's throwaway PostgreSQL and mail catcher listen (e2e/docker-compose.yml),
// and the environment a script or backend needs to use them instead of dev. The values are set
// explicitly, so the developer's .env (which dotenv never lets override a set variable) can't point
// anything at dev.
const path = require('path');

const BACKEND_ROOT = path.join(__dirname, '..', '..');

// A baseline and everything a run makes stay outside the repos: a baseline made from production data
// holds personal data
const DEFAULT_OUTPUT_DIR = path.join(BACKEND_ROOT, '..', 'e2e-output');

const DATABASE_ENV = {
  PG_HOST: 'localhost',
  PG_PORT: '55432',
  PG_DATABASE: 'ehub_e2e',
  PG_USER: 'ehub_e2e',
  PG_PASSWORD: 'ehub_e2e',
};

const MAIL_ENV = {
  EMAIL_TRANSPORT: 'smtp',
  EMAIL_HOST: 'localhost',
  EMAIL_PORT: '1125',
  EMAIL_SECURE: 'false',
  EMAIL_USER: '',
  EMAIL_PASS: '',
};

const MAILPIT_API = 'http://localhost:8125/api/v1';

// The environment for a script or backend run against the end-to-end database
const e2eEnv = (extra = {}) => ({ ...process.env, ...DATABASE_ENV, ...MAIL_ENV, ...extra });

// Command-line arguments that aren't --flags
const positional = (argv = process.argv) => argv.slice(2).filter((arg) => !arg.startsWith('--'));

module.exports = {
  BACKEND_ROOT,
  DEFAULT_OUTPUT_DIR,
  DATABASE_ENV,
  MAIL_ENV,
  MAILPIT_API,
  e2eEnv,
  positional,
};
