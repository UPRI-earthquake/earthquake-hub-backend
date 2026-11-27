// End-to-end check, API reads: calls every read endpoint the frontend uses, for every record, on the
// backend (start-backend.js), and compares each response field by field with the baseline's
// (baseline/api-reads.json). The first baseline was recorded on MongoDB (docs/e2e/E2E_RESULTS.md):
// the differences the migration documents (POSTGRES.md, "What the API shows differently") are counted
// apart; any other fails.
//
// --record saves this backend's responses as the baseline instead (the output folder must not hold one).
//
// Writes to the output folder (outside the repos: responses can hold production data):
//   api-reads.json            per endpoint: requests, identical, documented-only, undocumented (with paths)
//   baseline/api-reads.json   with --record: every response, under `${endpoint} ${key}`
//
//   node scripts/e2e/compare-api.js [output folder] [--record]
const fs = require('fs');
const path = require('path');
const { DEFAULT_OUTPUT_DIR, positional } = require('./env');
const { BACKEND, url } = require('./start-backend');

const ALL_TIME = 'startTime=1970-01-01T00:00:00.000Z&endTime=2100-01-01T00:00:00.000Z';

// --- Requests ---

async function call(requestPath, { cookie, origin } = {}) {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  if (origin) headers.Origin = origin;
  const res = await fetch(`${url()}${requestPath}`, { headers });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch (_) { body = text; }
  return { status: res.status, body };
}

async function signIn(username, password, role) {
  const origin = role === 'brgy' ? `http://localhost:${BACKEND.clientPort}` : undefined;
  const res = await fetch(`${url()}/accounts/authenticate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) },
    body: JSON.stringify({ username, password, role }),
  });
  if (res.status !== 200) throw new Error(`Signing in as a ${role} failed (${res.status})`);
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
  return [{ path: at, baseline: a, backend: b }];
}

// The differences POSTGRES.md documents for events, by the event field they're in: what MongoDB (the
// first baseline) showed, then what PostgreSQL shows
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
  if (!m || !p) return { documented: [], undocumented: [{ path: '(event)', baseline: Boolean(m), backend: Boolean(p) }] };
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

async function compareReads(outputDir = DEFAULT_OUTPUT_DIR, { record = false } = {}) {
  const baselineFile = path.join(outputDir, 'baseline', 'api-reads.json');
  if (record && fs.existsSync(baselineFile)) throw new Error(`${baselineFile} already exists: a baseline is never overwritten`);
  const saved = record ? {} : JSON.parse(fs.readFileSync(baselineFile, 'utf8'));
  const NOT_SAVED = { status: '(not in the baseline)', body: null };
  const report = {};
  const recordResult = (endpoint, key, m, p, classify = null) => {
    const entry = report[endpoint] || (report[endpoint] = { requests: 0, identical: 0, documentedOnly: 0, documentedFields: {}, undocumented: [] });
    entry.requests += 1;
    if (m.status !== p.status) {
      entry.undocumented.push({ key, path: '(status)', baseline: m.status, backend: p.status });
      return;
    }
    const result = classify ? classify(m.body, p.body) : { documented: [], undocumented: diff(m.body, p.body) };
    if (result.undocumented.length > 0) entry.undocumented.push(...result.undocumented.slice(0, 20).map((d) => ({ key, ...d })));
    else if (result.documented.length > 0) {
      entry.documentedOnly += 1;
      result.documented.forEach((field) => { entry.documentedFields[field] = (entry.documentedFields[field] || 0) + 1; });
    } else entry.identical += 1;
  };
  // One request: the backend's response, and the baseline's under `${endpoint} ${key}` (with --record,
  // the response is saved there)
  const request = async (endpoint, key, requestPath, session) => {
    const p = await call(requestPath, session);
    if (record) saved[`${endpoint} ${key}`] = p;
    return [record ? p : (saved[`${endpoint} ${key}`] || NOT_SAVED), p];
  };

  // Earthquakes: the whole list (compared per event, then the order), then every event's page. The
  // baseline keeps the list as one entry per event, in its order
  const LIST = 'GET /eq-events (each event in the list)';
  const pList = await call(`/eq-events?${ALL_TIME}`);
  if (record) (pList.body.payload || []).forEach((e) => { saved[`${LIST} ${e.publicID}`] = { status: pList.status, body: e }; });
  const entries = Object.entries(saved).filter(([key]) => key.startsWith(`${LIST} `)).map(([, value]) => value);
  const mList = { status: entries[0] && entries[0].status, body: { payload: entries.map((e) => e.body).filter(Boolean) } };
  const byPublicId = (list) => new Map((list.body.payload || []).map((e) => [e.publicID, e]));
  const mEvents = byPublicId(mList);
  const pEvents = byPublicId(pList);
  new Set([...mEvents.keys(), ...pEvents.keys()]).forEach((publicID) => {
    recordResult(LIST, publicID, { status: mList.status, body: mEvents.get(publicID) },
      { status: pList.status, body: pEvents.get(publicID) }, classifyEvent);
  });
  // Events with no place come last, in the order their GeoServe lookups end (addPlacesAttribute adds
  // each event as its lookup finishes), which varies from call to call: the rest are compared in order,
  // these as a set (E2E_RESULTS.md, finding 13)
  const order = (list) => (list.body.payload || []).map((e) => e.publicID);
  const noPlace = (list) => new Set((list.body.payload || []).filter((e) => e.place === 'Unavailable').map((e) => e.publicID));
  const [mOrder, pOrder] = [order(mList), order(pList)];
  const [mNoPlace, pNoPlace] = [noPlace(mList), noPlace(pList)];
  const withPlace = (ids, without) => JSON.stringify(ids.filter((id) => !without.has(id)));
  report['GET /eq-events (order)'] = {
    sameOrder: JSON.stringify(mOrder) === JSON.stringify(pOrder),
    sameOrderWithPlace: withPlace(mOrder, mNoPlace) === withPlace(pOrder, pNoPlace),
    sameEventsWithoutPlace: JSON.stringify([...mNoPlace].sort()) === JSON.stringify([...pNoPlace].sort()),
    withoutPlace: pNoPlace.size,
    baseline: mEvents.size,
    backend: pEvents.size,
  };

  const events = [...mEvents.values()];
  for (const event of events) {
    const [m, p] = await request('GET /eq-events/:publicID', event.publicID, `/eq-events/${encodeURIComponent(event.publicID)}`);
    recordResult('GET /eq-events/:publicID', event.publicID, m, p, (a, b) => classifyEvent(a && a.payload, b && b.payload));
  }

  // Comments: every event, then every page by cursor and by offset where there are any. The cursor is
  // the baseline's, as the first run sent MongoDB's to both backends
  for (const event of events) {
    const [m, p] = await request('GET /comments', event.publicID, `/comments?eventId=${event._id}&limit=100`);
    recordResult('GET /comments', event.publicID, m, p);
    const total = m.body?.pagination?.total || 0;
    if (total > 0) {
      let cursor = '';
      for (let page = 0; page < total + 1; page += 1) {
        const key = `${event.publicID} page ${page}`;
        const [mp, pp] = await request('GET /comments (by cursor)', key, `/comments?eventId=${event._id}&limit=1${cursor ? `&cursor=${cursor}` : ''}`);
        recordResult('GET /comments (by cursor)', key, mp, pp);
        cursor = mp.body?.pagination?.nextCursor;
        if (!cursor) break;
      }
      for (let offset = 0; offset < total; offset += 1) {
        const key = `${event.publicID} offset ${offset}`;
        const [mo, po] = await request('GET /comments (by offset)', key, `/comments?eventId=${event._id}&limit=1&offset=${offset}`);
        recordResult('GET /comments (by offset)', key, mo, po);
      }
    }
  }

  // Devices: the list, then every station's status. The list names the station `code`. A baseline from
  // the first run has no response per station (finding 12): those are compared with what its device
  // list showed instead
  const [mDevices, pDevices] = await request('GET /device/all', 'all', '/device/all');
  recordResult('GET /device/all', 'all', mDevices, pDevices);
  for (const device of (mDevices.body.payload || [])) {
    const station = device.code ?? device.station;
    const key = `${device.network}.${station}`;
    const requestPath = `/device/status?network=${encodeURIComponent(device.network)}&station=${encodeURIComponent(station)}`;
    if (record || saved[`GET /device/status ${key}`]) {
      const [m, p] = await request('GET /device/status', key, requestPath);
      recordResult('GET /device/status', key, m, p);
    } else {
      const p = await call(requestPath);
      const shown = (body) => (body && body.payload
        ? { network: body.payload.network, station: body.payload.station, activity: body.payload.activity } : body);
      recordResult('GET /device/status (vs the baseline\'s device list)', key,
        { status: 200, body: { network: device.network, station, activity: device.activity } }, { status: p.status, body: shown(p.body) });
    }
  }

  const [mHosts, pHosts] = await request('GET /accounts/ringserver-hosts', 'all', '/accounts/ringserver-hosts');
  recordResult('GET /accounts/ringserver-hosts', 'all', mHosts, pHosts);

  // Signed in as the sample accounts
  const samples = JSON.parse(fs.readFileSync(path.join(outputDir, 'sample-accounts.json'), 'utf8'));
  for (const sample of samples.accounts.filter((s) => s.found && s.kind !== 'admin')) {
    const session = await signIn(sample.username, samples.password, sample.kind === 'brgy' ? 'brgy' : 'citizen');
    for (const requestPath of ['/accounts/profile', '/device/my-devices']) {
      const [m, p] = await request(`GET ${requestPath}`, sample.kind, requestPath, session);
      recordResult(`GET ${requestPath}`, sample.kind, m, p);
    }
  }

  fs.writeFileSync(path.join(outputDir, 'api-reads.json'), `${JSON.stringify(report, null, 2)}\n`);
  if (record) {
    fs.mkdirSync(path.dirname(baselineFile), { recursive: true });
    fs.writeFileSync(baselineFile, `${JSON.stringify(saved)}\n`);
    console.log(`Recorded ${Object.keys(saved).length} responses in baseline/api-reads.json`);
    return { ok: true, report };
  }

  let ok = true;
  Object.entries(report).forEach(([endpoint, e]) => {
    if (e.requests === undefined) {
      const orderOk = e.sameOrderWithPlace && e.sameEventsWithoutPlace;
      if (!orderOk) ok = false;
      const detail = e.sameOrder ? 'same order'
        : `${e.sameOrderWithPlace ? 'same order' : 'DIFFERENT order'} for the events with a place; the ${e.withoutPlace} without one (last, in lookup order) ${e.sameEventsWithoutPlace ? 'are the same events' : 'DIFFER'}`;
      console.log(`${orderOk ? 'ok  ' : 'FAIL'} ${endpoint}: ${detail} (${e.baseline} / ${e.backend} events)`);
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
  const [outputArg] = positional();
  compareReads(outputArg ? path.resolve(outputArg) : undefined, { record: process.argv.includes('--record') })
    .then(({ ok }) => process.exit(ok ? 0 : 1))
    .catch((err) => { console.error(`compare-api failed: ${err.stack || err.message}`); process.exit(2); });
}
