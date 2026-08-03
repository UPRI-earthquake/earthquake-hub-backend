jest.mock('../src/models/device.model', () => ({ find: jest.fn(), findOne: jest.fn() }));
jest.mock('../src/services/EQevents.service', () => ({
  addPlacesAttribute: jest.fn(),
  getEventByPublicID: jest.fn(),
}));
jest.mock('../src/services/stationOperationalHistory.service', () => ({
  appendActivityTransition: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../src/services/stationTelemetry.service', () => ({
  retainFreshnessSample: jest.fn().mockResolvedValue({ stored: true }),
}));

const Device = require('../src/models/device.model');
const StationOperationalHistoryService = require('../src/services/stationOperationalHistory.service');
const StationTelemetryService = require('../src/services/stationTelemetry.service');
const MessagingService = require('../src/services/messaging.service');

describe('Ringserver station transition history', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    MessagingService.eventCache.removeAllListeners('newEvent');
  });

  it('persists freshness evidence only when activity changes', async () => {
    const persisted = {
      network: 'AM',
      station: 'R1382',
      streamId: 'AM_R1382_.*/MSEED',
      activity: 'active',
      save: jest.fn().mockResolvedValue(undefined),
    };
    Device.findOne.mockResolvedValue(persisted);
    const observedAt = new Date('2026-08-02T00:01:00.000Z');
    const latestPacketAt = new Date('2026-08-02T00:00:20.000Z');

    await expect(MessagingService._test.applyDeviceActivityObservation(
      { streamId: persisted.streamId, activity: 'active' },
      latestPacketAt,
      observedAt,
    )).resolves.toBe(true);

    expect(persisted.activity).toBe('inactive');
    expect(persisted.save).toHaveBeenCalledTimes(1);
    expect(StationOperationalHistoryService.appendActivityTransition).toHaveBeenCalledWith(expect.objectContaining({
      deviceId: 'AM_R1382',
      fromActivity: 'active',
      toActivity: 'inactive',
      packetAgeMs: 40_000,
      thresholdMs: 30_000,
    }));
  });

  it('does not append repeated observations of the same state', async () => {
    await expect(MessagingService._test.applyDeviceActivityObservation(
      { streamId: 'AM_R1382_.*/MSEED', activity: 'active' },
      new Date('2026-08-02T00:00:50.000Z'),
      new Date('2026-08-02T00:01:00.000Z'),
    )).resolves.toBe(false);

    expect(Device.findOne).not.toHaveBeenCalled();
    expect(StationOperationalHistoryService.appendActivityTransition).not.toHaveBeenCalled();
  });

  it('retains one bounded freshness observation using the latest station stream row', async () => {
    const device = {
      network: 'AM',
      station: 'R1382',
      streamId: 'AM_R1382_.*/MSEED',
      activity: 'active',
    };
    Device.find.mockResolvedValue([device]);

    await MessagingService._test.processStreamStatusSnapshot({
      current_time: '2026-08-02T10:15:00.000Z',
      stream_ids: [
        { stream_id: 'AM_R1382_00_EHZ/MSEED', latest_data_end_time: '2026-08-02T10:14:40.000Z' },
        { stream_id: 'AM_R1382_00_ENN/MSEED', latest_data_end_time: '2026-08-02T10:14:55.000Z' },
        { stream_id: 'malformed', latest_data_end_time: 'not-a-date' },
      ],
    });

    expect(StationTelemetryService.retainFreshnessSample).toHaveBeenCalledWith({
      activity: 'active',
      deviceId: 'AM_R1382',
      inactivityThresholdMs: 30_000,
      latestPacketAt: new Date('2026-08-02T10:14:55.000Z'),
      observedAt: new Date('2026-08-02T10:15:00.000Z'),
      packetAgeMs: 5_000,
      streamRowCount: 2,
    });
  });

  it('parses Ringserver timezone-free microsecond timestamps explicitly as UTC', () => {
    expect(MessagingService._test.parseRingserverTimestamp('2026-08-02 10:15:00.123456').toISOString())
      .toBe('2026-08-02T10:15:00.123Z');
    expect(MessagingService._test.parseRingserverTimestamp('invalid')).toBeNull();
  });
});
