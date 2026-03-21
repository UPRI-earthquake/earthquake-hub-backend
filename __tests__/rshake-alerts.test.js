const request = require('supertest');
jest.mock('../src/models/device.model', () => ({
  findOne: jest.fn(),
}));

const Device = require('../src/models/device.model');
const RshakeAlertCredentialsService = require('../src/services/rshakeAlertCredentials.service');
const app = require('../src/app');

describe('RShake alerts route smoke', () => {
  const originalSecret = process.env.RSHAKE_ALERT_SHARED_SECRET;
  const validAlertPayload = {
    schemaVersion: '1.0',
    messageId: 'msg-1',
    type: 'device.alert',
    occurredAt: '2026-03-13T00:00:00.000Z',
    device: {
      streamId: 'AM_TEST1_.*/MSEED',
    },
    summary: 'Test alert',
  };

  afterEach(() => {
    jest.clearAllMocks();
    if (originalSecret === undefined) {
      delete process.env.RSHAKE_ALERT_SHARED_SECRET;
    } else {
      process.env.RSHAKE_ALERT_SHARED_SECRET = originalSecret;
    }
  });

  it('returns 403 when no alert credential is provided and no global secret is configured', async () => {
    const res = await request(app)
      .post('/messaging/restricted/rshake-alert')
      .send({})
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(403);
  });

  it('POST /messaging/restricted/rshake-alert with invalid body returns 400 after auth succeeds', async () => {
    process.env.RSHAKE_ALERT_SHARED_SECRET = 'test-shared-secret';
    const res = await request(app)
      .post('/messaging/restricted/rshake-alert')
      .set('X-RShake-Alert-Secret', 'test-shared-secret')
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

  it('rejects partial network/station identifiers even after auth succeeds', async () => {
    process.env.RSHAKE_ALERT_SHARED_SECRET = 'test-shared-secret';
    const res = await request(app)
      .post('/messaging/restricted/rshake-alert')
      .set('X-RShake-Alert-Secret', 'test-shared-secret')
      .send({
        ...validAlertPayload,
        device: {
          station: 'TEST1',
        },
      })
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(400);
  });
});
