jest.mock('../src/services/auditLog.service', () => ({
  record: jest.fn().mockResolvedValue(undefined),
}));

const AuditLogService = require('../src/services/auditLog.service');
const {
  requireAdminCapability,
  requireTypedTargetConfirmation,
} = require('../src/middlewares/adminActionPolicy.middleware');
const { ACTIONS } = require('../src/services/adminCapabilities.service');

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

describe('admin action policy middleware', () => {
  const originalEnrichmentPolicy = process.env.ADMIN_EVENT_ENRICHMENT_ENABLED;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.ADMIN_EVENT_ENRICHMENT_ENABLED;
  });

  afterAll(() => {
    if (originalEnrichmentPolicy === undefined) delete process.env.ADMIN_EVENT_ENRICHMENT_ENABLED;
    else process.env.ADMIN_EVENT_ENRICHMENT_ENABLED = originalEnrichmentPolicy;
  });

  it('allows a server-enabled capability', async () => {
    const next = jest.fn();

    await requireAdminCapability(ACTIONS.EARTHQUAKE_EVENT_ENRICHMENT)(
      { body: {} },
      responseRecorder(),
      next,
    );

    expect(next).toHaveBeenCalledTimes(1);
    expect(AuditLogService.record).not.toHaveBeenCalled();
  });

  it('rejects and audits a server-disabled capability', async () => {
    process.env.ADMIN_EVENT_ENRICHMENT_ENABLED = 'false';
    const req = { body: { reason: 'Attempt while disabled.' } };
    const res = responseRecorder();
    const next = jest.fn();

    await requireAdminCapability(ACTIONS.EARTHQUAKE_EVENT_ENRICHMENT)(req, res, next);

    expect(res.statusCode).toBe(403);
    expect(res.body.errorCode).toBe('ADMIN_CAPABILITY_DISABLED');
    expect(next).not.toHaveBeenCalled();
    expect(AuditLogService.record).toHaveBeenCalledWith(req, expect.objectContaining({
      eventType: 'admin.capability.rejected',
      outcome: 'rejected',
    }));
  });

  it('requires an exact typed target and audits a mismatch', async () => {
    const req = {
      body: { confirmation: 'AM_OTHER', reason: 'Retire inactive mapping.' },
      params: { deviceId: 'AM_R1382' },
    };
    const res = responseRecorder();
    const next = jest.fn();

    await requireTypedTargetConfirmation({
      actionId: ACTIONS.DEVICE_TUNNEL_REVOCATION,
      eventType: 'device.tunnel.revoke',
      paramName: 'deviceId',
      targetType: 'device_station',
    })(req, res, next);

    expect(res.statusCode).toBe(400);
    expect(res.body.errorCode).toBe('ADMIN_CONFIRMATION_MISMATCH');
    expect(next).not.toHaveBeenCalled();
    expect(AuditLogService.record).toHaveBeenCalledWith(req, expect.objectContaining({
      outcome: 'rejected',
      metadata: expect.objectContaining({ reasonCode: 'typed_confirmation_mismatch' }),
    }));
  });
});
