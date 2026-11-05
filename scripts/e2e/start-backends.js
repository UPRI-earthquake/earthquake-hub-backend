// End-to-end check: runs the backend twice on the end-to-end databases, until stopped (Ctrl+C):
//   mongodb   every area on MongoDB     http://localhost:5101   (its frontend: http://localhost:3101)
//   postgres  every area on PostgreSQL  http://localhost:5102   (its frontend: http://localhost:3102)
// Both share the developer's .env for everything else (secrets), but every outside service it names
// is pointed at a dead local address (ISOLATION_ENV): no request reaches production's FDSN, GeoServe,
// ringserver or device tunnels, and both backends meet the same unreachable world. Logs go to
// <output folder>/backend-<name>.log.
//
//   node scripts/e2e/start-backends.js [output folder]
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { BACKEND_ROOT, DEFAULT_OUTPUT_DIR, areas, e2eEnv } = require('./env');

const BACKENDS = {
  mongodb: { port: 5101, clientPort: 3101 },
  postgres: { port: 5102, clientPort: 3102 },
};
const url = (name) => `http://localhost:${BACKENDS[name].port}`;

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

const waitUntilUp = async (name, timeoutMs = 120_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${url(name)}/`)).ok) return;
    } catch (_) { /* not listening yet */ }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`The ${name} backend didn't start within ${timeoutMs / 1000}s`);
};

function startBackends(outputDir = DEFAULT_OUTPUT_DIR) {
  fs.mkdirSync(outputDir, { recursive: true });
  return Object.entries(BACKENDS).map(([name, { port, clientPort }]) => {
    const log = fs.openSync(path.join(outputDir, `backend-${name}.log`), 'w');
    const child = spawn(process.execPath, ['-r', 'dotenv/config', 'src/index.js'], {
      cwd: BACKEND_ROOT,
      env: e2eEnv({
        ...ISOLATION_ENV,
        ...areas(name),
        NODE_ENV: 'development',
        BACKEND_DEV_PORT: String(port),
        CLIENT_DEV_HOST: 'localhost',
        CLIENT_DEV_PORT: String(clientPort),
      }),
      stdio: ['ignore', log, log],
    });
    return { name, child };
  });
}

module.exports = { BACKENDS, ISOLATION_ENV, url, waitUntilUp, startBackends };

if (require.main === module) {
  const outputDir = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_OUTPUT_DIR;
  const running = startBackends(outputDir);
  const stop = () => running.forEach(({ child }) => child.kill());
  process.on('SIGINT', () => { stop(); process.exit(0); });
  process.on('SIGTERM', () => { stop(); process.exit(0); });
  running.forEach(({ name, child }) => child.on('exit', (code) => console.log(`${name} backend exited (${code})`)));
  Promise.all(Object.keys(BACKENDS).map((name) => waitUntilUp(name)))
    .then(() => Object.keys(BACKENDS).forEach((name) => console.log(`${name} backend: ${url(name)}`)))
    .catch((err) => { console.error(err.message); stop(); process.exit(1); });
}
