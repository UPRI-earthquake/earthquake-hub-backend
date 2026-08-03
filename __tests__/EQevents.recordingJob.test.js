jest.mock('axios', () => ({ get: jest.fn() }));
jest.mock('../src/models/events.model', () => ({
  countDocuments: jest.fn(),
  find: jest.fn(),
  updateOne: jest.fn(),
}));
jest.mock('../src/models/device.model', () => ({ find: jest.fn() }));

const axios = require('axios');
const EQEvents = require('../src/models/events.model');
const Device = require('../src/models/device.model');
const { updateOnlineStations } = require('../src/services/EQevents.service');

function eventQuery(events) {
  const lean = jest.fn().mockResolvedValue(events);
  const limit = jest.fn().mockReturnValue({ lean });
  const sort = jest.fn().mockReturnValue({ limit, lean });
  return { sort, limit, lean };
}

describe('recording availability background-job batch', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    EQEvents.updateOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
    EQEvents.countDocuments.mockResolvedValue(5);
    Device.find.mockReturnValue({
      lean: jest.fn().mockResolvedValue([
        { station: 'R001', latitude: 14.5, longitude: 121.0 },
        { station: 'R002', latitude: 14.6, longitude: 121.1 },
      ]),
    });
    axios.get.mockResolvedValue({ status: 200 });
  });

  it('checks only a bounded attention batch and persists progress per event', async () => {
    const events = [
      {
        _id: 'event-1',
        OT: new Date('2026-07-31T00:00:00.000Z'),
        latitude_value: 14.55,
        longitude_value: 121.05,
        candidateStations: ['R001', 'R002'],
        recordingAvailabilityAttempts: 1,
      },
      {
        _id: 'event-2',
        OT: new Date('2026-07-30T00:00:00.000Z'),
        latitude_value: 14.65,
        longitude_value: 121.15,
        candidateStations: ['R001', 'R002'],
        recordingAvailabilityAttempts: 2,
      },
    ];
    const query = eventQuery(events);
    EQEvents.find.mockReturnValue(query);
    const onProgress = jest.fn().mockResolvedValue(undefined);

    const result = await updateOnlineStations({
      batchSize: 2,
      onlyAttention: true,
      onProgress,
      signal: new AbortController().signal,
    });

    expect(EQEvents.find).toHaveBeenCalledWith(expect.objectContaining({
      longitude_value: { $ne: null },
      latitude_value: { $ne: null },
      $or: expect.any(Array),
    }));
    expect(query.sort).toHaveBeenCalledWith({ OT: -1 });
    expect(query.limit).toHaveBeenCalledWith(2);
    expect(EQEvents.updateOne).toHaveBeenCalledTimes(2);
    expect(onProgress).toHaveBeenCalledTimes(3);
    expect(onProgress).toHaveBeenLastCalledWith({
      current: 2,
      total: 2,
      message: 'Checked 2 of 2 event recording windows.',
    });
    expect(result).toMatchObject({
      matchedCount: 2,
      modifiedCount: 2,
      totalProcessed: 2,
      eligibleCount: 5,
      batchLimited: true,
      skippedCount: 0,
      statusCounts: { pending: 0, partial: 0, verified: 2, unavailable: 0 },
    });
  });

  it('aborts before making FDSNWS requests when the deadline is already cancelled', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(updateOnlineStations({
      batchSize: 2,
      onlyAttention: true,
      signal: controller.signal,
    })).rejects.toMatchObject({ name: 'AbortError' });
    expect(EQEvents.find).not.toHaveBeenCalled();
    expect(axios.get).not.toHaveBeenCalled();
  });
});
