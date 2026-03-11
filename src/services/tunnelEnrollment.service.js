const fs = require('fs');
const { promisify } = require('util');
const { execFile } = require('child_process');

const execFileAsync = promisify(execFile);

class TunnelEnrollmentError extends Error {
  constructor(code, message, meta = {}) {
    super(message);
    this.name = 'TunnelEnrollmentError';
    this.code = code;
    this.meta = meta;
  }
}

function resolveConfig() {
  return {
    registerScript: process.env.TUNNEL_REGISTER_SCRIPT || '/opt/upri/bastion/register-device.sh',
    revokeScript: process.env.TUNNEL_REVOKE_SCRIPT || '/opt/upri/bastion/revoke-device.sh',
    registryFile: process.env.TUNNEL_REGISTRY_FILE || '/etc/upri/rshake-tunnels/devices.csv',
    bastionHost: process.env.TUNNEL_BASTION_HOST || '',
    bastionPort: Number(process.env.TUNNEL_BASTION_PORT || 443),
    bastionHostKey: (process.env.TUNNEL_BASTION_HOST_KEY || '').trim(),
    portRangeStart: process.env.TUNNEL_PORT_RANGE_START || '',
    portRangeEnd: process.env.TUNNEL_PORT_RANGE_END || '',
    commandTimeoutMs: Number(process.env.TUNNEL_SCRIPT_TIMEOUT_MS || 15000),
  };
}

function parseEnvSnippet(output) {
  const parsed = {};
  String(output || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .forEach((line) => {
      const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (!match) return;
      parsed[match[1]] = match[2];
    });
  return parsed;
}

function classifyScriptFailure(errorText = '') {
  const normalized = String(errorText).toLowerCase();
  if (
    normalized.includes('already mapped')
    || normalized.includes('already assigned')
    || normalized.includes('already active')
    || normalized.includes('refusing reassignment')
    || normalized.includes('already listening')
  ) {
    return 'COLLISION';
  }
  if (normalized.includes('device not found')) {
    return 'NOT_FOUND';
  }
  if (normalized.includes('no free port')) {
    return 'CAPACITY';
  }
  if (normalized.includes('required') || normalized.includes('invalid')) {
    return 'VALIDATION';
  }
  return 'SCRIPT_ERROR';
}

async function runScript(scriptPath, args = [], timeoutMs = 15000) {
  try {
    await fs.promises.access(scriptPath, fs.constants.X_OK);
  } catch (_error) {
    throw new TunnelEnrollmentError('CONFIG_ERROR', `Tunnel script is not executable: ${scriptPath}`);
  }

  try {
    return await execFileAsync(scriptPath, args, { timeout: timeoutMs, maxBuffer: 1024 * 1024 });
  } catch (error) {
    const stderr = String(error?.stderr || '').trim();
    const stdout = String(error?.stdout || '').trim();
    const errorText = [stderr, stdout, error?.message || ''].filter(Boolean).join('\n');
    const classified = classifyScriptFailure(errorText);

    throw new TunnelEnrollmentError(classified, errorText || 'Tunnel script execution failed', {
      scriptPath,
      args,
      exitCode: typeof error?.code === 'number' ? error.code : null,
    });
  }
}

function normalizeMappingFromEnv(deviceId, env, bastionPortFallback, bastionHostKey = '') {
  const bastionHost = env.REMOTE_TUNNEL_BASTION_HOST || '';
  const bastionUser = env.REMOTE_TUNNEL_BASTION_USER || '';
  const remotePortRaw = env.REMOTE_TUNNEL_REMOTE_PORT || '';
  const bastionPortRaw = env.REMOTE_TUNNEL_BASTION_PORT || `${bastionPortFallback || 443}`;
  const remotePort = Number(remotePortRaw);
  const bastionPort = Number(bastionPortRaw);

  if (!bastionHost || !bastionUser || !Number.isFinite(remotePort) || remotePort < 1) {
    throw new TunnelEnrollmentError(
      'SCRIPT_ERROR',
      'Tunnel registration output missing required mapping fields',
      { env },
    );
  }

  return {
    deviceId,
    REMOTE_TUNNEL_BASTION_HOST: bastionHost,
    REMOTE_TUNNEL_BASTION_PORT: Number.isFinite(bastionPort) && bastionPort > 0 ? bastionPort : 443,
    REMOTE_TUNNEL_BASTION_USER: bastionUser,
    REMOTE_TUNNEL_REMOTE_PORT: remotePort,
    REMOTE_TUNNEL_BASTION_HOST_KEY: bastionHostKey || '',
  };
}

async function enrollDeviceTunnel({
  deviceId,
  tunnelPublicKey,
  bastionUser,
  remotePort,
} = {}) {
  const cfg = resolveConfig();

  if (!cfg.bastionHost) {
    throw new TunnelEnrollmentError('CONFIG_ERROR', 'TUNNEL_BASTION_HOST is not configured on server');
  }
  if (!deviceId || typeof deviceId !== 'string') {
    throw new TunnelEnrollmentError('VALIDATION', 'deviceId is required');
  }
  if (!tunnelPublicKey || typeof tunnelPublicKey !== 'string') {
    throw new TunnelEnrollmentError('VALIDATION', 'tunnelPublicKey is required');
  }

  const args = [
    '--device-id',
    deviceId,
    '--bastion-host',
    cfg.bastionHost,
    '--public-key',
    tunnelPublicKey,
    '--registry-file',
    cfg.registryFile,
  ];

  if (bastionUser) {
    args.push('--bastion-user', bastionUser);
  }
  if (remotePort) {
    args.push('--remote-port', `${remotePort}`);
  }
  if (cfg.portRangeStart) {
    args.push('--port-start', `${cfg.portRangeStart}`);
  }
  if (cfg.portRangeEnd) {
    args.push('--port-end', `${cfg.portRangeEnd}`);
  }

  const { stdout } = await runScript(cfg.registerScript, args, cfg.commandTimeoutMs);
  const env = parseEnvSnippet(stdout);
  return normalizeMappingFromEnv(deviceId, env, cfg.bastionPort, cfg.bastionHostKey);
}

async function revokeDeviceTunnel(deviceId) {
  const cfg = resolveConfig();
  if (!deviceId || typeof deviceId !== 'string') {
    throw new TunnelEnrollmentError('VALIDATION', 'deviceId is required');
  }

  const args = [
    '--device-id',
    deviceId,
    '--registry-file',
    cfg.registryFile,
  ];

  const { stdout } = await runScript(cfg.revokeScript, args, cfg.commandTimeoutMs);
  return {
    deviceId,
    message: String(stdout || '').trim() || 'Device tunnel revoked',
  };
}

function parseCsvLine(line) {
  const parts = String(line || '').split(',');
  if (parts.length < 7) return null;
  return {
    deviceId: parts[0],
    bastionUser: parts[1],
    remotePort: Number(parts[2]),
    status: parts[3],
    keyFingerprint: parts[4],
    createdAt: parts[5] || null,
    revokedAt: parts[6] || null,
  };
}

async function listActiveMappings() {
  const cfg = resolveConfig();

  let raw;
  try {
    raw = await fs.promises.readFile(cfg.registryFile, 'utf-8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw new TunnelEnrollmentError('SCRIPT_ERROR', `Unable to read tunnel registry: ${error.message}`);
  }

  return raw
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean)
    .map(parseCsvLine)
    .filter((entry) => entry && entry.status === 'active')
    .map((entry) => ({
      deviceId: entry.deviceId,
      bastionUser: entry.bastionUser,
      remotePort: entry.remotePort,
      keyFingerprint: entry.keyFingerprint,
      createdAt: entry.createdAt,
    }));
}

module.exports = {
  TunnelEnrollmentError,
  enrollDeviceTunnel,
  revokeDeviceTunnel,
  listActiveMappings,
};
