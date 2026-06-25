const ContributionEvent = require('../models/contributionEvent.model');

const CONTRIBUTION_ACTION = Object.freeze({
  REPORT_POSTED: 'report_posted',
  IMAGE_REPORT_POSTED: 'image_report_posted',
  REPORT_MARKED_HELPFUL: 'report_marked_helpful',
  REPORT_RECEIVED_HELPFUL: 'report_received_helpful',
  REPORT_ISSUE_SUBMITTED: 'report_issue_submitted',
});

const CONTRIBUTION_POINTS = Object.freeze({
  [CONTRIBUTION_ACTION.REPORT_POSTED]: 5,
  [CONTRIBUTION_ACTION.IMAGE_REPORT_POSTED]: 8,
  [CONTRIBUTION_ACTION.REPORT_MARKED_HELPFUL]: 1,
  [CONTRIBUTION_ACTION.REPORT_RECEIVED_HELPFUL]: 2,
  [CONTRIBUTION_ACTION.REPORT_ISSUE_SUBMITTED]: 0,
});

function normalizeId(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (typeof value.toString === 'function') return value.toString();
  return String(value);
}

function buildContributionDedupeKey({
  accountId,
  actionType,
  targetType = 'comment',
  targetId,
  eventId,
  eventPublicID,
}) {
  const normalizedAccountId = normalizeId(accountId);
  const normalizedTargetId = normalizeId(targetId) || normalizeId(eventId) || normalizeId(eventPublicID) || 'global';
  return [
    normalizedAccountId,
    actionType,
    targetType,
    normalizedTargetId,
  ].join(':');
}

async function recordContribution({
  accountId,
  actionType,
  targetType = 'comment',
  targetId,
  eventId,
  eventPublicID,
  points,
  reason,
  metadata,
}) {
  if (!accountId || !actionType) return null;

  const dedupeKey = buildContributionDedupeKey({
    accountId,
    actionType,
    targetType,
    targetId,
    eventId,
    eventPublicID,
  });

  const contribution = {
    dedupeKey,
    accountId,
    actionType,
    targetType,
    targetId: normalizeId(targetId) || undefined,
    eventId: eventId || undefined,
    eventPublicID: eventPublicID || undefined,
    points: Number.isFinite(Number(points)) ? Number(points) : CONTRIBUTION_POINTS[actionType] || 0,
    reason: reason || undefined,
    metadata: metadata || undefined,
  };

  return ContributionEvent.findOneAndUpdate(
    { dedupeKey },
    { $setOnInsert: contribution },
    {
      new: true,
      setDefaultsOnInsert: true,
      upsert: true,
    },
  );
}

async function recordReportPosted({ accountId, comment, hasImage }) {
  if (!accountId || !comment?.commentId) return [];

  const basePayload = {
    accountId,
    targetType: 'comment',
    targetId: comment.commentId,
    eventId: comment.eventId,
    eventPublicID: comment.eventPublicID,
  };

  const writes = [
    recordContribution({
      ...basePayload,
      actionType: CONTRIBUTION_ACTION.REPORT_POSTED,
    }),
  ];

  if (hasImage) {
    writes.push(recordContribution({
      ...basePayload,
      actionType: CONTRIBUTION_ACTION.IMAGE_REPORT_POSTED,
    }));
  }

  return Promise.all(writes);
}

async function recordHelpfulMarked({ actorAccountId, comment }) {
  if (!actorAccountId || !comment?.commentId) return [];

  const authorAccountId = comment.accountId;
  const isSelfHelpful = authorAccountId && normalizeId(authorAccountId) === normalizeId(actorAccountId);
  if (isSelfHelpful) return [];

  const basePayload = {
    targetType: 'comment',
    targetId: comment.commentId,
    eventId: comment.eventId,
    eventPublicID: comment.eventPublicID,
  };

  const writes = [
    recordContribution({
      ...basePayload,
      accountId: actorAccountId,
      actionType: CONTRIBUTION_ACTION.REPORT_MARKED_HELPFUL,
    }),
  ];

  if (authorAccountId) {
    writes.push(recordContribution({
      ...basePayload,
      accountId: authorAccountId,
      actionType: CONTRIBUTION_ACTION.REPORT_RECEIVED_HELPFUL,
    }));
  }

  return Promise.all(writes);
}

async function recordIssueSubmitted({ accountId, comment, reason }) {
  if (!accountId || !comment?.commentId) return null;

  return recordContribution({
    accountId,
    actionType: CONTRIBUTION_ACTION.REPORT_ISSUE_SUBMITTED,
    targetType: 'comment',
    targetId: comment.commentId,
    eventId: comment.eventId,
    eventPublicID: comment.eventPublicID,
    reason,
  });
}

module.exports = {
  CONTRIBUTION_ACTION,
  CONTRIBUTION_POINTS,
  buildContributionDedupeKey,
  recordContribution,
  recordReportPosted,
  recordHelpfulMarked,
  recordIssueSubmitted,
};
