const StationOperationalEvent = require('../src/models/stationOperationalEvent.model');

describe('station operational event model', () => {
  beforeEach(() => delete process.env.ADMIN_STATION_HISTORY_RETENTION_DAYS);

  it('defines immutable bounded transition history with an absolute TTL index', () => {
    const event = new StationOperationalEvent({
      deviceId: 'AM_R1382',
      eventType: 'activity_changed',
      source: 'ringserver_stream_status',
      observedAt: new Date('2026-08-01T00:00:00.000Z'),
    });
    const ttlIndex = StationOperationalEvent.schema.indexes()
      .find(([fields]) => fields.expiresAt === 1);

    expect(event.retentionDays).toBe(365);
    expect(event.expiresAt).toBeInstanceOf(Date);
    expect(ttlIndex?.[1]).toEqual(expect.objectContaining({ expireAfterSeconds: 0 }));
    expect(StationOperationalEvent.EVENT_TYPES).toEqual(expect.arrayContaining([
      'activity_changed', 'tunnel_enrolled', 'tunnel_revoked',
    ]));
  });
});
