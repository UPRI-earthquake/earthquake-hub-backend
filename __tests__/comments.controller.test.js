const CommentsController = require('../src/controllers/comments.controller');
const CommentsService = require('../src/services/comments.service');

jest.mock('../src/services/comments.service');

CommentsService.COMMENT_STATUS = {
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
};
CommentsService.COMMENT_ISSUE_REASON = {
  DUPLICATE: 'duplicate',
  UNCLEAR: 'unclear',
  WRONG_LOCATION: 'wrong_location',
  NOT_RELATED: 'not_related',
  INAPPROPRIATE: 'inappropriate',
};

function createMockResponse() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('comments.controller getCommentsByEventId', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns paginated comments for an existing event', async () => {
    const req = {
      query: {
        eventId: '69c217dc9728d1ee7fcb8ea5',
      },
    };
    const res = createMockResponse();
    const next = jest.fn();

    CommentsService.getCommentsByEventId.mockResolvedValue({
      comments: [{ content: 'test comment' }],
      total: 1,
      limit: 20,
      offset: 0,
    });

    await CommentsController.getCommentsByEventId(req, res, next);

    expect(CommentsService.getCommentsByEventId).toHaveBeenCalledWith(
      '69c217dc9728d1ee7fcb8ea5',
      { limit: 20, offset: 0, cursor: '', viewerAccountId: null },
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Comments retrieved successfully',
        payload: [{ content: 'test comment' }],
        pagination: {
          total: 1,
          limit: 20,
          offset: 0,
          nextCursor: null,
          hasMore: false,
        },
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  test('returns 404 when event does not exist', async () => {
    const req = {
      query: {
        eventId: '69c217dc9728d1ee7fcb8ea5',
        limit: 10,
        offset: 0,
      },
    };
    const res = createMockResponse();
    const next = jest.fn();

    CommentsService.getCommentsByEventId.mockResolvedValue(null);

    await CommentsController.getCommentsByEventId(req, res, next);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Event not found',
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });
});

describe('comments.controller report interactions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('requires sign in before marking a report helpful', async () => {
    const req = {
      params: { commentId: 'report-1' },
    };
    const res = createMockResponse();
    const next = jest.fn();

    await CommentsController.markCommentHelpful(req, res, next);

    expect(CommentsService.markCommentHelpful).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      message: 'Sign in to interact with reports.',
    }));
    expect(next).not.toHaveBeenCalled();
  });

  test('marks a report helpful for an authenticated citizen', async () => {
    const req = {
      params: { commentId: 'report-1' },
      accountId: '69c217dc9728d1ee7fcb8ea5',
      username: 'citizen-user',
    };
    const res = createMockResponse();
    const next = jest.fn();
    CommentsService.markCommentHelpful.mockResolvedValue({
      commentId: 'report-1',
      helpfulCount: 1,
      viewerHasMarkedHelpful: true,
    });

    await CommentsController.markCommentHelpful(req, res, next);

    expect(CommentsService.markCommentHelpful).toHaveBeenCalledWith('report-1', '69c217dc9728d1ee7fcb8ea5');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      message: 'Report marked helpful',
      payload: expect.objectContaining({
        helpfulCount: 1,
        viewerHasMarkedHelpful: true,
      }),
    }));
    expect(next).not.toHaveBeenCalled();
  });

  test('removes a helpful mark for an authenticated citizen', async () => {
    const req = {
      params: { commentId: 'report-1' },
      accountId: '69c217dc9728d1ee7fcb8ea5',
      username: 'citizen-user',
    };
    const res = createMockResponse();
    const next = jest.fn();
    CommentsService.unmarkCommentHelpful.mockResolvedValue({
      commentId: 'report-1',
      helpfulCount: 0,
      viewerHasMarkedHelpful: false,
    });

    await CommentsController.unmarkCommentHelpful(req, res, next);

    expect(CommentsService.unmarkCommentHelpful).toHaveBeenCalledWith('report-1', '69c217dc9728d1ee7fcb8ea5');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      message: 'Report helpful mark removed',
    }));
    expect(next).not.toHaveBeenCalled();
  });

  test('submits a private issue report for an authenticated citizen', async () => {
    const req = {
      params: { commentId: 'report-1' },
      body: { reason: 'not_related' },
      accountId: '69c217dc9728d1ee7fcb8ea5',
      username: 'citizen-user',
    };
    const res = createMockResponse();
    const next = jest.fn();
    CommentsService.reportCommentIssue.mockResolvedValue({
      commentId: 'report-1',
      issueReported: true,
      reason: 'not_related',
    });

    await CommentsController.reportCommentIssue(req, res, next);

    expect(CommentsService.reportCommentIssue).toHaveBeenCalledWith('report-1', {
      accountId: '69c217dc9728d1ee7fcb8ea5',
      reason: 'not_related',
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      message: 'Report issue submitted',
      payload: expect.objectContaining({
        issueReported: true,
        reason: 'not_related',
      }),
    }));
    expect(next).not.toHaveBeenCalled();
  });

  test('rejects invalid issue reasons before calling the service', async () => {
    const req = {
      params: { commentId: 'report-1' },
      body: { reason: 'not_helpful' },
      accountId: '69c217dc9728d1ee7fcb8ea5',
      username: 'citizen-user',
    };
    const res = createMockResponse();
    const next = jest.fn();

    await CommentsController.reportCommentIssue(req, res, next);

    expect(CommentsService.reportCommentIssue).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({
      name: 'ValidationError',
    }));
  });
});

describe('comments.controller updateCommentStatus', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('updates moderation status for an existing comment', async () => {
    const req = {
      params: { commentId: 'report-1' },
      body: { status: 'rejected' },
      username: 'admin-user',
    };
    const res = createMockResponse();
    const next = jest.fn();

    CommentsService.updateCommentStatus.mockResolvedValue({
      commentId: 'report-1',
      username: 'Anonymous',
      status: 'rejected',
    });

    await CommentsController.updateCommentStatus(req, res, next);

    expect(CommentsService.updateCommentStatus).toHaveBeenCalledWith(
      'report-1',
      'rejected',
      'admin-user',
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Comment status updated successfully',
        payload: expect.objectContaining({ status: 'rejected' }),
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  test('rejects invalid moderation statuses', async () => {
    const req = {
      params: { commentId: 'report-1' },
      body: { status: 'hidden' },
      username: 'admin-user',
    };
    const res = createMockResponse();
    const next = jest.fn();

    await CommentsController.updateCommentStatus(req, res, next);

    expect(CommentsService.updateCommentStatus).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'ValidationError',
      }),
    );
  });
});

describe('comments.controller createComment', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('posts anonymously by default even when request is authenticated', async () => {
    const req = {
      isAuthenticated: true,
      accountId: '69c217dc9728d1ee7fcb8ea5',
      username: 'citizen-user',
      body: {
        eventId: '69c217dc9728d1ee7fcb8ea6',
        content: 'Felt light shaking.',
      },
    };
    const res = createMockResponse();
    const next = jest.fn();

    CommentsService.createComment.mockResolvedValue({
      eventId: req.body.eventId,
      accountId: req.accountId,
      username: 'Anonymous',
      content: req.body.content,
    });

    await CommentsController.createComment(req, res, next);

    expect(CommentsService.createComment).toHaveBeenCalledWith({
      eventId: '69c217dc9728d1ee7fcb8ea6',
      accountId: '69c217dc9728d1ee7fcb8ea5',
      username: 'Anonymous',
      content: 'Felt light shaking.',
      imageURL: null,
    });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(next).not.toHaveBeenCalled();
  });

  test('uses decoded citizen identity when authenticated user opts out of anonymity', async () => {
    const req = {
      isAuthenticated: true,
      accountId: '69c217dc9728d1ee7fcb8ea5',
      username: 'citizen-user',
      body: {
        eventId: '69c217dc9728d1ee7fcb8ea6',
        anonymous: 'false',
        username: 'spoofed-user',
        content: 'Felt light shaking.',
      },
    };
    const res = createMockResponse();
    const next = jest.fn();

    CommentsService.createComment.mockResolvedValue({
      eventId: req.body.eventId,
      accountId: req.accountId,
      username: req.username,
      content: req.body.content,
    });

    await CommentsController.createComment(req, res, next);

    expect(CommentsService.createComment).toHaveBeenCalledWith({
      eventId: '69c217dc9728d1ee7fcb8ea6',
      accountId: '69c217dc9728d1ee7fcb8ea5',
      username: 'citizen-user',
      content: 'Felt light shaking.',
      imageURL: null,
    });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(next).not.toHaveBeenCalled();
  });

  test('allows guest comments without account identity', async () => {
    const req = {
      isAuthenticated: false,
      body: {
        eventId: '69c217dc9728d1ee7fcb8ea6',
        content: 'Guest comment.',
      },
    };
    const res = createMockResponse();
    const next = jest.fn();

    CommentsService.createComment.mockResolvedValue({
      eventId: req.body.eventId,
      accountId: null,
      username: 'Anonymous',
      content: req.body.content,
    });

    await CommentsController.createComment(req, res, next);

    expect(CommentsService.createComment).toHaveBeenCalledWith({
      eventId: '69c217dc9728d1ee7fcb8ea6',
      accountId: undefined,
      username: 'Anonymous',
      content: 'Guest comment.',
      imageURL: null,
    });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(next).not.toHaveBeenCalled();
  });

  test('does not trust client-supplied image URLs', async () => {
    const req = {
      isAuthenticated: false,
      body: {
        eventId: '69c217dc9728d1ee7fcb8ea6',
        content: 'Guest comment.',
        imageURL: 'https://example.com/remote-image.jpg',
      },
    };
    const res = createMockResponse();
    const next = jest.fn();

    CommentsService.createComment.mockResolvedValue({
      commentId: 'report-1',
      username: 'Anonymous',
      content: req.body.content,
    });

    await CommentsController.createComment(req, res, next);

    expect(CommentsService.createComment).toHaveBeenCalledWith({
      eventId: '69c217dc9728d1ee7fcb8ea6',
      accountId: undefined,
      username: 'Anonymous',
      content: 'Guest comment.',
      imageURL: null,
    });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(next).not.toHaveBeenCalled();
  });

  test('allows image-only reports without sending empty content to the service', async () => {
    const req = {
      isAuthenticated: false,
      imageURL: '/uploads/report.jpg',
      body: {
        eventId: '69c217dc9728d1ee7fcb8ea6',
        content: '',
      },
    };
    const res = createMockResponse();
    const next = jest.fn();

    CommentsService.createComment.mockResolvedValue({
      eventId: req.body.eventId,
      accountId: null,
      username: 'Anonymous',
      imageURL: req.imageURL,
    });

    await CommentsController.createComment(req, res, next);

    expect(CommentsService.createComment).toHaveBeenCalledWith({
      eventId: '69c217dc9728d1ee7fcb8ea6',
      accountId: undefined,
      username: 'Anonymous',
      content: undefined,
      imageURL: '/uploads/report.jpg',
    });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(next).not.toHaveBeenCalled();
  });

  test('returns 404 when creating a report for a missing event', async () => {
    const req = {
      isAuthenticated: false,
      body: {
        eventId: '69c217dc9728d1ee7fcb8ea6',
        content: 'Missing event comment.',
      },
    };
    const res = createMockResponse();
    const next = jest.fn();

    CommentsService.createComment.mockResolvedValue(null);

    await CommentsController.createComment(req, res, next);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Event not found',
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  test('rejects reports with neither text nor image', async () => {
    const req = {
      isAuthenticated: false,
      body: {
        eventId: '69c217dc9728d1ee7fcb8ea6',
        content: '',
      },
    };
    const res = createMockResponse();
    const next = jest.fn();

    await CommentsController.createComment(req, res, next);

    expect(CommentsService.createComment).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'ValidationError',
      }),
    );
  });

  test('rejects invalid event ids before creating a comment', async () => {
    const req = {
      isAuthenticated: false,
      body: {
        eventId: 'gfz2026irfc',
        content: 'Invalid event id.',
      },
    };
    const res = createMockResponse();
    const next = jest.fn();

    await CommentsController.createComment(req, res, next);

    expect(CommentsService.createComment).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'ValidationError',
      }),
    );
  });
});
