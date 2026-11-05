// Where the end-to-end check's throwaway databases and mail catcher listen (e2e/docker-compose.yml),
// and the environment a script or backend needs to use them instead of dev. The values are set
// explicitly, so the developer's .env (which dotenv never lets override a set variable) can't point
// anything at dev.
const path = require('path');

const BACKEND_ROOT = path.join(__dirname, '..', '..');

// The export and everything made from it hold production data: they stay outside the repos
const DEFAULT_EXPORT_DIR = path.join(BACKEND_ROOT, '..', 'latestEQs.110526');
const DEFAULT_OUTPUT_DIR = path.join(BACKEND_ROOT, '..', 'e2e-output');

const DATABASE_ENV = {
  MONGO_CONNX_TYPE: 'docker',
  MONGO_HOST: 'localhost',
  MONGO_PORT: '27117',
  MONGO_NAME: 'latestEQs',
  MONGO_USER: '',
  MONGO_PASSWORD: '',
  MONGO_REPLICA_SET: 'rs0',
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

const ALL_AREAS = ['JOB_LOCKS_DB', 'PEOPLE_AND_SENSORS_DB', 'EARTHQUAKES_DB', 'COMMUNITY_DB'];
const areas = (database) => Object.fromEntries(ALL_AREAS.map((key) => [key, database]));

// The environment for a script or backend run against the end-to-end databases
const e2eEnv = (extra = {}) => ({ ...process.env, ...DATABASE_ENV, ...MAIL_ENV, ...extra });

// A Mongo URI for scripts that connect directly
const mongoUri = () => `mongodb://${DATABASE_ENV.MONGO_HOST}:${DATABASE_ENV.MONGO_PORT}/${DATABASE_ENV.MONGO_NAME}?replicaSet=${DATABASE_ENV.MONGO_REPLICA_SET}`;

module.exports = {
  BACKEND_ROOT,
  DEFAULT_EXPORT_DIR,
  DEFAULT_OUTPUT_DIR,
  DATABASE_ENV,
  MAIL_ENV,
  MAILPIT_API,
  areas,
  e2eEnv,
  mongoUri,
};
