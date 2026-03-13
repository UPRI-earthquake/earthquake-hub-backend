const request = require('supertest');
jest.mock('../src/models/device.model', () => ({
  findOne: jest.fn(),
}));

const Device = require('../src/models/device.model');
const RshakeAlertCredentialsService = require('../src/services/rshakeAlertCredentials.service');
const app = require('../src/app');

describe('RShake alerts route smoke', () => {
  const originalSecret = process.env.RSHAKE_ALERT_SHARED_SECRET;

  afterEach(() => {
    jest.clearAllMocks();
    if (originalSecret === undefined) {
      delete process.env.RSHAKE_ALERT_SHARED_SECRET;
    } else {
      process.env.RSHAKE_ALERT_SHARED_SECRET = originalSecret;
    }
  });

  it('POST /messaging/restricted/rshake-alert with invalid body returns 400', async () => {
    const res = await request(app)
      .post('/messaging/restricted/rshake-alert')
      .send({})
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('status');
  });

  it('returns 403 when shared secret is configured and header is missing', async () => {
    process.env.RSHAKE_ALERT_SHARED_SECRET = 'test-shared-secret';
    const res = await request(app)
      .post('/messaging/restricted/rshake-alert')
      .send({})
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(403);
  });

  it('allows request past auth check when shared secret header matches', async () => {
    process.env.RSHAKE_ALERT_SHARED_SECRET = 'test-shared-secret';
    const res = await request(app)
      .post('/messaging/restricted/rshake-alert')
      .set('X-RShake-Alert-Secret', 'test-shared-secret')
      .send({})
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('status');
  });

  it('returns 403 when a device-scoped alert credential exists and header is missing', async () => {
    Device.findOne.mockResolvedValue({
      _id: 'device-1',
      rshakeAlertCredentialHash: RshakeAlertCredentialsService.hashCredential('device-secret'),
    });

    const res = await request(app)
      .post('/messaging/restricted/rshake-alert')
      .send({
        device: {
          streamId: 'AM_TEST1_.*/MSEED',
        },
      })
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(403);
  });

  it('allows request past auth check when device-scoped alert credential header matches', async () => {
    Device.findOne.mockResolvedValue({
      _id: 'device-1',
      rshakeAlertCredentialHash: RshakeAlertCredentialsService.hashCredential('device-secret'),
    });

    const res = await request(app)
      .post('/messaging/restricted/rshake-alert')
      .set('X-RShake-Alert-Secret', 'device-secret')
      .send({
        device: {
          streamId: 'AM_TEST1_.*/MSEED',
        },
      })
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('status');
  });
});
