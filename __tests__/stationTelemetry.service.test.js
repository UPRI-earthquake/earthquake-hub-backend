jest.mock('../src/models/stationTelemetrySample.model', () => ({
  create: jest.fn(),
  find: jest.fn(),
}));

const StationTelemetrySample = require('../src/models/stationTelemetrySample.model');
const StationTelemetryService = require('../src/services/stationTelemetry.service');

const sampleInput = {
  activity: 'active',
  deviceId: 'am_r1382',
  inactivityThresholdMs: 30_000,
  latestPacketAt: '2026-08-02T10:14:50.000Z',
  observedAt: '2026-08-02T10:15:00.000Z',
  packetAgeMs: 10_000,
  streamRowCount: 3,
};

describe('station telemetry service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.ADMIN_STATION_TELEMETRY_SAMPLE_INTERVAL_SECONDS;
    delete process.env.ADMIN_STATION_TELEMETRY_RETENTION_DAYS;
    StationTelemetryService._test.resetSamplingState();
  });

  it('stores at most one freshness sample in a station interval', async () => {
    StationTelemetrySample.create.mockResolvedValue({ _id: 'sample-1' });
    await expect(StationTelemetryService.retainFreshnessSample(sampleInput, { nowMs: 1 }))
      .resolves.toMatchObject({ stored: true });
    await expect(StationTelemetryService.retainFreshnessSample({
      ...sampleInput,
      observedAt: '2026-08-02T10:16:00.000Z',
    }, { nowMs: 2 })).resolves.toMatchObject({ reason: 'already_sampled', stored: false });

    expect(StationTelemetrySample.create).toHaveBeenCalledTimes(1);
    expect(StationTelemetrySample.create).toHaveBeenCalledWith(expect.objectContaining({
      bucketAt: new Date('2026-08-02T10:15:00.000Z'),
      deviceId: 'AM_R1382',
      packetAgeMs: 10_000,
      retentionDays: 90,
      sampleIntervalSeconds: 900,
      streamRowCount: 3,
    }));
  });

  it('treats the unique bucket index as the cross-process deduplication authority', async () => {
    StationTelemetrySample.create.mockRejectedValue(Object.assign(new Error('duplicate'), { code: 11000 }));
    await expect(StationTelemetryService.retainFreshnessSample(sampleInput))
      .resolves.toMatchObject({ reason: 'already_sampled', stored: false });
  });

  it('defers repeated writes briefly after a storage failure', async () => {
    StationTelemetrySample.create.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(StationTelemetryService.retainFreshnessSample(sampleInput, { nowMs: 1000 }))
      .rejects.toThrow('database unavailable');
    await expect(StationTelemetryService.retainFreshnessSample(sampleInput, { nowMs: 2000 }))
      .resolves.toMatchObject({ reason: 'retry_deferred', stored: false });
    expect(StationTelemetrySample.create).toHaveBeenCalledTimes(1);
  });

  it('returns a bounded ascending freshness window and explicit summary', async () => {
    const rows = [
      { _id: '2', observedAt: new Date('2026-08-02T10:00:00.000Z'), packetAgeMs: 40_000, inactivityThresholdMs: 30_000 },
      { _id: '1', observedAt: new Date('2026-08-02T09:45:00.000Z'), packetAgeMs: 5_000, inactivityThresholdMs: 30_000 },
    ];
    const query = {
      sort: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue(rows),
    };
    StationTelemetrySample.find.mockReturnValue(query);

    const result = await StationTelemetryService.listFreshness({
      deviceId: 'am_r1382',
      hours: 6,
      now: new Date('2026-08-02T10:15:00.000Z'),
    });

    expect(StationTelemetrySample.find).toHaveBeenCalledWith({
      deviceId: 'AM_R1382',
      observedAt: {
        $gte: new Date('2026-08-02T04:15:00.000Z'),
        $lte: new Date('2026-08-02T10:15:00.000Z'),
      },
    });
    expect(result.samples.map(({ _id }) => _id)).toEqual(['1', '2']);
    expect(result.summary).toMatchObject({
      hours: 6,
      latestPacketAgeMs: 40_000,
      peakPacketAgeMs: 40_000,
      sampleCount: 2,
      source: 'ringserver_stream_status',
      truncated: false,
    });
  });
});
