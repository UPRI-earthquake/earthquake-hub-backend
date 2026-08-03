jest.mock('axios', () => ({ get: jest.fn() }));
jest.mock('fs', () => ({ readFileSync: jest.fn((path) => Buffer.from(path)) }));
jest.mock('https', () => ({ Agent: jest.fn().mockImplementation((options) => ({ options })) }));
jest.mock('../src/services/auditLog.service', () => ({ record: jest.fn() }));

const axios = require('axios');
const fs = require('fs');
const https = require('https');
const AuditLogService = require('../src/services/auditLog.service');
const AdminHostTelemetryClient = require('../src/services/adminHostTelemetry.client');

describe('admin host telemetry client', () => {
  const req = { accountId: 'account-1', username: 'admin', role: 'admin', headers: {}, method: 'GET', path: '/snapshot' };

  beforeEach(() => {
    jest.clearAllMocks();
    AdminHostTelemetryClient.resetTelemetryState();
    process.env.ADMIN_HOST_TELEMETRY_URL = 'http://admin-backend-dep-test:5100/v1';
    delete process.env.ADMIN_HOST_TELEMETRY_TOKEN;
    delete process.env.ADMIN_HOST_TELEMETRY_TLS_REQUIRED;
    delete process.env.ADMIN_HOST_TELEMETRY_CA_PATH;
    delete process.env.ADMIN_HOST_TELEMETRY_CERT_PATH;
    delete process.env.ADMIN_HOST_TELEMETRY_KEY_PATH;
  });

  afterAll(() => {
    delete process.env.ADMIN_HOST_TELEMETRY_URL;
    delete process.env.ADMIN_HOST_TELEMETRY_TOKEN;
    delete process.env.ADMIN_HOST_TELEMETRY_TLS_REQUIRED;
    delete process.env.ADMIN_HOST_TELEMETRY_CA_PATH;
    delete process.env.ADMIN_HOST_TELEMETRY_CERT_PATH;
    delete process.env.ADMIN_HOST_TELEMETRY_KEY_PATH;
  });

  it('calls only a fixed resource path and records a body-free audit event', async () => {
    axios.get.mockResolvedValue({ data: {
      requestId: 'adapter-request', observedAt: '2026-07-15T00:00:00.000Z', source: 'admin-backend',
      status: 'available', durationMs: 4, data: { checkId: 'hub-backend-http', reachable: true, httpStatus: 200 },
    } });

    const result = await AdminHostTelemetryClient.getResource('deployment', req);

    expect(result.status).toBe('available');
    expect(axios.get).toHaveBeenCalledWith('http://admin-backend-dep-test:5100/v1/deployment', expect.objectContaining({
      maxContentLength: 65536, maxRedirects: 0, proxy: false,
    }));
    expect(AuditLogService.record).toHaveBeenCalledWith(req, expect.objectContaining({
      eventType: 'admin.telemetry.read', outcome: 'succeeded', target: expect.objectContaining({ id: 'deployment' }),
      metadata: expect.not.objectContaining({ response: expect.anything(), body: expect.anything() }),
    }));
  });

  it('normalizes adapter failures and audits the failed read', async () => {
    axios.get.mockRejectedValue(Object.assign(new Error('connect failed'), { code: 'ECONNREFUSED' }));
    const result = await AdminHostTelemetryClient.getResource('archive', req);
    expect(result).toEqual(expect.objectContaining({ status: 'unavailable', errorCode: 'unavailable', data: null }));
    expect(AuditLogService.record).toHaveBeenCalledWith(req, expect.objectContaining({ outcome: 'failed' }));
  });

  it('audits a degraded check as a successful read with degraded classification', async () => {
    axios.get.mockResolvedValue({ data: {
      requestId: 'adapter-degraded',
      observedAt: new Date().toISOString(),
      source: 'admin-backend',
      status: 'degraded',
      durationMs: 4,
      data: { checkId: 'fdsnws-http', reachable: false, httpStatus: 503 },
    } });

    const result = await AdminHostTelemetryClient.getResource('seiscomp', req);

    expect(result.status).toBe('degraded');
    expect(AuditLogService.record).toHaveBeenCalledWith(req, expect.objectContaining({
      outcome: 'succeeded',
      metadata: expect.objectContaining({
        responseStatus: 'degraded',
        freshnessStatus: 'fresh',
      }),
    }));
  });

  it('retains last-success and failure-duration evidence across a source outage', async () => {
    const observedAt = new Date().toISOString();
    axios.get.mockResolvedValueOnce({ data: {
      requestId: 'adapter-success',
      observedAt,
      source: 'admin-backend',
      status: 'available',
      durationMs: 4,
      data: { checkId: 'archive-filesystem-capacity', mounted: true },
    } });

    const first = await AdminHostTelemetryClient.getResource('archive', req);
    axios.get.mockRejectedValueOnce(Object.assign(new Error('connect failed'), { code: 'ECONNREFUSED' }));
    const second = await AdminHostTelemetryClient.getResource('archive', req);

    expect(first.operational).toEqual(expect.objectContaining({
      availability: 'available',
      state: 'healthy',
      freshness: expect.objectContaining({ status: 'fresh' }),
    }));
    expect(second).toEqual(expect.objectContaining({
      status: 'unavailable',
      lastSuccessfulAt: observedAt,
      failureSince: expect.any(String),
      failureDurationMs: expect.any(Number),
      operational: expect.objectContaining({ state: 'unavailable' }),
    }));
  });

  it('rejects unsupported resource IDs before any network call', async () => {
    await expect(AdminHostTelemetryClient.getResource('logs', req)).rejects.toMatchObject({ code: 'UNSUPPORTED_TELEMETRY_RESOURCE' });
    expect(axios.get).not.toHaveBeenCalled();
  });

  it('uses the fixed system resource path for deployment-host metrics', async () => {
    axios.get.mockResolvedValue({ data: {
      requestId: 'system-request', observedAt: '2026-07-23T00:00:00.000Z', source: 'admin-backend',
      status: 'available', durationMs: 150, data: {
        checkId: 'deployment-host-resources',
        cpu: { utilizationPercent: 28, status: 'healthy' },
        memory: { utilizationPercent: 42, status: 'healthy' },
        disk: { utilizationPercent: 35, status: 'healthy' },
      },
    } });

    const result = await AdminHostTelemetryClient.getResource('system', req);

    expect(result.resourceId).toBe('system');
    expect(axios.get).toHaveBeenCalledWith(
      'http://admin-backend-dep-test:5100/v1/system',
      expect.objectContaining({ maxContentLength: 65536, maxRedirects: 0 }),
    );
  });

  it('uses the fixed WSTunnel resource without accepting a port from the caller', async () => {
    axios.get.mockResolvedValue({ data: {
      requestId: 'wstunnel-request', observedAt: '2026-08-02T00:00:00.000Z', source: 'admin-backend',
      status: 'available', durationMs: 3, data: {
        checkId: 'wstunnel-loopback-listeners',
        listenerPorts: [22012],
        portRange: { start: 22000, end: 22999 },
      },
    } });

    const result = await AdminHostTelemetryClient.getResource('wstunnel', req);

    expect(result.resourceId).toBe('wstunnel');
    expect(axios.get).toHaveBeenCalledWith(
      'http://admin-backend-dep-test:5100/v1/wstunnel',
      expect.objectContaining({ maxRedirects: 0, proxy: false }),
    );
  });

  it('fails closed when mTLS is required for a plaintext adapter URL', async () => {
    process.env.ADMIN_HOST_TELEMETRY_TLS_REQUIRED = 'true';

    const result = await AdminHostTelemetryClient.getResource('system', req);

    expect(result).toEqual(expect.objectContaining({
      status: 'unavailable',
      errorCode: 'mtls_not_configured',
    }));
    expect(axios.get).not.toHaveBeenCalled();
    expect(AuditLogService.record).toHaveBeenCalledWith(req, expect.objectContaining({
      outcome: 'failed',
      metadata: expect.objectContaining({ errorCode: 'mtls_not_configured' }),
    }));
  });

  it('fails closed when an HTTPS adapter has no required client certificate paths', async () => {
    process.env.ADMIN_HOST_TELEMETRY_URL = 'https://admin-backend:5100/v1';
    process.env.ADMIN_HOST_TELEMETRY_TLS_REQUIRED = 'true';

    const result = await AdminHostTelemetryClient.getResource('deployment', req);

    expect(result.errorCode).toBe('mtls_not_configured');
    expect(axios.get).not.toHaveBeenCalled();
  });

  it('loads the fixed client identity and passes a verifying HTTPS agent to axios', async () => {
    process.env.ADMIN_HOST_TELEMETRY_URL = 'https://admin-backend:5100/v1';
    process.env.ADMIN_HOST_TELEMETRY_TLS_REQUIRED = 'true';
    process.env.ADMIN_HOST_TELEMETRY_CA_PATH = '/run/secrets/admin-telemetry/ca.crt';
    process.env.ADMIN_HOST_TELEMETRY_CERT_PATH = '/run/secrets/admin-telemetry/tls.crt';
    process.env.ADMIN_HOST_TELEMETRY_KEY_PATH = '/run/secrets/admin-telemetry/tls.key';
    axios.get.mockResolvedValue({ data: {
      requestId: 'adapter-request', observedAt: '2026-07-29T00:00:00.000Z', source: 'admin-backend',
      status: 'available', durationMs: 4, data: { checkId: 'hub-backend-http', reachable: true },
    } });

    await AdminHostTelemetryClient.getResource('deployment', req);

    expect(fs.readFileSync).toHaveBeenCalledTimes(3);
    expect(https.Agent).toHaveBeenCalledWith(expect.objectContaining({
      minVersion: 'TLSv1.2',
      rejectUnauthorized: true,
    }));
    expect(axios.get).toHaveBeenCalledWith(
      'https://admin-backend:5100/v1/deployment',
      expect.objectContaining({ httpsAgent: expect.any(Object) }),
    );
  });
});
