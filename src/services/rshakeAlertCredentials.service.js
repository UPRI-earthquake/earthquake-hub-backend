const crypto = require('crypto');
const Account = require('../models/account.model');
const Device = require('../models/device.model');

const DEFAULT_SECRET_BYTES = 32;

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeIdentifiers(identifiers = {}) {
  return {
    streamId: normalizeText(identifiers.streamId),
    macAddress: normalizeText(identifiers.macAddress),
    network: normalizeText(identifiers.network).toUpperCase(),
    station: normalizeText(identifiers.station).toUpperCase(),
  };
}

function hashCredential(secret) {
  return crypto.createHash('sha256').update(String(secret || ''), 'utf8').digest('hex');
}

function hashesMatch(providedSecret, expectedHash) {
  const providedHash = hashCredential(providedSecret);
  const providedBuffer = Buffer.from(providedHash, 'utf8');
  const expectedBuffer = Buffer.from(String(expectedHash || ''), 'utf8');
  if (providedBuffer.length !== expectedBuffer.length) return false;
  return crypto.timingSafeEqual(providedBuffer, expectedBuffer);
}

function buildSecretValue() {
  const configuredBytes = Number(process.env.RSHAKE_ALERT_DEVICE_SECRET_BYTES || DEFAULT_SECRET_BYTES);
  const byteLength = Number.isFinite(configuredBytes) && configuredBytes >= 16
    ? Math.floor(configuredBytes)
    : DEFAULT_SECRET_BYTES;
  return crypto.randomBytes(byteLength).toString('hex');
}

function deviceInfoPayload(device = {}) {
  return {
    network: normalizeText(device.network).toUpperCase(),
    station: normalizeText(device.station).toUpperCase(),
    streamId: normalizeText(device.streamId),
    macAddress: normalizeText(device.macAddress),
  };
}

async function resolveCandidateDevices(identifiers = {}) {
  const normalized = normalizeIdentifiers(identifiers);
  const lookups = [];

  if (normalized.streamId) {
    lookups.push(Device.findOne({ streamId: normalized.streamId }));
  }
  if (normalized.macAddress) {
    lookups.push(Device.findOne({ macAddress: normalized.macAddress }));
  }
  if (normalized.network && normalized.station) {
    lookups.push(Device.findOne({ network: normalized.network, station: normalized.station }));
  }

  if (lookups.length === 0) {
    return [];
  }

  const results = await Promise.all(lookups);
  const unique = new Map();
  (results || []).filter(Boolean).forEach((device) => {
    unique.set(String(device._id), device);
  });
  return Array.from(unique.values());
}

async function findOwnedDevice(username, identifiers = {}) {
  const account = await Account.findOne({ username }).select('devices');
  if (!account) {
    return { str: 'usernameNotFound' };
  }

  const devices = await resolveCandidateDevices(identifiers);
  if (devices.length === 0) {
    return { str: 'deviceNotFound' };
  }
  if (devices.length > 1) {
    return { str: 'identifierMismatch' };
  }

  const [device] = devices;
  const ownedDeviceIds = new Set((account.devices || []).map((value) => String(value)));
  if (!ownedDeviceIds.has(String(device._id))) {
    return { str: 'deviceNotOwned' };
  }

  return { str: 'success', device };
}

async function issueAlertCredentialForOwnedDevice({ username, identifiers = {} }) {
  const lookup = await findOwnedDevice(username, identifiers);
  if (lookup.str !== 'success') {
    return lookup;
  }

  const sharedSecret = buildSecretValue();
  const issuedAt = new Date();

  lookup.device.rshakeAlertCredentialHash = hashCredential(sharedSecret);
  lookup.device.rshakeAlertCredentialIssuedAt = issuedAt;
  await lookup.device.save();

  return {
    str: 'success',
    payload: {
      deviceId: String(lookup.device._id),
      issuedAt: issuedAt.toISOString(),
      authHeader: 'X-RShake-Alert-Secret',
      sharedSecret,
      deviceInfo: deviceInfoPayload(lookup.device),
    },
  };
}

async function verifyDeviceAlertCredential({ providedSecret, device }) {
  const normalizedSecret = normalizeText(providedSecret);
  const candidates = await resolveCandidateDevices(device || {});
  if (candidates.length === 0) {
    return { matched: false, required: false };
  }

  const hasConfiguredCredential = candidates.some((candidate) => normalizeText(candidate.rshakeAlertCredentialHash));
  if (candidates.length > 1) {
    return {
      matched: false,
      required: hasConfiguredCredential,
      reason: 'identifierMismatch',
    };
  }

  const [candidate] = candidates;
  const expectedHash = normalizeText(candidate.rshakeAlertCredentialHash);
  if (!expectedHash) {
    return {
      matched: false,
      required: false,
      deviceId: String(candidate._id),
    };
  }

  if (!normalizedSecret) {
    return {
      matched: false,
      required: true,
      deviceId: String(candidate._id),
    };
  }

  return {
    matched: hashesMatch(normalizedSecret, expectedHash),
    required: true,
    deviceId: String(candidate._id),
  };
}

module.exports = {
  issueAlertCredentialForOwnedDevice,
  verifyDeviceAlertCredential,
  hashCredential,
};
