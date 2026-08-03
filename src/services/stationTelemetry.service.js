const StationTelemetrySample = require('../models/stationTelemetrySample.model');
const {
  getStationTelemetrySampleIntervalSeconds,
  resolveStationTelemetryRetention,
  stationTelemetryBucketAt,
} = require('../config/stationTelemetry.config');

const ALLOWED_WINDOWS_HOURS = [6, 24, 72];
const MAX_QUERY_SAMPLES = 1000;
const RETRY_AFTER_FAILURE_MS = 60_000;
const samplingState = new Map();

function normalizeDeviceId(value) {
  return String(value || '').trim().toUpperCase();
}

function deviceIdentity(deviceId) {
  const normalized = normalizeDeviceId(deviceId);
  const separator = normalized.indexOf('_');
  return {
    deviceId: normalized,
    network: separator > 0 ? normalized.slice(0, separator) : undefined,
    station: separator > 0 ? normalized.slice(separator + 1) : undefined,
  };
}

function validDate(value, name) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`${name} must be a valid date.`);
  return date;
}

function isDuplicateKey(error) {
  return error?.code === 11000;
}

function finiteNumber(value, name, minimum = 0) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum) {
    throw new Error(`${name} must be a finite number greater than or equal to ${minimum}.`);
  }
  return number;
}

async function retainFreshnessSample({
  activity,
  deviceId,
  inactivityThresholdMs,
  latestPacketAt,
  observedAt,
  packetAgeMs,
  streamRowCount,
}, options = {}) {
  const observationTime = validDate(observedAt, 'observedAt');
  const packetTime = validDate(latestPacketAt, 'latestPacketAt');
  const intervalSeconds = getStationTelemetrySampleIntervalSeconds();
  const bucketAt = stationTelemetryBucketAt(observationTime, intervalSeconds);
  const normalizedDeviceId = normalizeDeviceId(deviceId);
  if (!normalizedDeviceId) throw new Error('deviceId is required.');
  if (!['active', 'inactive'].includes(activity)) throw new Error('activity must be active or inactive.');
  const normalizedPacketAgeMs = finiteNumber(packetAgeMs, 'packetAgeMs');
  const normalizedThresholdMs = finiteNumber(inactivityThresholdMs, 'inactivityThresholdMs');
  const normalizedStreamRowCount = finiteNumber(streamRowCount, 'streamRowCount', 1);
  if (!Number.isInteger(normalizedStreamRowCount)) throw new Error('streamRowCount must be an integer.');
  const stateKey = normalizedDeviceId;
  const bucketKey = bucketAt.toISOString();
  const nowMs = options.nowMs ?? Date.now();
  const previous = samplingState.get(stateKey);

  if (previous?.bucketKey === bucketKey && (previous.stored || nowMs < previous.retryAt)) {
    return { bucketAt, reason: previous.stored ? 'already_sampled' : 'retry_deferred', stored: false };
  }

  samplingState.set(stateKey, { bucketKey, retryAt: nowMs + RETRY_AFTER_FAILURE_MS, stored: false });
  const retention = resolveStationTelemetryRetention(observationTime);
  try {
    const sample = await StationTelemetrySample.create({
      ...deviceIdentity(normalizedDeviceId),
      source: 'ringserver_stream_status',
      observedAt: observationTime,
      bucketAt,
      latestPacketAt: packetTime,
      packetAgeMs: normalizedPacketAgeMs,
      inactivityThresholdMs: normalizedThresholdMs,
      activity,
      streamRowCount: normalizedStreamRowCount,
      sampleIntervalSeconds: intervalSeconds,
      ...retention,
    });
    samplingState.set(stateKey, { bucketKey, retryAt: 0, stored: true });
    return { bucketAt, sample, stored: true };
  } catch (error) {
    if (isDuplicateKey(error)) {
      samplingState.set(stateKey, { bucketKey, retryAt: 0, stored: true });
      return { bucketAt, reason: 'already_sampled', stored: false };
    }
    throw error;
  }
}

async function listFreshness({ deviceId, hours = 24, now = new Date() }) {
  if (!ALLOWED_WINDOWS_HOURS.includes(hours)) {
    throw Object.assign(new Error('Station freshness window must be 6, 24, or 72 hours.'), { statusCode: 400 });
  }
  const until = validDate(now, 'now');
  const since = new Date(until.getTime() - hours * 60 * 60 * 1000);
  const rows = await StationTelemetrySample.find({
    deviceId: normalizeDeviceId(deviceId),
    observedAt: { $gte: since, $lte: until },
  })
    .sort({ observedAt: -1, _id: -1 })
    .limit(MAX_QUERY_SAMPLES + 1)
    .lean();
  const truncated = rows.length > MAX_QUERY_SAMPLES;
  const samples = (truncated ? rows.slice(0, MAX_QUERY_SAMPLES) : rows).reverse();
  const packetAges = samples.map(({ packetAgeMs }) => Number(packetAgeMs)).filter(Number.isFinite);

  return {
    samples,
    summary: {
      hours,
      sampleCount: samples.length,
      latestObservedAt: samples.at(-1)?.observedAt || null,
      latestPacketAgeMs: samples.at(-1)?.packetAgeMs ?? null,
      peakPacketAgeMs: packetAges.length ? Math.max(...packetAges) : null,
      inactivityThresholdMs: samples.at(-1)?.inactivityThresholdMs ?? null,
      source: 'ringserver_stream_status',
      truncated,
      windowStart: since,
      windowEnd: until,
    },
  };
}

function resetSamplingState() {
  samplingState.clear();
}

module.exports = {
  ALLOWED_WINDOWS_HOURS,
  MAX_QUERY_SAMPLES,
  RETRY_AFTER_FAILURE_MS,
  listFreshness,
  retainFreshnessSample,
  _test: { resetSamplingState, samplingState },
};
