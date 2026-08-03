const crypto = require('crypto');
const AuditLogService = require('./auditLog.service');

function identifierFingerprint(identifier) {
  return crypto
    .createHash('sha256')
    .update(String(identifier || 'unknown').trim().toLowerCase())
    .digest('hex');
}

async function recordAuthentication(req, {
  accountId,
  identifier,
  outcome,
  reasonCode,
  username,
}) {
  const succeeded = outcome === 'succeeded';
  const auditRequest = succeeded
    ? { ...req, accountId, username, role: 'admin' }
    : req;

  return AuditLogService.record(auditRequest, {
    eventType: 'admin.authentication',
    outcome,
    target: succeeded
      ? {
        type: 'admin_account',
        id: String(accountId || username),
        label: username,
      }
      : {
        type: 'admin_identifier_fingerprint',
        id: identifierFingerprint(identifier),
        label: 'Redacted admin sign-in identifier',
      },
    metadata: { reasonCode },
  });
}

module.exports = { identifierFingerprint, recordAuthentication };
