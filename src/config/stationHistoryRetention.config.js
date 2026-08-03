const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_RETENTION_DAYS = 3650;
const DEFAULT_STATION_HISTORY_RETENTION_DAYS = 365;

function getStationHistoryRetentionDays() {
  const rawValue = process.env.ADMIN_STATION_HISTORY_RETENTION_DAYS;
  if (rawValue === undefined || String(rawValue).trim() === '') {
    return DEFAULT_STATION_HISTORY_RETENTION_DAYS;
  }

  const value = Number(rawValue);
  if (!Number.isInteger(value) || value < 1 || value > MAX_RETENTION_DAYS) {
    throw new Error(`ADMIN_STATION_HISTORY_RETENTION_DAYS must be an integer from 1 to ${MAX_RETENTION_DAYS} days.`);
  }
  return value;
}

function resolveStationHistoryRetention(now = new Date()) {
  const retentionDays = getStationHistoryRetentionDays();
  return {
    retentionDays,
    expiresAt: new Date(now.getTime() + retentionDays * DAY_MS),
  };
}

module.exports = {
  DEFAULT_STATION_HISTORY_RETENTION_DAYS,
  MAX_RETENTION_DAYS,
  getStationHistoryRetentionDays,
  resolveStationHistoryRetention,
};
