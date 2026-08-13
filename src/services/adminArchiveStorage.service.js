const Device = require('../models/device.model');
const Event = require('../models/events.model');
const AdminHostTelemetryClient = require('./adminHostTelemetry.client');
const { buildOperationalState } = require('./adminOperationalState.service');

function toDate(value) {
  return value ? new Date(value).toISOString() : null;
}

function normalizeStations(value) {
  return Array.isArray(value) ? value.map((station) => String(station)).filter(Boolean) : [];
}

function safeByteCount(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : null;
}

function safePercent(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 100
    ? Math.round(parsed * 10) / 10
    : null;
}

function archiveCapacity(data = {}) {
  const totalBytes = safeByteCount(data.totalBytes);
  const availableBytes = safeByteCount(data.availableBytes);
  const usedBytes = safeByteCount(data.usedBytes);
  const usedPercent = safePercent(data.usedPercent);
  if (totalBytes === null || availableBytes === null || usedBytes === null || usedPercent === null) {
    return { totalBytes: null, availableBytes: null, usedBytes: null, usedPercent: null };
  }
  if (availableBytes > totalBytes || usedBytes > totalBytes) {
    return { totalBytes: null, availableBytes: null, usedBytes: null, usedPercent: null };
  }
  return { totalBytes, availableBytes, usedBytes, usedPercent };
}

function formatCapacity(bytes) {
  if (!Number.isFinite(bytes)) return 'unknown capacity';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const precision = value >= 10 || unit === 0 ? 0 : 1;
  return `${value.toFixed(precision)} ${units[unit]}`;
}

function buildGapDiagnostic(event) {
  const candidateStations = normalizeStations(event.candidateStations);
  const recordingStations = normalizeStations(event.recordingStations);
  const recordingSet = new Set(recordingStations);
  const missingStations = candidateStations.filter((station) => !recordingSet.has(station));
  const status = event.recordingAvailabilityStatus || 'pending';
  return {
    id: event.publicID,
    publicID: event.publicID,
    originTime: toDate(event.OT),
    magnitude: event.magnitude_value ?? null,
    location: event.text || null,
    status,
    checkedAt: toDate(event.recordingAvailabilityCheckedAt),
    candidateStations,
    recordingStations,
    missingStations,
    observation: status === 'unavailable'
      ? 'FDSN waveform verification was unavailable for this event.'
      : missingStations.length
        ? `${missingStations.length} candidate station${missingStations.length === 1 ? '' : 's'} lacked verified recording coverage.`
        : 'Waveform coverage requires another verification pass.',
  };
}

async function getSnapshot({ windowHours = 24, limit = 50 } = {}, req) {
  const now = new Date();
  const since = new Date(now.getTime() - (windowHours * 60 * 60 * 1000));
  const baseQuery = { createdAt: { $gte: since } };
  const [verifiedEvents, partialEvents, unavailableEvents, pendingEvents, activeStations, inactiveStations, latestCheckedEvent, gapEvents, hostTelemetry] = await Promise.all([
    Event.countDocuments({ ...baseQuery, recordingAvailabilityStatus: 'verified' }),
    Event.countDocuments({ ...baseQuery, recordingAvailabilityStatus: 'partial' }),
    Event.countDocuments({ ...baseQuery, recordingAvailabilityStatus: 'unavailable' }),
    Event.countDocuments({ ...baseQuery, recordingAvailabilityStatus: { $in: ['pending', null] } }),
    Device.countDocuments({ activity: 'active' }),
    Device.countDocuments({ activity: { $ne: 'active' } }),
    Event.findOne({ recordingAvailabilityCheckedAt: { $exists: true, $ne: null } })
      .sort({ recordingAvailabilityCheckedAt: -1 })
      .select('publicID recordingAvailabilityCheckedAt recordingAvailabilityStatus')
      .lean(),
    Event.find({
      ...baseQuery,
      recordingAvailabilityStatus: { $in: ['partial', 'unavailable', 'pending'] },
    })
      .sort({ recordingAvailabilityCheckedAt: -1, createdAt: -1 })
      .limit(limit)
      .select('publicID OT magnitude_value text recordingAvailabilityStatus recordingAvailabilityCheckedAt candidateStations recordingStations')
      .lean(),
    AdminHostTelemetryClient.getResource('archive', req),
  ]);

  const observedAt = now.toISOString();
  const capacity = archiveCapacity(hostTelemetry.data);
  const operationalAvailability = hostTelemetry.status === 'available'
    && hostTelemetry.operational?.state === 'healthy'
    ? 'available'
    : 'degraded';
  return {
    observedAt,
    operational: buildOperationalState({
      availability: operationalAvailability,
      observedAt,
      message: operationalAvailability === 'available'
        ? 'Persisted recording evidence and bounded archive-host telemetry were retrieved.'
        : 'Persisted recording evidence is available, but archive-host telemetry is degraded or unavailable.',
    }),
    window: { hours: windowHours, since: since.toISOString() },
    limitations: [
      'The private admin backend exposes mount availability and rounded capacity figures only; paths, files, remote mount details, and waveform contents remain hidden.',
      'slarchive process state remains unavailable to both backends.',
      'Gap diagnostics are based on persisted FDSN waveform verification for recent events, not a direct scan of the SDS archive.',
    ],
    summary: {
      activeStations,
      inactiveStations,
      verifiedEvents,
      partialEvents,
      unavailableEvents,
      pendingEvents,
      latestFdsnVerificationAt: toDate(latestCheckedEvent?.recordingAvailabilityCheckedAt),
      latestFdsnVerificationStatus: latestCheckedEvent?.recordingAvailabilityStatus || null,
      archiveMounted: hostTelemetry.data?.mounted ?? null,
      archiveFreeSpaceBand: hostTelemetry.data?.freeSpaceBand || null,
      archiveSourceLabel: hostTelemetry.data?.sourceLabel || 'Configured archive telemetry source',
      archiveTotalBytes: capacity.totalBytes,
      archiveAvailableBytes: capacity.availableBytes,
      archiveUsedBytes: capacity.usedBytes,
      archiveUsedPercent: capacity.usedPercent,
    },
    hostTelemetry,
    checks: [
      {
        id: 'fdsnws-recording-verification',
        name: 'FDSNWS waveform verification',
        status: latestCheckedEvent ? 'observed' : 'unobserved',
        observation: latestCheckedEvent
          ? `Latest backend-recorded FDSN verification was ${latestCheckedEvent.recordingAvailabilityStatus || 'unknown'}.`
          : 'No persisted FDSN waveform verification has been observed.',
        observedAt: toDate(latestCheckedEvent?.recordingAvailabilityCheckedAt),
      },
      {
        id: 'slarchive',
        name: 'slarchive',
        status: 'unobserved',
        observation: 'Host-level archive writer status is not exported to the backend.',
        observedAt: null,
      },
      {
        id: 'storage-mount',
        name: 'Archive storage mount',
        status: hostTelemetry.status === 'available' ? 'observed' : 'unobserved',
        observation: hostTelemetry.status === 'available'
          ? `${hostTelemetry.data?.sourceLabel || 'The configured archive telemetry source'} is available; ${capacity.usedPercent === null ? 'capacity is unavailable' : `${capacity.usedPercent}% used with ${formatCapacity(capacity.availableBytes)} available of ${formatCapacity(capacity.totalBytes)}`}.`
          : 'The bounded archive mount check is unavailable.',
        observedAt: hostTelemetry.observedAt,
      },
    ],
    gaps: gapEvents.map(buildGapDiagnostic),
  };
}

module.exports = { archiveCapacity, formatCapacity, getSnapshot };
