const request = require('supertest');
const app = require('../src/app');

// Updated smoke test: verify messaging route accepts a valid pick
describe('Messaging smoke', () => {
  it('POST /messaging/restricted/new-pick returns 200 for valid payload', async () => {
    const payload = {
      networkCode: 'AM',
      stationCode: 'R123',
      timestamp: new Date().toISOString(),
    };
    const res = await request(app)
      .post('/messaging/restricted/new-pick')
      .send(payload)
      .set('Content-Type', 'application/json');
    expect([200, 201]).toContain(res.status);
    expect(res.body).toHaveProperty('status');
  });
});
