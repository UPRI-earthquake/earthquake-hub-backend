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
      'The private admin backend exposes only archive mount availability and a free-space band; paths, files, and waveform contents remain hidden.',
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
          ? `${hostTelemetry.data?.sourceLabel || 'The configured archive telemetry source'} is available; free-space band is ${hostTelemetry.data?.freeSpaceBand || 'unknown'}.`
          : 'The bounded archive mount check is unavailable.',
        observedAt: hostTelemetry.observedAt,
      },
    ],
    gaps: gapEvents.map(buildGapDiagnostic),
  };
}

module.exports = { getSnapshot };
