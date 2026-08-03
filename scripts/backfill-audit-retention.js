#!/usr/bin/env node
require('dotenv/config');
const mongoose = require('mongoose');
const mongodb = require('../src/services/mongodb.service');
const {
  RETENTION_CLASSES,
  getAuditRetentionConfig,
} = require('../src/config/auditRetention.config');

function expirationExpression(retentionDays) {
  if (retentionDays === 0) return '$$REMOVE';
  return {
    $dateAdd: {
      startDate: '$createdAt',
      unit: 'day',
      amount: retentionDays,
    },
  };
}

async function applyClass(collection, filter, retentionClass, retentionDays) {
  return collection.updateMany(
    filter,
    [{
      $set: {
        retentionClass,
        expiresAt: expirationExpression(retentionDays),
      },
    }],
  );
}

async function main() {
  const apply = process.argv.includes('--apply');
  const config = getAuditRetentionConfig();
  await mongodb.connect();

  const collection = mongoose.connection.collection('auditlogs');
  const unclassified = { retentionClass: { $exists: false } };
  const routineTelemetry = {
    ...unclassified,
    eventType: 'admin.telemetry.read',
    outcome: 'succeeded',
  };
  const administrative = {
    ...unclassified,
    $nor: [{ eventType: 'admin.telemetry.read', outcome: 'succeeded' }],
  };

  const [routineCount, administrativeCount] = await Promise.all([
    collection.countDocuments(routineTelemetry),
    collection.countDocuments(administrative),
  ]);

  console.log(JSON.stringify({
    mode: apply ? 'apply' : 'dry-run',
    policy: {
      routineTelemetryDays: config.telemetryDays,
      administrativeDays: config.administrativeDays,
    },
    matchingExistingRecords: {
      routineTelemetry: routineCount,
      administrative: administrativeCount,
    },
  }, null, 2));

  if (!apply) {
    console.log('No records changed. Re-run with --apply after reviewing these counts.');
    return;
  }

  const routineResult = await applyClass(
    collection,
    routineTelemetry,
    RETENTION_CLASSES.ROUTINE_TELEMETRY,
    config.telemetryDays,
  );
  const administrativeResult = await applyClass(
    collection,
    administrative,
    RETENTION_CLASSES.ADMINISTRATIVE,
    config.administrativeDays,
  );
  await collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });

  console.log(JSON.stringify({
    applied: true,
    modifiedRecords: {
      routineTelemetry: routineResult.modifiedCount,
      administrative: administrativeResult.modifiedCount,
    },
    ttlIndex: 'expiresAt_1',
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
