jest.mock('../src/models/device.model', () => ({ countDocuments: jest.fn() }));
jest.mock('../src/models/events.model', () => ({ countDocuments: jest.fn(), find: jest.fn() }));
jest.mock('../src/services/adminHostTelemetry.client', () => ({ getResource: jest.fn() }));

const Device = require('../src/models/device.model');
const Event = require('../src/models/events.model');
const AdminHostTelemetryClient = require('../src/services/adminHostTelemetry.client');
const AdminSeiscompService = require('../src/services/adminSeiscomp.service');

function eventQuery(events) {
  return {
    sort: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(events),
  };
}

describe('Admin SeisComP monitoring service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Event.find.mockReturnValue(eventQuery([]));
    Event.countDocuments.mockResolvedValueOnce(0).mockResolvedValueOnce(0);
    Device.countDocuments.mockResolvedValueOnce(3).mockResolvedValueOnce(2);
    AdminHostTelemetryClient.getResource.mockResolvedValue({ status: 'unavailable', data: null, observedAt: null });
  });

  it('treats active and streaming station states as operational input', async () => {
    const snapshot = await AdminSeiscompService.getSnapshot({}, {});

    expect(Device.countDocuments).toHaveBeenNthCalledWith(1, { activity: { $in: ['active', 'streaming'] } });
    expect(Device.countDocuments).toHaveBeenNthCalledWith(2, { activity: { $nin: ['active', 'streaming'] } });
    expect(snapshot.summary).toMatchObject({ activeStations: 3, inactiveStations: 2 });
    expect(snapshot.modules.find((module) => module.id === 'seedlink').observation).toMatch(/active or streaming/);
  });
});
