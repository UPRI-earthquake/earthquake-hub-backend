jest.mock('../src/models/events.model', () => ({
  countDocuments: jest.fn(),
  distinct: jest.fn(),
  find: jest.fn(),
}));
jest.mock('../src/models/comments.model', () => ({
  aggregate: jest.fn(),
}));

const EQEvents = require('../src/models/events.model');
const Comment = require('../src/models/comments.model');
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

  it('adds event-specific community-report and pending-review counts', async () => {
    const queryChain = {
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([
        { publicID: 'event-1' },
        { publicID: 'event-2' },
      ]),
    };
    EQEvents.find.mockReturnValue(queryChain);
    EQEvents.countDocuments.mockResolvedValue(2);
    Comment.aggregate.mockResolvedValue([{ _id: 'event-1', total: 3, pending: 2 }]);

    await expect(EQEventsService.getAdminEventQueue()).resolves.toMatchObject({
      events: [
        { publicID: 'event-1', communityReports: { total: 3, pending: 2 } },
        { publicID: 'event-2', communityReports: { total: 0, pending: 0 } },
      ],
    });
    expect(Comment.aggregate).toHaveBeenCalledWith([
      { $match: { eventPublicID: { $in: ['event-1', 'event-2'] } } },
      {
        $group: {
          _id: '$eventPublicID',
          total: { $sum: 1 },
          pending: { $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] } },
        },
      },
    ]);
  });

  it('returns unfiltered operational summary evidence and source facets', async () => {
    EQEvents.countDocuments
      .mockResolvedValueOnce(120)
      .mockResolvedValueOnce(14)
      .mockResolvedValueOnce(8)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(4)
      .mockResolvedValueOnce(6)
      .mockResolvedValueOnce(3);
    EQEvents.distinct.mockResolvedValue(['upri-current', null, 'legacy-import']);

    await expect(EQEventsService.getAdminEventSummary()).resolves.toEqual({
      total: 120,
      recentSevenDays: 14,
      customSummaries: 8,
      summariesNeedingReview: 2,
      approvedSummaries: 4,
      pendingEnrichment: 6,
      recordingAttention: 3,
      sources: ['legacy-import', 'upri-current'],
    });
  });

  it('treats legacy custom summaries without a review state as drafts', () => {
    expect(EQEventsService._test.currentSummaryReviewStatus({ text: 'Legacy summary' }))
      .toBe('draft');
    expect(EQEventsService._test.currentSummaryReviewStatus(null)).toBe('none');
  });

  it('filters the review queue while including legacy drafts', async () => {
    const queryChain = {
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([]),
    };
    EQEvents.find.mockReturnValue(queryChain);
    EQEvents.countDocuments.mockResolvedValue(0);

    await EQEventsService.getAdminEventQueue({ summaryReviewStatus: 'draft' });

    expect(EQEvents.find).toHaveBeenCalledWith({
      'summaryOverride.text': { $exists: true, $ne: '' },
      $or: [
        { 'summaryOverride.reviewStatus': 'draft' },
        { 'summaryOverride.reviewStatus': { $exists: false } },
        { 'summaryOverride.reviewStatus': null },
      ],
    });
  });
});
