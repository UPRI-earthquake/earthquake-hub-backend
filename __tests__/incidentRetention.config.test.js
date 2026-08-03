const {
  getIncidentRetentionConfig,
  resolveIncidentEventRetention,
  resolveResolvedIncidentRetention,
} = require('../src/config/incidentRetention.config');

describe('incident retention configuration', () => {
  beforeEach(() => {
    delete process.env.ADMIN_INCIDENT_RESOLVED_RETENTION_DAYS;
    delete process.env.ADMIN_INCIDENT_EVENT_RETENTION_DAYS;
  });

  it('retains resolved incidents and append-only history for two years by default', () => {
    expect(getIncidentRetentionConfig()).toEqual({
      resolvedIncidentDays: 730,
      eventDays: 730,
    });
  });

  it('rejects invalid retention periods', () => {
    process.env.ADMIN_INCIDENT_EVENT_RETENTION_DAYS = '-1';
    expect(() => getIncidentRetentionConfig()).toThrow(/must be an integer/);

    process.env.ADMIN_INCIDENT_EVENT_RETENTION_DAYS = 'forever';
    expect(() => getIncidentRetentionConfig()).toThrow(/must be an integer/);
  });

  it('calculates resolved-record and history expiry from their policy anchors', () => {
    const now = new Date('2026-01-01T00:00:00.000Z');

    expect(resolveResolvedIncidentRetention(now).expiresAt.toISOString())
      .toBe('2028-01-01T00:00:00.000Z');
    expect(resolveIncidentEventRetention(now).expiresAt.toISOString())
      .toBe('2028-01-01T00:00:00.000Z');
  });

  it('supports explicit indefinite retention without creating a TTL date', () => {
    process.env.ADMIN_INCIDENT_RESOLVED_RETENTION_DAYS = '0';
    process.env.ADMIN_INCIDENT_EVENT_RETENTION_DAYS = '0';

    expect(resolveResolvedIncidentRetention().expiresAt).toBeUndefined();
    expect(resolveIncidentEventRetention().expiresAt).toBeUndefined();
  });
});
