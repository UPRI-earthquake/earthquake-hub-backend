jest.mock('../src/models/comments.model', () => ({
  findOne: jest.fn(),
  findOneAndUpdate: jest.fn(),
}));

const Comment = require('../src/models/comments.model');
const CommentsService = require('../src/services/comments.service');

function findOneResult(value) {
  return {
    select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(value) }),
  };
}

function report(overrides = {}) {
  return {
    commentId: 'CR-1',
    eventPublicID: 'event-1',
    status: 'pending',
    issueReports: [],
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('community report moderation cases', () => {
  beforeEach(() => jest.clearAllMocks());

  it('derives a legacy pending report as an open version-zero case', async () => {
    Comment.findOne.mockReturnValue(findOneResult(report()));

    await expect(CommentsService.getModerationCase('CR-1')).resolves.toEqual({
      moderationCase: expect.objectContaining({
        reportId: 'CR-1',
        status: 'open',
        version: 0,
        history: [],
      }),
    });
  });

  it('atomically escalates a case and appends bounded history', async () => {
    Comment.findOne.mockReturnValue(findOneResult(report()));
    Comment.findOneAndUpdate.mockResolvedValue(report({
      moderationCase: {
        status: 'escalated',
        version: 1,
        updatedAt: new Date(),
        updatedBy: 'ops-admin',
        history: [{ eventType: 'escalated', reason: 'Potentially harmful content.' }],
      },
    }));

    const result = await CommentsService.transitionModerationCase('CR-1', {
      currentStatus: 'open',
      currentVersion: 0,
      status: 'escalated',
      reason: 'Potentially harmful content.',
    }, { username: 'ops-admin', role: 'operator' }, 'correlation-1');

    expect(result.moderationCase).toMatchObject({ status: 'escalated', version: 1 });
    expect(Comment.findOneAndUpdate).toHaveBeenCalledWith(
      {
        commentId: 'CR-1',
        'moderationCase.version': { $exists: false },
        updatedAt: new Date('2026-08-01T00:00:00.000Z'),
      },
      expect.objectContaining({
        $set: {
          moderationCase: expect.objectContaining({
            status: 'escalated',
            version: 1,
            historyCount: 1,
            history: [expect.objectContaining({
              correlationId: 'correlation-1',
              eventType: 'escalated',
              reason: 'Potentially harmful content.',
            })],
          }),
        },
      }),
      { new: true, runValidators: true },
    );
  });

  it('resolves the case in the same update as an approval decision', async () => {
    const existing = report({
      moderationCase: {
        status: 'investigating', version: 2, history: [], updatedAt: new Date(),
      },
    });
    Comment.findOne.mockReturnValue(findOneResult(existing));
    Comment.findOneAndUpdate.mockResolvedValue(report({
      status: 'approved',
      moderationCase: {
        status: 'resolved', version: 3, history: [{ eventType: 'decision' }], updatedAt: new Date(),
      },
    }));

    const result = await CommentsService.moderateAdminComment('CR-1', {
      currentStatus: 'pending',
      currentCaseStatus: 'investigating',
      currentCaseVersion: 2,
      status: 'approved',
      reason: 'Verified against event evidence.',
    }, { username: 'ops-admin' }, 'correlation-2');

    expect(result.report.status).toBe('approved');
    expect(result.moderationCase.status).toBe('resolved');
    expect(Comment.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ commentId: 'CR-1', status: 'pending', 'moderationCase.version': 2 }),
      expect.objectContaining({
        $set: expect.objectContaining({
          status: 'approved',
          'moderationCase.status': 'resolved',
          'moderationCase.version': 3,
          'moderationCase.historyCount': 1,
        }),
      }),
      { new: true, runValidators: true },
    );
  });

  it('fails closed when the operator acts on a stale case version', async () => {
    Comment.findOne.mockReturnValue(findOneResult(report({
      moderationCase: { status: 'escalated', version: 4, history: [], updatedAt: new Date() },
    })));

    await expect(CommentsService.transitionModerationCase('CR-1', {
      currentStatus: 'investigating',
      currentVersion: 3,
      status: 'resolved',
      reason: 'Stale resolution.',
    }, { username: 'ops-admin' })).resolves.toMatchObject({ error: 'conflict' });
    expect(Comment.findOneAndUpdate).not.toHaveBeenCalled();
  });
});
