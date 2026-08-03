jest.mock('../src/models/stationOperationalEvent.model', () => ({
  create: jest.fn(),
  find: jest.fn(),
}));

const StationOperationalEvent = require('../src/models/stationOperationalEvent.model');
const StationOperationalHistoryService = require('../src/services/stationOperationalHistory.service');

describe('station operational history service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.ADMIN_STATION_HISTORY_RETENTION_DAYS;
  });

  it('stores bounded packet-freshness evidence for an activity transition', async () => {
    StationOperationalEvent.create.mockResolvedValue({});
    await StationOperationalHistoryService.appendActivityTransition({
      deviceId: 'am_r1382',
      effectiveAt: '2026-08-01T00:00:20.000Z',
      fromActivity: 'active',
      latestPacketAt: '2026-08-01T00:00:20.000Z',
      observedAt: '2026-08-01T00:01:00.000Z',
      packetAgeMs: 40_000,
      streamId: 'AM_R1382_.*/MSEED',
      thresholdMs: 30_000,
      toActivity: 'inactive',
    });

    expect(StationOperationalEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      deviceId: 'AM_R1382',
      network: 'AM',
      station: 'R1382',
      eventType: 'activity_changed',
      source: 'ringserver_stream_status',
      fromState: { activity: 'active' },
      toState: { activity: 'inactive' },
      evidence: expect.objectContaining({ packetAgeMs: 40_000, inactivityThresholdMs: 30_000 }),
      retentionDays: 365,
    }));
  });

  it('stores an audit-correlated tunnel mapping transition without key material', async () => {
    StationOperationalEvent.create.mockResolvedValue({});
    await StationOperationalHistoryService.appendTunnelTransition({
      actor: { accountId: 'admin-1', username: 'ops-admin', role: 'admin' },
      correlationId: 'audit-correlation-1',
      deviceId: 'AM_R1382',
      eventType: 'tunnel_enrolled',
      observedAt: '2026-08-01T00:00:00.000Z',
      remotePort: 22501,
    });

    const stored = StationOperationalEvent.create.mock.calls[0][0];
    expect(stored).toMatchObject({
      correlationId: 'audit-correlation-1',
      evidence: { remotePort: 22501 },
      fromState: { tunnelMapping: 'unmapped' },
      toState: { tunnelMapping: 'mapped' },
    });
    expect(JSON.stringify(stored)).not.toMatch(/publicKey|privateKey|fingerprint/i);
  });

  it('returns cursor-paginated history newest first', async () => {
    const rows = [
      { _id: '507f1f77bcf86cd799439011', observedAt: new Date('2026-08-02T00:00:00.000Z') },
      { _id: '507f1f77bcf86cd799439012', observedAt: new Date('2026-08-01T00:00:00.000Z') },
    ];
    const chain = {
      sort: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue(rows),
    };
    StationOperationalEvent.find.mockReturnValue(chain);

    const result = await StationOperationalHistoryService.listHistory({ deviceId: 'am_r1382', limit: 1 });

    expect(StationOperationalEvent.find).toHaveBeenCalledWith({ deviceId: 'AM_R1382' });
    expect(chain.sort).toHaveBeenCalledWith({ observedAt: -1, _id: -1 });
    expect(chain.limit).toHaveBeenCalledWith(2);
    expect(result.events).toEqual([rows[0]]);
    expect(result.nextCursor).toEqual(expect.any(String));
  });
});
