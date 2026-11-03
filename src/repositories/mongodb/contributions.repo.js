// Contribution points in MongoDB (`contributionevents` collection): one entry per action that earns (or
// records) points. Step 4 adds a PostgreSQL version and the setting that picks between them; both must
// pass __tests__/community.repo.integration.test.js.
//
// An entry comes back as:
//   { dedupeKey, accountId, actionType, targetType, targetId, eventId, eventPublicID, points, reason,
//     metadata, createdAt, updatedAt }
// with account and event ids as MongoDB-style strings, and the optional fields (targetId, eventId,
// eventPublicID, reason, metadata) left out when not set.
const ContributionEvent = require('../../models/contributionEvent.model');

const OPTIONAL_FIELDS = ['targetId', 'eventPublicID', 'reason', 'metadata'];

const toContribution = (doc) => {
  if (!doc) return null;
  const contribution = {
    dedupeKey: doc.dedupeKey,
    accountId: String(doc.accountId),
    actionType: doc.actionType,
    targetType: doc.targetType,
    points: doc.points,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
  if (doc.eventId) contribution.eventId = String(doc.eventId);
  OPTIONAL_FIELDS.forEach((field) => {
    if (doc[field] !== undefined && doc[field] !== null) contribution[field] = doc[field];
  });
  return contribution;
};

/***************************************************************************
  * recordOnce:
  *     Stores a points entry unless one with the same dedupeKey already exists, so a repeated action
  *     never counts twice.
  *
  * Inputs:
  *     entry   { dedupeKey, accountId, actionType, targetType, targetId, eventId, eventPublicID,
  *               points, reason, metadata }
  *
  * Returns:
  *     the stored entry: the new one, or the earlier one with this dedupeKey (unchanged)
  ***************************************************************************/
async function recordOnce(entry) {
  // Timestamps are set on insert only: Mongoose's own would also bump an earlier entry's updatedAt
  const now = new Date();
  const doc = await ContributionEvent.findOneAndUpdate(
    { dedupeKey: entry.dedupeKey },
    { $setOnInsert: { ...entry, createdAt: now, updatedAt: now } },
    { new: true, setDefaultsOnInsert: true, upsert: true, timestamps: false },
  ).lean();
  return toContribution(doc);
}

module.exports = { recordOnce };
