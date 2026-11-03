// Contribution points in PostgreSQL (`contribution_events`): the same function and entry shape as
// mongodb/contributions.repo.js, which both must keep (__tests__/community.repo.integration.test.js).
//
// Account and event ids go in and come out MongoDB-style (see legacyIds.js). eventPublicID has no
// column: it's the event's public_id, or metadata.eventPublicID for an entry whose event is gone.
// Entries never change once written, so updatedAt is createdAt.
const { accountIdFor, eventIdFor, shownId } = require('./legacyIds');

const isMissing = (value) => value === null || value === undefined || value === '';

// `db` is a Knex instance (src/db/knex.js in the app, a test container's in integration tests)
const createContributionsRepo = (db) => {
  const q = (tx) => tx || db;

  const toContribution = (row) => {
    if (!row) return null;
    const { eventPublicID: keptPublicId, ...metadata } = row.metadata || {};
    const contribution = {
      dedupeKey: row.dedupe_key,
      accountId: shownId(row.account_legacy_id, row.account_id),
      actionType: row.action_type,
      targetType: row.target_type,
      points: row.points,
      createdAt: row.created_at,
      updatedAt: row.created_at,
    };
    if (row.target_id !== null) contribution.targetId = row.target_id;
    if (row.event_id) contribution.eventId = shownId(row.event_legacy_id, row.event_id);
    const eventPublicID = row.event_public_id || keptPublicId;
    if (eventPublicID) contribution.eventPublicID = eventPublicID;
    if (row.reason !== null) contribution.reason = row.reason;
    if (Object.keys(metadata).length > 0) contribution.metadata = metadata;
    return contribution;
  };

  /***************************************************************************
    * recordOnce:
    *     Stores a points entry unless one with the same dedupeKey already exists (insert, ignoring a
    *     key already there), so a repeated action never counts twice, even when two requests race.
    *
    * Inputs:
    *     entry   { dedupeKey, accountId, actionType, targetType, targetId, eventId, eventPublicID,
    *               points, reason, metadata }, ids MongoDB-style
    *     tx      optional Knex transaction
    *
    * Returns:
    *     the stored entry: the new one, or the earlier one with this dedupeKey (unchanged). null when
    *     the account no longer exists (a session outliving its account): points belong to an account.
    ***************************************************************************/
  async function recordOnce(entry, { tx } = {}) {
    const k = q(tx);
    const accountId = await accountIdFor(k, entry.accountId);
    if (!accountId) return null;

    const eventId = isMissing(entry.eventId) && isMissing(entry.eventPublicID)
      ? null
      : await eventIdFor(k, { _id: entry.eventId, publicID: entry.eventPublicID });
    const metadata = { ...(entry.metadata && typeof entry.metadata === 'object' ? entry.metadata : {}) };
    if (!eventId && !isMissing(entry.eventPublicID)) metadata.eventPublicID = String(entry.eventPublicID);

    await k('contribution_events')
      .insert({
        dedupe_key: String(entry.dedupeKey),
        account_id: accountId,
        action_type: entry.actionType,
        target_type: entry.targetType || 'comment',
        target_id: isMissing(entry.targetId) ? null : String(entry.targetId),
        event_id: eventId,
        points: Number.isFinite(Number(entry.points)) ? Number(entry.points) : 0,
        reason: isMissing(entry.reason) ? null : String(entry.reason),
        metadata,
        created_at: new Date(),
      })
      .onConflict('dedupe_key')
      .ignore();

    const row = await k('contribution_events AS ce')
      .join('accounts AS a', 'a.id', 'ce.account_id')
      .leftJoin('events AS e', 'e.id', 'ce.event_id')
      .select('ce.*', 'a.legacy_mongo_id AS account_legacy_id', 'e.legacy_mongo_id AS event_legacy_id', 'e.public_id AS event_public_id')
      .where('ce.dedupe_key', String(entry.dedupeKey))
      .first();
    return toContribution(row);
  }

  return { recordOnce };
};

module.exports = { createContributionsRepo };
