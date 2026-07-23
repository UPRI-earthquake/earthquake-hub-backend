jest.mock('../src/models/auditLog.model', () => ({
  create: jest.fn(),
  find: jest.fn(),
  countDocuments: jest.fn(),
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
  beforeEach(() => {
    jest.clearAllMocks();
    AuditLog.create.mockImplementation(async (document) => ({ toObject: () => document }));
  });

  it('redacts sensitive metadata before persisting an audit event', async () => {
    const auditEvent = await AuditLogService.record(request, { ...event, outcome: 'started' });

    expect(auditEvent.metadata).toEqual({ token: '[redacted]', nested: { password: '[redacted]', safe: 'ok' } });
    expect(auditEvent.actor).toEqual({ accountId: request.accountId, username: 'admin-user', role: 'admin' });
    expect(auditEvent.request.path).toBe('/admin/device-action');
  });

  it('records started and succeeded lifecycle events for a completed operation', async () => {
    const result = await AuditLogService.execute(request, event, async () => ({ restarted: true }));

    expect(result).toEqual({ restarted: true });
    expect(AuditLog.create).toHaveBeenCalledTimes(2);
    const [started, succeeded] = AuditLog.create.mock.calls.map(([document]) => document);
    expect(started.outcome).toBe('started');
    expect(succeeded.outcome).toBe('succeeded');
    expect(started.correlationId).toBe(succeeded.correlationId);
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
    const lean = jest.fn().mockResolvedValue([{ _id: 'audit-1', outcome: 'failed' }]);
    const limit = jest.fn(() => ({ lean }));
    const skip = jest.fn(() => ({ limit }));
    const sort = jest.fn(() => ({ skip }));
    AuditLog.find.mockReturnValue({ sort });
    AuditLog.countDocuments
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(7)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1);

    const result = await AuditLogService.list(
      { 'actor.username': 'admin-user', outcome: 'failed' },
      { limit: 25, offset: 0 },
    );

    expect(result.total).toBe(1);
    expect(result.summary).toEqual({ total: 7, started: 2, succeeded: 3, failed: 1, rejected: 1 });
    expect(AuditLog.countDocuments).toHaveBeenNthCalledWith(2, { 'actor.username': 'admin-user' });
    expect(AuditLog.countDocuments).toHaveBeenNthCalledWith(5, { 'actor.username': 'admin-user', outcome: 'failed' });
  });
});
