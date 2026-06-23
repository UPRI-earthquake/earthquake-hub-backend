const Comment = require('../src/models/comments.model');

describe('Comment model', () => {
  it('defaults missing username to Anonymous', async () => {
    const comment = new Comment({
      eventId: '64a7c2f3b8e4f9a1c2d3e4f5',
      content: 'Felt light shaking.',
    });

    await expect(comment.validate()).resolves.toBeUndefined();
    expect(comment.username).toBe('Anonymous');
  });

  it('defaults blank username to Anonymous', async () => {
    const comment = new Comment({
      eventId: '64a7c2f3b8e4f9a1c2d3e4f5',
      username: '   ',
      content: 'Felt light shaking.',
    });

    await expect(comment.validate()).resolves.toBeUndefined();
    expect(comment.username).toBe('Anonymous');
  });

  it('allows image-only reports without storing blank content', async () => {
    const comment = new Comment({
      eventId: '64a7c2f3b8e4f9a1c2d3e4f5',
      content: '   ',
      imageURL: '/uploads/report.jpg',
    });

    await expect(comment.validate()).resolves.toBeUndefined();
    expect(comment.content).toBeUndefined();
    expect(comment.imageURL).toBe('/uploads/report.jpg');
  });

  it('defaults moderation status to approved', async () => {
    const comment = new Comment({
      eventId: '64a7c2f3b8e4f9a1c2d3e4f5',
      content: 'Felt light shaking.',
    });

    await expect(comment.validate()).resolves.toBeUndefined();
    expect(comment.status).toBe('approved');
  });

  it('rejects reports with neither text nor image', async () => {
    const comment = new Comment({
      eventId: '64a7c2f3b8e4f9a1c2d3e4f5',
      content: '   ',
    });

    await expect(comment.validate()).rejects.toThrow('A report must include text or an image.');
  });
});
