const request = require('supertest');
const app = require('../src/app');

describe('Backend smoke: root responds', () => {
  test('GET / returns version 1.0', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.body && res.body.version).toBe('1.0');
  });
});

