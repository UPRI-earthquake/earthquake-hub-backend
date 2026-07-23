const Device = require('../models/device.model');
const Event = require('../models/events.model');
const AdminHostTelemetryClient = require('./adminHostTelemetry.client');

function toDate(value) {
  return value ? new Date(value).toISOString() : null;
}

function ageMs(value, now) {
  return value ? Math.max(0, now.getTime() - new Date(value).getTime()) : null;
}

async function getSnapshot({ windowHours = 24, limit = 20 } = {}, req) {
  const now = new Date();
  const since = new Date(now.getTime() - (windowHours * 60 * 60 * 1000));
  const [recentEvents, eventCount, pendingRecordingCount, activeStations, inactiveStations, hostTelemetry] = await Promise.all([
    Event.find({ createdAt: { $gte: since } })
      .sort({ createdAt: -1 })
      .limit(limit)
      .select('publicID OT magnitude_value text type createdAt updatedAt last_modification recordingAvailabilityStatus')
      .lean(),
    Event.countDocuments({ createdAt: { $gte: since } }),
    Event.countDocuments({ createdAt: { $gte: since }, recordingAvailabilityStatus: { $in: ['pending', 'partial'] } }),
    Device.countDocuments({ activity: { $in: ['active', 'streaming'] } }),
    Device.countDocuments({ activity: { $nin: ['active', 'streaming'] } }),
    AdminHostTelemetryClient.getResource('seiscomp', req),
  ]);

  const latestEvent = recentEvents[0] || null;
  const latestEventObservedAt = latestEvent?.createdAt || null;
  const eventDeliveryAgeMs = ageMs(latestEventObservedAt, now);
  const modules = [
    {
      id: 'fdsnws-host-check',
      name: 'FDSNWS reachability',
      status: hostTelemetry.status === 'available' ? 'observed' : 'unobserved',
      observation: hostTelemetry.status === 'available' || hostTelemetry.status === 'degraded'
        ? `The fixed FDSNWS endpoint returned HTTP ${hostTelemetry.data?.httpStatus ?? 'unknown'} in ${hostTelemetry.data?.latencyMs ?? 'unknown'} ms.`
        : 'The fixed FDSNWS reachability check is unavailable.',
      observedAt: hostTelemetry.observedAt,
    },
    {
      id: 'seedlink',
      name: 'SeedLink input',
      status: 'observed',
      observation: `${activeStations} station${activeStations === 1 ? '' : 's'} currently marked active or streaming in the station registry.`,
      observedAt: null,
    },
    {
      id: 'scautopick',
      name: 'scautopick',
      status: 'unobserved',
      observation: 'Pick delivery is streamed to clients but is not persisted, so no reliable module freshness metric is available.',
      observedAt: null,
    },
    {
      id: 'scamp',
      name: 'scamp',
      status: 'unobserved',
      observation: 'Amplitude processing has no backend-facing heartbeat or persisted operational metric.',
      observedAt: null,
    },
    {
      id: 'scautoloc',
      name: 'scautoloc',
      status: latestEvent ? 'observed' : 'unobserved',
      observation: latestEvent ? `Latest delivered event: ${latestEvent.publicID}.` : 'No SeisComP event delivery has been observed in this window.',
      observedAt: toDate(latestEventObservedAt),
    },
    {
      id: 'scevent',
      name: 'scevent',
      status: latestEvent ? 'observed' : 'unobserved',
      observation: latestEvent ? `${eventCount} event${eventCount === 1 ? '' : 's'} delivered to the backend in the selected window.` : 'No event delivery has been observed in this window.',
      observedAt: toDate(latestEventObservedAt),
    },
    {
      id: 'scmag',
      name: 'scmag',
      status: latestEvent?.magnitude_value !== undefined && latestEvent?.magnitude_value !== null ? 'observed' : 'unobserved',
      observation: latestEvent?.magnitude_value !== undefined && latestEvent?.magnitude_value !== null ? `Latest delivered magnitude: M${latestEvent.magnitude_value}.` : 'No delivered magnitude is available in this window.',
      observedAt: toDate(latestEventObservedAt),
    },
    {
      id: 'event-messaging-proxy',
      name: 'Event messaging proxy',
      status: latestEvent ? 'observed' : 'unobserved',
      observation: latestEvent ? 'The backend has observed a forwarded SeisComP event.' : 'No forwarded SeisComP event was observed in this window.',
      observedAt: toDate(latestEventObservedAt),
    },
  ];

  return {
    observedAt: now.toISOString(),
    window: { hours: windowHours, since: since.toISOString() },
    limitations: [
      'SeisComP runs on the deployment host, outside the Docker backend.',
      'The private admin backend checks only a fixed FDSNWS endpoint; it does not claim SeisComP module or process status.',
      'This snapshot also reports backend-observed delivery and Ringserver-derived station input.',
    ],
    summary: {
      activeStations,
      inactiveStations,
      deliveredEvents: eventCount,
      eventsPendingRecordingVerification: pendingRecordingCount,
      latestEventObservedAt: toDate(latestEventObservedAt),
      eventDeliveryAgeMs,
      fdsnwsReachable: hostTelemetry.data?.reachable ?? null,
    },
    hostTelemetry,
    modules,
    recentEvents: recentEvents.map((event) => ({
      publicID: event.publicID,
      originTime: toDate(event.OT),
      magnitude: event.magnitude_value ?? null,
      location: event.text || null,
      eventType: event.type || null,
      observedAt: toDate(event.createdAt),
      updatedAt: toDate(event.updatedAt),
      recordingAvailabilityStatus: event.recordingAvailabilityStatus || null,
    })),
  };
}

module.exports = { getSnapshot };
