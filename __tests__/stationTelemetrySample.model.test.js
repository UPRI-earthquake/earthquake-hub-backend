const StationTelemetrySample = require('../src/models/stationTelemetrySample.model');

describe('station telemetry sample model', () => {
  beforeEach(() => {
    delete process.env.ADMIN_STATION_TELEMETRY_SAMPLE_INTERVAL_SECONDS;
    delete process.env.ADMIN_STATION_TELEMETRY_RETENTION_DAYS;
  });

  it('defines immutable, unique, absolute-expiry samples', () => {
    const sample = new StationTelemetrySample({
      activity: 'active',
      bucketAt: new Date('2026-08-02T10:00:00.000Z'),
      deviceId: 'AM_R1382',
      inactivityThresholdMs: 30_000,
      latestPacketAt: new Date('2026-08-02T10:14:50.000Z'),
      observedAt: new Date('2026-08-02T10:15:00.000Z'),
      packetAgeMs: 10_000,
      streamRowCount: 3,
    });
    const indexes = StationTelemetrySample.schema.indexes();
    const uniqueBucket = indexes.find(([fields]) => fields.deviceId === 1 && fields.bucketAt === 1);
    const ttl = indexes.find(([fields]) => fields.expiresAt === 1);

    expect(sample.sampleIntervalSeconds).toBe(900);
    expect(sample.retentionDays).toBe(90);
    expect(uniqueBucket?.[1]).toEqual(expect.objectContaining({ unique: true }));
    expect(ttl?.[1]).toEqual(expect.objectContaining({ expireAfterSeconds: 0 }));
  });
});
