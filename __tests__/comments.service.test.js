const mockEventFindById = jest.fn();
let mockSaveResult;

jest.mock('../src/models/events.model', () => ({
  findById: (...args) => mockEventFindById(...args),
}));

jest.mock('../src/models/comments.model', () => {
  const MockComment = jest.fn(function MockComment(doc) {
    Object.assign(this, doc);
    this.commentId = this.commentId || 'generated-comment-id';
    this.createdAt = this.createdAt || new Date('2026-06-17T00:00:00.000Z');
    this.updatedAt = this.updatedAt || new Date('2026-06-17T00:00:00.000Z');
    this.save = jest.fn().mockImplementation(() => Promise.resolve(mockSaveResult || this));
  });

  MockComment.find = jest.fn();
  MockComment.countDocuments = jest.fn();
  MockComment.findOneAndDelete = jest.fn();
  MockComment.findOneAndUpdate = jest.fn();
  MockComment.findOne = jest.fn();

  return MockComment;
});

const Comment = require('../src/models/comments.model');
const CommentsService = require('../src/services/comments.service');

function mockEventLookup(event) {
  const chain = {
    select: jest.fn(() => chain),
    lean: jest.fn(() => Promise.resolve(event)),
  };
  mockEventFindById.mockReturnValue(chain);
  return chain;
}

function createFindChain(result) {
  const chain = {
    sort: jest.fn(() => chain),
    skip: jest.fn(() => chain),
    limit: jest.fn(() => chain),
    select: jest.fn(() => chain),
    lean: jest.fn(() => Promise.resolve(result)),
  };
  return chain;
}

function createSelectChain(result) {
  return {
    select: jest.fn(() => Promise.resolve(result)),
  };
}

describe('comments.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSaveResult = undefined;
  });

  test('createComment returns null when the event does not exist', async () => {
    mockEventLookup(null);

    const result = await CommentsService.createComment({
      eventId: '69c217dc9728d1ee7fcb8ea6',
      content: 'Missing event.',
    });

    expect(result).toBeNull();
    expect(Comment).not.toHaveBeenCalled();
  });

  test('createComment returns a public comment without account internals', async () => {
    const createdAt = new Date('2026-06-17T01:00:00.000Z');
    const updatedAt = new Date('2026-06-17T01:00:00.000Z');
    mockEventLookup({ _id: '69c217dc9728d1ee7fcb8ea6', publicID: 'gfz2025tean' });
    mockSaveResult = {
      commentId: 'report-1',
      eventId: '69c217dc9728d1ee7fcb8ea6',
      eventPublicID: 'gfz2025tean',
        accountId: '69c217dc9728d1ee7fcb8ea5',
        username: 'citizen-user',
        content: 'Felt light shaking.',
        imageURL: '/uploads/report.jpg',
        helpfulAccountIds: [],
        status: 'approved',
        createdAt,
        updatedAt,
        toObject() {
        return this;
      },
    };

    const result = await CommentsService.createComment({
      eventId: '69c217dc9728d1ee7fcb8ea6',
      accountId: '69c217dc9728d1ee7fcb8ea5',
      username: 'citizen-user',
      content: ' Felt light shaking. ',
      imageURL: '/uploads/report.jpg',
    });

    expect(result).toEqual({
      commentId: 'report-1',
      username: 'citizen-user',
      content: 'Felt light shaking.',
      imageURL: '/uploads/report.jpg',
      helpfulCount: 0,
      viewerHasMarkedHelpful: false,
      status: 'approved',
      createdAt,
      updatedAt,
    });
    expect(result).not.toHaveProperty('accountId');
    expect(result).not.toHaveProperty('eventId');
    expect(result).not.toHaveProperty('_id');
    expect(Comment).toHaveBeenCalledWith(expect.objectContaining({
      eventId: '69c217dc9728d1ee7fcb8ea6',
      eventPublicID: 'gfz2025tean',
    }));
  });

  test('getCommentsByEventId returns public comments only', async () => {
    const createdAt = new Date('2026-06-17T02:00:00.000Z');
    const updatedAt = new Date('2026-06-17T02:00:00.000Z');
    mockEventLookup({ _id: '69c217dc9728d1ee7fcb8ea6', publicID: 'gfz2025tean' });
    Comment.find.mockReturnValue(createFindChain([
      {
        commentId: 'report-1',
        _id: 'internal-id',
        eventId: '69c217dc9728d1ee7fcb8ea6',
        accountId: '69c217dc9728d1ee7fcb8ea5',
        username: 'Anonymous',
        content: 'Felt shaking.',
        helpfulAccountIds: ['69c217dc9728d1ee7fcb8ea5'],
        status: 'approved',
        createdAt,
        updatedAt,
      },
    ]));
    Comment.countDocuments.mockResolvedValue(1);

    const result = await CommentsService.getCommentsByEventId('69c217dc9728d1ee7fcb8ea6', {
      limit: 20,
      offset: 0,
      viewerAccountId: '69c217dc9728d1ee7fcb8ea5',
    });

    expect(result.comments).toEqual([
      {
        commentId: 'report-1',
        username: 'Anonymous',
        content: 'Felt shaking.',
        helpfulCount: 1,
        viewerHasMarkedHelpful: true,
        createdAt,
        updatedAt,
      },
    ]);
    expect(result.comments[0]).not.toHaveProperty('accountId');
    expect(result.comments[0]).not.toHaveProperty('eventId');
    expect(result.comments[0]).not.toHaveProperty('_id');
    expect(result.hasMore).toBe(false);
    expect(result.nextCursor).toBeNull();
    expect(Comment.find).toHaveBeenCalledWith({
      $and: [
        {
          $or: [
            { eventId: '69c217dc9728d1ee7fcb8ea6' },
            { eventPublicID: 'gfz2025tean' },
          ],
        },
        {
          $or: [
            { status: 'approved' },
            { status: { $exists: false } },
          ],
        },
      ],
    });
  });

  test('getCommentsByEventId returns a next cursor when more reports exist', async () => {
    mockEventLookup({ _id: '69c217dc9728d1ee7fcb8ea6', publicID: 'gfz2025tean' });
    Comment.find.mockReturnValue(createFindChain([
      {
        commentId: 'report-2',
        username: 'Anonymous',
        content: 'Second report.',
        createdAt: new Date('2026-06-17T03:00:00.000Z'),
        updatedAt: new Date('2026-06-17T03:00:00.000Z'),
      },
      {
        commentId: 'report-1',
        username: 'Anonymous',
        content: 'First report.',
        createdAt: new Date('2026-06-17T02:00:00.000Z'),
        updatedAt: new Date('2026-06-17T02:00:00.000Z'),
      },
    ]));
    Comment.countDocuments.mockResolvedValue(2);

    const result = await CommentsService.getCommentsByEventId('69c217dc9728d1ee7fcb8ea6', {
      limit: 1,
      offset: 0,
    });

    expect(result.comments).toHaveLength(1);
    expect(result.comments[0].commentId).toBe('report-2');
    expect(result.hasMore).toBe(true);
    expect(result.nextCursor).toEqual(expect.any(String));
  });

  test('updateCommentStatus stores moderation metadata', async () => {
    const moderatedAtBefore = Date.now();
    Comment.findOneAndUpdate.mockResolvedValue({
      commentId: 'report-1',
      eventId: '69c217dc9728d1ee7fcb8ea6',
      accountId: '69c217dc9728d1ee7fcb8ea5',
      username: 'Anonymous',
      content: 'Felt shaking.',
      status: 'rejected',
      moderatedBy: 'admin-user',
      moderatedAt: new Date('2026-06-17T04:00:00.000Z'),
    });

    const result = await CommentsService.updateCommentStatus('report-1', 'rejected', 'admin-user');

    expect(Comment.findOneAndUpdate).toHaveBeenCalledWith(
      { commentId: 'report-1' },
      expect.objectContaining({
        $set: expect.objectContaining({
          status: 'rejected',
          moderatedBy: 'admin-user',
          moderatedAt: expect.any(Date),
        }),
      }),
      { new: true },
    );
    const moderatedAt = Comment.findOneAndUpdate.mock.calls[0][1].$set.moderatedAt.getTime();
    expect(moderatedAt).toBeGreaterThanOrEqual(moderatedAtBefore);
    expect(result).toEqual(
      expect.objectContaining({
        commentId: 'report-1',
        accountId: '69c217dc9728d1ee7fcb8ea5',
        status: 'rejected',
        moderatedBy: 'admin-user',
      }),
    );
  });

  test('markCommentHelpful adds the viewer account once and returns public counts', async () => {
    const updatedComment = {
      commentId: 'report-1',
      username: 'Anonymous',
      content: 'Felt shaking.',
      helpfulAccountIds: ['69c217dc9728d1ee7fcb8ea5'],
      createdAt: new Date('2026-06-17T04:00:00.000Z'),
      updatedAt: new Date('2026-06-17T04:00:00.000Z'),
    };
    Comment.findOneAndUpdate.mockReturnValue(createSelectChain(updatedComment));

    const result = await CommentsService.markCommentHelpful('report-1', '69c217dc9728d1ee7fcb8ea5');

    expect(Comment.findOneAndUpdate).toHaveBeenCalledWith(
      {
        commentId: 'report-1',
        $or: [
          { status: 'approved' },
          { status: { $exists: false } },
        ],
      },
      { $addToSet: { helpfulAccountIds: '69c217dc9728d1ee7fcb8ea5' } },
      { new: true },
    );
    expect(result).toEqual(expect.objectContaining({
      commentId: 'report-1',
      helpfulCount: 1,
      viewerHasMarkedHelpful: true,
    }));
  });

  test('unmarkCommentHelpful removes the viewer account and returns public counts', async () => {
    const updatedComment = {
      commentId: 'report-1',
      username: 'Anonymous',
      content: 'Felt shaking.',
      helpfulAccountIds: [],
      createdAt: new Date('2026-06-17T04:00:00.000Z'),
      updatedAt: new Date('2026-06-17T04:00:00.000Z'),
    };
    Comment.findOneAndUpdate.mockReturnValue(createSelectChain(updatedComment));

    const result = await CommentsService.unmarkCommentHelpful('report-1', '69c217dc9728d1ee7fcb8ea5');

    expect(Comment.findOneAndUpdate).toHaveBeenCalledWith(
      {
        commentId: 'report-1',
        $or: [
          { status: 'approved' },
          { status: { $exists: false } },
        ],
      },
      { $pull: { helpfulAccountIds: '69c217dc9728d1ee7fcb8ea5' } },
      { new: true },
    );
    expect(result).toEqual(expect.objectContaining({
      commentId: 'report-1',
      helpfulCount: 0,
      viewerHasMarkedHelpful: false,
    }));
  });

  test('reportCommentIssue stores one private issue report per account', async () => {
    const comment = {
      commentId: 'report-1',
      issueReports: [],
      save: jest.fn().mockResolvedValue(undefined),
    };
    Comment.findOne.mockResolvedValue(comment);

    const result = await CommentsService.reportCommentIssue('report-1', {
      accountId: '69c217dc9728d1ee7fcb8ea5',
      reason: 'not_related',
    });

    expect(Comment.findOne).toHaveBeenCalledWith({
      commentId: 'report-1',
      $or: [
        { status: 'approved' },
        { status: { $exists: false } },
      ],
    });
    expect(comment.issueReports).toHaveLength(1);
    expect(comment.issueReports[0]).toEqual(expect.objectContaining({
      accountId: '69c217dc9728d1ee7fcb8ea5',
      reason: 'not_related',
      createdAt: expect.any(Date),
    }));
    expect(comment.save).toHaveBeenCalled();
    expect(result).toEqual({
      commentId: 'report-1',
      issueReported: true,
      reason: 'not_related',
    });
  });

  test('reportCommentIssue updates an existing issue from the same account', async () => {
    const existingIssue = {
      accountId: '69c217dc9728d1ee7fcb8ea5',
      reason: 'unclear',
      createdAt: new Date('2026-06-17T01:00:00.000Z'),
    };
    const comment = {
      commentId: 'report-1',
      issueReports: [existingIssue],
      save: jest.fn().mockResolvedValue(undefined),
    };
    Comment.findOne.mockResolvedValue(comment);

    const result = await CommentsService.reportCommentIssue('report-1', {
      accountId: '69c217dc9728d1ee7fcb8ea5',
      reason: 'duplicate',
    });

    expect(comment.issueReports).toHaveLength(1);
    expect(existingIssue.reason).toBe('duplicate');
    expect(existingIssue.createdAt).toEqual(expect.any(Date));
    expect(result).toEqual(expect.objectContaining({
      commentId: 'report-1',
      issueReported: true,
      reason: 'duplicate',
    }));
  });

  test('reportCommentIssue rejects unsupported reasons', async () => {
    const result = await CommentsService.reportCommentIssue('report-1', {
      accountId: '69c217dc9728d1ee7fcb8ea5',
      reason: 'downvote',
    });

    expect(result).toEqual({ invalidReason: true });
    expect(Comment.findOne).not.toHaveBeenCalled();
  });
});
