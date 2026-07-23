jest.mock('../src/models/comments.model', () => ({
  countDocuments: jest.fn(),
  find: jest.fn(),
}));

const Comment = require('../src/models/comments.model');
const CommentsService = require('../src/services/comments.service');

function queueChain(comments = []) {
  return {
    sort: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(comments),
  };
}

describe('Admin community report service', () => {
  beforeEach(() => jest.clearAllMocks());

  it('combines no-image and search filters without losing either condition', async () => {
    Comment.find.mockReturnValue(queueChain());
    Comment.countDocuments.mockResolvedValue(0);

    await CommentsService.getAdminModerationQueue({ hasImage: false, search: 'Batangas' });

    const query = Comment.find.mock.calls[0][0];
    expect(query.$and).toHaveLength(2);
    expect(query.$and[0].$or).toEqual([
      { imageURL: { $exists: false } }, { imageURL: '' }, { imageURL: null },
    ]);
    expect(query.$and[1].$or).toHaveLength(4);
  });

  it('returns issue reasons as counts without exposing reporter account identifiers', async () => {
    Comment.find.mockReturnValue(queueChain([{
      commentId: 'CR-1',
      issueReports: [
        { accountId: 'private-1', reason: 'duplicate' },
        { accountId: 'private-2', reason: 'duplicate' },
        { accountId: 'private-3', reason: 'wrong_location' },
      ],
    }]));
    Comment.countDocuments.mockResolvedValue(1);

    const result = await CommentsService.getAdminModerationQueue();

    expect(result.comments[0].issueReasons).toEqual({ duplicate: 2, wrong_location: 1 });
    expect(result.comments[0]).not.toHaveProperty('issueReports');
  });

  it('returns unfiltered moderation summary evidence', async () => {
    Comment.countDocuments
      .mockResolvedValueOnce(30)
      .mockResolvedValueOnce(8)
      .mockResolvedValueOnce(17)
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(12)
      .mockResolvedValueOnce(6);

    await expect(CommentsService.getAdminModerationSummary()).resolves.toEqual({
      total: 30, pending: 8, approved: 17, rejected: 5, withImages: 12, withIssues: 6,
    });
  });
});
