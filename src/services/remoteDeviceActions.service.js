const fs = require('fs');
const { execFile } = require('child_process');
const { promisify } = require('util');

const Account = require('../models/account.model');
const AccountsService = require('./accounts.service');
const TunnelEnrollmentService = require('./tunnelEnrollment.service');

const execFileAsync = promisify(execFile);

const ACTIONS = Object.freeze({
  UNLINK: 'UNLINK',
  RELINK: 'RELINK',
  ADD_SERVER: 'ADD_SERVER',
  REMOVE_SERVER: 'REMOVE_SERVER',
});

const QUERY_ACTIONS = Object.freeze({
  LIST_SERVERS: 'LIST_SERVERS',
});

class RemoteDeviceActionError extends Error {
  constructor(code, message, httpStatus = 500, meta = {}) {
    super(message);
    this.name = 'RemoteDeviceActionError';
    this.code = code;
    this.httpStatus = httpStatus;
    this.meta = meta;
  }
}

function isTruthy(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(normalized);
}

function normalizeDeviceId(value = '') {
  return String(value || '').trim().toUpperCase();
}

function composeDeviceId(network, station) {
  const net = String(network || '').trim().toUpperCase();
  const sta = String(station || '').trim().toUpperCase();
  if (!net || !sta) return '';
  return `${net}_${sta}`;
}

function normalizeHostUrl(value) {
  return String(value || '').trim().replace(/\/+$/g, '').toLowerCase();
}

function normalizeAction(value) {
  return String(value || '').trim().toUpperCase();
}

function resolveConfig() {
  const strictHostKey = isTruthy(process.env.TUNNEL_REMOTE_ACTION_SSH_STRICT_HOST_KEY || 'false');
  return {
    sshHost: String(
      process.env.TUNNEL_REMOTE_ACTION_SSH_HOST
      || process.env.TUNNEL_SCRIPT_SSH_HOST
      || '127.0.0.1',
    ).trim(),
    sshUser: String(process.env.TUNNEL_REMOTE_ACTION_SSH_USER || 'myshake').trim(),
    sshKeyPath: String(
      process.env.TUNNEL_REMOTE_ACTION_SSH_KEY_PATH
      || process.env.TUNNEL_SCRIPT_SSH_KEY_PATH
      || '/opt/upri/bastion/ssh/tunnel-admin_id_ed25519',
    ).trim(),
    sshKnownHostsPath: String(
      process.env.TUNNEL_REMOTE_ACTION_SSH_KNOWN_HOSTS_PATH
      || process.env.TUNNEL_SCRIPT_SSH_KNOWN_HOSTS_PATH
      || '',
    ).trim(),
    sshStrictHostKey: strictHostKey,
    commandTimeoutMs: Number(process.env.TUNNEL_REMOTE_ACTION_TIMEOUT_MS || 20000),
  };
}

async function resolveOwnedDeviceSet(username) {
  const account = await Account.findOne({ username })
    .select('devices releasedDevices')
    .populate('devices', 'network station');

  if (!account) {
    throw new RemoteDeviceActionError(
      'not_owned',
      'Account not found for remote action request.',
      403,
    );
  }

  const owned = new Set();
  (account.devices || []).filter(Boolean).forEach((device) => {
    const id = composeDeviceId(device.network, device.station);
    if (id) owned.add(id);
  });
  (account.releasedDevices || []).filter(Boolean).forEach((entry) => {
    const id = composeDeviceId(entry.network, entry.station);
    if (id) owned.add(id);
  });

  return owned;
}

async function listAllowedRingserverTargets() {
  const response = await AccountsService.getActiveRingserverHosts();
  if (!response || response.str !== 'success' || !Array.isArray(response.hosts)) {
    return [];
  }

  return response.hosts
    .map((host) => {
      const username = String(host?.username || '').trim();
      const ringserverUrl = String(host?.ringserverUrl || '').trim();
      const ringserverPort = String(host?.ringserverPort || '').trim();
      if (!username || !ringserverUrl || !ringserverPort) return null;
      return {
        institutionName: username,
        url: `${ringserverUrl}:${ringserverPort}`,
      };
    })
    .filter(Boolean);
}

function parseRemoteActionMarker(output = '') {
  const marker = 'REMOTE_ACTION_RESULT=';
  const lines = String(output || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .reverse();

  const matched = lines.find((line) => line.startsWith(marker));
  if (!matched) return null;

  const jsonText = matched.slice(marker.length);
  if (!jsonText) return null;
  try {
    return JSON.parse(jsonText);
  } catch (_error) {
    return null;
  }
}

async function runRemoteCommand({ remotePort, action, payload }) {
  const cfg = resolveConfig();

  if (!cfg.sshHost || !cfg.sshUser) {
    throw new RemoteDeviceActionError(
      'config_error',
      'Remote action SSH host/user is not configured.',
      500,
    );
  }

  if (!Number.isFinite(cfg.commandTimeoutMs) || cfg.commandTimeoutMs < 1000) {
    throw new RemoteDeviceActionError(
      'config_error',
      'Remote action timeout configuration is invalid.',
      500,
    );
  }

  if (cfg.sshKeyPath) {
    try {
      await fs.promises.access(cfg.sshKeyPath, fs.constants.R_OK);
    } catch (_error) {
      throw new RemoteDeviceActionError(
        'config_error',
        `Remote action SSH key is not readable: ${cfg.sshKeyPath}`,
        500,
      );
    }
  }

  if (cfg.sshStrictHostKey && cfg.sshKnownHostsPath) {
    try {
      await fs.promises.access(cfg.sshKnownHostsPath, fs.constants.R_OK);
    } catch (_error) {
      throw new RemoteDeviceActionError(
        'config_error',
        `Remote action known_hosts is not readable: ${cfg.sshKnownHostsPath}`,
        500,
      );
    }
  }

  const payloadB64 = Buffer.from(JSON.stringify(payload || {}), 'utf8').toString('base64');
  const sshArgs = [
    '-T',
    '-p',
    `${remotePort}`,
    '-o',
    'BatchMode=yes',
    '-o',
    `ConnectTimeout=${Math.max(5, Math.ceil(cfg.commandTimeoutMs / 1000))}`,
  ];

  if (cfg.sshStrictHostKey) {
    sshArgs.push('-o', 'StrictHostKeyChecking=yes');
    if (cfg.sshKnownHostsPath) {
      sshArgs.push('-o', `UserKnownHostsFile=${cfg.sshKnownHostsPath}`);
    }
  } else {
    sshArgs.push('-o', 'StrictHostKeyChecking=no');
    sshArgs.push('-o', 'UserKnownHostsFile=/dev/null');
  }

  if (cfg.sshKeyPath) {
    sshArgs.push('-i', cfg.sshKeyPath);
  }

  sshArgs.push(
    `${cfg.sshUser}@${cfg.sshHost}`,
    `REMOTE_ACTION_EXECUTE ${action} ${payloadB64}`,
  );

  try {
    const { stdout, stderr } = await execFileAsync('ssh', sshArgs, {
      timeout: cfg.commandTimeoutMs,
      maxBuffer: 1024 * 1024,
    });

    const remoteResult = parseRemoteActionMarker(`${stdout || ''}\n${stderr || ''}`);
    if (remoteResult && remoteResult.ok === false) {
      throw new RemoteDeviceActionError(
        'remote_failed',
        remoteResult.message || 'Remote action rejected by sender.',
        502,
        { remoteResult },
      );
    }
    return remoteResult || {
      ok: true,
      message: String(stdout || '').trim() || 'Remote action executed.',
    };
  } catch (error) {
    if (error?.name === 'RemoteDeviceActionError') {
      throw error;
    }

    const combinedOutput = [error?.stderr || '', error?.stdout || '']
      .map((value) => String(value || '').trim())
      .filter(Boolean)
      .join('\n');

    const marker = parseRemoteActionMarker(combinedOutput);
    if (marker && marker.ok === false) {
      throw new RemoteDeviceActionError(
        'remote_failed',
        marker.message || 'Remote action failed on sender.',
        502,
        { remoteResult: marker },
      );
    }

    const timedOut = Boolean(error?.killed)
      || String(error?.message || '').toLowerCase().includes('timed out');

    if (timedOut) {
      throw new RemoteDeviceActionError(
        'timeout',
        'Remote action timed out while waiting for sender response.',
        504,
      );
    }

    throw new RemoteDeviceActionError(
      'remote_failed',
      'Remote action failed while connecting to sender.',
      502,
      {
        stderr: String(error?.stderr || '').trim(),
        stdout: String(error?.stdout || '').trim(),
      },
    );
  }
}

async function resolveCapability({ username, deviceId, ownedDeviceSet }) {
  const normalizedDeviceId = normalizeDeviceId(deviceId);
  const ownedSet = ownedDeviceSet || await resolveOwnedDeviceSet(username);
  if (!ownedSet.has(normalizedDeviceId)) {
    return {
      deviceId: normalizedDeviceId,
      canExecute: false,
      reason: 'not_owned',
      status: null,
      listener: null,
      remotePort: null,
    };
  }

  let mapping;
  try {
    mapping = await TunnelEnrollmentService.resolveDeviceMapping(normalizedDeviceId);
  } catch (error) {
    if (error?.name === 'TunnelEnrollmentError' && error.code === 'NOT_FOUND') {
      return {
        deviceId: normalizedDeviceId,
        canExecute: false,
        reason: 'not_mapped',
        status: null,
        listener: null,
        remotePort: null,
      };
    }
    throw new RemoteDeviceActionError(
      'config_error',
      error?.message || 'Failed to resolve tunnel mapping for device.',
      500,
    );
  }

  const status = String(mapping.status || '').toLowerCase();
  const listener = String(mapping.listener || '').toLowerCase();
  if (status !== 'active') {
    return {
      deviceId: normalizedDeviceId,
      canExecute: false,
      reason: 'revoked',
      status: mapping.status,
      listener: mapping.listener,
      remotePort: mapping.remotePort,
    };
  }
  if (listener !== 'up') {
    return {
      deviceId: normalizedDeviceId,
      canExecute: false,
      reason: 'offline',
      status: mapping.status,
      listener: mapping.listener,
      remotePort: mapping.remotePort,
    };
  }

  return {
    deviceId: normalizedDeviceId,
    canExecute: true,
    reason: null,
    status: mapping.status,
    listener: mapping.listener,
    remotePort: mapping.remotePort,
  };
}

async function listRemoteActionCapabilities({ username, deviceIds = [] }) {
  const ownedDeviceSet = await resolveOwnedDeviceSet(username);
  const requestedIds = Array.from(
    new Set(
      (deviceIds || [])
        .map(normalizeDeviceId)
        .filter(Boolean),
    ),
  );
  const normalizedIds = requestedIds.length
    ? requestedIds
    : Array.from(ownedDeviceSet);

  return Promise.all(
    normalizedIds.map((deviceId) => resolveCapability({
      username,
      deviceId,
      ownedDeviceSet,
    })),
  );
}

async function resolveAddServerPayload(rawPayload = {}) {
  const institutionName = String(rawPayload?.institutionName || '').trim();
  const url = String(rawPayload?.url || '').trim();
  const normalizedUrl = normalizeHostUrl(url);

  if (!institutionName || !url) {
    throw new RemoteDeviceActionError(
      'validation_error',
      'Add server payload requires institutionName and url.',
      400,
    );
  }

  const allowedTargets = await listAllowedRingserverTargets();
  const allowedMatch = allowedTargets.find((entry) => (
    String(entry.institutionName || '').trim().toLowerCase() === institutionName.toLowerCase()
    && normalizeHostUrl(entry.url) === normalizedUrl
  ));

  if (!allowedMatch) {
    throw new RemoteDeviceActionError(
      'validation_error',
      'Selected ringserver target is not allowed.',
      400,
    );
  }

  return {
    institutionName: allowedMatch.institutionName,
    url: allowedMatch.url,
  };
}

function resolveRelinkPayload(username, rawPayload = {}) {
  const password = String(rawPayload?.password || '');
  const longitude = String(rawPayload?.longitude ?? '').trim();
  const latitude = String(rawPayload?.latitude ?? '').trim();
  const elevation = String(rawPayload?.elevation ?? '').trim();

  if (!password || !longitude || !latitude || !elevation) {
    throw new RemoteDeviceActionError(
      'validation_error',
      'Relink payload requires password, longitude, latitude, and elevation.',
      400,
    );
  }

  return {
    username,
    password,
    longitude,
    latitude,
    elevation,
  };
}

function resolveRemoveServerPayload(rawPayload = {}) {
  const url = String(rawPayload?.url || '').trim();
  if (!url) {
    throw new RemoteDeviceActionError(
      'validation_error',
      'Remove server payload requires url.',
      400,
    );
  }
  return { url };
}

function assertCapabilityOrThrow(capability = {}) {
  if (capability.canExecute) return;
  const statusCode = capability.reason === 'not_owned' ? 403 : 409;
  throw new RemoteDeviceActionError(
    capability.reason,
    `Remote action is unavailable for this device (${capability.reason}).`,
    statusCode,
    { capability },
  );
}

function parseServersFromRemoteResult(remoteResult = {}) {
  let rawServers = Array.isArray(remoteResult?.payload?.servers)
    ? remoteResult.payload.servers
    : [];

  if (!rawServers.length && typeof remoteResult?.payload?.serversBodyB64 === 'string') {
    try {
      const decodedBody = Buffer.from(remoteResult.payload.serversBodyB64, 'base64').toString('utf8');
      const parsedBody = JSON.parse(decodedBody);
      const payloadObject = (parsedBody && typeof parsedBody.payload === 'object' && parsedBody.payload)
        ? parsedBody.payload
        : {};
      rawServers = Object.entries(payloadObject).map(([url, item]) => ({
        institutionName: item?.institutionName,
        url,
        status: item?.status,
      }));
    } catch (_error) {
      rawServers = [];
    }
  }

  return rawServers
    .map((entry) => {
      const institutionName = String(entry?.institutionName || '').trim();
      const url = String(entry?.url || '').trim();
      const status = String(entry?.status || '').trim();
      if (!url) return null;
      return { institutionName, url, status };
    })
    .filter(Boolean);
}

async function executeRemoteDeviceAction({ username, deviceId, action, payload = {} }) {
  const normalizedDeviceId = normalizeDeviceId(deviceId);
  const normalizedAction = normalizeAction(action);
  if (!Object.values(ACTIONS).includes(normalizedAction)) {
    throw new RemoteDeviceActionError(
      'validation_error',
      `Unsupported remote action: ${action}`,
      400,
    );
  }

  const capability = await resolveCapability({ username, deviceId: normalizedDeviceId });
  assertCapabilityOrThrow(capability);

  let actionPayload = {};
  if (normalizedAction === ACTIONS.RELINK) {
    actionPayload = resolveRelinkPayload(username, payload);
  } else if (normalizedAction === ACTIONS.ADD_SERVER) {
    actionPayload = await resolveAddServerPayload(payload);
  } else if (normalizedAction === ACTIONS.REMOVE_SERVER) {
    actionPayload = resolveRemoveServerPayload(payload);
  }

  const remoteResult = await runRemoteCommand({
    remotePort: capability.remotePort,
    action: normalizedAction,
    payload: actionPayload,
  });

  return {
    deviceId: normalizedDeviceId,
    action: normalizedAction,
    remotePort: capability.remotePort,
    status: capability.status,
    listener: capability.listener,
    result: remoteResult,
  };
}

async function listRemoteDeviceServers({ username, deviceId }) {
  const normalizedDeviceId = normalizeDeviceId(deviceId);
  if (!normalizedDeviceId) {
    throw new RemoteDeviceActionError(
      'validation_error',
      'deviceId is required for listing remote servers.',
      400,
    );
  }

  const capability = await resolveCapability({ username, deviceId: normalizedDeviceId });
  assertCapabilityOrThrow(capability);

  const remoteResult = await runRemoteCommand({
    remotePort: capability.remotePort,
    action: QUERY_ACTIONS.LIST_SERVERS,
    payload: {},
  });

  return {
    deviceId: normalizedDeviceId,
    remotePort: capability.remotePort,
    status: capability.status,
    listener: capability.listener,
    servers: parseServersFromRemoteResult(remoteResult),
  };
}

module.exports = {
  ACTIONS,
  RemoteDeviceActionError,
  listRemoteActionCapabilities,
  listRemoteDeviceServers,
  executeRemoteDeviceAction,
};
