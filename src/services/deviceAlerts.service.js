const Account = require('../models/account.model');
const Device = require('../models/device.model');
const EmailService = require('./email.service');

const DEFAULT_ADMIN_MONITOR_EMAIL = 'earthquake@science.upd.edu.ph';
const SUPPORTED_ALERT_TYPES = new Set(['device.alert', 'device.recovery', 'device.heartbeat']);
const HEARTBEAT_TYPE = 'device.heartbeat';

function normalizeText(value) {
  return String(value || '').trim();
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

function extractEmail(value) {
  const raw = normalizeText(value);
  if (!raw) return '';
  const angleMatch = raw.match(/<([^>]+)>/);
  if (angleMatch && isValidEmail(angleMatch[1])) {
    return angleMatch[1].toLowerCase();
  }
  if (isValidEmail(raw)) {
    return raw.toLowerCase();
  }
  return '';
}

function parseEmailList(raw) {
  return String(raw || '')
    .split(/[;,]/)
    .map((entry) => extractEmail(entry))
    .filter(Boolean);
}

function dedupeEmails(list = []) {
  const seen = new Set();
  const deduped = [];
  list.forEach((value) => {
    const key = String(value || '').trim().toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    deduped.push(key);
  });
  return deduped;
}

function getAdminRecipients() {
  const explicitPrimary = parseEmailList(process.env.ALERT_EMAIL_ADMIN_TO);
  const explicitSecondary = parseEmailList(process.env.EMAIL_ALERT_ADMIN_TO);
  const explicit = explicitPrimary.length > 0 ? explicitPrimary : explicitSecondary;
  if (explicit.length > 0) return dedupeEmails(explicit);

  const senderAddress = extractEmail(process.env.EMAIL_FROM);
  if (senderAddress) {
    return [senderAddress];
  }

  return [DEFAULT_ADMIN_MONITOR_EMAIL];
}

function sanitizeToken(value, fallback) {
  const normalized = normalizeText(value).toLowerCase().replace(/[^a-z0-9._-]+/g, '-');
  const compact = normalized.replace(/^-+|-+$/g, '');
  return compact || fallback;
}

function buildThreadRootMessageId() {
  const threadKey = sanitizeToken(process.env.ALERT_EMAIL_THREAD_KEY || 'rshake-alerts', 'rshake-alerts');
  const threadDomain = sanitizeToken(
    process.env.ALERT_EMAIL_THREAD_DOMAIN || 'earthquake-hub.local',
    'earthquake-hub.local',
  );
  return `<${threadKey}@${threadDomain}>`;
}

function normalizeSeverity(rawSeverity, messageType) {
  const value = normalizeText(rawSeverity).toLowerCase();
  if (value === 'critical' || value === 'warning' || value === 'info') {
    return value;
  }
  if (messageType === 'device.recovery') {
    return 'info';
  }
  return 'warning';
}

function normalizeMessageType(rawType) {
  const normalized = normalizeText(rawType).toLowerCase();
  if (SUPPORTED_ALERT_TYPES.has(normalized)) return normalized;
  return 'device.alert';
}

function normalizeAlertCode(rawCode, messageType) {
  const code = normalizeText(rawCode);
  if (code) return code.toUpperCase();
  if (messageType === 'device.recovery') return 'RECOVERY';
  if (messageType === 'device.heartbeat') return 'HEARTBEAT';
  return 'ALERT';
}

function normalizeIsoTimestamp(rawTimestamp) {
  const parsed = new Date(rawTimestamp || Date.now());
  if (Number.isNaN(parsed.getTime())) return new Date().toISOString();
  return parsed.toISOString();
}

function formatLocation(location = {}, fallback = {}) {
  const latitude = location.latitude ?? fallback.latitude;
  const longitude = location.longitude ?? fallback.longitude;
  const elevation = location.elevation ?? fallback.elevation;

  if (latitude === null || latitude === undefined || longitude === null || longitude === undefined) {
    return 'Unavailable';
  }
  const elevationSuffix =
    elevation === null || elevation === undefined || elevation === '' ? '' : ` (${elevation} m)`;
  return `${latitude}, ${longitude}${elevationSuffix}`;
}

function formatDeviceLabel(device = {}) {
  const network = normalizeText(device.network).toUpperCase();
  const station = normalizeText(device.station).toUpperCase();
  if (network && station) return `${network}.${station}`;
  if (station) return station;
  if (device.streamId) return normalizeText(device.streamId);
  if (device.macAddress) return normalizeText(device.macAddress);
  return 'Unknown device';
}

function buildEventDetails(payload, resolvedDevice = null) {
  const messageType = normalizeMessageType(payload.type);
  const severity = normalizeSeverity(payload.severity, messageType);
  const alertCode = normalizeAlertCode(payload.alertCode, messageType);
  const occurredAt = normalizeIsoTimestamp(payload.occurredAt);
  const messageId = normalizeText(payload.messageId) || 'n/a';
  const dedupeKey = normalizeText(payload.dedupeKey) || 'n/a';
  const summary = normalizeText(payload.summary) || 'RShake alert received by central server.';
  const status = normalizeText(payload.status) || (messageType === 'device.recovery' ? 'Streaming' : 'Error');
  const schemaVersion = normalizeText(payload.schemaVersion) || '1.0';
  const details = payload.details && typeof payload.details === 'object' ? payload.details : {};
  const safeDetails = Object.keys(details).length > 0 ? JSON.stringify(details, null, 2) : null;

  const mergedDevice = {
    network: normalizeText(payload.device?.network || resolvedDevice?.network).toUpperCase(),
    station: normalizeText(payload.device?.station || resolvedDevice?.station).toUpperCase(),
    streamId: normalizeText(payload.device?.streamId || resolvedDevice?.streamId),
    macAddress: normalizeText(payload.device?.macAddress || resolvedDevice?.macAddress),
    latitude: payload.location?.latitude ?? resolvedDevice?.latitude,
    longitude: payload.location?.longitude ?? resolvedDevice?.longitude,
    elevation: payload.location?.elevation ?? resolvedDevice?.elevation,
  };

  return {
    messageType,
    severity,
    alertCode,
    occurredAt,
    messageId,
    dedupeKey,
    summary,
    status,
    schemaVersion,
    details: safeDetails,
    device: mergedDevice,
    deviceLabel: formatDeviceLabel(mergedDevice),
    locationLabel: formatLocation(payload.location, resolvedDevice || {}),
  };
}

async function resolveDevice(payload = {}) {
  const streamId = normalizeText(payload.device?.streamId);
  if (streamId) {
    const byStream = await Device.findOne({ streamId });
    if (byStream) return byStream;
  }

  const macAddress = normalizeText(payload.device?.macAddress);
  if (macAddress) {
    const byMac = await Device.findOne({ macAddress });
    if (byMac) return byMac;
  }

  const network = normalizeText(payload.device?.network).toUpperCase();
  const station = normalizeText(payload.device?.station).toUpperCase();
  if (network && station) {
    return Device.findOne({ network, station });
  }

  return null;
}

async function getOptedInRecipients(deviceId) {
  if (!deviceId) return [];

  const accounts = await Account.find({
    devices: deviceId,
    'alertPreferences.rshakeEmailEnabled': true,
  }).select('email');

  return dedupeEmails(
    (accounts || [])
      .map((account) => extractEmail(account.email))
      .filter(Boolean),
  );
}

function buildUserSubject(eventDetails) {
  if (eventDetails.messageType === 'device.recovery') {
    return `[RESOLVED][UPRI EQ Hub] ${eventDetails.deviceLabel} ${eventDetails.alertCode}`;
  }
  const level = eventDetails.severity.toUpperCase();
  return `[${level}][UPRI EQ Hub] ${eventDetails.deviceLabel} ${eventDetails.alertCode}`;
}

function buildAdminTextBody(eventDetails) {
  const lines = [
    'UPRI Earthquake Hub RShake Alert Monitor',
    '',
    `Type: ${eventDetails.messageType}`,
    `Severity: ${eventDetails.severity}`,
    `Alert Code: ${eventDetails.alertCode}`,
    `Status: ${eventDetails.status}`,
    `Summary: ${eventDetails.summary}`,
    '',
    'Device:',
    `- Station: ${eventDetails.deviceLabel}`,
    `- Stream ID: ${eventDetails.device.streamId || 'Unavailable'}`,
    `- MAC: ${eventDetails.device.macAddress || 'Unavailable'}`,
    `- Location: ${eventDetails.locationLabel}`,
    '',
    'Timing:',
    `- Occurred At (UTC): ${eventDetails.occurredAt}`,
    '',
    'Tracking:',
    `- Message ID: ${eventDetails.messageId}`,
    `- Dedupe Key: ${eventDetails.dedupeKey}`,
    `- Schema Version: ${eventDetails.schemaVersion}`,
  ];

  if (eventDetails.details) {
    lines.push('', 'Details:', eventDetails.details);
  }

  return lines.join('\n');
}

function buildUserTextBody(eventDetails) {
  const lines = [
    'UPRI Earthquake Hub Device Alert',
    '',
    `Severity: ${eventDetails.severity}`,
    `Alert Code: ${eventDetails.alertCode}`,
    `Status: ${eventDetails.status}`,
    `Summary: ${eventDetails.summary}`,
    '',
    'Device:',
    `- Station: ${eventDetails.deviceLabel}`,
    `- Stream ID: ${eventDetails.device.streamId || 'Unavailable'}`,
    `- MAC: ${eventDetails.device.macAddress || 'Unavailable'}`,
    `- Location: ${eventDetails.locationLabel}`,
    '',
    'Timing:',
    `- Occurred At (UTC): ${eventDetails.occurredAt}`,
    '',
    'Tracking:',
    `- Message ID: ${eventDetails.messageId}`,
    `- Dedupe Key: ${eventDetails.dedupeKey}`,
  ];

  if (eventDetails.details) {
    lines.push('', 'Details:', eventDetails.details);
  }

  return lines.join('\n');
}

async function sendDeviceAlertEmails(payload = {}) {
  const resolvedDevice = await resolveDevice(payload);
  const eventDetails = buildEventDetails(payload, resolvedDevice);

  if (eventDetails.messageType === HEARTBEAT_TYPE) {
    return {
      str: 'success',
      skipped: true,
      reason: 'heartbeat',
      recipients: {
        users: [],
        admin: [],
      },
      event: eventDetails,
    };
  }

  const optedInRecipients = await getOptedInRecipients(resolvedDevice?._id);
  const adminRecipients = dedupeEmails(getAdminRecipients());
  const adminSet = new Set(adminRecipients.map((email) => email.toLowerCase()));
  const userRecipients = optedInRecipients.filter((email) => !adminSet.has(email.toLowerCase()));

  const threadRoot = buildThreadRootMessageId();
  const commonHeaders = {
    'In-Reply-To': threadRoot,
    References: threadRoot,
    'X-Thread-ID': sanitizeToken(process.env.ALERT_EMAIL_THREAD_KEY || 'rshake-alerts', 'rshake-alerts'),
  };

  const deliveryJobs = [];
  if (userRecipients.length > 0) {
    deliveryJobs.push(
      EmailService.sendMail({
        to: userRecipients.join(','),
        subject: buildUserSubject(eventDetails),
        text: buildUserTextBody(eventDetails),
      }),
    );
  }
  if (adminRecipients.length > 0) {
    deliveryJobs.push(
      EmailService.sendMail({
        to: adminRecipients.join(','),
        subject: 'UPRI RShake Device Alerts',
        text: buildAdminTextBody(eventDetails),
        headers: commonHeaders,
      }),
    );
  }

  if (deliveryJobs.length === 0) {
    return {
      str: 'success',
      skipped: true,
      reason: 'noRecipients',
      recipients: {
        users: [],
        admin: [],
      },
      event: eventDetails,
    };
  }

  const results = await Promise.allSettled(deliveryJobs);
  const hasFailure = results.some((entry) => entry.status === 'rejected');
  if (hasFailure) {
    const errorMessages = results
      .filter((entry) => entry.status === 'rejected')
      .map((entry) => entry.reason?.message || String(entry.reason));
    return {
      str: 'deliveryFailed',
      errors: errorMessages,
      recipients: {
        users: userRecipients,
        admin: adminRecipients,
      },
      event: eventDetails,
    };
  }

  return {
    str: 'success',
    recipients: {
      users: userRecipients,
      admin: adminRecipients,
    },
    event: eventDetails,
  };
}

module.exports = {
  sendDeviceAlertEmails,
};
