#!/usr/bin/env node
require('dotenv/config');
const mongoose = require('mongoose');
const mongodb = require('../src/services/mongodb.service');

const MIGRATION_ACTOR = 'summary-review-backfill';

async function main() {
  const apply = process.argv.includes('--apply');
  await mongodb.connect();
  const events = mongoose.connection.collection('events');
  const legacySummaries = {
    'summaryOverride.text': { $exists: true, $ne: '' },
    $or: [
      { 'summaryOverride.reviewStatus': { $exists: false } },
      { 'summaryOverride.reviewStatus': null },
    ],
  };
  const matchingRecords = await events.countDocuments(legacySummaries);

  console.log(JSON.stringify({
    mode: apply ? 'apply' : 'dry-run',
    matchingLegacySummaries: matchingRecords,
    targetReviewStatus: 'needs_review',
  }, null, 2));

  if (!apply) {
    console.log('No records changed. Re-run with --apply after reviewing the count.');
    return;
  }

  const changedAt = new Date();
  const result = await events.updateMany(legacySummaries, {
    $set: {
      'summaryOverride.reviewStatus': 'needs_review',
      'summaryOverride.reviewStatusChangedAt': changedAt,
      'summaryOverride.reviewStatusChangedBy': MIGRATION_ACTOR,
      'summaryOverride.submittedAt': changedAt,
      'summaryOverride.submittedBy': MIGRATION_ACTOR,
    },
    $unset: {
      'summaryOverride.approvedAt': '',
      'summaryOverride.approvedBy': '',
    },
  });

  console.log(JSON.stringify({
    applied: true,
    matchedRecords: result.matchedCount,
    modifiedRecords: result.modifiedCount,
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => {});
  });
