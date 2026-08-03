const mongoose = require('mongoose');
const {
  resolveIncidentEventRetention,
  resolveResolvedIncidentRetention,
} = require('../config/incidentRetention.config');
const AdminIncident = require('../models/adminIncident.model');
const AdminIncidentEvent = require('../models/adminIncidentEvent.model');

const ACTIVE_STATUSES = ['open', 'acknowledged', 'investigating'];
const STATUS_TRANSITIONS = Object.freeze({
  open: new Set(['acknowledged', 'investigating', 'resolved']),
  acknowledged: new Set(['open', 'investigating', 'resolved']),
  investigating: new Set(['open', 'acknowledged', 'resolved']),
  resolved: new Set(['open']),
});

function sourceMetrics(sources, id) {
  return sources.find((source) => source.id === id)?.metrics || {};
}

function condition({
  detail,
  fingerprint,
  route,
  severity,
  sourceId,
  sourceType,
  subsystem,
  title,
  evidence = {},
}) {
  return {
    detail,
    evidence,
    fingerprint,
    route,
    severity,
    source: { type: sourceType, id: sourceId },
    subsystem,
    title,
  };
}

function deriveConditions(snapshot) {
  const sources = Array.isArray(snapshot?.sources) ? snapshot.sources : [];
  const summary = snapshot?.summary || {};
  const conditions = sources
    .filter((source) => ['degraded', 'stale', 'unavailable'].includes(source.status))
    .map((source) => condition({
      detail: source.message || 'Subsystem evidence requires review.',
      evidence: {
        observedAt: source.observedAt || snapshot.observedAt,
        failureSince: source.failureSince || null,
        freshnessStatus: source.freshness?.status || null,
        retrievalStatus: source.status,
      },
      fingerprint: `overview:source:${source.id}:availability`,
      route: source.route,
      severity: source.status === 'unavailable' ? 'critical' : 'warning',
      sourceId: source.id,
      sourceType: 'overview_source',
      subsystem: source.label,
      title: source.status === 'unavailable'
        ? `${source.label} evidence unavailable`
        : source.status === 'stale'
          ? `${source.label} evidence is stale`
          : `${source.label} evidence is degraded`,
    }));

  const stations = sourceMetrics(sources, 'stations');
  if ((stations.inactive || 0) > 0) {
    conditions.push(condition({
      detail: `${stations.inactive} inactive, unlinked, or unknown.`,
      evidence: {
        active: stations.active ?? null,
        inactive: stations.inactive,
        total: stations.total ?? null,
        unlinked: stations.unlinked ?? null,
      },
      fingerprint: 'overview:stations:activity-attention',
      route: '/devices-stations',
      severity: 'warning',
      sourceId: 'stations',
      sourceType: 'derived_metric',
      subsystem: 'RShake Stations',
      title: 'Station activity needs review',
    }));
  }

  if ((summary.archiveAttention || 0) > 0) {
    conditions.push(condition({
      detail: `${summary.archiveAttention} waveform checks need review.`,
      evidence: { attentionCount: summary.archiveAttention },
      fingerprint: 'overview:archive:verification-attention',
      route: '/archive-storage',
      severity: 'warning',
      sourceId: 'archive',
      sourceType: 'derived_metric',
      subsystem: 'Archive / FDSNWS',
      title: 'Archive verification needs review',
    }));
  }

  if ((summary.pendingReports || 0) > 0) {
    conditions.push(condition({
      detail: `${summary.pendingReports} awaiting moderation.`,
      evidence: { pendingCount: summary.pendingReports },
      fingerprint: 'overview:moderation:pending-reports',
      route: '/community-reports',
      severity: 'warning',
      sourceId: 'moderation',
      sourceType: 'derived_metric',
      subsystem: 'Community Reports',
      title: 'Community reports are pending',
    }));
  }

  if ((summary.configurationAttention || 0) > 0) {
    conditions.push(condition({
      detail: `${summary.configurationAttention} configuration checks need review.`,
      evidence: { attentionCount: summary.configurationAttention },
      fingerprint: 'overview:configuration:attention',
      route: '/settings',
      severity: 'warning',
      sourceId: 'configuration',
      sourceType: 'derived_metric',
      subsystem: 'Settings',
      title: 'Configuration needs review',
    }));
  }

  if ((summary.deploymentAttention || 0) > 0) {
    conditions.push(condition({
      detail: `${summary.deploymentAttention} services lack runtime observation.`,
      evidence: { unobservedServices: summary.deploymentAttention },
      fingerprint: 'overview:deployment:visibility',
      route: '/deployment',
      severity: 'informational',
      sourceId: 'deployment',
      sourceType: 'derived_metric',
      subsystem: 'Backend / API',
      title: 'Runtime visibility is limited',
    }));
  }

  return conditions;
}

function actor(req = {}) {
  return {
    accountId: req.accountId ? String(req.accountId) : undefined,
    username: req.username,
    role: req.adminRole || req.role,
  };
}

function serializeIncident(source) {
  const incident = typeof source?.toObject === 'function' ? source.toObject() : source;
  if (!incident) return null;
  return {
    incidentId: String(incident._id),
    fingerprint: incident.fingerprint,
    status: incident.status,
    severity: incident.severity,
    title: incident.title,
    detail: incident.detail,
    subsystem: incident.subsystem,
    route: incident.route,
    source: incident.source,
    evidence: incident.evidence || {},
    assignedTo: incident.assignedTo || null,
    firstDetectedAt: incident.firstDetectedAt,
    lastObservedAt: incident.lastObservedAt,
    acknowledgedAt: incident.acknowledgedAt || null,
    investigatingAt: incident.investigatingAt || null,
    resolvedAt: incident.resolvedAt || null,
    recurrenceCount: incident.recurrenceCount || 1,
    createdAt: incident.createdAt,
    updatedAt: incident.updatedAt,
  };
}

function severityRank(value) {
  if (value === 'critical') return 0;
  if (value === 'warning') return 1;
  return 2;
}

function sortIncidents(left, right) {
  const severityDifference = severityRank(left.severity) - severityRank(right.severity);
  if (severityDifference) return severityDifference;
  return new Date(left.firstDetectedAt).getTime() - new Date(right.firstDetectedAt).getTime();
}

async function synchronizeOverview(snapshot) {
  const observedAt = new Date(snapshot.observedAt);
  const eventRetention = resolveIncidentEventRetention();
  const conditions = deriveConditions(snapshot);
  const fingerprints = conditions.map((item) => item.fingerprint);
  const existing = await AdminIncident.find({ origin: 'overview' }).lean();
  const events = [];

  for (const item of conditions) {
    const incidentId = new mongoose.Types.ObjectId();
    const commonFields = {
      detail: item.detail,
      evidence: item.evidence,
      lastObservedAt: observedAt,
      origin: 'overview',
      route: item.route,
      severity: item.severity,
      source: item.source,
      subsystem: item.subsystem,
      title: item.title,
    };

    let creation;
    try {
      creation = await AdminIncident.updateOne(
        { fingerprint: item.fingerprint },
        {
          $setOnInsert: {
            ...commonFields,
            fingerprint: item.fingerprint,
            firstDetectedAt: observedAt,
            recurrenceCount: 1,
            status: 'open',
            _id: incidentId,
          },
        },
        { upsert: true },
      );
    } catch (error) {
      // A concurrent first observation can win the unique-fingerprint upsert
      // after this request has evaluated its predicate. Continue as an update;
      // only the winning insert is allowed to append the detected event.
      if (error?.code !== 11000) throw error;
      creation = { upsertedCount: 0 };
    }

    if (creation.upsertedCount === 1) {
      events.push({
        ...eventRetention,
        incidentId,
        eventType: 'detected',
        actor: { username: 'system', role: 'system' },
        toStatus: 'open',
        reason: 'The Overview detected this operational condition.',
        sourceEvidence: item.evidence,
      });
      continue;
    }

    const reopened = await AdminIncident.findOneAndUpdate(
      { fingerprint: item.fingerprint, status: 'resolved' },
      {
        $set: {
          ...commonFields,
          status: 'open',
          assignedTo: null,
          acknowledgedAt: null,
          investigatingAt: null,
          resolvedAt: null,
        },
        $unset: { expiresAt: 1, retentionDays: 1 },
        $inc: { recurrenceCount: 1 },
      },
      { new: true },
    ).lean();

    if (reopened) {
      events.push({
        ...eventRetention,
        incidentId: reopened._id,
        eventType: 'reopened',
        actor: { username: 'system', role: 'system' },
        fromStatus: 'resolved',
        toStatus: 'open',
        reason: 'The source condition recurred after being resolved.',
        sourceEvidence: item.evidence,
      });
    } else {
      await AdminIncident.updateOne(
        { fingerprint: item.fingerprint, status: { $ne: 'resolved' } },
        { $set: commonFields },
      );
    }
  }

  for (const item of existing.filter(
    (candidate) => (
      ACTIVE_STATUSES.includes(candidate.status)
      && !fingerprints.includes(candidate.fingerprint)
    ),
  )) {
    const resolvedRetention = resolveResolvedIncidentRetention(observedAt);
    const resolved = await AdminIncident.findOneAndUpdate(
      { _id: item._id, status: { $in: ACTIVE_STATUSES } },
      {
        $set: {
          status: 'resolved',
          resolvedAt: observedAt,
          retentionDays: resolvedRetention.retentionDays,
          ...(resolvedRetention.expiresAt ? { expiresAt: resolvedRetention.expiresAt } : {}),
        },
        ...(resolvedRetention.expiresAt ? {} : { $unset: { expiresAt: 1 } }),
      },
      { new: false },
    ).lean();
    if (resolved) {
      events.push({
        ...eventRetention,
        incidentId: resolved._id,
        eventType: 'resolved',
        actor: { username: 'system', role: 'system' },
        fromStatus: resolved.status,
        toStatus: 'resolved',
        reason: 'The source condition was no longer present in the latest Overview snapshot.',
        sourceEvidence: { observedAt: snapshot.observedAt, resolution: 'condition_cleared' },
      });
    }
  }

  if (events.length) await AdminIncidentEvent.insertMany(events, { ordered: false });

  const active = await AdminIncident.find({ status: { $in: ACTIVE_STATUSES } }).lean();
  const incidents = active.map(serializeIncident).sort(sortIncidents);
  return {
    incidents,
    summary: {
      active: incidents.length,
      open: incidents.filter((item) => item.status === 'open').length,
      acknowledged: incidents.filter((item) => item.status === 'acknowledged').length,
      investigating: incidents.filter((item) => item.status === 'investigating').length,
      critical: incidents.filter((item) => item.severity === 'critical').length,
    },
  };
}

async function listIncidents({
  assignedTo,
  limit = 50,
  offset = 0,
  severity,
  status,
} = {}) {
  const query = {};
  if (assignedTo === 'unassigned') query.assignedTo = { $in: [null, ''] };
  else if (assignedTo) query.assignedTo = assignedTo;
  if (severity) query.severity = severity;
  if (status) query.status = status;
  const [rows, total] = await Promise.all([
    AdminIncident.find(query)
      .sort({ updatedAt: -1, _id: -1 })
      .skip(offset)
      .limit(limit)
      .lean(),
    AdminIncident.countDocuments(query),
  ]);
  return { incidents: rows.map(serializeIncident), limit, offset, total };
}

async function listEvents(incidentId, { limit = 100 } = {}) {
  const events = await AdminIncidentEvent.find({ incidentId })
    .sort({ createdAt: -1, _id: -1 })
    .limit(limit)
    .lean();
  return events.map((event) => ({
    eventId: String(event._id),
    incidentId: String(event.incidentId),
    correlationId: event.correlationId || null,
    eventType: event.eventType,
    actor: event.actor,
    fromStatus: event.fromStatus || null,
    toStatus: event.toStatus || null,
    assignedTo: event.assignedTo || null,
    reason: event.reason || null,
    sourceEvidence: event.sourceEvidence || {},
    createdAt: event.createdAt,
  }));
}

async function updateIncident(incidentId, {
  assignment = 'unchanged',
  reason,
  status,
}, req) {
  const incident = await AdminIncident.findById(incidentId);
  if (!incident) return { notFound: true };

  const priorStatus = incident.status;
  if (status && status !== priorStatus && !STATUS_TRANSITIONS[priorStatus]?.has(status)) {
    return { invalidTransition: true, fromStatus: priorStatus, toStatus: status };
  }

  let eventType = status && status !== priorStatus ? status : 'note';
  let assignedTo = incident.assignedTo || null;
  if (assignment === 'self') {
    assignedTo = req.username;
    if (!status && assignedTo !== incident.assignedTo) eventType = 'assigned';
  } else if (assignment === 'unassigned') {
    assignedTo = null;
    if (!status && incident.assignedTo) eventType = 'unassigned';
  }

  if (status && status !== priorStatus) {
    const transitionTime = new Date();
    incident.status = status;
    if (status === 'acknowledged') incident.acknowledgedAt = transitionTime;
    if (status === 'investigating') {
      incident.investigatingAt = transitionTime;
      if (assignment === 'unchanged' && !assignedTo) assignedTo = req.username;
    }
    if (status === 'resolved') {
      const retention = resolveResolvedIncidentRetention(transitionTime);
      incident.resolvedAt = transitionTime;
      incident.retentionDays = retention.retentionDays;
      incident.expiresAt = retention.expiresAt;
    }
    if (status === 'open') {
      incident.acknowledgedAt = null;
      incident.investigatingAt = null;
      incident.resolvedAt = null;
      incident.retentionDays = undefined;
      incident.expiresAt = undefined;
    }
  }
  incident.assignedTo = assignedTo;
  await incident.save();
  await AdminIncidentEvent.create({
    ...resolveIncidentEventRetention(),
    incidentId: incident._id,
    correlationId: req.auditCorrelationId,
    eventType,
    actor: actor(req),
    fromStatus: priorStatus,
    toStatus: incident.status,
    assignedTo,
    reason,
  });
  return { incident: serializeIncident(incident) };
}

module.exports = {
  ACTIVE_STATUSES,
  STATUS_TRANSITIONS,
  deriveConditions,
  listEvents,
  listIncidents,
  serializeIncident,
  synchronizeOverview,
  updateIncident,
};
