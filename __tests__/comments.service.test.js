const mockEventExists = jest.fn();
let mockSaveResult;

jest.mock('../src/models/events.model', () => ({
  exists: (...args) => mockEventExists(...args),
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

  return MockComment;
});

const Comment = require('../src/models/comments.model');
const CommentsService = require('../src/services/comments.service');

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

describe('comments.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSaveResult = undefined;
  });

  test('createComment returns null when the event does not exist', async () => {
    mockEventExists.mockResolvedValue(null);

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
    mockEventExists.mockResolvedValue({ _id: '69c217dc9728d1ee7fcb8ea6' });
    mockSaveResult = {
      commentId: 'report-1',
      eventId: '69c217dc9728d1ee7fcb8ea6',
      accountId: '69c217dc9728d1ee7fcb8ea5',
      username: 'citizen-user',
      content: 'Felt light shaking.',
      imageURL: '/uploads/report.jpg',
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
      createdAt,
      updatedAt,
    });
    expect(result).not.toHaveProperty('accountId');
    expect(result).not.toHaveProperty('eventId');
    expect(result).not.toHaveProperty('_id');
  });

  test('getCommentsByEventId returns public comments only', async () => {
    const createdAt = new Date('2026-06-17T02:00:00.000Z');
    const updatedAt = new Date('2026-06-17T02:00:00.000Z');
    mockEventExists.mockResolvedValue({ _id: '69c217dc9728d1ee7fcb8ea6' });
    Comment.find.mockReturnValue(createFindChain([
      {
        commentId: 'report-1',
        _id: 'internal-id',
        eventId: '69c217dc9728d1ee7fcb8ea6',
        accountId: '69c217dc9728d1ee7fcb8ea5',
        username: 'Anonymous',
        content: 'Felt shaking.',
        createdAt,
        updatedAt,
      },
    ]));
    Comment.countDocuments.mockResolvedValue(1);

    const result = await CommentsService.getCommentsByEventId('69c217dc9728d1ee7fcb8ea6', {
      limit: 20,
      offset: 0,
    });

    expect(result.comments).toEqual([
      {
        commentId: 'report-1',
        username: 'Anonymous',
        content: 'Felt shaking.',
        createdAt,
        updatedAt,
      },
    ]);
    expect(result.comments[0]).not.toHaveProperty('accountId');
    expect(result.comments[0]).not.toHaveProperty('eventId');
    expect(result.comments[0]).not.toHaveProperty('_id');
  });
});
