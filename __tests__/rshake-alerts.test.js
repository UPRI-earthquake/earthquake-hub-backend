const request = require('supertest');
const app = require('../src/app');

describe('RShake alerts route smoke', () => {
  it('POST /messaging/restricted/rshake-alert with invalid body returns 400', async () => {
    const res = await request(app)
      .post('/messaging/restricted/rshake-alert')
      .send({})
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('status');
  });
});
