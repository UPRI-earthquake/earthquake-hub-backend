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

function normalizeExecMode(value) {
  const normalized = String(value || 'local').trim().toLowerCase();
  if (normalized === 'local' || normalized === 'ssh') {
    return normalized;
  }
  return 'local';
}

function isTruthy(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === '1'
    || normalized === 'true'
    || normalized === 'yes'
    || normalized === 'on';
}

function shellEscape(value) {
  const raw = String(value || '');
  return `'${raw.replace(/'/g, "'\"'\"'")}'`;
}

function resolveConfig() {
  return {
    execMode: normalizeExecMode(process.env.TUNNEL_SCRIPT_EXEC_MODE || 'local'),
    registerScript: process.env.TUNNEL_REGISTER_SCRIPT || '/opt/upri/bastion/register-device.sh',
    revokeScript: process.env.TUNNEL_REVOKE_SCRIPT || '/opt/upri/bastion/revoke-device.sh',
    registryFile: process.env.TUNNEL_REGISTRY_FILE || '/etc/upri/rshake-tunnels/devices.csv',
    bastionHost: process.env.TUNNEL_BASTION_HOST || '',
    bastionPort: Number(process.env.TUNNEL_BASTION_PORT || 443),
    bastionHostKey: (process.env.TUNNEL_BASTION_HOST_KEY || '').trim(),
    portRangeStart: process.env.TUNNEL_PORT_RANGE_START || '',
    portRangeEnd: process.env.TUNNEL_PORT_RANGE_END || '',
    commandTimeoutMs: Number(process.env.TUNNEL_SCRIPT_TIMEOUT_MS || 15000),
    sshHost: process.env.TUNNEL_SCRIPT_SSH_HOST || '',
    sshPort: Number(process.env.TUNNEL_SCRIPT_SSH_PORT || 22),
    sshUser: process.env.TUNNEL_SCRIPT_SSH_USER || '',
    sshKeyPath: process.env.TUNNEL_SCRIPT_SSH_KEY_PATH || '',
    sshKnownHostsPath: process.env.TUNNEL_SCRIPT_SSH_KNOWN_HOSTS_PATH || '',
    sshStrictHostKey: !isTruthy(process.env.TUNNEL_SCRIPT_SSH_STRICT_HOST_KEY || 'true')
      ? false
      : true,
    sshRemotePrefix: process.env.TUNNEL_SCRIPT_SSH_REMOTE_PREFIX || 'sudo -n',
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

async function runScriptLocal(scriptPath, args = [], timeoutMs = 15000) {
  try {
    await fs.promises.access(scriptPath, fs.constants.X_OK);
  } catch (_error) {
    throw new TunnelEnrollmentError('CONFIG_ERROR', `Tunnel script is not executable or not found: ${scriptPath}`);
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

async function runScriptOverSsh(cfg, scriptPath, args = [], timeoutMs = 15000) {
  if (!cfg.sshHost || !cfg.sshUser) {
    throw new TunnelEnrollmentError(
      'CONFIG_ERROR',
      'TUNNEL_SCRIPT_SSH_HOST and TUNNEL_SCRIPT_SSH_USER are required in ssh exec mode',
    );
  }

  if (!Number.isFinite(cfg.sshPort) || cfg.sshPort < 1 || cfg.sshPort > 65535) {
    throw new TunnelEnrollmentError('CONFIG_ERROR', 'TUNNEL_SCRIPT_SSH_PORT must be between 1 and 65535');
  }

  if (cfg.sshKeyPath) {
    try {
      await fs.promises.access(cfg.sshKeyPath, fs.constants.R_OK);
    } catch (_error) {
      throw new TunnelEnrollmentError(
        'CONFIG_ERROR',
        `Tunnel SSH private key is not readable: ${cfg.sshKeyPath}`,
      );
    }
  }

  if (cfg.sshStrictHostKey && cfg.sshKnownHostsPath) {
    try {
      await fs.promises.access(cfg.sshKnownHostsPath, fs.constants.R_OK);
    } catch (_error) {
      throw new TunnelEnrollmentError(
        'CONFIG_ERROR',
        `Tunnel SSH known_hosts is not readable: ${cfg.sshKnownHostsPath}`,
      );
    }
  }

  const sshArgs = [
    '-p',
    `${cfg.sshPort}`,
    '-o',
    'BatchMode=yes',
    '-o',
    `ConnectTimeout=${Math.max(5, Math.ceil(timeoutMs / 1000))}`,
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

  const remoteTarget = `${cfg.sshUser}@${cfg.sshHost}`;
  const commandParts = [];
  const prefix = String(cfg.sshRemotePrefix || '').trim();
  if (prefix) {
    commandParts.push(prefix);
  }
  commandParts.push(shellEscape(scriptPath));
  args.forEach((arg) => commandParts.push(shellEscape(arg)));

  sshArgs.push(remoteTarget, commandParts.join(' '));

  try {
    return await execFileAsync('ssh', sshArgs, { timeout: timeoutMs, maxBuffer: 1024 * 1024 });
  } catch (error) {
    const stderr = String(error?.stderr || '').trim();
    const stdout = String(error?.stdout || '').trim();
    const errorText = [stderr, stdout, error?.message || ''].filter(Boolean).join('\n');
    const classified = classifyScriptFailure(errorText);

    throw new TunnelEnrollmentError(classified, errorText || 'Tunnel script execution failed', {
      scriptPath,
      args,
      sshTarget: remoteTarget,
      exitCode: typeof error?.code === 'number' ? error.code : null,
    });
  }
}

async function runScript(cfg, scriptPath, args = [], timeoutMs = 15000) {
  if (cfg.execMode === 'ssh') {
    return runScriptOverSsh(cfg, scriptPath, args, timeoutMs);
  }
  return runScriptLocal(scriptPath, args, timeoutMs);
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

  const { stdout } = await runScript(cfg, cfg.registerScript, args, cfg.commandTimeoutMs);
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

  const { stdout } = await runScript(cfg, cfg.revokeScript, args, cfg.commandTimeoutMs);
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
