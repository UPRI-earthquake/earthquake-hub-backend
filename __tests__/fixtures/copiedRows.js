// Seeds PostgreSQL with records the way the copy from MongoDB (Phase 3) wrote them. The golden tests
// define their data as MongoDB stored it, and their recordings were made on MongoDB: seeded with these,
// the app on PostgreSQL must still give the recorded responses. The copy scripts were removed with
// MongoDB (they're in git history, before Phase 4 - Part 3); these keep their rules for the kinds of
// records the golden data has:
//   accounts   one row each; created when the MongoDB id says, unless createdAt is set
//   devices    owned by the non-brgy account that lists it; a brgy account's list becomes its
//              forwarded devices (brgy_forwarded_devices), in the list's order
//   releases   each account's releasedDevices[] entry becomes a device_releases row
//   events     one row each, with stations as links to the devices with those codes (codes with no
//              device left out), catalog matches in their order, and one status row per searched catalog
//   comments   one row each, with helpful marks and issue reports as rows
// Ids are MongoDB-style hex strings, as the golden data names records.
const { normalizeStations, toMatchColumns } = require('../../src/repositories/postgres/eventMappings');

const SEARCHED_SOURCES = ['phivolcs', 'usgs'];
const MATCH_SOURCES = new Set(['phivolcs', 'usgs', 'upri-legacy']);
const ENRICHMENT_STATUSES = new Set(['pending', 'done', 'no_match', 'failed']);
const RECORDING_STATUSES = new Set(['pending', 'partial', 'verified', 'unavailable']);
const COMMENT_STATUSES = new Set(['pending', 'approved', 'rejected']);
const ACTIVITIES = { active: 'active', streaming: 'active', inactive: 'inactive', unlinked: 'unlinked' };
const MAX_ENRICHMENT_ATTEMPTS = 3;

const isMissing = (value) => value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
const textOrNull = (value) => (isMissing(value) ? null : String(value));
const trimmedOrNull = (value) => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null);
const numberOrNull = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);
// Numbers, or numeric strings as Mongoose would have cast them
const toNumber = (value) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  return null;
};
const toDate = (value) => {
  if (value === null || value === undefined) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
};
const idOf = (value) => (isMissing(value) ? null : String(value));
// When a MongoDB id was made: its first 4 bytes, in seconds
const idTime = (id) => new Date(parseInt(String(id).slice(0, 8), 16) * 1000);
const createdAtOf = (doc) => toDate(doc.createdAt) || idTime(doc._id);

// Inserts the rows; resolves to Map(legacy id -> uuid)
async function insertByLegacyId(db, table, rows) {
  if (rows.length === 0) return new Map();
  const inserted = await db(table).insert(rows).returning(['id', 'legacy_mongo_id']);
  return new Map(inserted.map((row) => [row.legacy_mongo_id.trim(), row.id]));
}

/***************************************************************************
  * insertPeopleAndSensors:
  *     Accounts and devices (MongoDB `accounts` and `devices` documents), with device ownership,
  *     brgy forwarding and released devices.
  *     Resolves to { accountIds, deviceIds }: Map(legacy id -> uuid) each.
  ***************************************************************************/
async function insertPeopleAndSensors(db, { accounts = [], devices = [] }) {
  const accountIds = await insertByLegacyId(db, 'accounts', accounts.map((doc) => {
    const createdAt = createdAtOf(doc);
    return {
      legacy_mongo_id: idOf(doc._id),
      email: doc.email.trim(),
      username: doc.username,
      password_hash: doc.password,
      roles: [...new Set(doc.roles || [])],
      is_approved: Boolean(doc.isApproved),
      password_policy_version: Number.isInteger(doc.passwordPolicyVersion) ? doc.passwordPolicyVersion : 1,
      password_updated_at: toDate(doc.passwordUpdatedAt),
      password_reset_token_id: textOrNull(doc.passwordResetTokenId),
      password_reset_issued_at: toDate(doc.passwordResetIssuedAt),
      password_reset_used_at: toDate(doc.passwordResetUsedAt),
      ringserver_url: textOrNull(doc.ringserverUrl),
      ringserver_port: Number.isInteger(doc.ringserverPort) ? doc.ringserverPort : null,
      rshake_email_enabled: Boolean(doc.alertPreferences?.rshakeEmailEnabled),
      alert_prefs_updated_at: toDate(doc.alertPreferences?.updatedAt),
      created_at: createdAt,
      updated_at: toDate(doc.updatedAt) || createdAt,
    };
  }));

  // A device's owner: the one non-brgy account listing it. A brgy's list is the devices it forwards
  const known = new Set(devices.map((doc) => idOf(doc._id)));
  const owners = new Map();
  const brgyLinks = [];
  accounts.forEach((doc) => {
    const brgy = Array.isArray(doc.roles) && doc.roles.includes('brgy');
    (doc.devices || []).filter(Boolean).map(String).forEach((deviceId, position) => {
      if (!known.has(deviceId)) return;
      if (brgy) brgyLinks.push({ brgyId: idOf(doc._id), deviceId, position });
      else owners.set(deviceId, [...new Set([...(owners.get(deviceId) || []), idOf(doc._id)])]);
    });
  });
  const deviceIds = await insertByLegacyId(db, 'devices', devices.map((doc) => {
    const createdAt = createdAtOf(doc);
    const listedBy = owners.get(idOf(doc._id)) || [];
    return {
      legacy_mongo_id: idOf(doc._id),
      owner_account_id: listedBy.length === 1 ? accountIds.get(listedBy[0]) || null : null,
      network: doc.network,
      station: doc.station,
      description: textOrNull(doc.description),
      stream_id: textOrNull(doc.streamId),
      mac_address: textOrNull(doc.macAddress),
      latitude: doc.latitude,
      longitude: doc.longitude,
      elevation_m: doc.elevation,
      activity: ACTIVITIES[doc.activity] || 'inactive',
      activity_toggled_at: toDate(doc.activityToggleTime) || new Date(0),
      rshake_alert_credential_hash: textOrNull(doc.rshakeAlertCredentialHash),
      rshake_alert_credential_issued_at: toDate(doc.rshakeAlertCredentialIssuedAt),
      created_at: createdAt,
      updated_at: toDate(doc.updatedAt) || createdAt,
    };
  }));

  const releases = accounts.flatMap((doc) => (doc.releasedDevices || []).map((entry) => ({
    legacy_mongo_id: idOf(entry._id),
    account_id: accountIds.get(idOf(doc._id)),
    device_id: (entry.deviceId && deviceIds.get(String(entry.deviceId))) || null,
    device_legacy_mongo_id: idOf(entry.deviceId),
    network: textOrNull(entry.network),
    station: textOrNull(entry.station),
    stream_id: textOrNull(entry.streamId),
    mac_address: textOrNull(entry.macAddress),
    description: textOrNull(entry.description),
    latitude: numberOrNull(entry.latitude),
    longitude: numberOrNull(entry.longitude),
    elevation_m: numberOrNull(entry.elevation),
    reason: textOrNull(entry.reason) || 'unlink',
    released_at: toDate(entry.releasedAt) || createdAtOf(doc),
  })));
  if (releases.length > 0) await db('device_releases').insert(releases);

  // MongoDB didn't record when a brgy added a device: its list's order is kept
  const startedAt = Date.now();
  if (brgyLinks.length > 0) {
    await db('brgy_forwarded_devices').insert(brgyLinks.map((link) => ({
      brgy_account_id: accountIds.get(link.brgyId),
      device_id: deviceIds.get(link.deviceId),
      added_at: new Date(startedAt + link.position),
    })));
  }
  return { accountIds, deviceIds };
}

// One status row per searched catalog, from the bookkeeping MongoDB kept on the event: pending while in
// pendingCatalogSources, else its catalogEnrichmentStatus entry, else (older records) done if matched,
// no_match once the legacy upForEnrichment flag says enrichment finished, failed when its legacy attempts
// ran out, pending otherwise
const toStatusRows = (doc, eventId, matchedSources, updatedAt) => {
  const pending = new Set(normalizeStations(doc.pendingCatalogSources).map((source) => source.toLowerCase()));
  const statusMap = doc.catalogEnrichmentStatus && typeof doc.catalogEnrichmentStatus === 'object' ? doc.catalogEnrichmentStatus : {};
  const attemptsMap = doc.catalogEnrichmentAttempts && typeof doc.catalogEnrichmentAttempts === 'object' ? doc.catalogEnrichmentAttempts : {};
  const legacyAttempts = Math.max(0, Math.floor(toNumber(doc.enrichmentAttempts) || 0));
  const untracked = doc.pendingCatalogSources === undefined && Object.keys(statusMap).length === 0
    && doc.upForEnrichment === undefined && doc.enrichmentAttempts === undefined;
  return SEARCHED_SOURCES.map((source) => {
    let status;
    if (pending.has(source)) status = 'pending';
    else if (ENRICHMENT_STATUSES.has(statusMap[source])) status = statusMap[source];
    else if (matchedSources.has(source)) status = 'done';
    else if (doc.upForEnrichment === false) status = 'no_match';
    else if (doc.upForEnrichment === true && legacyAttempts >= MAX_ENRICHMENT_ATTEMPTS) status = 'failed';
    else status = 'pending';
    let attempts = toNumber(attemptsMap[source]);
    if (attempts === null) attempts = untracked ? 0 : legacyAttempts;
    return { event_id: eventId, source, status, attempts: Math.max(0, Math.floor(attempts)), updated_at: updatedAt };
  });
};

// additionalInformation entries, as the app reads them (an array; once an object keyed by catalog)
const catalogEntries = (additionalInformation) => {
  if (Array.isArray(additionalInformation)) return additionalInformation.filter((entry) => entry && typeof entry === 'object');
  if (additionalInformation && typeof additionalInformation === 'object') {
    return Object.entries(additionalInformation)
      .filter(([, value]) => value && typeof value === 'object')
      .map(([source, value]) => ({ source, ...value }));
  }
  return [];
};

/***************************************************************************
  * insertEvents:
  *     Earthquake events (MongoDB `events` documents), with their stations, catalog matches and
  *     enrichment status. The devices their station codes name must be inserted first.
  *     Resolves to Map(legacy id -> uuid).
  ***************************************************************************/
async function insertEvents(db, events) {
  const devicesByStation = new Map();
  (await db('devices').select('id', 'station')).forEach((row) => {
    const station = row.station.trim().toUpperCase();
    devicesByStation.set(station, [...(devicesByStation.get(station) || []), row.id]);
  });

  const rows = events.map((doc) => {
    const createdAt = createdAtOf(doc);
    const summaryText = textOrNull(doc.summaryOverride?.text);
    const attempts = toNumber(doc.recordingAvailabilityAttempts);
    return {
      legacy_mongo_id: idOf(doc._id),
      public_id: String(doc.publicID),
      source_catalog: textOrNull(doc.sourceCatalog) || 'upri-current',
      source_server: textOrNull(doc.sourceServer),
      source_seiscomp_version: textOrNull(doc.sourceSeiscompVersion),
      is_legacy_record: Boolean(doc.isLegacyRecord),
      legacy_imported_at: toDate(doc.legacyImportedAt),
      legacy_source_public_id: textOrNull(doc.legacySourcePublicID),
      origin_time: toDate(doc.OT),
      latitude: toNumber(doc.latitude_value),
      longitude: toNumber(doc.longitude_value),
      depth_km: toNumber(doc.depth_value),
      magnitude: toNumber(doc.magnitude_value),
      seiscomp_type: textOrNull(doc.type),
      region_text: textOrNull(doc.text),
      place: typeof doc.place === 'string' ? doc.place : null, // '' kept: the API showed it
      recording_status: RECORDING_STATUSES.has(doc.recordingAvailabilityStatus) ? doc.recordingAvailabilityStatus : 'pending',
      recording_checked_at: toDate(doc.recordingAvailabilityCheckedAt),
      recording_attempts: attempts !== null && attempts > 0 ? Math.floor(attempts) : 0,
      last_modification: toDate(doc.last_modification),
      summary_override_text: summaryText,
      summary_override_edited_at: summaryText ? toDate(doc.summaryOverride.editedAt) : null,
      summary_override_edited_by: summaryText ? textOrNull(doc.summaryOverride.editedBy) : null,
      created_at: createdAt,
      updated_at: toDate(doc.updatedAt) || createdAt,
    };
  });
  const eventIds = await insertByLegacyId(db, 'events', rows);

  for (const [i, doc] of events.entries()) {
    const row = rows[i];
    const eventId = eventIds.get(row.legacy_mongo_id);

    // Stations: candidateStations (older records: onlineStations) and recordingStations
    const hasCandidates = Array.isArray(doc.candidateStations) && doc.candidateStations.length > 0;
    const stationRows = [];
    [['candidate', normalizeStations(hasCandidates ? doc.candidateStations : doc.onlineStations)], ['recording', normalizeStations(doc.recordingStations)]]
      .forEach(([kind, codes]) => codes.forEach((code, position) => {
        const devices = devicesByStation.get(code) || [];
        if (devices.length === 1) stationRows.push({ event_id: eventId, device_id: devices[0], kind, position });
      }));
    if (stationRows.length > 0) await db('event_stations').insert(stationRows);

    // Catalog matches: the last entry per catalog, in the order they came
    const bySource = new Map();
    catalogEntries(doc.additionalInformation).forEach((entry) => {
      const source = String(entry.source ?? '').toLowerCase();
      if (MATCH_SOURCES.has(source)) bySource.set(source, entry);
    });
    const matchRows = [...bySource.entries()].map(([source, entry], position) => ({
      ...toMatchColumns(entry, source, position), event_id: eventId, created_at: row.created_at, updated_at: row.updated_at,
    }));
    if (matchRows.length > 0) await db('event_catalog_matches').insert(matchRows);

    await db('event_catalog_status').insert(toStatusRows(doc, eventId, new Set(bySource.keys()), row.updated_at));
  }
  return eventIds;
}

/***************************************************************************
  * insertComments:
  *     Comments (MongoDB `comments` documents): the event found by its MongoDB id, or else its
  *     publicID; the account by its MongoDB id. No status means approved (from before moderation).
  *     A helpful mark is dated with the comment's updatedAt (MongoDB kept no time per mark); an issue
  *     report with its own time, the latest per account. The accounts and events must be inserted first.
  ***************************************************************************/
async function insertComments(db, comments) {
  const idByLegacyId = async (table, value) => {
    const legacyId = idOf(value);
    return legacyId ? (await db(table).where({ legacy_mongo_id: legacyId }).first('id'))?.id ?? null : null;
  };
  for (const doc of comments) {
    const eventId = await idByLegacyId('events', doc.eventId)
      ?? (doc.eventPublicID ? (await db('events').where({ public_id: doc.eventPublicID }).first('id'))?.id : null);
    const createdAt = createdAtOf(doc);
    const updatedAt = toDate(doc.updatedAt) || createdAt;
    let status = 'approved';
    if (doc.status !== undefined && doc.status !== null) status = COMMENT_STATUSES.has(doc.status) ? doc.status : 'pending';
    const [{ id }] = await db('comments').insert({
      legacy_mongo_id: idOf(doc._id),
      comment_id: doc.commentId.toLowerCase(),
      event_id: eventId,
      account_id: await idByLegacyId('accounts', doc.accountId),
      username: trimmedOrNull(doc.username) || 'Anonymous',
      content: trimmedOrNull(doc.content),
      image_url: trimmedOrNull(doc.imageURL),
      status,
      moderated_by: textOrNull(doc.moderatedBy),
      moderated_at: toDate(doc.moderatedAt),
      created_at: createdAt,
      updated_at: updatedAt,
    }).returning('id');

    const marked = new Set();
    for (const value of doc.helpfulAccountIds || []) {
      const accountId = await idByLegacyId('accounts', value);
      if (accountId && !marked.has(accountId)) {
        marked.add(accountId);
        await db('comment_helpful_marks').insert({ comment_id: id, account_id: accountId, created_at: updatedAt });
      }
    }
    const latest = new Map();
    for (const report of doc.issueReports || []) {
      const accountId = await idByLegacyId('accounts', report?.accountId);
      if (!accountId) continue;
      const row = { comment_id: id, account_id: accountId, reason: report.reason, created_at: toDate(report.createdAt) || updatedAt };
      const earlier = latest.get(accountId);
      if (!earlier || row.created_at >= earlier.created_at) latest.set(accountId, row);
    }
    if (latest.size > 0) await db('comment_issue_reports').insert([...latest.values()]);
  }
}

module.exports = { insertPeopleAndSensors, insertEvents, insertComments };
