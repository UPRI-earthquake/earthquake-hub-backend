const crypto = require('crypto');
const AuditLog = require('../models/auditLog.model');

const SENSITIVE_KEY = /password|token|secret|authorization|cookie|private.?key/i;

function redactMetadata(value, depth = 0) {
  if (depth > 5 || value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => redactMetadata(item, depth + 1));
  if (typeof value !== 'object') return value;
  return Object.entries(value).reduce((safe, [key, item]) => {
    safe[key] = SENSITIVE_KEY.test(key) ? '[redacted]' : redactMetadata(item, depth + 1);
    return safe;
  }, {});
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
  const auditLog = await AuditLog.create({
    correlationId: event.correlationId || crypto.randomUUID(),
    eventType: event.eventType,
    outcome: event.outcome,
    actor: actorContext(req),
    target: event.target,
    reason: event.reason,
    request: requestContext(req),
    metadata: redactMetadata(event.metadata || {}),
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
    const result = await operation();
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

async function list(filters, { limit, offset }) {
  const [logs, total] = await Promise.all([
    AuditLog.find(filters).sort({ createdAt: -1 }).skip(offset).limit(limit).lean(),
    AuditLog.countDocuments(filters),
  ]);
  return { logs, total, limit, offset };
}

module.exports = { execute, list, record, redactMetadata };
