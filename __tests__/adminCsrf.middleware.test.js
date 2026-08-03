jest.mock('../src/services/auditLog.service', () => ({ record: jest.fn().mockResolvedValue(undefined) }));

const {
  requireAdminCsrf,
  requireAdminCsrfWhenAdmin,
} = require('../src/middlewares/adminCsrf.middleware');
const AuditLogService = require('../src/services/auditLog.service');

function responseRecorder() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

describe('admin CSRF middleware', () => {
  beforeEach(() => jest.clearAllMocks());

  it('rejects and audits an administrator mutation without matching CSRF evidence', async () => {
    const req = { role: 'admin', method: 'PATCH', path: '/accounts/1', cookies: { csrfToken: 'expected' }, csrfToken: 'expected', get: jest.fn(() => '') };
    const res = responseRecorder();
    const next = jest.fn();

    await requireAdminCsrf(req, res, next);

    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
    expect(AuditLogService.record).toHaveBeenCalledWith(req, expect.objectContaining({
      eventType: 'admin.csrf.rejected', outcome: 'rejected',
    }));
  });

  it('allows an administrator mutation only when all CSRF values match', async () => {
    const req = { role: 'admin', cookies: { csrfToken: 'expected' }, csrfToken: 'expected', get: jest.fn(() => 'expected') };
    const res = responseRecorder();
    const next = jest.fn();

    await requireAdminCsrfWhenAdmin(req, res, next);

    expect(res.statusCode).toBeNull();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('preserves the existing citizen flow on shared legacy routes', async () => {
    const req = { role: 'citizen', cookies: {}, get: jest.fn(() => '') };
    const res = responseRecorder();
    const next = jest.fn();

    await requireAdminCsrfWhenAdmin(req, res, next);

    expect(res.statusCode).toBeNull();
    expect(next).toHaveBeenCalledTimes(1);
  });
});
