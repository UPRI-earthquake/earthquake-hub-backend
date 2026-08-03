const {
  getStationHistoryRetentionDays,
  resolveStationHistoryRetention,
} = require('../src/config/stationHistoryRetention.config');

describe('station operational history retention', () => {
  beforeEach(() => delete process.env.ADMIN_STATION_HISTORY_RETENTION_DAYS);

  it('uses a bounded one-year default', () => {
    expect(getStationHistoryRetentionDays()).toBe(365);
    expect(resolveStationHistoryRetention(new Date('2026-01-01T00:00:00.000Z')).expiresAt.toISOString())
      .toBe('2027-01-01T00:00:00.000Z');
  });

  it('rejects indefinite and invalid retention', () => {
    process.env.ADMIN_STATION_HISTORY_RETENTION_DAYS = '0';
    expect(() => getStationHistoryRetentionDays()).toThrow(/must be an integer/);
    process.env.ADMIN_STATION_HISTORY_RETENTION_DAYS = 'forever';
    expect(() => getStationHistoryRetentionDays()).toThrow(/must be an integer/);
  });
});
