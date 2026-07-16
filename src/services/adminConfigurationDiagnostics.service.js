const { getUploadConfig } = require('../config/upload.config');

function textValue(name, fallback) {
  const value = String(process.env[name] || '').trim();
  return value || fallback;
}

function configured(...names) {
  return names.some((name) => String(process.env[name] || '').trim().length > 0);
}

function configuration({ group, id, label, source, value }) {
  return { group, id, label, source, value };
}

function sensitiveSetting({ id, label, names, required = true }) {
  const isConfigured = configured(...names);
  return {
    id,
    label,
    required,
    status: isConfigured ? 'configured' : required ? 'missing' : 'not-configured',
    value: isConfigured ? 'Configured (value masked)' : 'Not configured',
    source: 'Process environment',
  };
}

function getUploadDiagnostic() {
  try {
    const upload = getUploadConfig();
    return {
      status: 'valid',
      publicPath: upload.publicUploadPath,
      persistentDirectoryConfigured: configured('UPLOAD_DIR'),
    };
  } catch (error) {
    return {
      status: 'invalid',
      publicPath: textValue('UPLOAD_PUBLIC_PATH', '/uploads'),
      persistentDirectoryConfigured: false,
      message: error.message,
    };
  }
}

function getSnapshot() {
  const upload = getUploadDiagnostic();
  const sensitiveSettings = [
    sensitiveSetting({ id: 'web-access-key', label: 'Web session signing key', names: ['ACCESS_TOKEN_PRIVATE_KEY_WEB', 'ACCESS_TOKEN_PRIVATE_KEY'] }),
    sensitiveSetting({ id: 'web-refresh-key', label: 'Web refresh signing key', names: ['REFRESH_TOKEN_PRIVATE_KEY_WEB', 'REFRESH_TOKEN_PRIVATE_KEY'] }),
    sensitiveSetting({ id: 'device-access-key', label: 'Device signing key', names: ['ACCESS_TOKEN_PRIVATE_KEY_DEVICE', 'ACCESS_TOKEN_PRIVATE_KEY'] }),
    sensitiveSetting({ id: 'brgy-access-key', label: 'Barangay signing key', names: ['ACCESS_TOKEN_PRIVATE_KEY_BRGY', 'ACCESS_TOKEN_PRIVATE_KEY_DEVICE', 'ACCESS_TOKEN_PRIVATE_KEY'] }),
    sensitiveSetting({ id: 'password-reset-key', label: 'Password reset signing key', names: ['PASSWORD_RESET_TOKEN_KEY', 'ACCESS_TOKEN_PRIVATE_KEY_WEB', 'ACCESS_TOKEN_PRIVATE_KEY'] }),
    sensitiveSetting({ id: 'vapid-private-key', label: 'Web Push private key', names: ['PRIVATE_VAPID_KEY'] }),
    sensitiveSetting({ id: 'smtp-password', label: 'SMTP password', names: ['EMAIL_PASS'], required: false }),
    sensitiveSetting({ id: 'rshake-alert-secret', label: 'RShake shared alert secret', names: ['RSHAKE_ALERT_SHARED_SECRET'], required: false }),
    sensitiveSetting({ id: 'tunnel-ssh-key', label: 'Tunnel SSH key path', names: ['TUNNEL_SCRIPT_SSH_KEY_PATH'], required: false }),
  ];
  const missingRequired = sensitiveSettings.filter((setting) => setting.required && setting.status === 'missing').length;
  const validation = [
    {
      id: 'session-signing',
      name: 'Session signing material',
      status: missingRequired ? 'warning' : 'valid',
      observation: missingRequired
        ? String(missingRequired) + ' required signing configuration item(s) are absent.'
        : 'Required signing configuration is present; values remain masked.',
    },
    {
      id: 'upload-configuration',
      name: 'Report upload configuration',
      status: upload.status,
      observation: upload.status === 'valid'
        ? (upload.persistentDirectoryConfigured
          ? 'Persistent upload directory is configured.'
          : 'Using the development upload directory fallback.')
        : upload.message,
    },
    {
      id: 'configuration-editing',
      name: 'Configuration editing',
      status: 'read-only',
      observation: 'Environment and deployment configuration is read-only in the Admin Console; no audited apply/reload path is configured.',
    },
  ];

  return {
    observedAt: new Date().toISOString(),
    runtime: {
      nodeVersion: process.version,
      environment: textValue('NODE_ENV', 'development'),
      timezone: textValue('TZ', 'Asia/Manila'),
      trustProxy: textValue('TRUST_PROXY', 'not configured'),
    },
    configurations: [
      configuration({ group: 'Runtime', id: 'node-environment', label: 'NODE_ENV', value: textValue('NODE_ENV', 'development'), source: 'Process environment' }),
      configuration({ group: 'Runtime', id: 'timezone', label: 'Timezone', value: textValue('TZ', 'Asia/Manila'), source: 'Process environment/default' }),
      configuration({ group: 'Runtime', id: 'trust-proxy', label: 'Trust proxy', value: textValue('TRUST_PROXY', 'not configured'), source: 'Process environment' }),
      configuration({ group: 'Authentication', id: 'web-token-expiry', label: 'Web access-token expiry', value: textValue('JWT_WEB_EXPIRY', '12h'), source: 'Process environment/default' }),
      configuration({ group: 'Authentication', id: 'web-refresh-expiry', label: 'Web refresh-token expiry', value: textValue('REFRESH_TOKEN_WEB_EXPIRY', '30 days'), source: 'Process environment/default' }),
      configuration({ group: 'Accounts', id: 'username-minimum', label: 'Username minimum length', value: textValue('USERNAME_MIN_LENGTH', '3'), source: 'Process environment/default' }),
      configuration({ group: 'Accounts', id: 'username-maximum', label: 'Username maximum length', value: textValue('USERNAME_MAX_LENGTH', '32'), source: 'Process environment/default' }),
      configuration({ group: 'Moderation', id: 'comments-default-status', label: 'Default community-report status', value: textValue('COMMENTS_DEFAULT_STATUS', 'approved'), source: 'Process environment/default' }),
      configuration({ group: 'Events', id: 'fdsn-network', label: 'FDSN network', value: textValue('FDSNWS_NETWORK', 'AM'), source: 'Process environment/default' }),
      configuration({ group: 'Events', id: 'fdsn-location', label: 'FDSN location', value: textValue('FDSNWS_LOCATION', '00'), source: 'Process environment/default' }),
      configuration({ group: 'Events', id: 'fdsn-channel', label: 'FDSN channel', value: textValue('FDSNWS_CHANNEL', 'EHZ'), source: 'Process environment/default' }),
      configuration({ group: 'Events', id: 'enrichment-cron', label: 'Enrichment schedule', value: textValue('ENRICHMENT_CRON', '0 2 * * *'), source: 'Process environment/default' }),
      configuration({ group: 'Uploads', id: 'upload-public-path', label: 'Public upload path', value: upload.publicPath, source: 'Process environment/default' }),
      configuration({ group: 'Uploads', id: 'persistent-upload-directory', label: 'Persistent upload directory', value: upload.persistentDirectoryConfigured ? 'Configured' : 'Development fallback', source: 'Presence check only' }),
    ],
    sensitiveSettings,
    validation,
    limitations: [
      'Secret values, private keys, credentials, endpoint tokens, and filesystem paths are never returned by this endpoint.',
      'Configuration diagnostics show the effective process environment only; they do not read Docker Secrets, host files, or unmounted deployment configuration.',
      'Changing environment configuration requires the approved deployment workflow and a service restart outside this console.',
    ],
  };
}

module.exports = { getSnapshot };
