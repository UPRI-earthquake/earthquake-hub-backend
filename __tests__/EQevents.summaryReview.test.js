jest.mock('../src/models/events.model', () => ({
  findOne: jest.fn(),
  findOneAndUpdate: jest.fn(),
}));

const EQEvents = require('../src/models/events.model');
const EQEventsService = require('../src/services/EQevents.service');

function selectedSummary(summaryOverride) {
  return {
    select: jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue(summaryOverride === undefined
        ? null
        : { summaryOverride }),
    }),
  };
}

describe('earthquake event summary review lifecycle', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('resets edited content to draft and clears prior review evidence', async () => {
    EQEvents.findOneAndUpdate.mockResolvedValue({
      summaryOverride: { text: 'Updated text', reviewStatus: 'draft' },
    });

    await EQEventsService.setEventSummary('event-1', 'Updated text', 'editor');

    expect(EQEvents.findOneAndUpdate).toHaveBeenCalledWith(
      { publicID: 'event-1' },
      { $set: { summaryOverride: expect.objectContaining({
        text: 'Updated text',
        editedBy: 'editor',
        reviewStatus: 'draft',
        reviewStatusChangedBy: 'editor',
      }) } },
      { new: true, runValidators: true },
    );
  });

  it('atomically submits a legacy draft for review', async () => {
    EQEvents.findOneAndUpdate.mockResolvedValue({
      summaryOverride: { text: 'Legacy text', reviewStatus: 'needs_review' },
    });

    const event = await EQEventsService.transitionEventSummaryReview(
      'event-1',
      'draft',
      'needs_review',
      'operator',
    );

    expect(event.summaryOverride.reviewStatus).toBe('needs_review');
    expect(EQEvents.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        publicID: 'event-1',
        $or: expect.arrayContaining([
          { 'summaryOverride.reviewStatus': { $exists: false } },
        ]),
      }),
      expect.objectContaining({
        $set: expect.objectContaining({
          'summaryOverride.reviewStatus': 'needs_review',
          'summaryOverride.submittedBy': 'operator',
        }),
        $unset: {
          'summaryOverride.approvedAt': '',
          'summaryOverride.approvedBy': '',
        },
      }),
      { new: true, runValidators: true },
    );
  });

  it('rejects transitions that skip the review queue', async () => {
    await expect(EQEventsService.transitionEventSummaryReview(
      'event-1',
      'draft',
      'approved',
      'operator',
    )).rejects.toMatchObject({
      code: 'SUMMARY_REVIEW_INVALID_TRANSITION',
      status: 409,
    });
    expect(EQEvents.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('reports an optimistic concurrency conflict with the actual state', async () => {
    EQEvents.findOneAndUpdate.mockResolvedValue(null);
    EQEvents.findOne.mockReturnValue(selectedSummary({
      text: 'Changed elsewhere',
      reviewStatus: 'approved',
    }));

    await expect(EQEventsService.transitionEventSummaryReview(
      'event-1',
      'needs_review',
      'draft',
      'operator',
    )).rejects.toMatchObject({
      code: 'SUMMARY_REVIEW_CONFLICT',
      status: 409,
      message: expect.stringContaining('approved'),
    });
  });
});
