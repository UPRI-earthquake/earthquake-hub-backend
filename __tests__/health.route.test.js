const request = require('supertest');
const app = require('../src/app');
const HealthService = require('../src/services/health.service');

describe('backend health routes', () => {
  it('reports process liveness without requiring MongoDB', async () => {
    const response = await request(app).get('/health/live');
    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ status: 'live' });
  });

  it('reports unavailable readiness while the test database is disconnected', async () => {
    const unavailable = await request(app).get('/health/ready');
    expect(unavailable.statusCode).toBe(503);
    expect(unavailable.body.dependencies.mongodb).toBe('unavailable');
  });

  it('classifies a connected MongoDB dependency as ready', () => {
    expect(HealthService.readiness({ readyState: 1 })).toEqual({
      ready: true,
      payload: { status: 'ready', dependencies: { mongodb: 'ready' } },
    });
  });
});
