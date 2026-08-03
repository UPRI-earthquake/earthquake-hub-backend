const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_SAMPLE_INTERVAL_SECONDS = 15 * 60;
const DEFAULT_TELEMETRY_RETENTION_DAYS = 90;
const MAX_RETENTION_DAYS = 3650;
const MAX_SAMPLE_INTERVAL_SECONDS = 24 * 60 * 60;
const MIN_SAMPLE_INTERVAL_SECONDS = 60;

function boundedInteger(name, rawValue, fallback, minimum, maximum) {
  if (rawValue === undefined || String(rawValue).trim() === '') return fallback;
  const value = Number(rawValue);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}.`);
  }
  return value;
}

function getStationTelemetrySampleIntervalSeconds() {
  return boundedInteger(
    'ADMIN_STATION_TELEMETRY_SAMPLE_INTERVAL_SECONDS',
    process.env.ADMIN_STATION_TELEMETRY_SAMPLE_INTERVAL_SECONDS,
    DEFAULT_SAMPLE_INTERVAL_SECONDS,
    MIN_SAMPLE_INTERVAL_SECONDS,
    MAX_SAMPLE_INTERVAL_SECONDS,
  );
}

function getStationTelemetryRetentionDays() {
  return boundedInteger(
    'ADMIN_STATION_TELEMETRY_RETENTION_DAYS',
    process.env.ADMIN_STATION_TELEMETRY_RETENTION_DAYS,
    DEFAULT_TELEMETRY_RETENTION_DAYS,
    1,
    MAX_RETENTION_DAYS,
  );
}

function stationTelemetryBucketAt(observedAt, intervalSeconds = getStationTelemetrySampleIntervalSeconds()) {
  const date = observedAt instanceof Date ? observedAt : new Date(observedAt);
  if (Number.isNaN(date.getTime())) throw new Error('Station telemetry observedAt must be a valid date.');
  const intervalMs = intervalSeconds * 1000;
  return new Date(Math.floor(date.getTime() / intervalMs) * intervalMs);
}

function resolveStationTelemetryRetention(now = new Date()) {
  const retentionDays = getStationTelemetryRetentionDays();
  return {
    retentionDays,
    expiresAt: new Date(now.getTime() + retentionDays * DAY_MS),
  };
}

module.exports = {
  DEFAULT_SAMPLE_INTERVAL_SECONDS,
  DEFAULT_TELEMETRY_RETENTION_DAYS,
  MAX_RETENTION_DAYS,
  MAX_SAMPLE_INTERVAL_SECONDS,
  MIN_SAMPLE_INTERVAL_SECONDS,
  getStationTelemetryRetentionDays,
  getStationTelemetrySampleIntervalSeconds,
  resolveStationTelemetryRetention,
  stationTelemetryBucketAt,
};
