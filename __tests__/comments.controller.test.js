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
