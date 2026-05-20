const CommentsController = require('../src/controllers/comments.controller');
const CommentsService = require('../src/services/comments.service');

jest.mock('../src/services/comments.service');

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
      { limit: 20, offset: 0 },
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

describe('comments.controller createComment', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('uses decoded citizen identity when request is authenticated', async () => {
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
