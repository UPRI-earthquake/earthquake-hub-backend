// Carries the hand-written details of the old significant earthquakes (MongoDB `significant-eqs`) over to
// their events in PostgreSQL. The list itself isn't copied: the significance score picks it now
// (src/services/significance.js). Safe to run more than once: it only fills in what's missing.
//
//   1. Each entry is matched to the event within 1 day and 150 km of it, with the closest magnitude
//      (then the nearest, then the lowest public_id). Skipped and reported: an entry with no usable
//      latitude, longitude, magnitude or eventTime; no matching event; a second entry matching an event
//      another entry already matched.
//   2. Its summary (eventSummary) becomes the event's summaryOverride, only where the event has none:
//      a summary an admin wrote is kept.
//   3. Its instrumentRecordings (station codes) and references (http(s) links) become the event's row
//      in significant_eq_details, only where the event has none. Both may be lists or "[a, b]" strings,
//      as the original JSON had them; codes and links that aren't valid are left out and reported.
//   4. Checks that every matched entry's summary and details are in PostgreSQL, and that every entry is
//      accounted for (matched or reported).
//
// Copy accounts and devices, then earthquakes, first (copy-earthquakes-to-postgres.js).
//
//   dry run (no changes): docker exec -w /app earthquake-hub-backend-dev npm run db:pg:copy-significant-eq-details -- --dry-run
//   copy:                 docker exec -w /app earthquake-hub-backend-dev npm run db:pg:copy-significant-eq-details
//
// Exit code: 0 = done (or dry run), 1 = validation failed, 2 = error. Skipped entries alone don't fail it.
try { require('dotenv/config'); } catch (_) { /* prod images don't ship dotenv; env comes from compose */ }
const mongoose = require('mongoose');

const MATCH_WINDOW_MS = 24 * 60 * 60 * 1000;
const MATCH_DISTANCE_M = 150 * 1000;
const COPIED_BY = 'copied from MongoDB significant-eqs';
const STATION_CODE = /^[A-Z0-9]{1,10}$/;

const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);

// A list, or a "[a, b]" string (as the original src/significantEQs.json had them)
function parseList(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (typeof value !== 'string') return [];
  const text = value.trim();
  const inner = text.startsWith('[') && text.endsWith(']') ? text.slice(1, -1) : text;
  return inner.split(',').map((item) => item.trim()).filter(Boolean);
}

const isLink = (text) => {
  if (text.length > 2000) return false;
  try { return ['http:', 'https:'].includes(new URL(text).protocol); } catch (_) { return false; }
};

// A Date, an ISO string, or "MM-DD-YYYYTHH:mm:ss.sss+00:00" (as the original JSON had them)
function parseEventTime(value) {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : null;
  if (typeof value !== 'string') return null;
  const us = value.trim().match(/^(\d{2})-(\d{2})-(\d{4})(T.*)?$/);
  const date = new Date(us ? `${us[3]}-${us[1]}-${us[2]}${us[4] || 'T00:00:00Z'}` : value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function entryProblem(doc) {
  if (!isNumber(doc.latitude) || doc.latitude < -90 || doc.latitude > 90) return 'no usable latitude';
  if (!isNumber(doc.longitude) || doc.longitude < -180 || doc.longitude > 180) return 'no usable longitude';
  if (!isNumber(doc.magnitude)) return 'no usable magnitude';
  if (!parseEventTime(doc.eventTime)) return `eventTime ${JSON.stringify(doc.eventTime)} is not a date`;
  return null;
}

// The event an entry describes: within 1 day and 150 km, closest magnitude first
const findEvent = (db, doc) => {
  const time = parseEventTime(doc.eventTime).getTime();
  const point = 'ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography';
  return db('events')
    .whereNotNull('location')
    .whereBetween('origin_time', [new Date(time - MATCH_WINDOW_MS), new Date(time + MATCH_WINDOW_MS)])
    .whereRaw(`ST_DWithin(location, ${point}, ?)`, [doc.longitude, doc.latitude, MATCH_DISTANCE_M])
    .orderByRaw(`abs(magnitude - ?) NULLS LAST, ST_Distance(location, ${point}), public_id`, [doc.magnitude, doc.longitude, doc.latitude])
    .first('id', 'public_id', 'summary_override_text');
};

const hasText = (value) => typeof value === 'string' && value.trim() !== '';

/***************************************************************************
  * copySignificantEqDetails:
  *     Copies the old significant earthquakes' summaries, recordings and references to their events.
  *
  * Inputs:
  *     db:      Knex instance for PostgreSQL
  *     dryRun:  report what would change without writing
  *     log:     function for progress lines (default console.log)
  *
  * Outputs:
  *     { ok, mongoTotal, matched: [{ id, publicID }], skipped: [{ id, reason }], unmatched: [{ id, title }],
  *       sameEvent: [{ id, other }], summaries: { set, kept, none }, details: { inserted, alreadyCopied, kept, none },
  *       leftOut: [{ id, recordings, references }], missing: [id] }
  ***************************************************************************/
async function copySignificantEqDetails({ db, dryRun = false, log = console.log }) {
  const docs = await mongoose.connection.collection('significant-eqs').find({}).sort({ _id: 1 }).toArray();
  const result = {
    mongoTotal: docs.length,
    matched: [],
    skipped: [],
    unmatched: [],
    sameEvent: [],
    summaries: { set: 0, kept: 0, none: 0 },
    details: { inserted: 0, alreadyCopied: 0, kept: 0, none: 0 },
    leftOut: [],
    missing: [],
  };

  // 1. Match each entry to its event
  const plans = [];
  const matchedBy = new Map(); // event id -> entry id
  for (const doc of docs) {
    const id = String(doc._id);
    const problem = entryProblem(doc);
    if (problem) {
      result.skipped.push({ id, reason: problem });
      continue;
    }
    const event = await findEvent(db, doc);
    if (!event) {
      result.unmatched.push({ id, title: String(doc.title || '').slice(0, 80) });
      continue;
    }
    if (matchedBy.has(event.id)) {
      result.sameEvent.push({ id, other: matchedBy.get(event.id) });
      continue;
    }
    matchedBy.set(event.id, id);

    const rawRecordings = parseList(doc.instrumentRecordings).map((code) => code.toUpperCase());
    const rawReferences = parseList(doc.references);
    const recordings = [...new Set(rawRecordings.filter((code) => STATION_CODE.test(code)))];
    const references = [...new Set(rawReferences.filter(isLink))];
    const leftOut = {
      recordings: rawRecordings.filter((code) => !STATION_CODE.test(code)).length,
      references: rawReferences.filter((link) => !isLink(link)).length,
    };
    if (leftOut.recordings || leftOut.references) result.leftOut.push({ id, ...leftOut });

    plans.push({
      id, event, summary: hasText(doc.eventSummary) ? doc.eventSummary.trim() : null, recordings, references,
    });
    result.matched.push({ id, publicID: event.public_id });
  }

  // 2 and 3. Fill in what each event is missing
  const existingDetails = new Map((await db('significant_eq_details')
    .whereIn('event_id', plans.map((plan) => plan.event.id))
    .select('event_id', 'legacy_mongo_id'))
    .map((row) => [row.event_id, (row.legacy_mongo_id || '').trim()]));

  const write = async (trx) => {
    for (const plan of plans) {
      if (!plan.summary) result.summaries.none += 1;
      else if (hasText(plan.event.summary_override_text)) result.summaries.kept += 1;
      else {
        result.summaries.set += 1;
        if (trx) {
          await trx('events').where({ id: plan.event.id })
            .where((query) => query.whereNull('summary_override_text').orWhereRaw("btrim(summary_override_text) = ''"))
            .update({ summary_override_text: plan.summary, summary_override_edited_at: trx.fn.now(), summary_override_edited_by: COPIED_BY });
        }
      }

      if (plan.recordings.length === 0 && plan.references.length === 0) result.details.none += 1;
      else if (existingDetails.has(plan.event.id)) {
        if (existingDetails.get(plan.event.id) === plan.id) result.details.alreadyCopied += 1;
        else result.details.kept += 1;
      } else {
        result.details.inserted += 1;
        if (trx) {
          await trx('significant_eq_details').insert({
            legacy_mongo_id: plan.id,
            event_id: plan.event.id,
            instrument_recordings: plan.recordings,
            reference_urls: plan.references,
            edited_by: COPIED_BY,
            edited_at: trx.fn.now(),
          });
        }
      }
    }
  };
  if (dryRun) await write(null);
  else await db.transaction(write);

  // 4. Validation
  if (!dryRun) {
    const eventIds = plans.map((plan) => plan.event.id);
    const [withDetails, withSummary] = await Promise.all([
      db('significant_eq_details').whereIn('event_id', eventIds).pluck('event_id'),
      db('events').whereIn('id', eventIds).whereRaw("btrim(coalesce(summary_override_text, '')) <> ''").pluck('id'),
    ]);
    const detailsSet = new Set(withDetails);
    const summarySet = new Set(withSummary);
    plans.forEach((plan) => {
      const needsDetails = plan.recordings.length > 0 || plan.references.length > 0;
      if ((needsDetails && !detailsSet.has(plan.event.id)) || (plan.summary && !summarySet.has(plan.event.id))) {
        result.missing.push(plan.id);
      }
    });
  }
  const accounted = result.matched.length + result.skipped.length + result.unmatched.length + result.sameEvent.length;
  const countsAddUp = accounted === result.mongoTotal;
  result.ok = result.missing.length === 0 && countsAddUp;

  // Report: entry ids and titles only (the entries hold no personal data)
  const would = (verb) => (dryRun ? `would ${verb}` : verb);
  const list = (items, format) => items.forEach((item) => log(`    ${format(item)}`));
  log(`${dryRun ? '[dry run] ' : ''}Significant earthquakes in MongoDB: ${result.mongoTotal}`);
  log(`  matched to an event: ${result.matched.length}`);
  list(result.matched, ({ id, publicID }) => `${id} -> ${publicID}`);
  log(`  skipped: ${result.skipped.length}`);
  list(result.skipped, ({ id, reason }) => `${id}: ${reason}`);
  log(`  no event within 1 day and 150 km: ${result.unmatched.length}`);
  list(result.unmatched, ({ id, title }) => `${id}: ${title}`);
  log(`  same event as an earlier entry: ${result.sameEvent.length}`);
  list(result.sameEvent, ({ id, other }) => `${id}: same event as ${other}`);
  log(`Summaries: ${would('set')}: ${result.summaries.set}, kept (the event already has one): ${result.summaries.kept}, entries without one: ${result.summaries.none}`);
  log(`Recordings and references: ${would('insert')}: ${result.details.inserted}, already copied: ${result.details.alreadyCopied}, kept (the event already has details): ${result.details.kept}, entries without any: ${result.details.none}`);
  log(`  station codes or links left out (not valid): ${result.leftOut.length}`);
  list(result.leftOut, ({ id, recordings, references }) => `${id}: ${recordings} station codes, ${references} links`);
  if (!dryRun) {
    log(result.missing.length === 0
      ? 'Validation passed: every matched entry\'s summary and details are in PostgreSQL.'
      : `Validation FAILED: missing for ${result.missing.join(', ')}`);
  }
  if (!countsAddUp) log('Validation FAILED: counts do not add up.');

  return result;
}

module.exports = { copySignificantEqDetails, parseList, parseEventTime };

if (require.main === module) {
  const { connectOrThrow } = require('./find-duplicates');
  const postgres = require('../src/db/knex');
  const dryRun = process.argv.includes('--dry-run');

  connectOrThrow()
    .then(() => copySignificantEqDetails({ db: postgres.db, dryRun }))
    .then(async ({ ok }) => {
      await mongoose.disconnect();
      await postgres.db.destroy();
      process.exit(ok ? 0 : 1);
    })
    .catch(async (err) => {
      console.error(`copy-significant-eq-details-to-postgres failed: ${err.message}`);
      await mongoose.disconnect().catch(() => {});
      await postgres.db.destroy().catch(() => {});
      process.exit(2);
    });
}
