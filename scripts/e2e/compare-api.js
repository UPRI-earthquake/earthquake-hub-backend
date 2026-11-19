// End-to-end check, API reads: calls every read endpoint the frontend uses, for every record, on both
// backends (start-backends.js) and compares the responses field by field. Differences the migration
// documents (POSTGRES.md, "What the API shows differently") are counted apart; any other fails.
//
// Writes to the output folder (outside the repos: responses hold production data):
//   api-reads.json            per endpoint: requests, identical, documented-only, undocumented (with paths)
//   baseline/api-reads.json   every MongoDB response, the baseline for the re-run after Part 4
//
// Re-run after Part 4 (--baseline): MongoDB is gone, so its side is the saved baseline/api-reads.json
// and only the postgres backend is called. Writes rerun/api-reads.json; the baseline is never changed.
//
//   node scripts/e2e/compare-api.js [output folder] [--baseline]
const fs = require('fs');
const path = require('path');
const { DEFAULT_OUTPUT_DIR } = require('./env');
const { BACKENDS, url, positional } = require('./start-backends');

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

async function compareReads(outputDir = DEFAULT_OUTPUT_DIR, { baseline: useBaseline = false } = {}) {
  const report = {};
  const baseline = {};
  const saved = useBaseline ? JSON.parse(fs.readFileSync(path.join(outputDir, 'baseline', 'api-reads.json'), 'utf8')) : null;
  const NOT_SAVED = { status: '(not in the baseline)', body: null };
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
  // One request on both sides. With --baseline, MongoDB's side is its saved response, under the key
  // the first run recorded it with (`${endpoint} ${key}`)
  const both = async (requestPath, sessions = {}, savedKey = null) => {
    if (!useBaseline) return Promise.all(['mongodb', 'postgres'].map((name) => call(name, requestPath, sessions[name])));
    return [saved[savedKey] || NOT_SAVED, await call('postgres', requestPath, sessions.postgres)];
  };

  // Earthquakes: the whole list (compared per event, then the order), then every event's page. The
  // baseline keeps the list as one entry per event, in MongoDB's order
  const LIST = 'GET /eq-events (each event in the list)';
  let mList;
  let pList;
  if (useBaseline) {
    const entries = Object.entries(saved).filter(([key]) => key.startsWith(`${LIST} `)).map(([, value]) => value);
    mList = { status: entries[0] && entries[0].status, body: { payload: entries.map((e) => e.body).filter(Boolean) } };
    pList = await call('postgres', `/eq-events?${ALL_TIME}`);
  } else {
    [mList, pList] = await both(`/eq-events?${ALL_TIME}`);
  }
  const byPublicId = (list) => new Map((list.body.payload || []).map((e) => [e.publicID, e]));
  const mEvents = byPublicId(mList);
  const pEvents = byPublicId(pList);
  new Set([...mEvents.keys(), ...pEvents.keys()]).forEach((publicID) => {
    record(LIST, publicID, { status: mList.status, body: mEvents.get(publicID) },
      { status: pList.status, body: pEvents.get(publicID) }, classifyEvent);
  });
  // Events with no place come last, in the order their GeoServe lookups end (addPlacesAttribute adds
  // each event as its lookup finishes), which varies from call to call on either database: the rest
  // are compared in order, these as a set
  const order = (list) => (list.body.payload || []).map((e) => e.publicID);
  const noPlace = (list) => new Set((list.body.payload || []).filter((e) => e.place === 'Unavailable').map((e) => e.publicID));
  const [mOrder, pOrder] = [order(mList), order(pList)];
  const [mNoPlace, pNoPlace] = [noPlace(mList), noPlace(pList)];
  const withPlace = (ids, without) => JSON.stringify(ids.filter((id) => !without.has(id)));
  const firstMoved = mOrder.findIndex((publicID, i) => pOrder[i] !== publicID);
  report['GET /eq-events (order)'] = {
    sameOrder: JSON.stringify(mOrder) === JSON.stringify(pOrder),
    sameOrderWithPlace: withPlace(mOrder, mNoPlace) === withPlace(pOrder, pNoPlace),
    sameEventsWithoutPlace: JSON.stringify([...mNoPlace].sort()) === JSON.stringify([...pNoPlace].sort()),
    withoutPlace: pNoPlace.size,
    mongodb: mEvents.size,
    postgres: pEvents.size,
    ...(firstMoved >= 0 ? { firstDifference: { position: firstMoved, mongodb: mOrder[firstMoved], postgres: pOrder[firstMoved] } } : {}),
  };

  const events = [...mEvents.values()];
  for (const event of events) {
    const [m, p] = await both(`/eq-events/${encodeURIComponent(event.publicID)}`, {}, `GET /eq-events/:publicID ${event.publicID}`);
    record('GET /eq-events/:publicID', event.publicID, m, p, (a, b) => classifyEvent(a && a.payload, b && b.payload));
  }

  // Comments: every event, then every page by cursor and by offset where there are any
  for (const event of events) {
    const [m, p] = await both(`/comments?eventId=${event._id}&limit=100`, {}, `GET /comments ${event.publicID}`);
    record('GET /comments', event.publicID, m, p);
    const total = m.body?.pagination?.total || 0;
    if (total > 0) {
      let cursor = '';
      for (let page = 0; page < total + 1; page += 1) {
        const key = `${event.publicID} page ${page}`;
        const [mp, pp] = await both(`/comments?eventId=${event._id}&limit=1${cursor ? `&cursor=${cursor}` : ''}`, {}, `GET /comments (by cursor) ${key}`);
        record('GET /comments (by cursor)', key, mp, pp);
        cursor = mp.body?.pagination?.nextCursor;
        if (!cursor) break;
      }
      for (let offset = 0; offset < total; offset += 1) {
        const key = `${event.publicID} offset ${offset}`;
        const [mo, po] = await both(`/comments?eventId=${event._id}&limit=1&offset=${offset}`, {}, `GET /comments (by offset) ${key}`);
        record('GET /comments (by offset)', key, mo, po);
      }
    }
  }

  // Devices: the list, then every station's status. The list names the station `code`: the first run
  // read `station`, so it asked for station=undefined every time (E2E_RESULTS.md, "Re-run after Part 4")
  const [mDevices, pDevices] = await both('/device/all', {}, 'GET /device/all all');
  record('GET /device/all', 'all', mDevices, pDevices);
  for (const device of (mDevices.body.payload || [])) {
    const station = device.code ?? device.station;
    const requestPath = `/device/status?network=${encodeURIComponent(device.network)}&station=${encodeURIComponent(station)}`;
    if (useBaseline) {
      // The baseline has no MongoDB response per station: compare with what MongoDB's device list showed
      const p = await call('postgres', requestPath);
      const shown = (body) => (body && body.payload
        ? { network: body.payload.network, station: body.payload.station, activity: body.payload.activity } : body);
      record('GET /device/status (vs the MongoDB device list)', `${device.network}.${station}`,
        { status: 200, body: { network: device.network, station, activity: device.activity } }, { status: p.status, body: shown(p.body) });
    } else {
      const [m, p] = await both(requestPath);
      record('GET /device/status', `${device.network}.${station}`, m, p);
    }
  }

  const [mHosts, pHosts] = await both('/accounts/ringserver-hosts', {}, 'GET /accounts/ringserver-hosts all');
  record('GET /accounts/ringserver-hosts', 'all', mHosts, pHosts);

  // Signed in as the sample accounts
  const samples = JSON.parse(fs.readFileSync(path.join(outputDir, 'sample-accounts.json'), 'utf8'));
  for (const sample of samples.accounts.filter((s) => s.found && s.kind !== 'admin')) {
    const role = sample.kind === 'brgy' ? 'brgy' : 'citizen';
    const sessions = { postgres: await signIn('postgres', sample.username, samples.password, role) };
    if (!useBaseline) sessions.mongodb = await signIn('mongodb', sample.username, samples.password, role);
    for (const requestPath of ['/accounts/profile', '/device/my-devices']) {
      const [m, p] = await both(requestPath, sessions, `GET ${requestPath} ${sample.kind}`);
      record(`GET ${requestPath}`, sample.kind, m, p);
    }
  }

  const reportDir = useBaseline ? path.join(outputDir, 'rerun') : outputDir;
  fs.mkdirSync(reportDir, { recursive: true });
  fs.writeFileSync(path.join(reportDir, 'api-reads.json'), `${JSON.stringify(report, null, 2)}\n`);
  if (!useBaseline) {
    fs.mkdirSync(path.join(outputDir, 'baseline'), { recursive: true });
    fs.writeFileSync(path.join(outputDir, 'baseline', 'api-reads.json'), `${JSON.stringify(baseline)}\n`);
  }

  let ok = true;
  Object.entries(report).forEach(([endpoint, e]) => {
    if (e.requests === undefined) {
      const orderOk = e.sameOrderWithPlace && e.sameEventsWithoutPlace;
      if (!orderOk) ok = false;
      const detail = e.sameOrder ? 'same order'
        : `${e.sameOrderWithPlace ? 'same order' : 'DIFFERENT order'} for the events with a place; the ${e.withoutPlace} without one (last, in lookup order) ${e.sameEventsWithoutPlace ? 'are the same events' : 'DIFFER'}`;
      console.log(`${orderOk ? 'ok  ' : 'FAIL'} ${endpoint}: ${detail} (${e.mongodb} / ${e.postgres} events)`);
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
  compareReads(outputArg ? path.resolve(outputArg) : undefined, { baseline: process.argv.includes('--baseline') })
    .then(({ ok }) => process.exit(ok ? 0 : 1))
    .catch((err) => { console.error(`compare-api failed: ${err.stack || err.message}`); process.exit(2); });
}
