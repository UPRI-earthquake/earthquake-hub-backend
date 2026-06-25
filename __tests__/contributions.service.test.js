jest.mock('../src/models/contributionEvent.model', () => ({
  findOneAndUpdate: jest.fn(),
}));

const ContributionEvent = require('../src/models/contributionEvent.model');
const ContributionsService = require('../src/services/contributions.service');

describe('contributions.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    ContributionEvent.findOneAndUpdate.mockImplementation((query, update) => Promise.resolve({
      ...update.$setOnInsert,
      _id: 'contribution-event-id',
    }));
  });

  test('recordContribution stores an idempotent contribution event with default points', async () => {
    const result = await ContributionsService.recordContribution({
      accountId: '69c217dc9728d1ee7fcb8ea5',
      actionType: ContributionsService.CONTRIBUTION_ACTION.REPORT_POSTED,
      targetType: 'comment',
      targetId: 'report-1',
      eventId: '69c217dc9728d1ee7fcb8ea6',
      eventPublicID: 'gfz2025tean',
    });

    expect(ContributionEvent.findOneAndUpdate).toHaveBeenCalledWith(
      { dedupeKey: '69c217dc9728d1ee7fcb8ea5:report_posted:comment:report-1' },
      {
        $setOnInsert: expect.objectContaining({
          accountId: '69c217dc9728d1ee7fcb8ea5',
          actionType: 'report_posted',
          points: 5,
          targetId: 'report-1',
          eventPublicID: 'gfz2025tean',
        }),
      },
      {
        new: true,
        setDefaultsOnInsert: true,
        upsert: true,
      },
    );
    expect(result).toEqual(expect.objectContaining({
      actionType: 'report_posted',
      points: 5,
    }));
  });

  test('recordReportPosted awards both report and image report events for image posts', async () => {
    await ContributionsService.recordReportPosted({
      accountId: '69c217dc9728d1ee7fcb8ea5',
      hasImage: true,
      comment: {
        commentId: 'report-1',
        eventId: '69c217dc9728d1ee7fcb8ea6',
        eventPublicID: 'gfz2025tean',
      },
    });

    expect(ContributionEvent.findOneAndUpdate).toHaveBeenCalledTimes(2);
    expect(ContributionEvent.findOneAndUpdate.mock.calls[0][1].$setOnInsert).toEqual(
      expect.objectContaining({ actionType: 'report_posted', points: 5 }),
    );
    expect(ContributionEvent.findOneAndUpdate.mock.calls[1][1].$setOnInsert).toEqual(
      expect.objectContaining({ actionType: 'image_report_posted', points: 8 }),
    );
  });

  test('recordHelpfulMarked awards the voter and report author when accounts differ', async () => {
    await ContributionsService.recordHelpfulMarked({
      actorAccountId: '69c217dc9728d1ee7fcb8ea5',
      comment: {
        commentId: 'report-1',
        accountId: '69c217dc9728d1ee7fcb8ea7',
        eventId: '69c217dc9728d1ee7fcb8ea6',
        eventPublicID: 'gfz2025tean',
      },
    });

    expect(ContributionEvent.findOneAndUpdate).toHaveBeenCalledTimes(2);
    expect(ContributionEvent.findOneAndUpdate.mock.calls[0][1].$setOnInsert).toEqual(
      expect.objectContaining({
        accountId: '69c217dc9728d1ee7fcb8ea5',
        actionType: 'report_marked_helpful',
        points: 1,
      }),
    );
    expect(ContributionEvent.findOneAndUpdate.mock.calls[1][1].$setOnInsert).toEqual(
      expect.objectContaining({
        accountId: '69c217dc9728d1ee7fcb8ea7',
        actionType: 'report_received_helpful',
        points: 2,
      }),
    );
  });

  test('recordHelpfulMarked skips scoring self-helpful marks', async () => {
    const result = await ContributionsService.recordHelpfulMarked({
      actorAccountId: '69c217dc9728d1ee7fcb8ea5',
      comment: {
        commentId: 'report-1',
        accountId: '69c217dc9728d1ee7fcb8ea5',
      },
    });

    expect(result).toEqual([]);
    expect(ContributionEvent.findOneAndUpdate).not.toHaveBeenCalled();
  });

  test('recordIssueSubmitted stores a zero-point moderation signal', async () => {
    await ContributionsService.recordIssueSubmitted({
      accountId: '69c217dc9728d1ee7fcb8ea5',
      reason: 'not_related',
      comment: {
        commentId: 'report-1',
        eventId: '69c217dc9728d1ee7fcb8ea6',
      },
    });

    expect(ContributionEvent.findOneAndUpdate).toHaveBeenCalledWith(
      { dedupeKey: '69c217dc9728d1ee7fcb8ea5:report_issue_submitted:comment:report-1' },
      {
        $setOnInsert: expect.objectContaining({
          actionType: 'report_issue_submitted',
          points: 0,
          reason: 'not_related',
        }),
      },
      expect.any(Object),
    );
  });
});
