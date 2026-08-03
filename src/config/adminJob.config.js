const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_RETENTION_DAYS = 3650;
const DEFAULT_ADMIN_JOB_RETENTION_DAYS = 180;
const DEFAULT_ADMIN_JOB_TIMEOUT_MS = 60 * 60 * 1000;
const DEFAULT_ADMIN_JOB_MAX_ATTEMPTS = 3;

function boundedInteger(name, fallback, { min, max }) {
  const rawValue = process.env[name];
  if (rawValue === undefined || String(rawValue).trim() === '') return fallback;

  const value = Number(rawValue);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer from ${min} to ${max}.`);
  }
  return value;
}

function getAdminJobConfig() {
  return {
    maxAttempts: boundedInteger(
      'ADMIN_JOB_MAX_ATTEMPTS',
      DEFAULT_ADMIN_JOB_MAX_ATTEMPTS,
      { min: 1, max: 10 },
    ),
    retentionDays: boundedInteger(
      'ADMIN_JOB_RETENTION_DAYS',
      DEFAULT_ADMIN_JOB_RETENTION_DAYS,
      { min: 0, max: MAX_RETENTION_DAYS },
    ),
    timeoutMs: boundedInteger(
      'ADMIN_JOB_TIMEOUT_MS',
      DEFAULT_ADMIN_JOB_TIMEOUT_MS,
      { min: 60_000, max: 24 * 60 * 60 * 1000 },
    ),
  };
}

function resolveAdminJobRetention(now = new Date()) {
  const retentionDays = getAdminJobConfig().retentionDays;
  return {
    retentionDays,
    expiresAt: retentionDays === 0
      ? undefined
      : new Date(now.getTime() + retentionDays * DAY_MS),
  };
}

module.exports = {
  DEFAULT_ADMIN_JOB_MAX_ATTEMPTS,
  DEFAULT_ADMIN_JOB_RETENTION_DAYS,
  DEFAULT_ADMIN_JOB_TIMEOUT_MS,
  getAdminJobConfig,
  resolveAdminJobRetention,
};
