#!/usr/bin/env node
require('dotenv/config');
const mongoose = require('mongoose');
const mongodb = require('../src/services/mongodb.service');
const AuditLogService = require('../src/services/auditLog.service');

function argumentValue(name) {
  const prefix = `--${name}=`;
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
}

function parseDate(name, required = false) {
  const value = argumentValue(name);
  if (!value && !required) return undefined;
  if (!value) throw new Error(`--${name}=<ISO-8601 date> is required.`);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`--${name} must be a valid ISO-8601 date.`);
  return date;
}

async function writeLine(document) {
  if (process.stdout.write(`${JSON.stringify(document)}\n`)) return;
  await new Promise((resolve) => process.stdout.once('drain', resolve));
}

async function main() {
  const before = parseDate('before', true);
  const after = parseDate('after');
  if (after && after >= before) throw new Error('--after must be earlier than --before.');

  await mongodb.connect();
  const collection = mongoose.connection.collection('auditlogs');
  const query = {
    retentionClass: process.argv.includes('--all')
      ? { $in: ['administrative', 'routine_telemetry'] }
      : 'administrative',
    createdAt: {
      ...(after ? { $gte: after } : {}),
      $lt: before,
    },
  };
  const count = await collection.countDocuments(query);
  console.error(`Exporting ${count} audit records; output contains sensitive operational data.`);

  const cursor = collection.find(query).sort({ createdAt: 1, _id: 1 });
  for await (const document of cursor) await writeLine(document);
  await AuditLogService.record({
    username: process.env.ADMIN_AUDIT_EXPORT_ACTOR || 'system-maintenance',
    role: 'system',
    method: 'MAINTENANCE',
    path: '/scripts/export-audit-logs',
    headers: {},
  }, {
    eventType: 'admin.audit.export',
    outcome: 'succeeded',
    target: { type: 'audit_collection', id: 'auditlogs', label: 'Admin audit logs' },
    metadata: {
      after: after?.toISOString(),
      before: before.toISOString(),
      recordCount: count,
      includedRetentionClasses: process.argv.includes('--all')
        ? ['administrative', 'routine_telemetry']
        : ['administrative'],
    },
  });
  console.error(`Export complete: ${count} records.`);
}

process.stdout.on('error', (error) => {
  if (error.code === 'EPIPE') process.exit(0);
  throw error;
});

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => {});
  });
