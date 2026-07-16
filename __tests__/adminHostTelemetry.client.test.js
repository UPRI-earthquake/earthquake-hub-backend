jest.mock('axios', () => ({ get: jest.fn() }));
jest.mock('../src/services/auditLog.service', () => ({ record: jest.fn() }));

const axios = require('axios');
const AuditLogService = require('../src/services/auditLog.service');
const AdminHostTelemetryClient = require('../src/services/adminHostTelemetry.client');

describe('admin host telemetry client', () => {
  const req = { accountId: 'account-1', username: 'admin', role: 'admin', headers: {}, method: 'GET', path: '/snapshot' };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.ADMIN_HOST_TELEMETRY_URL = 'http://admin-backend-dep-test:5100/v1';
    delete process.env.ADMIN_HOST_TELEMETRY_TOKEN;
  });

  afterAll(() => {
    delete process.env.ADMIN_HOST_TELEMETRY_URL;
    delete process.env.ADMIN_HOST_TELEMETRY_TOKEN;
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

  it('rejects unsupported resource IDs before any network call', async () => {
    await expect(AdminHostTelemetryClient.getResource('logs', req)).rejects.toMatchObject({ code: 'UNSUPPORTED_TELEMETRY_RESOURCE' });
    expect(axios.get).not.toHaveBeenCalled();
  });
});
