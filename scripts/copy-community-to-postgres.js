// Copies community data from MongoDB to PostgreSQL: `comments`, the lists MongoDB embedded in each
// comment into `comment_helpful_marks` and `comment_issue_reports`, and the points ledger
// (`contributionevents`) into `contribution_events`. Safe to run more than once: rows are matched by
// legacy_mongo_id (the MongoDB _id).
//
//   1. Comments. Each one's event is found by eventId (the event's legacy_mongo_id), or else by
//      eventPublicID; its account by accountId. Skipped and reported: no event any more; a commentId
//      that is missing or not a UUID, that another MongoDB comment also has (all of them, since
//      picking one would be a guess), or that a different PostgreSQL comment already has; neither text
//      nor an image; text over 1000 characters. Copied and reported: an account that no longer exists
//      (copied unlinked, under the same username); an unknown status (copied as pending, hidden as in
//      MongoDB). Comments from before moderation (no status) are copied as approved.
//   2. Each copied comment's helpful marks (helpfulAccountIds) and issue reports (issueReports).
//      Marks or reports whose account no longer exists, and reports with an unknown reason, are left
//      out and reported; an account listed twice is folded into one (for reports, its latest) and
//      reported. MongoDB kept no time per mark: a mark gets the comment's updated_at.
//   3. Points entries. Skipped and reported: no dedupeKey; an account that no longer exists; an unknown
//      action or target type; points that aren't a whole number; a dedupeKey another entry already
//      counts (the earliest is kept). An entry whose event no longer exists is copied unlinked, its
//      eventPublicID kept in metadata, and reported. Copied entries are never rewritten (they don't change).
//   4. Checks that every copyable comment and points entry has its row, that each rewritten comment's
//      marks and reports are all there, and that every MongoDB comment, mark, report and points entry
//      is accounted for (copied, kept or reported).
//
// A comment and its marks and reports are copied as one unit: a comment changed in PostgreSQL since it
// was copied (newer updated_at) is kept with all its rows, so re-running after the switch never
// overwrites newer data. For that, the PostgreSQL comments repository must move a comment's updated_at
// whenever it writes one of its marks or reports. A copied comment keeps its commentId. Copy accounts
// and events first (copy-people-and-sensors-to-postgres.js, copy-earthquakes-to-postgres.js).
//
//   dry run (no changes): docker exec -w /app earthquake-hub-backend-dev npm run db:pg:copy-community -- --dry-run
//   copy:                 docker exec -w /app earthquake-hub-backend-dev npm run db:pg:copy-community
//
// Exit code: 0 = done (or dry run), 1 = validation failed, 2 = error. Skipped records alone don't fail it.
try { require('dotenv/config'); } catch (_) { /* prod images don't ship dotenv; env comes from compose */ }
const mongoose = require('mongoose');
const {
  chunk, toDate, upsertByLegacyId, copiedUpdatedAt, idsByLegacyId, missingLegacyIds,
} = require('./lib/pgCopy');

const COMMENT_STATUSES = new Set(['pending', 'approved', 'rejected']);
const ISSUE_REASONS = new Set(['duplicate', 'unclear', 'wrong_location', 'not_related', 'inappropriate']);
const ACTION_TYPES = new Set(['report_posted', 'image_report_posted', 'report_marked_helpful', 'report_received_helpful', 'report_issue_submitted']);
const TARGET_TYPES = new Set(['comment', 'event']);
const MAX_CONTENT_LENGTH = 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Columns overwritten when a copied comment is refreshed: everything but the ids (a copied comment
// keeps its commentId)
const COMMENT_COLUMNS = [
  'event_id', 'account_id', 'username', 'content', 'image_url', 'status', 'moderated_by', 'moderated_at', 'created_at', 'updated_at',
];

const isMissing = (value) => value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
const textOrNull = (value) => (isMissing(value) ? null : String(value));
const trimmedOrNull = (value) => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null);
const idOrNull = (value) => (isMissing(value) ? null : String(value));
const label = (doc, key) => `${doc._id}${doc[key] ? ` (${doc[key]})` : ''}`;
const commentLabel = (doc) => label(doc, 'commentId');
const pointsLabel = (doc) => label(doc, 'dedupeKey');

// PostgreSQL ids of the rows whose `column` has these values: Map(value -> id)
async function idsByColumn(db, table, column, values) {
  const ids = new Map();
  for (const batch of chunk([...new Set(values)])) {
    const rows = await db(table).select('id', column).whereIn(column, batch);
    rows.forEach((row) => ids.set(String(row[column]).trim(), row.id));
  }
  return ids;
}

// Finds accounts and events by their MongoDB ids (and events also by publicID) in one pass
async function lookups(db, docs) {
  const accountIds = new Set();
  const eventIds = new Set();
  const publicIds = new Set();
  docs.forEach((doc) => {
    [doc.accountId, ...(Array.isArray(doc.helpfulAccountIds) ? doc.helpfulAccountIds : []),
      ...(Array.isArray(doc.issueReports) ? doc.issueReports.map((report) => report?.accountId) : [])]
      .map(idOrNull).filter(Boolean).forEach((id) => accountIds.add(id));
    if (idOrNull(doc.eventId)) eventIds.add(idOrNull(doc.eventId));
    if (trimmedOrNull(doc.eventPublicID)) publicIds.add(trimmedOrNull(doc.eventPublicID));
  });
  const [accounts, events, eventsByPublicId] = await Promise.all([
    idsByLegacyId(db, 'accounts', [...accountIds]),
    idsByLegacyId(db, 'events', [...eventIds]),
    idsByColumn(db, 'events', 'public_id', [...publicIds]),
  ]);
  const account = (value) => (idOrNull(value) ? accounts.get(idOrNull(value)) || null : null);
  // The event by eventId, else by eventPublicID: { id, byPublicId } or null
  const event = (doc) => {
    const byId = idOrNull(doc.eventId) ? events.get(idOrNull(doc.eventId)) : undefined;
    if (byId) return { id: byId, byPublicId: false };
    const byPublicId = trimmedOrNull(doc.eventPublicID) ? eventsByPublicId.get(trimmedOrNull(doc.eventPublicID)) : undefined;
    return byPublicId ? { id: byPublicId, byPublicId: true } : null;
  };
  return { account, event };
}

// --- Comments ---

const commentProblem = (doc, find) => {
  if (typeof doc.commentId !== 'string' || !UUID.test(doc.commentId)) return 'commentId missing or not a UUID';
  if (!find.event(doc)) return 'its event no longer exists';
  const content = trimmedOrNull(doc.content);
  if (!content && !trimmedOrNull(doc.imageURL)) return 'neither text nor an image';
  if (content && content.length > MAX_CONTENT_LENGTH) return `text longer than ${MAX_CONTENT_LENGTH} characters`;
  return null;
};

const toCommentRow = (doc, find) => {
  const createdAt = toDate(doc.createdAt) || doc._id.getTimestamp();
  let status = 'approved'; // also for comments from before moderation (no status), which MongoDB showed
  if (doc.status !== undefined && doc.status !== null) status = COMMENT_STATUSES.has(doc.status) ? doc.status : 'pending';
  return {
    legacy_mongo_id: String(doc._id),
    comment_id: doc.commentId.toLowerCase(),
    event_id: find.event(doc).id,
    account_id: find.account(doc.accountId),
    username: trimmedOrNull(doc.username) || 'Anonymous',
    content: trimmedOrNull(doc.content),
    image_url: trimmedOrNull(doc.imageURL),
    status,
    moderated_by: textOrNull(doc.moderatedBy),
    moderated_at: toDate(doc.moderatedAt),
    created_at: createdAt,
    updated_at: toDate(doc.updatedAt) || createdAt,
  };
};

/***************************************************************************
  * toMarkAndReportRows:
  *     A comment's helpful marks and issue reports as rows, one per account.
  *
  * Returns:
  *     { markRows, reportRows, marks: { total, noAccount, duplicates }, reports: { total, noAccount,
  *       unknownReason, duplicates } }, the counts being the entries left out (or folded) for each reason
  ***************************************************************************/
const toMarkAndReportRows = (doc, commentId, commentRow, find) => {
  const marks = { total: 0, noAccount: 0, duplicates: 0 };
  const markAccounts = new Set();
  const markRows = [];
  (Array.isArray(doc.helpfulAccountIds) ? doc.helpfulAccountIds : []).forEach((value) => {
    marks.total += 1;
    const accountId = find.account(value);
    if (!accountId) marks.noAccount += 1;
    else if (markAccounts.has(accountId)) marks.duplicates += 1;
    else {
      markAccounts.add(accountId);
      markRows.push({ comment_id: commentId, account_id: accountId, created_at: commentRow.updated_at });
    }
  });

  const reports = { total: 0, noAccount: 0, unknownReason: 0, duplicates: 0 };
  const latest = new Map(); // account -> row
  (Array.isArray(doc.issueReports) ? doc.issueReports : []).forEach((report) => {
    reports.total += 1;
    const accountId = find.account(report?.accountId);
    if (!accountId) {
      reports.noAccount += 1;
      return;
    }
    if (!ISSUE_REASONS.has(report.reason)) {
      reports.unknownReason += 1;
      return;
    }
    const row = { comment_id: commentId, account_id: accountId, reason: report.reason, created_at: toDate(report.createdAt) || commentRow.updated_at };
    const earlier = latest.get(accountId);
    if (earlier) reports.duplicates += 1;
    if (!earlier || row.created_at >= earlier.created_at) latest.set(accountId, row);
  });

  return { markRows, reportRows: [...latest.values()], marks, reports };
};

// Rows per comment already in `table`, for these comments: Map(commentId -> count)
async function rowCounts(db, table, commentIds) {
  const counts = new Map();
  for (const batch of chunk(commentIds)) {
    const rows = await db(table).select('comment_id').count({ n: '*' }).whereIn('comment_id', batch).groupBy('comment_id');
    rows.forEach((row) => counts.set(row.comment_id, Number(row.n)));
  }
  return counts;
}

// --- Points ---

const toPointsRow = (doc, find) => {
  const event = find.event(doc);
  const metadata = doc.metadata === undefined || doc.metadata === null ? {} : doc.metadata;
  const isObject = typeof metadata === 'object' && !Array.isArray(metadata);
  const row = {
    legacy_mongo_id: String(doc._id),
    dedupe_key: String(doc.dedupeKey),
    account_id: find.account(doc.accountId),
    action_type: doc.actionType,
    target_type: isMissing(doc.targetType) ? 'comment' : doc.targetType,
    target_id: textOrNull(doc.targetId),
    event_id: event ? event.id : null,
    points: isMissing(doc.points) ? 0 : Number(doc.points),
    reason: textOrNull(doc.reason),
    metadata: isObject ? { ...metadata } : { value: metadata },
    created_at: toDate(doc.createdAt) || doc._id.getTimestamp(),
  };
  // No event any more: keep which one it was
  const eventPublicID = trimmedOrNull(doc.eventPublicID);
  if (!event && eventPublicID) row.metadata.eventPublicID = eventPublicID;
  return { row, unlinked: !event && Boolean(eventPublicID || idOrNull(doc.eventId)), wrappedMetadata: !isObject };
};

const pointsProblem = (doc, find) => {
  if (isMissing(doc.dedupeKey)) return 'no dedupeKey';
  if (!find.account(doc.accountId)) return 'its account no longer exists';
  if (!ACTION_TYPES.has(doc.actionType)) return `unknown action ${JSON.stringify(doc.actionType ?? null)}`;
  if (!isMissing(doc.targetType) && !TARGET_TYPES.has(doc.targetType)) return `unknown target type ${JSON.stringify(doc.targetType)}`;
  if (!isMissing(doc.points) && !Number.isInteger(Number(doc.points))) return `points ${JSON.stringify(doc.points)} not a whole number`;
  return null;
};

/***************************************************************************
  * copyCommunity:
  *     Copies MongoDB comments with their helpful marks and issue reports, and the points ledger, to
  *     PostgreSQL (see the steps at the top of this file). Expects Mongoose to be connected already.
  *
  * Inputs:
  *     db:      Knex instance for PostgreSQL
  *     dryRun:  report what would change without writing
  *     log:     function for progress lines (default console.log)
  *
  * Outputs:
  *     { ok, comments, marks, reports, points }:
  *       comments: { mongoTotal, skipped: [{ id, reason }], inserted, updated, keptNewer, missing: [id],
  *                   byPublicId: [id], accountGone: [id], beforeModeration: [id], unknownStatus: [{ id, status }] }
  *       marks:    { mongoTotal, written, keptWithComment, withSkippedComment, noAccount: [{ id, count }],
  *                   duplicates: [{ id, count }], incomplete: [id] }
  *       reports:  as marks, plus unknownReason: [{ id, count }]
  *       points:   { mongoTotal, skipped: [{ id, reason }], inserted, alreadyCopied, alreadyCounted: [id],
  *                   unlinked: [id], wrappedMetadata: [id], missing: [id] }
  ***************************************************************************/
async function copyCommunity({ db, dryRun = false, log = console.log }) {
  const commentDocs = await mongoose.connection.collection('comments').find({}).toArray();
  const pointsDocs = await mongoose.connection.collection('contributionevents').find({}).toArray();
  const find = await lookups(db, [...commentDocs, ...pointsDocs]);

  // 1. Comments
  const commentsSkipped = [];
  let candidates = [];
  commentDocs.forEach((doc) => {
    const reason = commentProblem(doc, find);
    if (reason) commentsSkipped.push({ doc, reason });
    else candidates.push(doc);
  });

  const byCommentId = new Map();
  candidates.forEach((doc) => {
    const key = doc.commentId.toLowerCase();
    byCommentId.set(key, [...(byCommentId.get(key) || []), doc]);
  });
  candidates = candidates.filter((doc) => {
    const group = byCommentId.get(doc.commentId.toLowerCase());
    if (group.length === 1) return true;
    const others = group.filter((other) => other !== doc).map((other) => String(other._id));
    commentsSkipped.push({ doc, reason: `same commentId as ${others.join(', ')}` });
    return false;
  });

  // commentIds PostgreSQL already holds under another row (e.g. a comment posted after the switch)
  const takenCommentIds = new Map();
  for (const batch of chunk(candidates.map((doc) => doc.commentId.toLowerCase()))) {
    const rows = await db('comments').select('comment_id', 'legacy_mongo_id').whereIn('comment_id', batch);
    rows.forEach((row) => takenCommentIds.set(row.comment_id, (row.legacy_mongo_id || '').trim()));
  }
  candidates = candidates.filter((doc) => {
    const holder = takenCommentIds.get(doc.commentId.toLowerCase());
    if (holder === undefined || holder === String(doc._id)) return true;
    commentsSkipped.push({ doc, reason: 'commentId already used by another PostgreSQL comment' });
    return false;
  });

  const commentRows = candidates.map((doc) => toCommentRow(doc, find));
  const comments = {
    mongoTotal: commentDocs.length,
    skipped: commentsSkipped.map(({ doc, reason }) => ({ id: commentLabel(doc), reason })),
    byPublicId: candidates.filter((doc) => find.event(doc).byPublicId).map(commentLabel),
    accountGone: candidates.filter((doc) => idOrNull(doc.accountId) && !find.account(doc.accountId)).map(commentLabel),
    beforeModeration: candidates.filter((doc) => doc.status === undefined || doc.status === null).map(commentLabel),
    unknownStatus: candidates.filter((doc) => !isMissing(doc.status) && !COMMENT_STATUSES.has(doc.status))
      .map((doc) => ({ id: commentLabel(doc), status: doc.status })),
  };

  // Comments changed in PostgreSQL since they were copied keep their rows; the rest get theirs rewritten
  const copiedAt = await copiedUpdatedAt(db, 'comments', commentRows.map((row) => row.legacy_mongo_id));
  const keptIds = new Set(commentRows
    .filter((row) => copiedAt.has(row.legacy_mongo_id) && copiedAt.get(row.legacy_mongo_id) > row.updated_at)
    .map((row) => row.legacy_mongo_id));
  Object.assign(comments, await upsertByLegacyId({ db, table: 'comments', rows: commentRows, columns: COMMENT_COLUMNS, dryRun }));
  const commentIds = dryRun ? new Map() : await idsByLegacyId(db, 'comments', commentRows.map((row) => row.legacy_mongo_id));

  // 2. Each comment's helpful marks and issue reports
  const tally = () => ({ mongoTotal: 0, written: 0, keptWithComment: 0, withSkippedComment: 0, noAccount: [], duplicates: [] });
  const marks = tally();
  const reports = { ...tally(), unknownReason: [] };
  commentsSkipped.forEach(({ doc }) => {
    const markCount = Array.isArray(doc.helpfulAccountIds) ? doc.helpfulAccountIds.length : 0;
    const reportCount = Array.isArray(doc.issueReports) ? doc.issueReports.length : 0;
    marks.mongoTotal += markCount;
    marks.withSkippedComment += markCount;
    reports.mongoTotal += reportCount;
    reports.withSkippedComment += reportCount;
  });
  const units = []; // { commentId, legacyId, markRows, reportRows } for comments whose rows are rewritten

  candidates.forEach((doc, i) => {
    const commentRow = commentRows[i];
    const legacyId = commentRow.legacy_mongo_id;
    const commentId = commentIds.get(legacyId) || null;
    const derived = toMarkAndReportRows(doc, commentId, commentRow, find);
    const id = commentLabel(doc);

    marks.mongoTotal += derived.marks.total;
    reports.mongoTotal += derived.reports.total;
    if (derived.marks.noAccount) marks.noAccount.push({ id, count: derived.marks.noAccount });
    if (derived.marks.duplicates) marks.duplicates.push({ id, count: derived.marks.duplicates });
    if (derived.reports.noAccount) reports.noAccount.push({ id, count: derived.reports.noAccount });
    if (derived.reports.unknownReason) reports.unknownReason.push({ id, count: derived.reports.unknownReason });
    if (derived.reports.duplicates) reports.duplicates.push({ id, count: derived.reports.duplicates });

    if (keptIds.has(legacyId)) {
      marks.keptWithComment += derived.markRows.length;
      reports.keptWithComment += derived.reportRows.length;
    } else {
      units.push({ commentId, legacyId, markRows: derived.markRows, reportRows: derived.reportRows });
      marks.written += derived.markRows.length;
      reports.written += derived.reportRows.length;
    }
  });

  if (!dryRun) {
    await db.transaction(async (trx) => {
      // One query at a time: a transaction runs on a single connection
      for (const batch of chunk(units)) {
        const ids = batch.map((unit) => unit.commentId);
        for (const [table, key] of [['comment_helpful_marks', 'markRows'], ['comment_issue_reports', 'reportRows']]) {
          await trx(table).whereIn('comment_id', ids).del();
          for (const part of chunk(batch.flatMap((unit) => unit[key]))) {
            await trx(table).insert(part);
          }
        }
      }
    });
  }

  // 3. Points
  const pointsSkipped = [];
  const pointsCandidates = [];
  pointsDocs.forEach((doc) => {
    const reason = pointsProblem(doc, find);
    if (reason) pointsSkipped.push({ id: pointsLabel(doc), reason });
    else pointsCandidates.push(doc);
  });
  // One entry per dedupeKey: the earliest counted
  const byDedupeKey = new Map();
  pointsCandidates.forEach((doc) => {
    const key = String(doc.dedupeKey);
    const earlier = byDedupeKey.get(key);
    const createdAt = (d) => (toDate(d.createdAt) || d._id.getTimestamp()).getTime();
    if (!earlier) byDedupeKey.set(key, doc);
    else {
      const [kept, dropped] = createdAt(doc) < createdAt(earlier) ? [doc, earlier] : [earlier, doc];
      byDedupeKey.set(key, kept);
      pointsSkipped.push({ id: pointsLabel(dropped), reason: `same dedupeKey as ${kept._id} (counted once)` });
    }
  });
  const pointsMapped = [...byDedupeKey.values()].map((doc) => ({ doc, ...toPointsRow(doc, find) }));

  // Already copied (by legacy id), or already counted in PostgreSQL under another row (same dedupe_key)
  const copiedPoints = new Set((await idsByLegacyId(db, 'contribution_events', pointsMapped.map(({ row }) => row.legacy_mongo_id))).keys());
  const countedKeys = new Map();
  for (const batch of chunk(pointsMapped.map(({ row }) => row.dedupe_key))) {
    const rows = await db('contribution_events').select('dedupe_key', 'legacy_mongo_id').whereIn('dedupe_key', batch);
    rows.forEach((row) => countedKeys.set(row.dedupe_key, (row.legacy_mongo_id || '').trim()));
  }
  const alreadyCounted = [];
  const toInsert = [];
  pointsMapped.forEach(({ doc, row }) => {
    if (copiedPoints.has(row.legacy_mongo_id)) return;
    if (countedKeys.has(row.dedupe_key)) alreadyCounted.push(pointsLabel(doc));
    else toInsert.push(row);
  });
  let pointsInserted = 0;
  if (!dryRun) {
    await db.transaction(async (trx) => {
      for (const batch of chunk(toInsert)) {
        // Rows that collide anyway (an entry recorded meanwhile) are left alone and found by validation
        const written = await trx('contribution_events').insert(batch).onConflict().ignore().returning('id');
        pointsInserted += written.length;
      }
    });
  } else {
    pointsInserted = toInsert.length;
  }
  const points = {
    mongoTotal: pointsDocs.length,
    skipped: pointsSkipped,
    inserted: pointsInserted,
    alreadyCopied: pointsMapped.filter(({ row }) => copiedPoints.has(row.legacy_mongo_id)).length,
    alreadyCounted,
    unlinked: pointsMapped.filter(({ unlinked }) => unlinked).map(({ doc }) => pointsLabel(doc)),
    wrappedMetadata: pointsMapped.filter(({ wrappedMetadata }) => wrappedMetadata).map(({ doc }) => pointsLabel(doc)),
  };

  // 4. Validation: every copyable comment and points entry has its row, each rewritten comment has all
  //    its marks and reports, and every MongoDB record is accounted for
  comments.missing = dryRun ? [] : await missingLegacyIds(db, 'comments', commentRows.map((row) => row.legacy_mongo_id));
  points.missing = dryRun ? [] : await missingLegacyIds(db, 'contribution_events', toInsert.map((row) => row.legacy_mongo_id));
  const incomplete = async (table, key) => {
    if (dryRun) return [];
    const counts = await rowCounts(db, table, units.map((unit) => unit.commentId));
    return units.filter((unit) => (counts.get(unit.commentId) || 0) !== unit[key].length).map((unit) => unit.legacyId);
  };
  marks.incomplete = await incomplete('comment_helpful_marks', 'markRows');
  reports.incomplete = await incomplete('comment_issue_reports', 'reportRows');

  const sum = (items) => items.reduce((total, { count }) => total + count, 0);
  const countsAddUp = comments.mongoTotal === comments.skipped.length + commentRows.length
    && commentRows.length === comments.inserted + comments.updated + comments.keptNewer
    && comments.keptNewer === keptIds.size
    && marks.mongoTotal === marks.written + marks.keptWithComment + marks.withSkippedComment + sum(marks.noAccount) + sum(marks.duplicates)
    && reports.mongoTotal === reports.written + reports.keptWithComment + reports.withSkippedComment
      + sum(reports.noAccount) + sum(reports.unknownReason) + sum(reports.duplicates)
    && points.mongoTotal === points.skipped.length + points.inserted + points.alreadyCopied + points.alreadyCounted.length + points.missing.length;
  const allProblems = [...comments.missing, ...marks.incomplete, ...reports.incomplete, ...points.missing];
  const ok = countsAddUp && allProblems.length === 0;

  // Report
  const would = (word) => (dryRun ? `would ${word}` : { insert: 'inserted', update: 'updated', write: 'written' }[word]);
  const list = (items, format) => items.forEach((item) => log(`    ${format(item)}`));
  const counted = ({ id, count }) => `${id}: ${count}`;
  log(`${dryRun ? '[dry run] ' : ''}Comments in MongoDB: ${comments.mongoTotal}`);
  log(`  ${would('insert')}: ${comments.inserted}, ${would('update')}: ${comments.updated}, kept with their marks and reports (changed in PostgreSQL since copied): ${comments.keptNewer}`);
  log(`  skipped: ${comments.skipped.length}`);
  list(comments.skipped, ({ id, reason }) => `${id}: ${reason}`);
  log(`  event found by eventPublicID (its eventId matches no event): ${comments.byPublicId.length}`);
  list(comments.byPublicId, (id) => id);
  log(`  account no longer exists (copied unlinked, same username): ${comments.accountGone.length}`);
  list(comments.accountGone, (id) => id);
  log(`  from before moderation (no status, copied as approved): ${comments.beforeModeration.length}`);
  log(`  unknown status (copied as pending): ${comments.unknownStatus.length}`);
  list(comments.unknownStatus, ({ id, status }) => `${id}: ${JSON.stringify(status)}`);
  log(`Helpful marks in MongoDB: ${marks.mongoTotal}`);
  log(`  ${would('write')}: ${marks.written}, kept with their comment: ${marks.keptWithComment}, on skipped comments: ${marks.withSkippedComment}`);
  log(`  left out, account no longer exists: ${sum(marks.noAccount)}`);
  list(marks.noAccount, counted);
  log(`  folded, same account twice: ${sum(marks.duplicates)}`);
  list(marks.duplicates, counted);
  log(`Issue reports in MongoDB: ${reports.mongoTotal}`);
  log(`  ${would('write')}: ${reports.written}, kept with their comment: ${reports.keptWithComment}, on skipped comments: ${reports.withSkippedComment}`);
  log(`  left out, account no longer exists: ${sum(reports.noAccount)}`);
  list(reports.noAccount, counted);
  log(`  left out, unknown reason: ${sum(reports.unknownReason)}`);
  list(reports.unknownReason, counted);
  log(`  folded, same account twice (latest kept): ${sum(reports.duplicates)}`);
  list(reports.duplicates, counted);
  log(`Points entries in MongoDB: ${points.mongoTotal}`);
  log(`  ${would('insert')}: ${points.inserted}, already copied: ${points.alreadyCopied}`);
  log(`  already counted in PostgreSQL (same dedupeKey): ${points.alreadyCounted.length}`);
  list(points.alreadyCounted, (id) => id);
  log(`  skipped: ${points.skipped.length}`);
  list(points.skipped, ({ id, reason }) => `${id}: ${reason}`);
  log(`  event no longer exists (copied unlinked, eventPublicID kept in metadata): ${points.unlinked.length}`);
  list(points.unlinked, (id) => id);
  log(`  metadata not an object (kept as metadata.value): ${points.wrappedMetadata.length}`);
  list(points.wrappedMetadata, (id) => id);
  if (!dryRun) {
    log(allProblems.length === 0
      ? 'Validation passed: every copyable comment, with its marks and reports, and every points entry is in PostgreSQL.'
      : `Validation FAILED: missing rows for ${[...new Set(allProblems)].join(', ')}`);
  }
  if (!countsAddUp) log('Validation FAILED: counts do not add up.');

  return { ok, comments, marks, reports, points };
}

module.exports = { copyCommunity };

if (require.main === module) {
  const { connectOrThrow } = require('./find-duplicates');
  const postgres = require('../src/db/knex');
  const dryRun = process.argv.includes('--dry-run');

  connectOrThrow()
    .then(() => copyCommunity({ db: postgres.db, dryRun }))
    .then(async ({ ok }) => {
      await mongoose.disconnect();
      await postgres.db.destroy();
      process.exit(ok ? 0 : 1);
    })
    .catch(async (err) => {
      console.error(`copy-community-to-postgres failed: ${err.message}`);
      await mongoose.disconnect().catch(() => {});
      await postgres.db.destroy().catch(() => {});
      process.exit(2);
    });
}
