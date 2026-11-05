// End-to-end check: serves one production build of the frontend twice, each copy talking to its own
// backend (start-backends.js), until stopped:
//   http://localhost:3101  ->  http://localhost:5101  (every area on MongoDB)
//   http://localhost:3102  ->  http://localhost:5102  (every area on PostgreSQL)
// The frontend reads its backend from /config.js at runtime, so each copy gets its own; nothing in the
// frontend's code changes. Live ringserver feeds point at a dead local address (no real sensor is
// contacted), and the browser tests block every other non-local request.
//
// Build the frontend first (outside the repos), from the frontend folder:
//   BUILD_PATH=../e2e-output/frontend-build GENERATE_SOURCEMAP=false REACT_APP_FDSNWS=http://localhost:9/fdsnws npx react-scripts build
//
//   node scripts/e2e/serve-frontend.js [build folder]
const fs = require('fs');
const http = require('http');
const path = require('path');
const { DEFAULT_OUTPUT_DIR } = require('./env');
const { BACKENDS } = require('./start-backends');

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webp': 'image/webp',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.txt': 'text/plain', '.mseed': 'application/octet-stream', '.map': 'application/json',
};

const configFor = (backendPort) => `window['ENV'] = ${JSON.stringify({
  REACT_APP_BACKEND: `http://localhost:${backendPort}`,
  REACT_APP_BACKEND_DEV: `http://localhost:${backendPort}`,
  REACT_APP_RINGSERVER_WS: 'ws://localhost:9',
  REACT_APP_RINGSERVER_WS_DEV: 'ws://localhost:9',
  REACT_APP_RS_FDSNWS: 'http://localhost:9/fdsnws',
}, null, 2)};\n`;

function serveFrontend(buildDir = path.join(DEFAULT_OUTPUT_DIR, 'frontend-build')) {
  if (!fs.existsSync(path.join(buildDir, 'index.html'))) throw new Error(`No frontend build in ${buildDir}`);
  return Object.entries(BACKENDS).map(([name, { port, clientPort }]) => {
    const handler = (req, res) => {
      const urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      if (urlPath === '/config.js') {
        res.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-store' });
        res.end(configFor(port));
        return;
      }
      let file = path.join(buildDir, urlPath);
      if (!file.startsWith(buildDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        file = path.join(buildDir, 'index.html'); // single-page app: every route is index.html
      }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    };
    // Loopback only (the build talks to production data), on IPv4 and IPv6: "localhost" can be either
    const servers = ['127.0.0.1', '::1'].map((host) => http.createServer(handler).listen(clientPort, host));
    return { name, servers, url: `http://localhost:${clientPort}` };
  });
}

module.exports = { serveFrontend };

if (require.main === module) {
  const running = serveFrontend(process.argv[2] ? path.resolve(process.argv[2]) : undefined);
  running.forEach(({ name, url }) => console.log(`${name} frontend: ${url}`));
}
