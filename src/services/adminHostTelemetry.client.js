const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const axios = require('axios');
const AuditLogService = require('./auditLog.service');
const { buildOperationalState } = require('./adminOperationalState.service');

const RESOURCE_PATHS = Object.freeze({
  deployment: 'deployment',
  seiscomp: 'seiscomp',
  archive: 'archive',
  system: 'system',
  wstunnel: 'wstunnel',
});
const resourceHealth = new Map();

function positiveIntegerEnv(name, fallback) {
  const value = Number.parseInt(process.env[name], 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function unavailable(resourceId, errorCode = 'not_configured') {
  return {
    requestId: null,
    observedAt: null,
    source: 'admin-backend',
    status: 'unavailable',
    durationMs: null,
    data: null,
    errorCode,
    message: 'Host telemetry is unavailable.',
    resourceId,
  };
}

function withOperationalState(resourceId, result, now = new Date()) {
  const prior = resourceHealth.get(resourceId) || {};
  const successfulRead = result.status === 'available' || result.status === 'degraded';
  const failureSince = successfulRead ? null : prior.failureSince || now.toISOString();
  const lastSuccessfulAt = successfulRead
    ? result.observedAt || now.toISOString()
    : prior.lastSuccessfulAt || null;
  const nextHealth = { failureSince, lastSuccessfulAt };
  resourceHealth.set(resourceId, nextHealth);

  return {
    ...result,
    lastSuccessfulAt,
    failureSince,
    failureDurationMs: failureSince
      ? Math.max(0, now.getTime() - new Date(failureSince).getTime())
      : null,
    operational: buildOperationalState({
      availability: result.status,
      generatedAt: now,
      message: result.message || null,
      now,
      observedAt: result.observedAt,
    }),
  };
}

let cachedAgent = null;
let cachedAgentKey = null;

function booleanEnv(name, fallback = false) {
  const value = process.env[name];
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function mtlsTransport(baseUrl) {
  const tlsRequired = booleanEnv('ADMIN_HOST_TELEMETRY_TLS_REQUIRED', false);
  let parsedUrl;
  try {
    parsedUrl = new URL(baseUrl);
  } catch {
    throw Object.assign(new Error('Invalid admin telemetry URL.'), { code: 'MTLS_NOT_CONFIGURED' });
  }
  if (tlsRequired && parsedUrl.protocol !== 'https:') {
    throw Object.assign(new Error('Admin telemetry requires HTTPS.'), { code: 'MTLS_NOT_CONFIGURED' });
  }
  if (parsedUrl.protocol !== 'https:') return {};

  const paths = {
    ca: process.env.ADMIN_HOST_TELEMETRY_CA_PATH,
    cert: process.env.ADMIN_HOST_TELEMETRY_CERT_PATH,
    key: process.env.ADMIN_HOST_TELEMETRY_KEY_PATH,
  };
  const configured = Object.values(paths).every(Boolean);
  if (!configured) {
    if (tlsRequired) {
      throw Object.assign(new Error('Admin telemetry client certificate paths are required.'), { code: 'MTLS_NOT_CONFIGURED' });
    }
    return {};
  }

  const agentKey = JSON.stringify(paths);
  if (!cachedAgent || cachedAgentKey !== agentKey) {
    try {
      cachedAgent = new https.Agent({
        ca: fs.readFileSync(paths.ca),
        cert: fs.readFileSync(paths.cert),
        key: fs.readFileSync(paths.key),
        keepAlive: true,
        maxSockets: 4,
        minVersion: 'TLSv1.2',
        rejectUnauthorized: true,
      });
      cachedAgentKey = agentKey;
    } catch (error) {
      throw Object.assign(new Error('Admin telemetry client certificates could not be loaded.'), {
        code: 'MTLS_NOT_CONFIGURED',
        cause: error,
      });
    }
  }
  return { httpsAgent: cachedAgent };
}

async function auditRead(req, resourceId, result, durationMs, requestId) {
  if (!req) return;
  await AuditLogService.record(req, {
    correlationId: requestId,
    eventType: 'admin.telemetry.read',
    outcome: result.status === 'unavailable' ? 'failed' : 'succeeded',
    target: { type: 'host-telemetry', id: resourceId, label: resourceId },
    metadata: {
      resourceId,
      durationMs,
      cache: false,
      adapterRequestId: result.requestId || requestId,
      classification: 'internal-operational',
      errorCode: result.errorCode,
      responseStatus: result.status,
      freshnessStatus: result.operational?.freshness?.status || 'unknown',
    },
  });
}

async function getResource(resourceId, req) {
  const resourcePath = RESOURCE_PATHS[resourceId];
  if (!resourcePath) throw Object.assign(new Error('Unsupported telemetry resource.'), { code: 'UNSUPPORTED_TELEMETRY_RESOURCE' });
  const baseUrl = String(process.env.ADMIN_HOST_TELEMETRY_URL || '').replace(/\/$/, '');
  const requestId = crypto.randomUUID();
  const startedAt = Date.now();
  if (!baseUrl) {
    const result = withOperationalState(resourceId, unavailable(resourceId));
    await auditRead(req, resourceId, result, Date.now() - startedAt, requestId);
    return result;
  }

  const headers = { Accept: 'application/json', 'X-Request-ID': requestId };
  if (process.env.ADMIN_HOST_TELEMETRY_TOKEN) headers.Authorization = `Bearer ${process.env.ADMIN_HOST_TELEMETRY_TOKEN}`;
  let result;
  try {
    const transport = mtlsTransport(baseUrl);
    const response = await axios.get(`${baseUrl}/${resourcePath}`, {
      headers,
      timeout: positiveIntegerEnv('ADMIN_HOST_TELEMETRY_TIMEOUT_MS', 2500),
      maxContentLength: 64 * 1024,
      maxRedirects: 0,
      proxy: false,
      validateStatus: (status) => status === 200,
      ...transport,
    });
    const payload = response.data;
    if (!payload || !['available', 'degraded', 'unavailable'].includes(payload.status) || payload.source !== 'admin-backend') {
      throw Object.assign(new Error('Invalid telemetry response.'), { code: 'INVALID_TELEMETRY_RESPONSE' });
    }
    result = { ...payload, resourceId };
  } catch (error) {
    const errorCode = error.code === 'ECONNABORTED' ? 'timeout'
      : error.code === 'INVALID_TELEMETRY_RESPONSE' ? 'invalid_response'
        : error.code === 'MTLS_NOT_CONFIGURED' ? 'mtls_not_configured'
          : /CERT|TLS|SSL/i.test(String(error.code || '')) ? 'mtls_failed'
            : error.response?.status === 401 ? 'denied' : 'unavailable';
    result = unavailable(resourceId, errorCode);
  }
  const normalizedResult = withOperationalState(resourceId, result);
  await auditRead(req, resourceId, normalizedResult, Date.now() - startedAt, requestId);
  return normalizedResult;
}

function resetTelemetryState() {
  resourceHealth.clear();
}

module.exports = {
  getResource,
  mtlsTransport,
  resetTelemetryState,
  withOperationalState,
};
