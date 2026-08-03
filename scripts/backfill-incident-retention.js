#!/usr/bin/env node
require('dotenv/config');
const mongoose = require('mongoose');
const mongodb = require('../src/services/mongodb.service');
const {
  getIncidentRetentionConfig,
} = require('../src/config/incidentRetention.config');

function expirationExpression(anchor, retentionDays) {
  if (retentionDays === 0) return '$$REMOVE';
  return {
    $dateAdd: {
      startDate: anchor,
      unit: 'day',
      amount: retentionDays,
    },
  };
}

async function main() {
  const apply = process.argv.includes('--apply');
  const config = getIncidentRetentionConfig();
  await mongodb.connect();

  const incidents = mongoose.connection.collection('adminincidents');
  const events = mongoose.connection.collection('adminincidentevents');
  const resolvedPolicyMismatch = {
    status: 'resolved',
    $or: [
      { retentionDays: { $ne: config.resolvedIncidentDays } },
      ...(config.resolvedIncidentDays === 0
        ? [{ expiresAt: { $exists: true } }]
        : [{ expiresAt: { $exists: false } }]),
    ],
  };
  const activeWithRetention = {
    status: { $in: ['open', 'acknowledged', 'investigating'] },
    $or: [
      { retentionDays: { $exists: true } },
      { expiresAt: { $exists: true } },
    ],
  };
  const eventPolicyMismatch = {
    $or: [
      { retentionDays: { $ne: config.eventDays } },
      ...(config.eventDays === 0
        ? [{ expiresAt: { $exists: true } }]
        : [{ expiresAt: { $exists: false } }]),
    ],
  };

  const [resolvedCount, activeRetentionCount, eventCount] = await Promise.all([
    incidents.countDocuments(resolvedPolicyMismatch),
    incidents.countDocuments(activeWithRetention),
    events.countDocuments(eventPolicyMismatch),
  ]);

  console.log(JSON.stringify({
    mode: apply ? 'apply' : 'dry-run',
    policy: config,
    matchingExistingRecords: {
      resolvedIncidentsRequiringPolicy: resolvedCount,
      activeIncidentsWithRetention: activeRetentionCount,
      incidentEventsRequiringPolicy: eventCount,
    },
  }, null, 2));

  if (!apply) {
    console.log('No records changed. Re-run with --apply after reviewing these counts.');
    return;
  }

  const [resolvedResult, activeResult, eventResult] = await Promise.all([
    incidents.updateMany(
      resolvedPolicyMismatch,
      [{
        $set: {
          retentionDays: config.resolvedIncidentDays,
          expiresAt: expirationExpression(
            { $ifNull: ['$resolvedAt', { $ifNull: ['$updatedAt', '$createdAt'] }] },
            config.resolvedIncidentDays,
          ),
        },
      }],
    ),
    incidents.updateMany(
      activeWithRetention,
      { $unset: { expiresAt: '', retentionDays: '' } },
    ),
    events.updateMany(
      eventPolicyMismatch,
      [{
        $set: {
          retentionDays: config.eventDays,
          expiresAt: expirationExpression('$createdAt', config.eventDays),
        },
      }],
    ),
  ]);

  await Promise.all([
    incidents.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    events.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
  ]);

  console.log(JSON.stringify({
    applied: true,
    modifiedRecords: {
      resolvedIncidents: resolvedResult.modifiedCount,
      activeIncidents: activeResult.modifiedCount,
      incidentEvents: eventResult.modifiedCount,
    },
    ttlIndexes: ['adminincidents.expiresAt_1', 'adminincidentevents.expiresAt_1'],
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
