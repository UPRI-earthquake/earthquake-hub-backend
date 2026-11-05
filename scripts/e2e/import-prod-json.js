// End-to-end check, step 1: loads a production MongoDB export (one JSON file per collection, as
// mongoexport writes them) into the end-to-end MongoDB (e2e/docker-compose.yml). Test-only: not part
// of the app.
//
//   1. Reads each file: one JSON array, or one document per line, in Extended JSON ($oid, $date...),
//      which restores ObjectIds and Dates. A plain-JSON export (ids and dates as strings) is refused:
//      its types would have to be rebuilt first.
//   2. Inspects it, structure only: fields this branch doesn't know or expects but doesn't find,
//      dates or numbers stored as text, references that point nowhere, usernames or emails that
//      clash ignoring case, and files the export doesn't include (uploaded images).
//   3. Makes it safe for testing, in the end-to-end copy only: every email becomes a fake one (two
//      that clash ignoring case still clash), and a few sample accounts get a known test password.
//      Nothing else changes: old shapes and odd values stay as production has them.
//   4. Loads it with the app's indexes built first, so a duplicate is rejected as production would.
//
// Writes import-report.json (no personal data: counts, field names, ids) and sample-accounts.json
// (usernames of the test accounts: personal, so both go to the output folder outside the repos).
//
//   node scripts/e2e/import-prod-json.js [export folder] [output folder]
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const { BSON } = require('mongodb');
const { DEFAULT_EXPORT_DIR, DEFAULT_OUTPUT_DIR, mongoUri } = require('./env');
const { CURRENT_PASSWORD_POLICY_VERSION } = require('../../src/controllers/helpers');

const TEST_PASSWORD = process.env.E2E_TEST_PASSWORD || 'E2e-Test-Password-2026!';

// The collections the app still uses, and their models (for indexes and known fields)
const COLLECTIONS = {
  accounts: '../../src/models/account.model',
  devices: '../../src/models/device.model',
  events: '../../src/models/events.model',
  comments: '../../src/models/comments.model',
  contributionevents: '../../src/models/contributionEvent.model',
};

const sha = (text) => crypto.createHash('sha256').update(text).digest('hex');
const idOf = (value) => (value === null || value === undefined ? null : String(value));
const count = (items) => items.reduce((counts, item) => ({ ...counts, [item]: (counts[item] || 0) + 1 }), {});

// --- 1. Reading ---

function findFile(dir, collection) {
  const files = fs.readdirSync(dir);
  return files.find((file) => file === `${collection}.json`) || files.find((file) => file.endsWith(`.${collection}.json`)) || null;
}

function readExport(file) {
  const text = fs.readFileSync(file, 'utf8').trim();
  const isArray = text.startsWith('[');
  const parts = isArray ? [text] : text.split(/\r?\n/).filter((line) => line.trim());
  const extended = /"\$oid"\s*:/.test(text);
  if (!extended) {
    throw new Error(`${path.basename(file)} is plain JSON (no $oid): ids and dates would load as strings. Export with mongoexport --jsonFormat=canonical, or rebuild the types first.`);
  }
  const docs = parts.flatMap((part) => {
    const parsed = BSON.EJSON.parse(part, { relaxed: true });
    return isArray ? parsed : [parsed];
  });
  return { docs, format: `${isArray ? 'one JSON array' : 'one document per line'}, Extended JSON ($oid, $date)` };
}

// --- 2. Inspection (structure only) ---

const topLevelPaths = (schema) => {
  const paths = new Set(['_id', '__v']);
  Object.keys(schema.paths).forEach((key) => paths.add(key.split('.')[0]));
  Object.keys(schema.nested || {}).forEach((key) => paths.add(key.split('.')[0]));
  return paths;
};
const pathsOfType = (schema, type) => Object.entries(schema.paths)
  .filter(([, schemaType]) => schemaType.instance === type)
  .map(([key]) => key)
  .filter((key) => !key.includes('.'));

function inspectCollection(name, docs, schema) {
  const known = topLevelPaths(schema);
  const unknown = count(docs.flatMap((doc) => Object.keys(doc).filter((key) => !known.has(key))));
  const missing = {};
  [...known].filter((key) => key !== '__v').forEach((key) => {
    const n = docs.filter((doc) => doc[key] === undefined).length;
    if (n > 0) missing[key] = n;
  });
  const textDates = {};
  pathsOfType(schema, 'Date').forEach((key) => {
    const n = docs.filter((doc) => typeof doc[key] === 'string').length;
    if (n > 0) textDates[key] = n;
  });
  const textNumbers = {};
  pathsOfType(schema, 'Number').forEach((key) => {
    const n = docs.filter((doc) => typeof doc[key] === 'string').length;
    if (n > 0) textNumbers[key] = n;
  });
  const findings = { unknownFields: unknown, missingFields: missing, datesAsText: textDates, numbersAsText: textNumbers };
  if (name === 'events') {
    findings.additionalInformationAsObject = docs.filter((doc) => doc.additionalInformation && !Array.isArray(doc.additionalInformation) && typeof doc.additionalInformation === 'object').length;
  }
  return findings;
}

function inspectReferences(data) {
  const ids = (collection) => new Set(data[collection].map((doc) => idOf(doc._id)));
  const accountIds = ids('accounts');
  const deviceIds = ids('devices');
  const eventIds = ids('events');
  const stations = new Set(data.devices.map((doc) => String(doc.station || '').trim().toUpperCase()));
  const dangling = (values, known) => values.filter((value) => value !== null && !known.has(value));

  const listed = data.accounts.flatMap((doc) => (doc.devices || []).map(idOf));
  const stationCodes = data.events.flatMap((doc) => [...(doc.candidateStations || []), ...(doc.recordingStations || [])]);
  return {
    accountDevicesToMissingDevices: { listed: listed.length, distinct: new Set(listed).size, missing: new Set(dangling(listed, deviceIds)).size },
    commentsWithMissingEvent: dangling(data.comments.map((doc) => idOf(doc.eventId)), eventIds).length,
    commentsWithMissingAccount: dangling(data.comments.map((doc) => idOf(doc.accountId)), accountIds).length,
    helpfulMarksByMissingAccounts: dangling(data.comments.flatMap((doc) => (doc.helpfulAccountIds || []).map(idOf)), accountIds).length,
    issueReportsByMissingAccounts: dangling(data.comments.flatMap((doc) => (doc.issueReports || []).map((r) => idOf(r && r.accountId))), accountIds).length,
    pointsWithMissingAccount: dangling(data.contributionevents.map((doc) => idOf(doc.accountId)), accountIds).length,
    pointsWithMissingEvent: dangling(data.contributionevents.map((doc) => idOf(doc.eventId)), eventIds).length,
    eventStationCodesWithNoDevice: stationCodes.filter((code) => !stations.has(String(code).trim().toUpperCase())).length,
  };
}

function caseClashes(docs, field) {
  const groups = Object.values(docs.reduce((acc, doc) => {
    const key = String(doc[field] || '').toLowerCase();
    if (key) acc[key] = [...(acc[key] || []), doc];
    return acc;
  }, {})).filter((group) => group.length > 1);
  return groups;
}

// --- 3. Making it safe for testing ---

// Every email becomes user-<hash>@example.invalid; emails that clash ignoring case get the same
// address in different cases, so they still clash ignoring case (and only then)
function fakeEmails(accounts) {
  const byLower = new Map();
  accounts.forEach((doc) => {
    const key = String(doc.email || '').toLowerCase();
    byLower.set(key, [...(byLower.get(key) || []), doc]);
  });
  byLower.forEach((group, lower) => {
    const local = `user-${sha(lower).slice(0, 12)}`;
    group.sort((a, b) => (idOf(a._id) < idOf(b._id) ? -1 : 1)).forEach((doc, i) => {
      doc.email = `${local.slice(0, i).toUpperCase()}${local.slice(i)}@example.invalid`;
    });
  });
}

// A known test password for the first account (by _id) of each kind the tests sign in as
function pickSampleAccounts(accounts) {
  const sorted = [...accounts].sort((a, b) => (idOf(a._id) < idOf(b._id) ? -1 : 1));
  const has = (doc, role) => Array.isArray(doc.roles) && doc.roles.includes(role);
  const kinds = {
    sensorOwner: (doc) => has(doc, 'citizen') && (doc.devices || []).length > 0,
    citizen: (doc) => has(doc, 'citizen') && (doc.devices || []).length === 0,
    brgy: (doc) => has(doc, 'brgy') && doc.isApproved === true,
    admin: (doc) => has(doc, 'admin'),
  };
  const hash = bcrypt.hashSync(TEST_PASSWORD, 10);
  return Object.entries(kinds).map(([kind, test]) => {
    const doc = sorted.find(test);
    if (!doc) return { kind, found: false };
    doc.password = hash;
    doc.passwordPolicyVersion = CURRENT_PASSWORD_POLICY_VERSION; // signs in without a policy upgrade write
    return { kind, found: true, id: idOf(doc._id), username: doc.username, roles: doc.roles };
  });
}

// --- 4. Loading ---

async function load(name, docs, Model) {
  const existing = await mongoose.connection.db.listCollections({ name }).toArray();
  if (existing.length > 0) await mongoose.connection.db.dropCollection(name);
  // The app's indexes (unique ones included), built before anything is inserted
  await Model.createCollection();
  await Model.createIndexes();
  if (docs.length === 0) return { imported: 0, rejected: [] };
  try {
    const result = await mongoose.connection.db.collection(name).insertMany(docs, { ordered: false });
    return { imported: result.insertedCount, rejected: [] };
  } catch (err) {
    if (!err.writeErrors) throw err;
    const writeErrors = Array.isArray(err.writeErrors) ? err.writeErrors : [err.writeErrors];
    const reasons = writeErrors.map((writeError) => (writeError.code === 11000
      ? `duplicate key ${JSON.stringify(Object.keys(writeError.err?.keyPattern || writeError.keyPattern || {}))}`
      : `error ${writeError.code}`));
    return { imported: err.result?.insertedCount ?? docs.length - writeErrors.length, rejected: Object.entries(count(reasons)).map(([reason, n]) => ({ reason, count: n })) };
  }
}

async function importExport(exportDir = DEFAULT_EXPORT_DIR, outputDir = DEFAULT_OUTPUT_DIR, { log = console.log } = {}) {
  const models = Object.fromEntries(Object.entries(COLLECTIONS).map(([name, modulePath]) => [name, require(modulePath)]));
  const data = {};
  const report = { exportDir: path.basename(exportDir), collections: {}, findings: {}, sampleAccounts: [] };

  for (const name of Object.keys(COLLECTIONS)) {
    const file = findFile(exportDir, name);
    if (!file) {
      data[name] = [];
      report.collections[name] = { file: null, read: 0, note: 'not in the export' };
      continue;
    }
    const { docs, format } = readExport(path.join(exportDir, file));
    data[name] = docs;
    report.collections[name] = { file, format, read: docs.length };
    report.findings[name] = inspectCollection(name, docs, models[name].schema);
  }
  report.findings.references = inspectReferences(data);
  report.findings.caseClashes = {
    usernames: caseClashes(data.accounts, 'username').length,
    emails: caseClashes(data.accounts, 'email').length,
  };
  report.findings.uploadedImagesNotInExport = data.comments.filter((doc) => doc.imageURL).length;

  fakeEmails(data.accounts);
  const samples = pickSampleAccounts(data.accounts);
  report.sampleAccounts = samples.map(({ username, ...rest }) => rest);

  // Indexes are built explicitly per collection, after it's emptied: Mongoose's own build on connect
  // would race the drop
  await mongoose.connect(mongoUri(), { autoIndex: false, autoCreate: false });
  try {
    for (const name of Object.keys(COLLECTIONS)) {
      Object.assign(report.collections[name], await load(name, data[name], models[name]));
      const stored = await mongoose.connection.db.collection(name).countDocuments();
      report.collections[name].inMongoDB = stored;
    }
  } finally {
    await mongoose.disconnect();
  }

  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, 'import-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(path.join(outputDir, 'sample-accounts.json'), `${JSON.stringify({ password: TEST_PASSWORD, accounts: samples }, null, 2)}\n`);

  log(`Imported ${report.exportDir} into the end-to-end MongoDB:`);
  Object.entries(report.collections).forEach(([name, c]) => {
    const rejected = (c.rejected || []).reduce((n, r) => n + r.count, 0);
    log(`  ${name}: read ${c.read}, imported ${c.imported ?? 0}, rejected ${rejected}${c.note ? ` (${c.note})` : ''}`);
  });
  log(`Sample accounts with the test password: ${samples.filter((s) => s.found).map((s) => s.kind).join(', ')}`);
  log(`Report: ${path.join(outputDir, 'import-report.json')}`);
  return report;
}

module.exports = { importExport };

if (require.main === module) {
  const [exportDir, outputDir] = process.argv.slice(2);
  importExport(exportDir ? path.resolve(exportDir) : undefined, outputDir ? path.resolve(outputDir) : undefined)
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(`import-prod-json failed: ${err.message}`);
      process.exit(2);
    });
}
