const {
  getStationTelemetryRetentionDays,
  getStationTelemetrySampleIntervalSeconds,
  resolveStationTelemetryRetention,
  stationTelemetryBucketAt,
} = require('../src/config/stationTelemetry.config');

describe('station telemetry configuration', () => {
  beforeEach(() => {
    delete process.env.ADMIN_STATION_TELEMETRY_SAMPLE_INTERVAL_SECONDS;
    delete process.env.ADMIN_STATION_TELEMETRY_RETENTION_DAYS;
  });

  it('uses a 15-minute sample interval and 90-day retention by default', () => {
    expect(getStationTelemetrySampleIntervalSeconds()).toBe(900);
    expect(getStationTelemetryRetentionDays()).toBe(90);
    expect(stationTelemetryBucketAt('2026-08-02T10:14:59.000Z').toISOString())
      .toBe('2026-08-02T10:00:00.000Z');
    expect(resolveStationTelemetryRetention(new Date('2026-08-02T00:00:00.000Z')).expiresAt.toISOString())
      .toBe('2026-10-31T00:00:00.000Z');
  });

  it('rejects unsafe intervals and indefinite retention', () => {
    process.env.ADMIN_STATION_TELEMETRY_SAMPLE_INTERVAL_SECONDS = '30';
    expect(() => getStationTelemetrySampleIntervalSeconds()).toThrow(/60 to 86400/);
    process.env.ADMIN_STATION_TELEMETRY_SAMPLE_INTERVAL_SECONDS = '900';
    process.env.ADMIN_STATION_TELEMETRY_RETENTION_DAYS = '0';
    expect(() => getStationTelemetryRetentionDays()).toThrow(/1 to 3650/);
  });
});
