const mongoose = require('mongoose');
const StationOperationalEvent = require('../models/stationOperationalEvent.model');
const { resolveStationHistoryRetention } = require('../config/stationHistoryRetention.config');

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

function validDate(value, fallback = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date;
}

function actorContext(actor = {}) {
  return {
    accountId: actor.accountId ? String(actor.accountId) : undefined,
    username: actor.username,
    role: actor.role,
  };
}

async function appendActivityTransition({
  deviceId,
  effectiveAt,
  fromActivity,
  latestPacketAt,
  observedAt,
  packetAgeMs,
  streamId,
  thresholdMs,
  toActivity,
}) {
  const observationTime = validDate(observedAt);
  const retention = resolveStationHistoryRetention(observationTime);
  return StationOperationalEvent.create({
    ...deviceIdentity(deviceId),
    eventType: 'activity_changed',
    source: 'ringserver_stream_status',
    observedAt: observationTime,
    effectiveAt: validDate(effectiveAt || latestPacketAt, observationTime),
    fromState: { activity: String(fromActivity || 'unknown').toLowerCase() },
    toState: { activity: String(toActivity || 'unknown').toLowerCase() },
    evidence: {
      streamId,
      latestPacketAt: latestPacketAt ? validDate(latestPacketAt, observationTime) : undefined,
      packetAgeMs: Number.isFinite(Number(packetAgeMs)) ? Math.max(0, Number(packetAgeMs)) : undefined,
      inactivityThresholdMs: Number.isFinite(Number(thresholdMs)) ? Math.max(0, Number(thresholdMs)) : undefined,
    },
    ...retention,
  });
}

async function appendTunnelTransition({ actor, correlationId, deviceId, eventType, observedAt, remotePort }) {
  if (!['tunnel_enrolled', 'tunnel_revoked'].includes(eventType)) {
    throw new Error('Unsupported station tunnel transition.');
  }
  const observationTime = validDate(observedAt);
  const retention = resolveStationHistoryRetention(observationTime);
  const enrolled = eventType === 'tunnel_enrolled';
  return StationOperationalEvent.create({
    ...deviceIdentity(deviceId),
    eventType,
    source: 'tunnel_registry_action',
    observedAt: observationTime,
    effectiveAt: observationTime,
    fromState: { tunnelMapping: enrolled ? 'unmapped' : 'mapped' },
    toState: { tunnelMapping: enrolled ? 'mapped' : 'unmapped' },
    evidence: {
      remotePort: Number.isFinite(Number(remotePort)) ? Number(remotePort) : undefined,
    },
    actor: actorContext(actor),
    correlationId,
    ...retention,
  });
}

function encodeCursor(event) {
  if (!event?.observedAt || !event?._id) return null;
  return Buffer.from(JSON.stringify({
    observedAt: new Date(event.observedAt).toISOString(),
    id: String(event._id),
  })).toString('base64url');
}

function decodeCursor(cursor) {
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    const observedAt = new Date(value.observedAt);
    if (!mongoose.isValidObjectId(value.id) || Number.isNaN(observedAt.getTime())) throw new Error();
    return { observedAt, id: new mongoose.Types.ObjectId(value.id) };
  } catch (_) {
    throw Object.assign(new Error('Invalid station history cursor.'), { statusCode: 400 });
  }
}

async function listHistory({ cursor, deviceId, eventType, limit = 25 }) {
  const filters = { deviceId: normalizeDeviceId(deviceId) };
  if (eventType) filters.eventType = eventType;
  if (cursor) {
    const position = decodeCursor(cursor);
    filters.$or = [
      { observedAt: { $lt: position.observedAt } },
      { observedAt: position.observedAt, _id: { $lt: position.id } },
    ];
  }

  const rows = await StationOperationalEvent.find(filters)
    .sort({ observedAt: -1, _id: -1 })
    .limit(limit + 1)
    .lean();
  const hasMore = rows.length > limit;
  const events = hasMore ? rows.slice(0, limit) : rows;
  return {
    events,
    limit,
    nextCursor: hasMore ? encodeCursor(events[events.length - 1]) : null,
  };
}

module.exports = {
  appendActivityTransition,
  appendTunnelTransition,
  decodeCursor,
  encodeCursor,
  listHistory,
  normalizeDeviceId,
};
