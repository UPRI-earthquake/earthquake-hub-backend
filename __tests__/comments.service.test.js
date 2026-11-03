const mockFindEventRef = jest.fn();

jest.mock('../src/repositories/events.repo', () => ({
  findRefById: (...args) => mockFindEventRef(...args),
}));

jest.mock('../src/repositories/comments.repo', () => ({
  create: jest.fn(),
  listVisibleForEvent: jest.fn(),
  findVisible: jest.fn(),
  remove: jest.fn(),
  setStatus: jest.fn(),
  addHelpfulMark: jest.fn(),
  removeHelpfulMark: jest.fn(),
  saveIssueReport: jest.fn(),
}));

// Runs the function with a stand-in transaction
jest.mock('../src/repositories/communityTransactions', () => ({
  withTransaction: jest.fn((fn) => fn('tx')),
  isTransactionUnsupported: jest.fn(() => false),
}));

jest.mock('../src/services/contributions.service', () => ({
  recordReportPosted: jest.fn().mockResolvedValue([]),
  recordHelpfulMarked: jest.fn().mockResolvedValue([]),
  recordIssueSubmitted: jest.fn().mockResolvedValue(null),
}));

const CommentsRepo = require('../src/repositories/comments.repo');
const CommunityTransactions = require('../src/repositories/communityTransactions');
const CommentsService = require('../src/services/comments.service');
const ContributionsService = require('../src/services/contributions.service');

// The event a comment refers to, as EventsRepo.findRefById gives it ({ _id, publicID }), or null
function mockEventLookup(event) {
  mockFindEventRef.mockResolvedValue(event);
}

// A comment as the comments repository returns it
function storedComment(fields = {}) {
  return {
    commentId: 'report-1',
    eventId: '69c217dc9728d1ee7fcb8ea6',
    eventPublicID: 'gfz2025tean',
    accountId: null,
    username: 'Anonymous',
    content: 'Felt shaking.',
    status: 'approved',
    helpfulAccountIds: [],
    issueReports: [],
    createdAt: new Date('2026-06-17T04:00:00.000Z'),
    updatedAt: new Date('2026-06-17T04:00:00.000Z'),
    ...fields,
  };
}

describe('comments.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.COMMENTS_DEFAULT_STATUS = 'approved'; // whatever the developer's .env says
  });

  test('createComment returns null when the event does not exist', async () => {
    mockEventLookup(null);

    const result = await CommentsService.createComment({
      eventId: '69c217dc9728d1ee7fcb8ea6',
      content: 'Missing event.',
    });

    expect(result).toBeNull();
    expect(CommentsRepo.create).not.toHaveBeenCalled();
  });

  test('createComment returns a public comment without account internals', async () => {
    const createdAt = new Date('2026-06-17T01:00:00.000Z');
    mockEventLookup({ _id: '69c217dc9728d1ee7fcb8ea6', publicID: 'gfz2025tean' });
    const saved = storedComment({
      accountId: '69c217dc9728d1ee7fcb8ea5',
      username: 'citizen-user',
      content: 'Felt light shaking.',
      imageURL: '/uploads/report.jpg',
      createdAt,
      updatedAt: createdAt,
    });
    CommentsRepo.create.mockResolvedValue(saved);

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
      updatedAt: createdAt,
    });
    expect(result).not.toHaveProperty('accountId');
    expect(result).not.toHaveProperty('eventId');
    expect(result).not.toHaveProperty('_id');
    expect(CommentsRepo.create).toHaveBeenCalledWith({
      eventId: '69c217dc9728d1ee7fcb8ea6',
      eventPublicID: 'gfz2025tean',
      accountId: '69c217dc9728d1ee7fcb8ea5',
      username: 'citizen-user',
      content: 'Felt light shaking.',
      imageURL: '/uploads/report.jpg',
      status: 'approved',
    }, { tx: 'tx' });
    // In the same transaction as the comment
    expect(ContributionsService.recordReportPosted).toHaveBeenCalledWith({
      accountId: '69c217dc9728d1ee7fcb8ea5',
      comment: saved,
      hasImage: true,
    }, { tx: 'tx' });
  });

  test('createComment leaves out empty content, and posts anonymously without an account', async () => {
    mockEventLookup({ _id: '69c217dc9728d1ee7fcb8ea6', publicID: 'gfz2025tean' });
    CommentsRepo.create.mockResolvedValue(storedComment({ content: undefined, imageURL: '/uploads/only.jpg' }));

    await CommentsService.createComment({ eventId: '69c217dc9728d1ee7fcb8ea6', content: '   ', imageURL: '/uploads/only.jpg' });

    expect(CommentsRepo.create).toHaveBeenCalledWith({
      eventId: '69c217dc9728d1ee7fcb8ea6',
      eventPublicID: 'gfz2025tean',
      accountId: null,
      username: 'Anonymous',
      imageURL: '/uploads/only.jpg',
      status: 'approved',
    }, { tx: 'tx' });
  });

  test("createComment falls back to plain writes on a MongoDB that can't run transactions", async () => {
    mockEventLookup({ _id: '69c217dc9728d1ee7fcb8ea6', publicID: 'gfz2025tean' });
    CommentsRepo.create.mockResolvedValue(storedComment());
    CommunityTransactions.withTransaction.mockRejectedValueOnce(new Error('Transaction numbers are only allowed on a replica set member'));
    CommunityTransactions.isTransactionUnsupported.mockReturnValueOnce(true);

    await CommentsService.createComment({ eventId: '69c217dc9728d1ee7fcb8ea6', content: 'Felt it.' });

    expect(CommentsRepo.create).toHaveBeenCalledWith(expect.objectContaining({ content: 'Felt it.' }), { tx: undefined });
  });

  test("createComment fails when its points can't be written (the transaction undoes the comment)", async () => {
    mockEventLookup({ _id: '69c217dc9728d1ee7fcb8ea6', publicID: 'gfz2025tean' });
    CommentsRepo.create.mockResolvedValue(storedComment({ accountId: '69c217dc9728d1ee7fcb8ea5' }));
    ContributionsService.recordReportPosted.mockRejectedValueOnce(new Error('points write failed'));

    await expect(CommentsService.createComment({ eventId: '69c217dc9728d1ee7fcb8ea6', accountId: '69c217dc9728d1ee7fcb8ea5', content: 'Felt it.' }))
      .rejects.toThrow('points write failed');
  });

  test('getCommentsByEventId returns public comments only', async () => {
    const event = { _id: '69c217dc9728d1ee7fcb8ea6', publicID: 'gfz2025tean' };
    mockEventLookup(event);
    CommentsRepo.listVisibleForEvent.mockResolvedValue({
      comments: [storedComment({ accountId: '69c217dc9728d1ee7fcb8ea5', helpfulAccountIds: ['69c217dc9728d1ee7fcb8ea5'] })],
      hasMore: false,
      total: 1,
    });

    const result = await CommentsService.getCommentsByEventId('69c217dc9728d1ee7fcb8ea6', {
      limit: 20,
      offset: 0,
      viewerAccountId: '69c217dc9728d1ee7fcb8ea5',
    });

    expect(result).toEqual({
      comments: [
        {
          commentId: 'report-1',
          username: 'Anonymous',
          content: 'Felt shaking.',
          helpfulCount: 1,
          viewerHasMarkedHelpful: true,
          createdAt: new Date('2026-06-17T04:00:00.000Z'),
          updatedAt: new Date('2026-06-17T04:00:00.000Z'),
        },
      ],
      total: 1,
      limit: 20,
      offset: 0,
      nextCursor: null,
      hasMore: false,
    });
    expect(CommentsRepo.listVisibleForEvent).toHaveBeenCalledWith(event, { limit: 20, offset: 0, after: null });
  });

  test('getCommentsByEventId returns a next cursor when more reports exist', async () => {
    mockEventLookup({ _id: '69c217dc9728d1ee7fcb8ea6', publicID: 'gfz2025tean' });
    CommentsRepo.listVisibleForEvent.mockResolvedValue({
      comments: [storedComment({ commentId: 'report-2', createdAt: new Date('2026-06-17T03:00:00.000Z') })],
      hasMore: true,
      total: 2,
    });

    const result = await CommentsService.getCommentsByEventId('69c217dc9728d1ee7fcb8ea6', { limit: 1, offset: 0 });

    expect(result.comments.map((comment) => comment.commentId)).toEqual(['report-2']);
    expect(result.hasMore).toBe(true);
    expect(CommentsService.decodePaginationCursor(result.nextCursor)).toEqual({
      createdAt: new Date('2026-06-17T03:00:00.000Z'),
      commentId: 'report-2',
    });
  });

  test('getCommentsByEventId passes a decoded cursor, and ignores the offset with one', async () => {
    mockEventLookup({ _id: '69c217dc9728d1ee7fcb8ea6', publicID: 'gfz2025tean' });
    CommentsRepo.listVisibleForEvent.mockResolvedValue({ comments: [], hasMore: false, total: 0 });
    const cursor = CommentsService.encodePaginationCursor({ createdAt: new Date('2026-06-17T03:00:00.000Z'), commentId: 'report-2' });

    const result = await CommentsService.getCommentsByEventId('69c217dc9728d1ee7fcb8ea6', { limit: 5, offset: 3, cursor });

    expect(CommentsRepo.listVisibleForEvent).toHaveBeenCalledWith(expect.anything(), {
      limit: 5,
      offset: 0,
      after: { createdAt: new Date('2026-06-17T03:00:00.000Z'), commentId: 'report-2' },
    });
    expect(result.offset).toBe(0);
  });

  test('getCommentsByEventId rejects a malformed cursor', async () => {
    mockEventLookup({ _id: '69c217dc9728d1ee7fcb8ea6', publicID: 'gfz2025tean' });

    await expect(CommentsService.getCommentsByEventId('69c217dc9728d1ee7fcb8ea6', { cursor: 'not-a-cursor' }))
      .rejects.toMatchObject({ name: 'ValidationError' });
    expect(CommentsRepo.listVisibleForEvent).not.toHaveBeenCalled();
  });

  test('updateCommentStatus stores moderation metadata', async () => {
    const moderatedAtBefore = Date.now();
    CommentsRepo.setStatus.mockResolvedValue(storedComment({
      accountId: '69c217dc9728d1ee7fcb8ea5',
      status: 'rejected',
      moderatedBy: 'admin-user',
      moderatedAt: new Date('2026-06-17T04:00:00.000Z'),
    }));

    const result = await CommentsService.updateCommentStatus('report-1', 'rejected', 'admin-user');

    expect(CommentsRepo.setStatus).toHaveBeenCalledWith('report-1', {
      status: 'rejected',
      moderatedBy: 'admin-user',
      moderatedAt: expect.any(Date),
    });
    const { moderatedAt } = CommentsRepo.setStatus.mock.calls[0][1];
    expect(moderatedAt.getTime()).toBeGreaterThanOrEqual(moderatedAtBefore);
    expect(result).toEqual(
      expect.objectContaining({
        commentId: 'report-1',
        eventId: '69c217dc9728d1ee7fcb8ea6',
        eventPublicID: 'gfz2025tean',
        accountId: '69c217dc9728d1ee7fcb8ea5',
        status: 'rejected',
        moderatedBy: 'admin-user',
      }),
    );
  });

  test('updateCommentStatus rejects an unknown status without writing', async () => {
    expect(await CommentsService.updateCommentStatus('report-1', 'hidden', 'admin-user')).toEqual({ invalidStatus: true });
    expect(CommentsRepo.setStatus).not.toHaveBeenCalled();
  });

  test('markCommentHelpful adds the viewer account once and returns public counts', async () => {
    const comment = storedComment({ helpfulAccountIds: ['69c217dc9728d1ee7fcb8ea5'] });
    CommentsRepo.addHelpfulMark.mockResolvedValue({ comment, added: true });

    const result = await CommentsService.markCommentHelpful('report-1', '69c217dc9728d1ee7fcb8ea5');

    expect(CommentsRepo.addHelpfulMark).toHaveBeenCalledWith('report-1', '69c217dc9728d1ee7fcb8ea5', { tx: 'tx' });
    expect(result).toEqual(expect.objectContaining({
      commentId: 'report-1',
      helpfulCount: 1,
      viewerHasMarkedHelpful: true,
    }));
    expect(ContributionsService.recordHelpfulMarked).toHaveBeenCalledWith({
      actorAccountId: '69c217dc9728d1ee7fcb8ea5',
      comment,
    }, { tx: 'tx' });
  });

  test('markCommentHelpful returns existing helpful state without scoring duplicates', async () => {
    CommentsRepo.addHelpfulMark.mockResolvedValue({
      comment: storedComment({ helpfulAccountIds: ['69c217dc9728d1ee7fcb8ea5'] }),
      added: false,
    });

    const result = await CommentsService.markCommentHelpful('report-1', '69c217dc9728d1ee7fcb8ea5');

    expect(result).toEqual(expect.objectContaining({
      commentId: 'report-1',
      helpfulCount: 1,
      viewerHasMarkedHelpful: true,
    }));
    expect(ContributionsService.recordHelpfulMarked).not.toHaveBeenCalled();
  });

  test('markCommentHelpful returns null for a hidden or unknown comment', async () => {
    CommentsRepo.addHelpfulMark.mockResolvedValue(null);

    expect(await CommentsService.markCommentHelpful('missing', '69c217dc9728d1ee7fcb8ea5')).toBeNull();
    expect(ContributionsService.recordHelpfulMarked).not.toHaveBeenCalled();
  });

  test('unmarkCommentHelpful removes the viewer account and returns public counts', async () => {
    CommentsRepo.removeHelpfulMark.mockResolvedValue(storedComment());

    const result = await CommentsService.unmarkCommentHelpful('report-1', '69c217dc9728d1ee7fcb8ea5');

    expect(CommentsRepo.removeHelpfulMark).toHaveBeenCalledWith('report-1', '69c217dc9728d1ee7fcb8ea5');
    expect(result).toEqual(expect.objectContaining({
      commentId: 'report-1',
      helpfulCount: 0,
      viewerHasMarkedHelpful: false,
    }));
  });

  test('helpful marks need a signed-in account', async () => {
    expect(await CommentsService.markCommentHelpful('report-1', null)).toEqual({ unauthenticated: true });
    expect(await CommentsService.unmarkCommentHelpful('report-1', null)).toEqual({ unauthenticated: true });
    expect(CommentsRepo.addHelpfulMark).not.toHaveBeenCalled();
    expect(CommentsRepo.removeHelpfulMark).not.toHaveBeenCalled();
  });

  test('reportCommentIssue stores one private issue report per account', async () => {
    const comment = storedComment({
      issueReports: [{ accountId: '69c217dc9728d1ee7fcb8ea5', reason: 'not_related', createdAt: new Date() }],
    });
    CommentsRepo.saveIssueReport.mockResolvedValue(comment);

    const result = await CommentsService.reportCommentIssue('report-1', {
      accountId: '69c217dc9728d1ee7fcb8ea5',
      reason: 'not_related',
    });

    expect(CommentsRepo.saveIssueReport).toHaveBeenCalledWith('report-1', {
      accountId: '69c217dc9728d1ee7fcb8ea5',
      reason: 'not_related',
      createdAt: expect.any(Date),
    }, { tx: 'tx' });
    expect(result).toEqual({
      commentId: 'report-1',
      issueReported: true,
      reason: 'not_related',
    });
    expect(ContributionsService.recordIssueSubmitted).toHaveBeenCalledWith({
      accountId: '69c217dc9728d1ee7fcb8ea5',
      comment,
      reason: 'not_related',
    }, { tx: 'tx' });
  });

  test('reportCommentIssue returns null for a hidden or unknown comment', async () => {
    CommentsRepo.saveIssueReport.mockResolvedValue(null);

    expect(await CommentsService.reportCommentIssue('missing', { accountId: '69c217dc9728d1ee7fcb8ea5', reason: 'unclear' })).toBeNull();
    expect(ContributionsService.recordIssueSubmitted).not.toHaveBeenCalled();
  });

  test('reportCommentIssue rejects unsupported reasons', async () => {
    const result = await CommentsService.reportCommentIssue('report-1', {
      accountId: '69c217dc9728d1ee7fcb8ea5',
      reason: 'downvote',
    });

    expect(result).toEqual({ invalidReason: true });
    expect(CommentsRepo.saveIssueReport).not.toHaveBeenCalled();
  });

  test('deleteComment deletes through the repository', async () => {
    CommentsRepo.remove.mockResolvedValue(storedComment());

    expect(await CommentsService.deleteComment('report-1')).toEqual(expect.objectContaining({ commentId: 'report-1' }));
    expect(CommentsRepo.remove).toHaveBeenCalledWith('report-1');
  });
});
