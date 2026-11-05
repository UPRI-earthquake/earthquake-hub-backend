// End-to-end check: after the copy, compares every table in the end-to-end PostgreSQL with the end-to-end
// MongoDB it was copied from. Counts per table (MongoDB, PostgreSQL, and what the copy reported
// skipping), then every record's links: each comment's event and author, each device's owner, each
// event's stations. Reports ids and counts only.
const mongoose = require('mongoose');
const { normalizeStations } = require('../../src/repositories/postgres/eventMappings');

const idOf = (value) => (value === null || value === undefined ? null : String(value).trim());
const pgCount = async (db, table) => Number((await db(table).count({ n: '*' }).first()).n);

/***************************************************************************
  * checkTables:
  *     Inputs:  db (Knex, end-to-end PostgreSQL), copies: the results of the three copy scripts
  *              ({ peopleAndSensors, earthquakes, community }); Mongoose must be connected.
  *     Returns: { counts: [{ table, mongodb, postgresql, copyReport, addsUp }], links: {...}, ok }
  ***************************************************************************/
async function checkTables({ db, copies }) {
  const mongo = (name) => mongoose.connection.db.collection(name).find({}).toArray();
  const [accounts, devices, events, comments, points] = await Promise.all(
    ['accounts', 'devices', 'events', 'comments', 'contributionevents'].map(mongo),
  );
  const { peopleAndSensors: ps, earthquakes: eq, community: cm } = copies;

  // --- Counts ---
  const skipped = (part) => (part.skipped || []).length;
  const row = async (table, mongodb, postgresTable, copied, copyReport) => {
    const postgresql = await pgCount(db, postgresTable);
    return { table, mongodb, postgresql, copyReport, addsUp: postgresql === copied };
  };
  const counts = [
    await row('accounts', accounts.length, 'accounts', accounts.length - skipped(ps.accounts), { skipped: skipped(ps.accounts) }),
    await row('devices', devices.length, 'devices', devices.length - skipped(ps.devices), { skipped: skipped(ps.devices) }),
    await row('device releases', accounts.reduce((n, a) => n + (a.releasedDevices || []).length, 0), 'device_releases',
      ps.releases.inserted + (ps.releases.alreadyCopied || 0), { inserted: ps.releases.inserted }),
    await row('brgy forwarding', null, 'brgy_forwarded_devices', ps.forwarding.inserted + (ps.forwarding.alreadyCopied || 0),
      { inserted: ps.forwarding.inserted }),
    await row('events', events.length, 'events', events.length - skipped(eq.events), { skipped: skipped(eq.events) }),
    await row('event stations', eq.stations.mongoTotal, 'event_stations', eq.stations.written + eq.stations.keptWithEvent,
      { written: eq.stations.written, unmatched: eq.stations.unmatched.length, ambiguous: eq.stations.ambiguous.length }),
    await row('event catalog matches', eq.matches.mongoTotal, 'event_catalog_matches', eq.matches.written + eq.matches.keptWithEvent,
      { written: eq.matches.written, unknownSource: eq.matches.unknownSource.length, duplicates: eq.matches.duplicates.length }),
    await row('event catalog status', null, 'event_catalog_status', eq.status.written + eq.status.keptWithEvent, { written: eq.status.written }),
    await row('comments', comments.length, 'comments', comments.length - skipped(cm.comments), { skipped: skipped(cm.comments) }),
    await row('helpful marks', cm.marks.mongoTotal, 'comment_helpful_marks', cm.marks.written + cm.marks.keptWithComment, { written: cm.marks.written }),
    await row('issue reports', cm.reports.mongoTotal, 'comment_issue_reports', cm.reports.written + cm.reports.keptWithComment, { written: cm.reports.written }),
    await row('contribution points', points.length, 'contribution_events', cm.points.inserted + cm.points.alreadyCopied,
      { skipped: cm.points.skipped.length, alreadyCounted: cm.points.alreadyCounted.length }),
  ];

  // --- Links ---
  // Each copied comment: the same event (by its MongoDB id, or by publicID) and the same author
  const eventsById = new Map(events.map((e) => [idOf(e._id), e]));
  const pgComments = await db('comments AS c').join('events AS e', 'e.id', 'c.event_id').leftJoin('accounts AS a', 'a.id', 'c.account_id')
    .select('c.legacy_mongo_id', 'e.legacy_mongo_id AS event_legacy', 'e.public_id', 'a.legacy_mongo_id AS account_legacy', 'c.account_id');
  const pgAccountIds = new Set((await db('accounts').select('legacy_mongo_id')).map((r) => idOf(r.legacy_mongo_id)));
  const commentsById = new Map(comments.map((c) => [idOf(c._id), c]));
  const commentLinks = pgComments.map((row) => {
    const doc = commentsById.get(idOf(row.legacy_mongo_id));
    const event = eventsById.get(idOf(doc.eventId));
    const expectedPublicId = event ? event.publicID : doc.eventPublicID;
    const expectedAuthor = doc.accountId && pgAccountIds.has(idOf(doc.accountId)) ? idOf(doc.accountId) : null;
    return { id: idOf(row.legacy_mongo_id), eventOk: row.public_id === expectedPublicId, authorOk: idOf(row.account_legacy) === expectedAuthor };
  });

  // Each device a citizen account lists: owned by that account in PostgreSQL
  const owners = new Map((await db('devices AS d').leftJoin('accounts AS a', 'a.id', 'd.owner_account_id')
    .select('d.legacy_mongo_id', 'a.legacy_mongo_id AS owner')).map((r) => [idOf(r.legacy_mongo_id), idOf(r.owner)]));
  const ownership = accounts
    .filter((a) => !(a.roles || []).includes('brgy'))
    .flatMap((a) => (a.devices || []).map((d) => ({ account: idOf(a._id), device: idOf(d) })))
    .filter(({ device }) => owners.has(device))
    .map(({ account, device }) => ({ device, ok: owners.get(device) === account }));

  // Each event's station lists, in order, minus codes the copy reported as matching no single device
  const stationRows = await db('event_stations AS s').join('events AS e', 'e.id', 's.event_id').join('devices AS d', 'd.id', 's.device_id')
    .select('e.legacy_mongo_id', 's.kind', 's.position', 'd.station').orderBy(['e.legacy_mongo_id', 's.kind', 's.position']);
  const stored = new Map();
  stationRows.forEach((r) => {
    const key = `${idOf(r.legacy_mongo_id)}|${r.kind}`;
    stored.set(key, [...(stored.get(key) || []), r.station.toUpperCase()]);
  });
  const deviceStations = new Map();
  devices.forEach((d) => {
    const code = String(d.station || '').trim().toUpperCase();
    deviceStations.set(code, (deviceStations.get(code) || 0) + 1);
  });
  const copiedEvents = new Set((await db('events').select('legacy_mongo_id')).map((r) => idOf(r.legacy_mongo_id)));
  const stationLinks = events.filter((e) => copiedEvents.has(idOf(e._id))).map((e) => {
    const hasCandidates = Array.isArray(e.candidateStations) && e.candidateStations.length > 0;
    const expected = {
      candidate: normalizeStations(hasCandidates ? e.candidateStations : e.onlineStations).filter((code) => deviceStations.get(code) === 1),
      recording: normalizeStations(e.recordingStations).filter((code) => deviceStations.get(code) === 1),
    };
    const ok = ['candidate', 'recording'].every((kind) => JSON.stringify(stored.get(`${idOf(e._id)}|${kind}`) || []) === JSON.stringify(expected[kind]));
    return { id: idOf(e._id), ok };
  });

  const failed = (items, ...keys) => items.filter((item) => keys.some((key) => !item[key])).map((item) => item.id || item.device);
  const links = {
    comments: { checked: commentLinks.length, failed: failed(commentLinks, 'eventOk', 'authorOk') },
    deviceOwners: { checked: ownership.length, failed: failed(ownership, 'ok') },
    eventStations: { checked: stationLinks.length, failed: failed(stationLinks, 'ok') },
  };
  const ok = counts.every((c) => c.addsUp) && Object.values(links).every((l) => l.failed.length === 0);
  return { counts, links, ok };
}

module.exports = { checkTables };
