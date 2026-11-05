// End-to-end check, API reads: calls every read endpoint the frontend uses, for every record, on both
// backends (start-backends.js) and compares the responses field by field. Differences the migration
// documents (POSTGRES.md, "What the API shows differently") are counted apart; any other fails.
//
// Writes to the output folder (outside the repos: responses hold production data):
//   api-reads.json            per endpoint: requests, identical, documented-only, undocumented (with paths)
//   baseline/api-reads.json   every MongoDB response, the baseline for the re-run after Part 4
//
//   node scripts/e2e/compare-api.js [output folder]
const fs = require('fs');
const path = require('path');
const { DEFAULT_OUTPUT_DIR } = require('./env');
const { BACKENDS, url } = require('./start-backends');

const ALL_TIME = 'startTime=1970-01-01T00:00:00.000Z&endTime=2100-01-01T00:00:00.000Z';

// --- Requests ---

async function call(name, requestPath, { cookie, origin } = {}) {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  if (origin) headers.Origin = origin;
  const res = await fetch(`${url(name)}${requestPath}`, { headers });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch (_) { body = text; }
  return { status: res.status, body };
}

async function signIn(name, username, password, role) {
  const origin = role === 'brgy' ? `http://localhost:${BACKENDS[name].clientPort}` : undefined;
  const res = await fetch(`${url(name)}/accounts/authenticate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) },
    body: JSON.stringify({ username, password, role }),
  });
  if (res.status !== 200) throw new Error(`${name}: signing in as a ${role} failed (${res.status})`);
  const cookies = (res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie')]).filter(Boolean);
  return { cookie: cookies.map((c) => c.split(';')[0]).join('; '), origin };
}

// --- Comparing ---

function diff(a, b, at = '') {
  if (Object.is(a, b)) return [];
  const isObject = (v) => v && typeof v === 'object';
  if (Array.isArray(a) && Array.isArray(b)) {
    const out = [];
    for (let i = 0; i < Math.max(a.length, b.length); i += 1) out.push(...diff(a[i], b[i], `${at}[${i}]`));
    return out;
  }
  if (isObject(a) && isObject(b) && !Array.isArray(a) && !Array.isArray(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    return [...keys].flatMap((key) => diff(a[key], b[key], at ? `${at}.${key}` : key));
  }
  return [{ path: at, mongodb: a, postgres: b }];
}

// The differences POSTGRES.md documents for events, by the event field they're in
const sameSet = (a, b) => JSON.stringify([...(a || [])].sort()) === JSON.stringify([...(b || [])].sort());
const EVENT_DOCUMENTED = {
  legacyImportedAt: (m, p) => (m === undefined && p === null) || (m === null && p === undefined),
  legacySourcePublicID: (m, p) => (m === undefined && p === null) || (m === null && p === undefined),
  catalogEnrichmentAttempts: () => true,
  catalogEnrichmentStatus: () => true,
  createdAt: (m) => m === undefined,
  __v: (m) => m === undefined,
  candidateStations: (m, p, me) => (m === undefined || (Array.isArray(m) && m.length === 0)) && sameSet(p, me.onlineStations),
  onlineStations: (m, p) => sameSet(m, p),
};

// Groups an event's field differences: documented (allowed) or not
function classifyEvent(m, p) {
  const result = { documented: [], undocumented: [] };
  if (!m || !p) return { documented: [], undocumented: [{ path: '(event)', mongodb: Boolean(m), postgres: Boolean(p) }] };
  new Set([...Object.keys(m), ...Object.keys(p)]).forEach((field) => {
    const differences = diff(m[field], p[field], field);
    if (differences.length === 0) return;
    const rule = EVENT_DOCUMENTED[field];
    if (rule && rule(m[field], p[field], m)) result.documented.push(field);
    else result.undocumented.push(...differences);
  });
  return result;
}

// --- The run ---

async function compareReads(outputDir = DEFAULT_OUTPUT_DIR) {
  const report = {};
  const baseline = {};
  const record = (endpoint, key, m, p, classify = null) => {
    const entry = report[endpoint] || (report[endpoint] = { requests: 0, identical: 0, documentedOnly: 0, documentedFields: {}, undocumented: [] });
    entry.requests += 1;
    baseline[`${endpoint} ${key}`] = m;
    if (m.status !== p.status) {
      entry.undocumented.push({ key, path: '(status)', mongodb: m.status, postgres: p.status });
      return;
    }
    const result = classify ? classify(m.body, p.body) : { documented: [], undocumented: diff(m.body, p.body) };
    if (result.undocumented.length > 0) entry.undocumented.push(...result.undocumented.slice(0, 20).map((d) => ({ key, ...d })));
    else if (result.documented.length > 0) {
      entry.documentedOnly += 1;
      result.documented.forEach((field) => { entry.documentedFields[field] = (entry.documentedFields[field] || 0) + 1; });
    } else entry.identical += 1;
  };
  const both = async (requestPath, sessions = {}) => Promise.all(['mongodb', 'postgres'].map((name) => call(name, requestPath, sessions[name])));

  // Earthquakes: the whole list (compared per event, then the order), then every event's page
  const [mList, pList] = await both(`/eq-events?${ALL_TIME}`);
  const byPublicId = (list) => new Map((list.body.payload || []).map((e) => [e.publicID, e]));
  const mEvents = byPublicId(mList);
  const pEvents = byPublicId(pList);
  new Set([...mEvents.keys(), ...pEvents.keys()]).forEach((publicID) => {
    record('GET /eq-events (each event in the list)', publicID, { status: mList.status, body: mEvents.get(publicID) },
      { status: pList.status, body: pEvents.get(publicID) }, classifyEvent);
  });
  const order = (list) => (list.body.payload || []).map((e) => e.publicID);
  report['GET /eq-events (order)'] = { sameOrder: JSON.stringify(order(mList)) === JSON.stringify(order(pList)), mongodb: mEvents.size, postgres: pEvents.size };

  const events = [...mEvents.values()];
  for (const event of events) {
    const [m, p] = await both(`/eq-events/${encodeURIComponent(event.publicID)}`);
    record('GET /eq-events/:publicID', event.publicID, m, p, (a, b) => classifyEvent(a && a.payload, b && b.payload));
  }

  // Comments: every event, then every page by cursor and by offset where there are any
  for (const event of events) {
    const [m, p] = await both(`/comments?eventId=${event._id}&limit=100`);
    record('GET /comments', event.publicID, m, p);
    const total = m.body?.pagination?.total || 0;
    if (total > 0) {
      let cursor = '';
      for (let page = 0; page < total + 1; page += 1) {
        const [mp, pp] = await both(`/comments?eventId=${event._id}&limit=1${cursor ? `&cursor=${cursor}` : ''}`);
        record('GET /comments (by cursor)', `${event.publicID} page ${page}`, mp, pp);
        cursor = mp.body?.pagination?.nextCursor;
        if (!cursor) break;
      }
      for (let offset = 0; offset < total; offset += 1) {
        const [mo, po] = await both(`/comments?eventId=${event._id}&limit=1&offset=${offset}`);
        record('GET /comments (by offset)', `${event.publicID} offset ${offset}`, mo, po);
      }
    }
  }

  // Devices: the list, then every station's status
  const [mDevices, pDevices] = await both('/device/all');
  record('GET /device/all', 'all', mDevices, pDevices);
  for (const device of (mDevices.body.payload || [])) {
    const [m, p] = await both(`/device/status?network=${encodeURIComponent(device.network)}&station=${encodeURIComponent(device.station)}`);
    record('GET /device/status', `${device.network}.${device.station}`, m, p);
  }

  const [mHosts, pHosts] = await both('/accounts/ringserver-hosts');
  record('GET /accounts/ringserver-hosts', 'all', mHosts, pHosts);

  // Signed in as the sample accounts
  const samples = JSON.parse(fs.readFileSync(path.join(outputDir, 'sample-accounts.json'), 'utf8'));
  for (const sample of samples.accounts.filter((s) => s.found && s.kind !== 'admin')) {
    const role = sample.kind === 'brgy' ? 'brgy' : 'citizen';
    const sessions = {
      mongodb: await signIn('mongodb', sample.username, samples.password, role),
      postgres: await signIn('postgres', sample.username, samples.password, role),
    };
    for (const requestPath of ['/accounts/profile', '/device/my-devices']) {
      const [m, p] = await both(requestPath, sessions);
      record(`GET ${requestPath}`, sample.kind, m, p);
    }
  }

  fs.mkdirSync(path.join(outputDir, 'baseline'), { recursive: true });
  fs.writeFileSync(path.join(outputDir, 'api-reads.json'), `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(path.join(outputDir, 'baseline', 'api-reads.json'), `${JSON.stringify(baseline)}\n`);

  let ok = true;
  Object.entries(report).forEach(([endpoint, e]) => {
    if (e.requests === undefined) {
      console.log(`${e.sameOrder ? 'ok  ' : 'DIFF'} ${endpoint}: ${e.sameOrder ? 'same order' : 'different order'} (${e.mongodb} / ${e.postgres} events)`);
      return;
    }
    const failed = e.undocumented.length > 0;
    if (failed) ok = false;
    const documented = Object.entries(e.documentedFields).map(([f, n]) => `${f} ${n}`).join(', ');
    console.log(`${failed ? 'FAIL' : 'ok  '} ${endpoint}: ${e.requests} requests, ${e.identical} identical, ${e.documentedOnly} documented differences only${documented ? ` (${documented})` : ''}${failed ? `, ${e.undocumented.length} undocumented` : ''}`);
  });
  return { ok, report };
}

module.exports = { compareReads, diff };

if (require.main === module) {
  compareReads(process.argv[2] ? path.resolve(process.argv[2]) : undefined)
    .then(({ ok }) => process.exit(ok ? 0 : 1))
    .catch((err) => { console.error(`compare-api failed: ${err.stack || err.message}`); process.exit(2); });
}
