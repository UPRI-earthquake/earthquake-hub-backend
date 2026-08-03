const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_RETENTION_DAYS = 3650;
const DEFAULT_RESOLVED_INCIDENT_RETENTION_DAYS = 730;
const DEFAULT_INCIDENT_EVENT_RETENTION_DAYS = 730;

function parseRetentionDays(name, defaultValue) {
  const rawValue = process.env[name];
  if (rawValue === undefined || String(rawValue).trim() === '') return defaultValue;

  const value = Number(rawValue);
  if (!Number.isInteger(value) || value < 0 || value > MAX_RETENTION_DAYS) {
    throw new Error(`${name} must be an integer from 0 to ${MAX_RETENTION_DAYS} days.`);
  }
  return value;
}

function getIncidentRetentionConfig() {
  return {
    resolvedIncidentDays: parseRetentionDays(
      'ADMIN_INCIDENT_RESOLVED_RETENTION_DAYS',
      DEFAULT_RESOLVED_INCIDENT_RETENTION_DAYS,
    ),
    eventDays: parseRetentionDays(
      'ADMIN_INCIDENT_EVENT_RETENTION_DAYS',
      DEFAULT_INCIDENT_EVENT_RETENTION_DAYS,
    ),
  };
}

function expirationFrom(now, retentionDays) {
  return retentionDays === 0
    ? undefined
    : new Date(now.getTime() + retentionDays * DAY_MS);
}

function resolveIncidentEventRetention(now = new Date()) {
  const retentionDays = getIncidentRetentionConfig().eventDays;
  return {
    retentionDays,
    expiresAt: expirationFrom(now, retentionDays),
  };
}

function resolveResolvedIncidentRetention(now = new Date()) {
  const retentionDays = getIncidentRetentionConfig().resolvedIncidentDays;
  return {
    retentionDays,
    expiresAt: expirationFrom(now, retentionDays),
  };
}

module.exports = {
  DEFAULT_INCIDENT_EVENT_RETENTION_DAYS,
  DEFAULT_RESOLVED_INCIDENT_RETENTION_DAYS,
  MAX_RETENTION_DAYS,
  getIncidentRetentionConfig,
  resolveIncidentEventRetention,
  resolveResolvedIncidentRetention,
};
