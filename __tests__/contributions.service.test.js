jest.mock('../src/repositories/contributions.repo', () => ({
  recordOnce: jest.fn(),
}));

const ContributionsRepo = require('../src/repositories/contributions.repo');
const ContributionsService = require('../src/services/contributions.service');

describe('contributions.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    ContributionsRepo.recordOnce.mockImplementation((entry) => Promise.resolve({
      ...entry,
      createdAt: new Date('2026-06-17T00:00:00.000Z'),
      updatedAt: new Date('2026-06-17T00:00:00.000Z'),
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

    expect(ContributionsRepo.recordOnce).toHaveBeenCalledWith(expect.objectContaining({
      dedupeKey: '69c217dc9728d1ee7fcb8ea5:report_posted:comment:report-1',
      accountId: '69c217dc9728d1ee7fcb8ea5',
      actionType: 'report_posted',
      points: 5,
      targetId: 'report-1',
      eventId: '69c217dc9728d1ee7fcb8ea6',
      eventPublicID: 'gfz2025tean',
    }), { tx: undefined });
    expect(result).toEqual(expect.objectContaining({
      actionType: 'report_posted',
      points: 5,
    }));
  });

  test('writes in the transaction it is given, one entry after the other', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    ContributionsRepo.recordOnce.mockImplementation(async (entry) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setImmediate(resolve));
      inFlight -= 1;
      return entry;
    });

    await ContributionsService.recordHelpfulMarked({
      actorAccountId: '69c217dc9728d1ee7fcb8ea5',
      comment: { commentId: 'report-1', accountId: '69c217dc9728d1ee7fcb8ea7' },
    }, { tx: 'tx' });

    expect(ContributionsRepo.recordOnce.mock.calls.map((call) => call[1])).toEqual([{ tx: 'tx' }, { tx: 'tx' }]);
    expect(maxInFlight).toBe(1);
  });

  test('recordContribution skips entries without an account or action', async () => {
    expect(await ContributionsService.recordContribution({ actionType: 'report_posted' })).toBeNull();
    expect(await ContributionsService.recordContribution({ accountId: '69c217dc9728d1ee7fcb8ea5' })).toBeNull();
    expect(ContributionsRepo.recordOnce).not.toHaveBeenCalled();
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

    expect(ContributionsRepo.recordOnce).toHaveBeenCalledTimes(2);
    expect(ContributionsRepo.recordOnce.mock.calls[0][0]).toEqual(
      expect.objectContaining({ actionType: 'report_posted', points: 5 }),
    );
    expect(ContributionsRepo.recordOnce.mock.calls[1][0]).toEqual(
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

    expect(ContributionsRepo.recordOnce).toHaveBeenCalledTimes(2);
    expect(ContributionsRepo.recordOnce.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        accountId: '69c217dc9728d1ee7fcb8ea5',
        actionType: 'report_marked_helpful',
        points: 1,
      }),
    );
    expect(ContributionsRepo.recordOnce.mock.calls[1][0]).toEqual(
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
    expect(ContributionsRepo.recordOnce).not.toHaveBeenCalled();
  });

  test('recordHelpfulMarked awards only the voter on an anonymous report', async () => {
    await ContributionsService.recordHelpfulMarked({
      actorAccountId: '69c217dc9728d1ee7fcb8ea5',
      comment: { commentId: 'report-1', accountId: null },
    });

    expect(ContributionsRepo.recordOnce).toHaveBeenCalledTimes(1);
    expect(ContributionsRepo.recordOnce.mock.calls[0][0]).toEqual(expect.objectContaining({ actionType: 'report_marked_helpful' }));
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

    expect(ContributionsRepo.recordOnce).toHaveBeenCalledWith(expect.objectContaining({
      dedupeKey: '69c217dc9728d1ee7fcb8ea5:report_issue_submitted:comment:report-1',
      actionType: 'report_issue_submitted',
      points: 0,
      reason: 'not_related',
    }), { tx: undefined });
  });
});
