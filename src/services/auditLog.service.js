const crypto = require('crypto');
const mongoose = require('mongoose');
const AuditLog = require('../models/auditLog.model');
const { resolveAuditRetention } = require('../config/auditRetention.config');

const SENSITIVE_KEY = /password|token|secret|authorization|cookie|private.?key/i;
const MAX_METADATA_DEPTH = 5;
const MAX_METADATA_ARRAY_ITEMS = 50;
const MAX_METADATA_OBJECT_KEYS = 50;
const MAX_METADATA_STRING_LENGTH = 2048;
const MAX_METADATA_BYTES = 32 * 1024;

function redactMetadata(value, depth = 0) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    return value.length > MAX_METADATA_STRING_LENGTH
      ? `${value.slice(0, MAX_METADATA_STRING_LENGTH)}[truncated]`
      : value;
  }
  if (typeof value !== 'object') return value;
  if (depth >= MAX_METADATA_DEPTH) return '[truncated]';
  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_METADATA_ARRAY_ITEMS)
      .map((item) => redactMetadata(item, depth + 1));
  }
  return Object.entries(value).slice(0, MAX_METADATA_OBJECT_KEYS).reduce((safe, [key, item]) => {
    safe[key] = SENSITIVE_KEY.test(key) ? '[redacted]' : redactMetadata(item, depth + 1);
    return safe;
  }, {});
}

function boundedMetadata(value) {
  const metadata = redactMetadata(value);
  const serialized = JSON.stringify(metadata);
  const bytes = Buffer.byteLength(serialized || '', 'utf8');
  if (bytes <= MAX_METADATA_BYTES) return metadata;
  return {
    truncated: true,
    originalSanitizedBytes: bytes,
    reason: 'Audit metadata exceeded the 32 KiB storage limit.',
  };
}

function requestContext(req = {}) {
  return {
    method: req.method,
    path: req.baseUrl && req.path ? `${req.baseUrl}${req.path}` : req.path,
    ip: req.ip,
    requestId: req.id || req.headers?.['x-request-id'],
  };
}

function actorContext(req = {}) {
  return {
    accountId: req.accountId ? String(req.accountId) : undefined,
    username: req.username,
    role: req.role,
  };
}

async function record(req, event) {
  const retention = resolveAuditRetention(event);
  const auditLog = await AuditLog.create({
    correlationId: event.correlationId || crypto.randomUUID(),
    eventType: event.eventType,
    outcome: event.outcome,
    actor: actorContext(req),
    target: event.target,
    reason: event.reason,
    request: requestContext(req),
    metadata: boundedMetadata(event.metadata || {}),
    retentionClass: retention.retentionClass,
    expiresAt: retention.expiresAt,
  });
  return auditLog.toObject ? auditLog.toObject() : auditLog;
}

/**
 * Runs an operational action only after its initial audit event persists, then
 * appends an immutable success or failure event with the same correlation ID.
 */
async function execute(req, event, operation) {
  const correlationId = crypto.randomUUID();
  const baseEvent = { ...event, correlationId };
  await record(req, { ...baseEvent, outcome: 'started' });
  try {
    const result = await operation({ correlationId });
    await record(req, { ...baseEvent, outcome: 'succeeded' });
    return result;
  } catch (error) {
    try {
      await record(req, {
        ...baseEvent,
        outcome: 'failed',
        metadata: { ...event.metadata, errorCode: error.code || error.name || 'operation_failed' },
      });
    } catch (auditError) {
      console.error('Failed to record audit failure event:', auditError);
    }
    throw error;
  }
}

function encodeCursor(log) {
  if (!log?.createdAt || !log?._id) return null;
  return Buffer.from(JSON.stringify({
    createdAt: new Date(log.createdAt).toISOString(),
    id: String(log._id),
  })).toString('base64url');
}

function decodeCursor(cursor) {
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    const createdAt = new Date(value.createdAt);
    if (!mongoose.isValidObjectId(value.id) || Number.isNaN(createdAt.getTime())) {
      throw new Error('Invalid audit cursor.');
    }
    return { createdAt, id: new mongoose.Types.ObjectId(value.id) };
  } catch (_) {
    throw Object.assign(new Error('Invalid audit cursor.'), { statusCode: 400 });
  }
}

function cursorFilters(filters, cursor) {
  if (!cursor) return filters;
  const position = decodeCursor(cursor);
  return {
    $and: [
      filters,
      {
        $or: [
          { createdAt: { $lt: position.createdAt } },
          { createdAt: position.createdAt, _id: { $lt: position.id } },
        ],
      },
    ],
  };
}

async function list(filters, { cursor, limit, offset }) {
  const summaryFilters = { ...filters };
  delete summaryFilters.outcome;
  const query = AuditLog.find(cursorFilters(filters, cursor)).sort({ createdAt: -1, _id: -1 });
  if (!cursor && offset) query.skip(offset);

  const [rows, summaries] = await Promise.all([
    query.limit(limit + 1).lean(),
    AuditLog.aggregate([
      { $match: summaryFilters },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          started: { $sum: { $cond: [{ $eq: ['$outcome', 'started'] }, 1, 0] } },
          succeeded: { $sum: { $cond: [{ $eq: ['$outcome', 'succeeded'] }, 1, 0] } },
          failed: { $sum: { $cond: [{ $eq: ['$outcome', 'failed'] }, 1, 0] } },
          rejected: { $sum: { $cond: [{ $eq: ['$outcome', 'rejected'] }, 1, 0] } },
        },
      },
    ]),
  ]);
  const hasMore = rows.length > limit;
  const logs = hasMore ? rows.slice(0, limit) : rows;
  const summaryDocument = summaries[0] || {
    total: 0, started: 0, succeeded: 0, failed: 0, rejected: 0,
  };
  const {
    total: summaryTotal = 0,
    started = 0,
    succeeded = 0,
    failed = 0,
    rejected = 0,
  } = summaryDocument;
  const summary = { total: summaryTotal, started, succeeded, failed, rejected };
  const total = filters.outcome ? summary[filters.outcome] : summary.total;
  return {
    logs,
    total,
    limit,
    offset: cursor ? 0 : offset,
    nextCursor: hasMore ? encodeCursor(logs[logs.length - 1]) : null,
    summary,
  };
}

module.exports = {
  boundedMetadata,
  decodeCursor,
  encodeCursor,
  execute,
  list,
  record,
  redactMetadata,
};
