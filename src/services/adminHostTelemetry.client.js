const crypto = require('crypto');
const axios = require('axios');
const AuditLogService = require('./auditLog.service');

const RESOURCE_PATHS = Object.freeze({
  deployment: 'deployment',
  seiscomp: 'seiscomp',
  archive: 'archive',
  system: 'system',
});

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

async function auditRead(req, resourceId, result, durationMs, requestId) {
  if (!req) return;
  await AuditLogService.record(req, {
    correlationId: requestId,
    eventType: 'admin.telemetry.read',
    outcome: result.status === 'available' ? 'succeeded' : 'failed',
    target: { type: 'host-telemetry', id: resourceId, label: resourceId },
    metadata: {
      resourceId,
      durationMs,
      cache: false,
      adapterRequestId: result.requestId || requestId,
      classification: 'internal-operational',
      errorCode: result.errorCode,
    },
  });
}

async function getResource(resourceId, req) {
  const resourcePath = RESOURCE_PATHS[resourceId];
  if (!resourcePath) throw Object.assign(new Error('Unsupported telemetry resource.'), { code: 'UNSUPPORTED_TELEMETRY_RESOURCE' });
  const baseUrl = String(process.env.ADMIN_HOST_TELEMETRY_URL || '').replace(/\/$/, '');
  if (!baseUrl) return unavailable(resourceId);

  const requestId = crypto.randomUUID();
  const startedAt = Date.now();
  const headers = { Accept: 'application/json', 'X-Request-ID': requestId };
  if (process.env.ADMIN_HOST_TELEMETRY_TOKEN) headers.Authorization = `Bearer ${process.env.ADMIN_HOST_TELEMETRY_TOKEN}`;
  let result;
  try {
    const response = await axios.get(`${baseUrl}/${resourcePath}`, {
      headers,
      timeout: positiveIntegerEnv('ADMIN_HOST_TELEMETRY_TIMEOUT_MS', 2500),
      maxContentLength: 64 * 1024,
      maxRedirects: 0,
      proxy: false,
      validateStatus: (status) => status === 200,
    });
    const payload = response.data;
    if (!payload || !['available', 'degraded', 'unavailable'].includes(payload.status) || payload.source !== 'admin-backend') {
      throw Object.assign(new Error('Invalid telemetry response.'), { code: 'INVALID_TELEMETRY_RESPONSE' });
    }
    result = { ...payload, resourceId };
  } catch (error) {
    const errorCode = error.code === 'ECONNABORTED' ? 'timeout'
      : error.code === 'INVALID_TELEMETRY_RESPONSE' ? 'invalid_response'
        : error.response?.status === 401 ? 'denied' : 'unavailable';
    result = unavailable(resourceId, errorCode);
  }
  await auditRead(req, resourceId, result, Date.now() - startedAt, requestId);
  return result;
}

module.exports = { getResource };
