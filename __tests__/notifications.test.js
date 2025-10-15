const request = require('supertest');
const app = require('../src/app');

// Updated smoke test: validate subscription endpoint input handling (no DB needed)
describe('Notifications smoke', () => {
  it('POST /notifications/subscribe with invalid body returns 400', async () => {
    const res = await request(app)
      .post('/notifications/subscribe')
      .send({})
      .set('Content-Type', 'application/json');
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('status');
  });
});
