jest.mock('../src/models/events.model', () => ({
  countDocuments: jest.fn(),
  distinct: jest.fn(),
  find: jest.fn(),
}));

const EQEvents = require('../src/models/events.model');
const EQEventsService = require('../src/services/EQevents.service');

describe('Admin earthquake event service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('builds operational event filters without requiring a date range', async () => {
    const queryChain = {
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([]),
    };
    EQEvents.find.mockReturnValue(queryChain);
    EQEvents.countDocuments.mockResolvedValue(0);

    await EQEventsService.getAdminEventQueue({
      minMagnitude: 4,
      recordingStatus: 'partial',
      sourceCatalog: 'upri-current',
    });

    expect(EQEvents.find).toHaveBeenCalledWith({
      magnitude_value: { $gte: 4 },
      recordingAvailabilityStatus: 'partial',
      sourceCatalog: 'upri-current',
    });
  });

  it('uses the combined recording-attention states used by the summary card', async () => {
    const queryChain = {
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([]),
    };
    EQEvents.find.mockReturnValue(queryChain);
    EQEvents.countDocuments.mockResolvedValue(0);

    await EQEventsService.getAdminEventQueue({ recordingAttention: true });

    expect(EQEvents.find).toHaveBeenCalledWith({
      recordingAvailabilityStatus: { $in: ['pending', 'partial', 'unavailable'] },
    });
  });

  it('returns unfiltered operational summary evidence and source facets', async () => {
    EQEvents.countDocuments
      .mockResolvedValueOnce(120)
      .mockResolvedValueOnce(14)
      .mockResolvedValueOnce(8)
      .mockResolvedValueOnce(6)
      .mockResolvedValueOnce(3);
    EQEvents.distinct.mockResolvedValue(['upri-current', null, 'legacy-import']);

    await expect(EQEventsService.getAdminEventSummary()).resolves.toEqual({
      total: 120,
      recentSevenDays: 14,
      customSummaries: 8,
      pendingEnrichment: 6,
      recordingAttention: 3,
      sources: ['legacy-import', 'upri-current'],
    });
  });
});
