const Comment = require('../src/models/comments.model');

describe('Comment model', () => {
  it('defaults missing userId to Anonymous', async () => {
    const comment = new Comment({
      eventId: '64a7c2f3b8e4f9a1c2d3e4f5',
      content: 'Felt light shaking.',
    });

    await expect(comment.validate()).resolves.toBeUndefined();
    expect(comment.userId).toBe('Anonymous');
  });

  it('defaults blank userId to Anonymous', async () => {
    const comment = new Comment({
      eventId: '64a7c2f3b8e4f9a1c2d3e4f5',
      userId: '   ',
      content: 'Felt light shaking.',
    });

    await expect(comment.validate()).resolves.toBeUndefined();
    expect(comment.userId).toBe('Anonymous');
  });
});
