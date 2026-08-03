jest.mock('../src/models/auditLog.model', () => ({
  aggregate: jest.fn(),
  create: jest.fn(),
  find: jest.fn(),
}));

const AuditLog = require('../src/models/auditLog.model');
const AuditLogService = require('../src/services/auditLog.service');

const request = {
  accountId: '507f1f77bcf86cd799439011',
  username: 'admin-user',
  role: 'admin',
  method: 'POST',
  baseUrl: '/admin',
  path: '/device-action',
  ip: '127.0.0.1',
  headers: { 'x-request-id': 'request-1' },
};

const event = {
  eventType: 'device.tunnel.restart',
  target: { type: 'station', id: 'AM.R1382', label: 'AM.R1382' },
  reason: 'Investigating delayed packets.',
  metadata: { token: 'must-not-be-stored', nested: { password: 'must-not-be-stored', safe: 'ok' } },
};

describe('AuditLogService', () => {
  afterEach(() => jest.useRealTimers());

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.ADMIN_AUDIT_TELEMETRY_RETENTION_DAYS;
    delete process.env.ADMIN_AUDIT_ADMINISTRATIVE_RETENTION_DAYS;
    AuditLog.create.mockImplementation(async (document) => ({ toObject: () => document }));
  });

  it('redacts sensitive metadata before persisting an audit event', async () => {
    const auditEvent = await AuditLogService.record(request, { ...event, outcome: 'started' });

    expect(auditEvent.metadata).toEqual({ token: '[redacted]', nested: { password: '[redacted]', safe: 'ok' } });
    expect(auditEvent.actor).toEqual({ accountId: request.accountId, username: 'admin-user', role: 'admin' });
    expect(auditEvent.request.path).toBe('/admin/device-action');
    expect(auditEvent.retentionClass).toBe('administrative');
    expect(auditEvent.expiresAt).toBeInstanceOf(Date);
  });

  it('truncates deep, long, and oversized metadata without leaking nested secrets', () => {
    const longText = 'x'.repeat(3000);
    const deep = { level1: { level2: { level3: { level4: { level5: { password: 'leak' } } } } } };
    const metadata = AuditLogService.boundedMetadata({ longText, deep });

    expect(metadata.longText).toMatch(/\[truncated\]$/);
    expect(JSON.stringify(metadata)).not.toContain('leak');
  });

  it('replaces metadata that remains larger than the document budget', () => {
    const metadata = AuditLogService.boundedMetadata(
      Object.fromEntries(Array.from({ length: 50 }, (_, index) => [`field${index}`, 'x'.repeat(2048)])),
    );

    expect(metadata).toEqual(expect.objectContaining({ truncated: true }));
  });

  it('retains successful routine telemetry for the shorter configured period', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-29T00:00:00.000Z'));
    process.env.ADMIN_AUDIT_TELEMETRY_RETENTION_DAYS = '30';

    const auditEvent = await AuditLogService.record(request, {
      eventType: 'admin.telemetry.read',
      outcome: 'succeeded',
      target: { type: 'host-telemetry', id: 'deployment' },
    });

    expect(auditEvent.retentionClass).toBe('routine_telemetry');
    expect(auditEvent.expiresAt.toISOString()).toBe('2026-08-28T00:00:00.000Z');
  });

  it('retains failed telemetry as an administrative record', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-29T00:00:00.000Z'));
    process.env.ADMIN_AUDIT_ADMINISTRATIVE_RETENTION_DAYS = '365';

    const auditEvent = await AuditLogService.record(request, {
      eventType: 'admin.telemetry.read',
      outcome: 'failed',
      target: { type: 'host-telemetry', id: 'deployment' },
    });

    expect(auditEvent.retentionClass).toBe('administrative');
    expect(auditEvent.expiresAt.toISOString()).toBe('2027-07-29T00:00:00.000Z');
  });

  it('supports explicitly disabling expiry for newly written records', async () => {
    process.env.ADMIN_AUDIT_ADMINISTRATIVE_RETENTION_DAYS = '0';

    const auditEvent = await AuditLogService.record(request, { ...event, outcome: 'started' });

    expect(auditEvent.retentionClass).toBe('administrative');
    expect(auditEvent.expiresAt).toBeUndefined();
  });

  it('records started and succeeded lifecycle events for a completed operation', async () => {
    const operation = jest.fn(async () => ({ restarted: true }));
    const result = await AuditLogService.execute(request, event, operation);

    expect(result).toEqual({ restarted: true });
    expect(AuditLog.create).toHaveBeenCalledTimes(2);
    const [started, succeeded] = AuditLog.create.mock.calls.map(([document]) => document);
    expect(started.outcome).toBe('started');
    expect(succeeded.outcome).toBe('succeeded');
    expect(started.correlationId).toBe(succeeded.correlationId);
    expect(operation).toHaveBeenCalledWith({ correlationId: started.correlationId });
  });

  it('records a failed lifecycle event and rethrows the operation error', async () => {
    await expect(AuditLogService.execute(request, event, async () => {
      const error = new Error('Tunnel unreachable');
      error.code = 'TUNNEL_UNREACHABLE';
      throw error;
    })).rejects.toThrow('Tunnel unreachable');

    const [, failed] = AuditLog.create.mock.calls.map(([document]) => document);
    expect(failed.outcome).toBe('failed');
    expect(failed.metadata.errorCode).toBe('TUNNEL_UNREACHABLE');
  });

  it('returns outcome counts for the current non-outcome filters', async () => {
    const lean = jest.fn().mockResolvedValue([{
      _id: 'audit-1', outcome: 'failed', createdAt: '2026-07-29T00:00:00.000Z',
    }]);
    const query = {
      lean,
      limit: jest.fn(() => query),
      skip: jest.fn(() => query),
      sort: jest.fn(() => query),
    };
    AuditLog.find.mockReturnValue(query);
    AuditLog.aggregate.mockResolvedValue([{
      _id: null, total: 7, started: 2, succeeded: 3, failed: 1, rejected: 1,
    }]);

    const result = await AuditLogService.list(
      { 'actor.username': 'admin-user', outcome: 'failed' },
      { limit: 25, offset: 0 },
    );

    expect(result.total).toBe(1);
    expect(result.summary).toEqual({ total: 7, started: 2, succeeded: 3, failed: 1, rejected: 1 });
    expect(AuditLog.aggregate).toHaveBeenCalledTimes(1);
    expect(query.limit).toHaveBeenCalledWith(26);
  });

  it('returns and accepts a stable cursor without using offset skip', async () => {
    const firstPageRows = [
      { _id: '507f1f77bcf86cd799439012', createdAt: '2026-07-29T02:00:00.000Z', outcome: 'succeeded' },
      { _id: '507f1f77bcf86cd799439011', createdAt: '2026-07-29T01:00:00.000Z', outcome: 'succeeded' },
    ];
    const query = {
      lean: jest.fn().mockResolvedValue(firstPageRows),
      limit: jest.fn(() => query),
      skip: jest.fn(() => query),
      sort: jest.fn(() => query),
    };
    AuditLog.find.mockReturnValue(query);
    AuditLog.aggregate.mockResolvedValue([{
      total: 2, started: 0, succeeded: 2, failed: 0, rejected: 0,
    }]);

    const first = await AuditLogService.list({}, { limit: 1, offset: 0 });
    expect(first.nextCursor).toBeTruthy();

    query.lean.mockResolvedValue([]);
    await AuditLogService.list({}, { cursor: first.nextCursor, limit: 1, offset: 100 });
    expect(query.skip).not.toHaveBeenCalled();
    expect(AuditLog.find).toHaveBeenLastCalledWith(expect.objectContaining({ $and: expect.any(Array) }));
  });

  it('rejects malformed cursors before querying MongoDB', async () => {
    await expect(AuditLogService.list({}, { cursor: 'not-a-cursor', limit: 25, offset: 0 }))
      .rejects.toMatchObject({ statusCode: 400 });
    expect(AuditLog.find).not.toHaveBeenCalled();
  });
});
