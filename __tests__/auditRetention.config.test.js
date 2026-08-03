const {
  getAuditRetentionConfig,
  resolveAuditRetention,
} = require('../src/config/auditRetention.config');

describe('audit retention configuration', () => {
  beforeEach(() => {
    delete process.env.ADMIN_AUDIT_TELEMETRY_RETENTION_DAYS;
    delete process.env.ADMIN_AUDIT_ADMINISTRATIVE_RETENTION_DAYS;
  });

  it('uses the approved default periods', () => {
    expect(getAuditRetentionConfig()).toEqual({ telemetryDays: 90, administrativeDays: 730 });
  });

  it('rejects invalid periods instead of silently disabling retention', () => {
    process.env.ADMIN_AUDIT_TELEMETRY_RETENTION_DAYS = '-1';
    expect(() => getAuditRetentionConfig()).toThrow(/must be an integer/);

    process.env.ADMIN_AUDIT_TELEMETRY_RETENTION_DAYS = 'ninety';
    expect(() => getAuditRetentionConfig()).toThrow(/must be an integer/);
  });

  it('calculates expiry from the event creation time', () => {
    const result = resolveAuditRetention(
      { eventType: 'account.brgy.approve', outcome: 'succeeded' },
      new Date('2026-01-01T00:00:00.000Z'),
    );
    expect(result.retentionClass).toBe('administrative');
    expect(result.expiresAt.toISOString()).toBe('2028-01-01T00:00:00.000Z');
  });
});
