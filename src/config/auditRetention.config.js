const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_RETENTION_DAYS = 3650;
const DEFAULT_TELEMETRY_RETENTION_DAYS = 90;
const DEFAULT_ADMIN_RETENTION_DAYS = 730;

const RETENTION_CLASSES = Object.freeze({
  ROUTINE_TELEMETRY: 'routine_telemetry',
  ADMINISTRATIVE: 'administrative',
});

function parseRetentionDays(name, defaultValue) {
  const rawValue = process.env[name];
  if (rawValue === undefined || String(rawValue).trim() === '') return defaultValue;

  const value = Number(rawValue);
  if (!Number.isInteger(value) || value < 0 || value > MAX_RETENTION_DAYS) {
    throw new Error(`${name} must be an integer from 0 to ${MAX_RETENTION_DAYS} days.`);
  }
  return value;
}

function getAuditRetentionConfig() {
  return {
    telemetryDays: parseRetentionDays(
      'ADMIN_AUDIT_TELEMETRY_RETENTION_DAYS',
      DEFAULT_TELEMETRY_RETENTION_DAYS,
    ),
    administrativeDays: parseRetentionDays(
      'ADMIN_AUDIT_ADMINISTRATIVE_RETENTION_DAYS',
      DEFAULT_ADMIN_RETENTION_DAYS,
    ),
  };
}

function isRoutineTelemetry(event = {}) {
  return event.eventType === 'admin.telemetry.read' && event.outcome === 'succeeded';
}

function resolveAuditRetention(event, now = new Date()) {
  const config = getAuditRetentionConfig();
  const routineTelemetry = isRoutineTelemetry(event);
  const retentionClass = routineTelemetry
    ? RETENTION_CLASSES.ROUTINE_TELEMETRY
    : RETENTION_CLASSES.ADMINISTRATIVE;
  const retentionDays = routineTelemetry ? config.telemetryDays : config.administrativeDays;

  return {
    retentionClass,
    retentionDays,
    expiresAt: retentionDays === 0
      ? undefined
      : new Date(now.getTime() + retentionDays * DAY_MS),
  };
}

module.exports = {
  DEFAULT_ADMIN_RETENTION_DAYS,
  DEFAULT_TELEMETRY_RETENTION_DAYS,
  MAX_RETENTION_DAYS,
  RETENTION_CLASSES,
  getAuditRetentionConfig,
  isRoutineTelemetry,
  resolveAuditRetention,
};
