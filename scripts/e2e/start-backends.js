// End-to-end check: runs the backend twice on the end-to-end databases, until stopped (Ctrl+C):
//   mongodb   every area on MongoDB     http://localhost:5101   (its frontend: http://localhost:3101)
//   postgres  every area on PostgreSQL  http://localhost:5102   (its frontend: http://localhost:3102)
// Both share the developer's .env for everything else (secrets, external services), so they reach the
// same outside world. Logs go to <output folder>/backend-<name>.log.
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

module.exports = { BACKENDS, url, waitUntilUp, startBackends };

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
