// End-to-end check: runs the backend on the end-to-end PostgreSQL, until stopped (Ctrl+C):
//   http://localhost:5102   (its frontend: http://localhost:3102)
// It reads the developer's .env for everything else (secrets), but every outside service the .env
// names is pointed at a dead local address (ISOLATION_ENV): no request reaches production's FDSN,
// GeoServe, ringserver or device tunnels. Logs go to <output folder>/backend.log, and reports' images to
// <output folder>/uploads.
//
//   node scripts/e2e/start-backend.js [output folder]
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { BACKEND_ROOT, DEFAULT_OUTPUT_DIR, e2eEnv, positional } = require('./env');

const BACKEND = { port: 5102, clientPort: 3102 };
const url = () => `http://localhost:${BACKEND.port}`;

// Port 9 (discard) on loopback: nothing listens, so every call fails at once, with no DNS lookup
const DEAD = '127.0.0.1';
const ISOLATION_ENV = {
  GEOSERVE_HOST: DEAD,
  GEOSERVE_PORT: '9',
  FDSNWS_DATASELECT_URL: `http://${DEAD}:9/fdsnws/dataselect/1/query`,
  RINGSERVER_HOST: DEAD,
  RINGSERVER_PORT: '9',
  TUNNEL_BASTION_HOST: DEAD,
  TUNNEL_BASTION_PORT: '9',
  TUNNEL_SCRIPT_SSH_HOST: DEAD,
  TUNNEL_REMOTE_ACTION_SSH_HOST: DEAD,
  TUNNEL_REMOTE_ACTION_TARGET_SSH_HOST: DEAD,
  TUNNEL_WSS_URL: `ws://${DEAD}:9`,
  // The nightly catalog enrichment (PHIVOLCS, USGS) never runs during a test: Feb 31 never comes
  ENRICHMENT_CRON: '0 2 31 2 *',
  ENRICHMENT_RUN_ON_STARTUP: 'false',
};

const waitUntilUp = async (timeoutMs = 120_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${url()}/`)).ok) return;
    } catch (_) { /* not listening yet */ }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`The backend didn't start within ${timeoutMs / 1000}s`);
};

function startBackend(outputDir = DEFAULT_OUTPUT_DIR) {
  fs.mkdirSync(outputDir, { recursive: true });
  const log = fs.openSync(path.join(outputDir, 'backend.log'), 'w');
  return spawn(process.execPath, ['-r', 'dotenv/config', 'src/index.js'], {
    cwd: BACKEND_ROOT,
    env: e2eEnv({
      ...ISOLATION_ENV,
      NODE_ENV: 'development',
      BACKEND_DEV_PORT: String(BACKEND.port),
      CLIENT_DEV_HOST: 'localhost',
      CLIENT_DEV_PORT: String(BACKEND.clientPort),
      UPLOAD_DIR: path.join(outputDir, 'uploads'),
    }),
    stdio: ['ignore', log, log],
  });
}

module.exports = { BACKEND, ISOLATION_ENV, url, waitUntilUp, startBackend };

if (require.main === module) {
  const [outputArg] = positional();
  const child = startBackend(outputArg ? path.resolve(outputArg) : DEFAULT_OUTPUT_DIR);
  const stop = () => child.kill();
  process.on('SIGINT', () => { stop(); process.exit(0); });
  process.on('SIGTERM', () => { stop(); process.exit(0); });
  child.on('exit', (code) => console.log(`backend exited (${code})`));
  waitUntilUp()
    .then(() => console.log(`backend: ${url()}`))
    .catch((err) => { console.error(err.message); stop(); process.exit(1); });
}
