// End-to-end check, API writes: runs every write flow the frontend and the sensors use on both backends
// (start-backends.js), step by step with the same input, and compares the responses after the goldens'
// normalization (__tests__/fixtures/golden.js: tokens as their claims, recent times as <now>, generated
// ids as placeholders). Uses throwaway accounts, comments and devices, and removes them afterwards
// where the API can.
//
// Flows: accounts (register to delete, password reset through the mail catcher), sensors (link, station
// status, brgy forwarding, unlink, reset-link), comments (text, image, anonymous; helpful marks; issue
// reports; moderation and delete), an earthquake summary, and a SeisComP event with its live update.
//
// Writes api-writes.json (per step: same or the differences) and baseline/api-writes.json (MongoDB's
// responses) to the output folder, outside the repos.
//
//   node scripts/e2e/compare-writes.js [output folder]
require('dotenv/config'); // the same secrets the backends use, to mint the admin session
const fs = require('fs');
const path = require('path');
const { DEFAULT_OUTPUT_DIR, MAILPIT_API } = require('./env');
const { BACKENDS, url } = require('./start-backends');
const { diff } = require('./compare-api');
const { stabilized } = require('../../__tests__/fixtures/golden');
const { generateAMStationCode, generateAccessToken } = require('../../src/controllers/helpers');

const NAMES = Object.keys(BACKENDS); // mongodb, postgres
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const RUN = Date.now().toString(36);
const PASSWORD = 'E2e-Flow-Password-2026!';
const NEW_PASSWORD = 'E2e-Flow-Password-2027!';
const RESET_PASSWORD = 'E2e-Flow-Password-2028!';

// --- HTTP, per backend ---

const cookieOf = (res) => (res.headers.getSetCookie ? res.headers.getSetCookie() : [])
  .map((c) => c.split(';')[0]).filter((c) => !c.endsWith('=')).join('; ');

async function send(name, { method = 'GET', path: requestPath, body, form, cookie, bearer, origin }) {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  if (origin) headers.Origin = origin;
  let payload;
  if (form) {
    payload = new FormData();
    Object.entries(form).forEach(([k, v]) => payload.append(k, v));
    payload.append('image', new Blob([PNG], { type: 'image/png' }), 'report.png');
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${url(name)}${requestPath}`, { method, headers, body: payload });
  const text = await res.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch (_) { parsed = text; }
  return { status: res.status, body: parsed, cookie: cookieOf(res) };
}

const webOrigin = (name) => `http://localhost:${BACKENDS[name].clientPort}`;

// The newest mail to `to` in the mail catcher, as text
async function latestMailTo(to) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const list = await (await fetch(`${MAILPIT_API}/messages?limit=50`)).json();
    const message = (list.messages || []).find((m) => (m.To || []).some((r) => r.Address.toLowerCase() === to.toLowerCase()));
    if (message) return (await (await fetch(`${MAILPIT_API}/message/${message.ID}`)).json()).Text || '';
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`No mail to ${to} arrived`);
}
const clearMail = () => fetch(`${MAILPIT_API}/messages`, { method: 'DELETE' });

// --- Steps ---

const report = [];
const baseline = {};
// Runs one step on both backends. `build(name, ctx)` gives the request; `replace(name, ctx, res)` the
// generated values to show as placeholders. ctx[name] keeps per-backend state between steps.
const ctx = Object.fromEntries(NAMES.map((name) => [name, {}]));
async function step(label, build, { replace = () => ({}), after = () => {} } = {}) {
  const results = {};
  for (const name of NAMES) {
    const req = await build(name, ctx[name]);
    const res = await send(name, req);
    after(name, ctx[name], res);
    results[name] = stabilized({ status: res.status, body: res.body }, replace(name, ctx[name], res));
  }
  const differences = diff(results.mongodb, results.postgres);
  report.push({ step: label, same: differences.length === 0, status: results.mongodb.status, differences: differences.slice(0, 20) });
  baseline[label] = results.mongodb;
  console.log(`${differences.length === 0 ? 'ok  ' : 'DIFF'} ${label} (${results.mongodb.status}${results.postgres.status !== results.mongodb.status ? ` vs ${results.postgres.status}` : ''})`);
  return results;
}
const ids = (name, c) => Object.fromEntries(Object.entries(c.placeholders || {}));
const remember = (c, value, placeholder) => {
  if (value) c.placeholders = { ...(c.placeholders || {}), [value]: placeholder };
};
const tokenClaims = (token) => JSON.parse(Buffer.from(String(token).split('.')[1], 'base64url').toString('utf8'));
const claimsFromCookie = (cookie) => {
  const token = /accessToken=([^;]+)/.exec(cookie || '');
  return token ? tokenClaims(token[1]) : {};
};

// --- Flows ---

async function accountsFlow() {
  const user = `e2e_${RUN}`;
  const email = `e2e.${RUN}@example.org`;
  const newEmail = `e2e.${RUN}.new@example.org`;
  await step('accounts: register a citizen', () => ({
    method: 'POST', path: '/accounts/register', body: { role: 'citizen', username: user, email, password: PASSWORD, confirmPassword: PASSWORD },
  }));
  await step('accounts: sign in', () => ({ method: 'POST', path: '/accounts/authenticate', body: { username: user, password: PASSWORD, role: 'citizen' } }), {
    after: (name, c, res) => { c.cookie = res.cookie; remember(c, claimsFromCookie(res.cookie).accountId, '<new account id>'); },
    replace: ids,
  });
  await step('accounts: profile', (name, c) => ({ path: '/accounts/profile', cookie: c.cookie }), { replace: ids });
  await step('accounts: alert preferences', (name, c) => ({ method: 'PATCH', path: '/accounts/alert-preferences', body: { rshakeEmailEnabled: true }, cookie: c.cookie }), { replace: ids });
  await step('accounts: change username', (name, c) => ({ method: 'PATCH', path: '/accounts/username', body: { newUsername: `${user}_r`, currentPassword: PASSWORD }, cookie: c.cookie }), {
    after: (name, c, res) => { if (res.cookie) c.cookie = res.cookie; },
    replace: ids,
  });
  await step('accounts: change email', (name, c) => ({ method: 'PATCH', path: '/accounts/email', body: { email: newEmail, currentPassword: PASSWORD }, cookie: c.cookie }), { replace: ids });
  await step('accounts: change password', (name, c) => ({
    method: 'PATCH', path: '/accounts/password', body: { currentPassword: PASSWORD, newPassword: NEW_PASSWORD, confirmPassword: NEW_PASSWORD }, cookie: c.cookie,
  }), { after: (name, c, res) => { if (res.cookie) c.cookie = res.cookie; }, replace: ids });
  await step('accounts: sign out', (name, c) => ({ method: 'POST', path: '/accounts/signout', cookie: c.cookie }), { replace: ids });

  // Password reset: each backend's mail, read from the mail catcher
  for (const name of NAMES) ctx[name].resetDone = false;
  await step('accounts: forgot password', async () => {
    await clearMail();
    return { method: 'POST', path: '/accounts/forgot-password', body: { email: newEmail } };
  }, {
    after: () => {},
    replace: ids,
  });
  for (const name of NAMES) {
    // Ask again per backend, so each one's own mail gives its own token
    await clearMail();
    await send(name, { method: 'POST', path: '/accounts/forgot-password', body: { email: newEmail } });
    const text = await latestMailTo(newEmail);
    ctx[name].resetToken = decodeURIComponent(/token=([^\s&"<>]+)/.exec(text)[1]);
  }
  await step('accounts: reset password', (name, c) => ({
    method: 'POST', path: '/accounts/reset-password', body: { token: c.resetToken, password: RESET_PASSWORD, confirmPassword: RESET_PASSWORD },
  }), { replace: ids });
  await step('accounts: sign in with the new password', () => ({
    method: 'POST', path: '/accounts/authenticate', body: { username: `${user}_r`, password: RESET_PASSWORD, role: 'citizen' },
  }), { after: (name, c, res) => { c.cookie = res.cookie; }, replace: ids });
  await step('accounts: delete the account', (name, c) => ({ method: 'DELETE', path: '/accounts', cookie: c.cookie }), { replace: ids });
}

async function sensorsFlow(samples) {
  const user = `e2e_s_${RUN}`;
  const mac = `B8:27:EB:${RUN.slice(-6).padStart(6, '0').match(/.{2}/g).map((p) => p.replace(/[^0-9a-f]/gi, '0').toUpperCase()).join(':')}`;
  const station = generateAMStationCode(mac);
  const streamId = `AM_${station}_.*/MSEED`;
  const brgy = samples.accounts.find((s) => s.kind === 'brgy' && s.found);
  const link = () => ({
    method: 'POST', path: '/device/link',
    body: { username: user, password: PASSWORD, role: 'sensor', elevation: '55', latitude: '14.64', longitude: '121.06', macAddress: mac, streamId },
  });
  await step('sensors: register the owner', () => ({
    method: 'POST', path: '/accounts/register', body: { role: 'citizen', username: user, email: `e2e.s.${RUN}@example.org`, password: PASSWORD, confirmPassword: PASSWORD },
  }));
  await step('sensors: link a new sensor', link, {
    after: (name, c, res) => remember(c, res.body?.payload?.rshakeAlertCredential?.deviceId, '<new device id>'),
    replace: ids,
  });
  for (const name of NAMES) {
    const res = await send(name, { method: 'POST', path: '/accounts/authenticate', body: { username: user, password: PASSWORD, role: 'sensor' } });
    ctx[name].sensorToken = res.body.accessToken;
    remember(ctx[name], claimsFromCookie(`accessToken=${res.body.accessToken}`).accountId, '<new account id>');
    const web = await send(name, { method: 'POST', path: '/accounts/authenticate', body: { username: user, password: PASSWORD, role: 'citizen' } });
    ctx[name].cookie = web.cookie;
  }
  await step('sensors: station status (as the ringserver sends it)', () => ({
    method: 'POST', path: '/messaging/restricted/station-status', body: { network: 'AM', station, status: 'streaming' },
  }));
  await step('sensors: the station\'s status', () => ({ path: `/device/status?network=AM&station=${station}` }), { replace: ids });
  await step('sensors: my devices', (name, c) => ({ path: '/device/my-devices', cookie: c.cookie }), { replace: ids });
  if (brgy) {
    for (const name of NAMES) {
      const res = await send(name, { method: 'POST', path: '/accounts/authenticate', body: { username: brgy.username, password: samples.password, role: 'brgy' } });
      ctx[name].brgyToken = res.body.accessToken;
      ctx[name].brgyCookie = (await send(name, {
        method: 'POST', path: '/accounts/authenticate', body: { username: brgy.username, password: samples.password, role: 'brgy' }, origin: webOrigin(name),
      })).cookie;
    }
    await step('brgy: forward the sensor (verify-sensor-token)', (name, c) => ({
      method: 'POST', path: '/accounts/verify-sensor-token', body: { token: c.sensorToken }, bearer: c.brgyToken,
    }), { replace: ids });
    await step('brgy: the brgy\'s devices', (name, c) => ({ path: '/device/my-devices', cookie: c.brgyCookie }), { replace: ids });
    await step('brgy: stop forwarding (brgy/remove-device)', (name, c) => ({
      method: 'POST', path: '/accounts/brgy/remove-device', body: { brgyUsername: brgy.username, streamId }, bearer: c.sensorToken,
    }), { replace: ids });
  }
  await step('sensors: unlink', (name, c) => ({ method: 'POST', path: '/device/unlink', body: { macAddress: mac, streamId }, bearer: c.sensorToken }), { replace: ids });
  await step('sensors: link again', link, { replace: ids });
  await step('sensors: reset-link', (name, c) => ({ method: 'POST', path: '/device/reset-link', body: { macAddress: mac, streamId }, bearer: c.sensorToken }), { replace: ids });
  await step('sensors: all devices after reset-link', () => ({ path: '/device/all' }), { replace: ids });
  await step('sensors: delete the owner', (name, c) => ({ method: 'DELETE', path: '/accounts', cookie: c.cookie }), { replace: ids });
}

async function commentsFlow(samples, event) {
  const citizen = samples.accounts.find((s) => s.kind === 'citizen' && s.found);
  const voter = samples.accounts.find((s) => s.kind === 'sensorOwner' && s.found);
  for (const name of NAMES) {
    ctx[name].citizen = (await send(name, { method: 'POST', path: '/accounts/authenticate', body: { username: citizen.username, password: samples.password, role: 'citizen' } })).cookie;
    ctx[name].voter = (await send(name, { method: 'POST', path: '/accounts/authenticate', body: { username: voter.username, password: samples.password, role: 'citizen' } })).cookie;
    ctx[name].admin = `accessToken=${generateAccessToken({ accountId: '000000000000000000000000', username: 'e2e_admin', role: 'admin' }, 'web')}`;
    ctx[name].comments = [];
  }
  const keep = (name, c, res) => {
    const id = res.body?.payload?.commentId;
    if (id) { c.comments.push(id); remember(c, id, `<new comment ${c.comments.length}>`); }
    if (res.body?.payload?.imageURL) remember(c, res.body.payload.imageURL, '<uploaded image>');
  };
  await step('comments: post as a citizen', (name, c) => ({
    method: 'POST', path: '/comments', body: { eventId: event._id, content: `E2E check ${RUN}`, anonymous: false }, cookie: c.citizen,
  }), { after: keep, replace: ids });
  await step('comments: post signed out (anonymous)', () => ({
    method: 'POST', path: '/comments', body: { eventId: event._id, content: `E2E anonymous ${RUN}` },
  }), { after: keep, replace: ids });
  await step('comments: post an image only', (name, c) => ({
    method: 'POST', path: '/comments', form: { eventId: event._id, anonymous: 'false' }, cookie: c.citizen,
  }), { after: keep, replace: ids });
  await step('comments: list', () => ({ path: `/comments?eventId=${event._id}&limit=10` }), { replace: ids });
  await step('comments: mark helpful', (name, c) => ({ method: 'PUT', path: `/comments/${c.comments[0]}/helpful`, cookie: c.voter }), { replace: ids });
  await step('comments: mark helpful again', (name, c) => ({ method: 'PUT', path: `/comments/${c.comments[0]}/helpful`, cookie: c.voter }), { replace: ids });
  await step('comments: unmark', (name, c) => ({ method: 'DELETE', path: `/comments/${c.comments[0]}/helpful`, cookie: c.voter }), { replace: ids });
  await step('comments: report an issue', (name, c) => ({ method: 'POST', path: `/comments/${c.comments[0]}/issues`, body: { reason: 'unclear' }, cookie: c.voter }), { replace: ids });
  await step('comments: report it again', (name, c) => ({ method: 'POST', path: `/comments/${c.comments[0]}/issues`, body: { reason: 'duplicate' }, cookie: c.voter }), { replace: ids });
  await step('comments: admin rejects it', (name, c) => ({ method: 'PATCH', path: `/comments/${c.comments[0]}/status`, body: { status: 'rejected' }, cookie: c.admin }), { replace: ids });
  for (let i = 0; i < 3; i += 1) {
    await step(`comments: admin deletes comment ${i + 1}`, (name, c) => ({ method: 'DELETE', path: `/comments/${c.comments[i]}`, cookie: c.admin }), { replace: ids });
  }
  await step('comments: list after the deletes', () => ({ path: `/comments?eventId=${event._id}&limit=10` }), { replace: ids });
}

async function summaryFlow(samples, event) {
  const citizen = samples.accounts.find((s) => s.kind === 'citizen' && s.found);
  await step('summary: edit', (name, c) => ({
    method: 'PATCH', path: `/eq-events/${encodeURIComponent(event.publicID)}/summary`, body: { text: `E2E summary ${RUN}` }, cookie: c.citizen,
  }));
  await step('summary: the event after the edit', () => ({ path: `/eq-events/${encodeURIComponent(event.publicID)}` }));
  await step('summary: clear', (name, c) => ({ method: 'DELETE', path: `/eq-events/${encodeURIComponent(event.publicID)}/summary`, cookie: c.citizen }));
  await step('summary: the event after clearing', () => ({ path: `/eq-events/${encodeURIComponent(event.publicID)}` }));
  return citizen;
}

// A SeisComP event, as the messaging proxy sends it, with what each backend's live feed (SSE) sent
async function seiscompFlow() {
  const publicID = `e2e${RUN}`;
  const message = (fields = {}) => ({
    publicID, OT: new Date().toISOString(), latitude_value: 14.62, longitude_value: 121.1, depth_value: 12, magnitude_value: 4.6,
    eventType: 'NEW', method: 'automatic', text: 'Luzon, Philippines', last_modification: new Date().toISOString(), ...fields,
  });
  const base = message();
  const feeds = {};
  for (const name of NAMES) {
    const controller = new AbortController();
    const res = await fetch(`${url(name)}/messaging`, { signal: controller.signal });
    const reader = res.body.getReader();
    const chunks = [];
    (async () => {
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          chunks.push(Buffer.from(value).toString('utf8'));
        }
      } catch (_) { /* aborted */ }
    })();
    feeds[name] = { controller, chunks };
  }
  await step('seiscomp: a new event', () => ({ method: 'POST', path: '/messaging/restricted/new-event', body: base }));
  await new Promise((resolve) => setTimeout(resolve, 2000));
  const sseEvents = (name) => feeds[name].chunks.join('').split(/\n\n/)
    .map((block) => block.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join(''))
    .filter(Boolean)
    .map((data) => { try { return JSON.parse(data); } catch (_) { return data; } })
    .filter((data) => JSON.stringify(data).includes(publicID));
  const live = Object.fromEntries(NAMES.map((name) => [name, stabilized(sseEvents(name))]));
  const liveDiff = diff(live.mongodb, live.postgres);
  report.push({ step: 'seiscomp: the live feed (SSE) message', same: liveDiff.length === 0, status: null, differences: liveDiff.slice(0, 20) });
  baseline['seiscomp: the live feed (SSE) message'] = live.mongodb;
  console.log(`${liveDiff.length === 0 ? 'ok  ' : 'DIFF'} seiscomp: the live feed (SSE) message (${live.mongodb.length} message(s))`);
  NAMES.forEach((name) => feeds[name].controller.abort());

  // Ingest starts the station check at once (ONLINE_STATION_REFINEMENT_DELAY_MS), and it waits on
  // FDSN: compare the event once both backends' checks have finished, not mid-check
  const checked = async (name) => ((await send(name, { path: `/eq-events/${publicID}` })).body?.payload?.recordingAvailabilityAttempts || 0) >= 1;
  for (let waited = 0; waited < 60 && !(await Promise.all(NAMES.map(checked))).every(Boolean); waited += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  await step('seiscomp: the new event (after its station check)', () => ({ path: `/eq-events/${publicID}` }), {
    after: (name, c, res) => remember(c, res.body?.payload?._id, '<new event id>'),
    replace: ids,
  });
  await step('seiscomp: an older update (dropped)', () => ({
    method: 'POST', path: '/messaging/restricted/new-event', body: { ...base, eventType: 'UPDATE', magnitude_value: 3.0, last_modification: new Date(Date.parse(base.last_modification) - 60000).toISOString() },
  }));
  await step('seiscomp: a newer update', () => ({
    method: 'POST', path: '/messaging/restricted/new-event', body: { ...base, eventType: 'UPDATE', magnitude_value: 4.8, last_modification: new Date(Date.parse(base.last_modification) + 60000).toISOString() },
  }));
  await step('seiscomp: the event after the updates', () => ({ path: `/eq-events/${publicID}` }), { replace: ids });
}

async function compareWrites(outputDir = DEFAULT_OUTPUT_DIR) {
  const samples = JSON.parse(fs.readFileSync(path.join(outputDir, 'sample-accounts.json'), 'utf8'));
  // The newest earthquake with no summary: comments and the summary edit go on it
  const list = await (await fetch(`${url('mongodb')}/eq-events?startTime=1970-01-01T00:00:00.000Z&endTime=2100-01-01T00:00:00.000Z`)).json();
  const event = list.payload.find((e) => !e.summaryOverride);

  await accountsFlow();
  await sensorsFlow(samples);
  await commentsFlow(samples, event);
  await summaryFlow(samples, event);
  await seiscompFlow();

  fs.mkdirSync(path.join(outputDir, 'baseline'), { recursive: true });
  fs.writeFileSync(path.join(outputDir, 'api-writes.json'), `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(path.join(outputDir, 'baseline', 'api-writes.json'), `${JSON.stringify(baseline)}\n`);
  const failed = report.filter((r) => !r.same);
  console.log(`${report.length} steps, ${report.length - failed.length} the same, ${failed.length} different`);
  return { ok: failed.length === 0, report };
}

module.exports = { compareWrites };

if (require.main === module) {
  compareWrites(process.argv[2] ? path.resolve(process.argv[2]) : undefined)
    .then(({ ok }) => process.exit(ok ? 0 : 1))
    .catch((err) => { console.error(`compare-writes failed: ${err.stack || err.message}`); process.exit(2); });
}
