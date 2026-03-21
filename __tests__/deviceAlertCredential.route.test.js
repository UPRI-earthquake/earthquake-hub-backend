const jwt = require('jsonwebtoken');
const request = require('supertest');

jest.mock('../src/services/rshakeAlertCredentials.service', () => ({
  issueAlertCredentialForOwnedDevice: jest.fn(),
}));

const RshakeAlertCredentialsService = require('../src/services/rshakeAlertCredentials.service');

function signDeviceToken(payload = {}) {
  return jwt.sign(
    {
      username: 'sensor-user',
      role: 'sensor',
      ...payload,
    },
    process.env.ACCESS_TOKEN_PRIVATE_KEY_DEVICE,
    { expiresIn: '1h' },
  );
}

describe('Device alert credential route', () => {
  let app;

  beforeAll(() => {
    process.env.NODE_ENV = 'test';
    process.env.ACCESS_TOKEN_PRIVATE_KEY_DEVICE = 'test-device-secret';
    app = require('../src/app');
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects unauthenticated requests', async () => {
    const response = await request(app)
      .post('/device/alert-credential')
      .send({
        streamId: 'AM_TEST1_.*/MSEED',
      });

    expect(response.statusCode).toBe(403);
  });

  it('issues a credential for an authenticated sensor device', async () => {
    RshakeAlertCredentialsService.issueAlertCredentialForOwnedDevice.mockResolvedValue({
      str: 'success',
      payload: {
        deviceId: 'device-1',
        sharedSecret: 'issued-secret',
        issuedAt: '2026-03-13T00:00:00.000Z',
      },
    });

    const token = signDeviceToken();
    const response = await request(app)
      .post('/device/alert-credential')
      .set('Authorization', `Bearer ${token}`)
      .send({
        streamId: 'AM_TEST1_.*/MSEED',
      });

    expect(response.statusCode).toBe(200);
    expect(response.body?.payload?.sharedSecret).toBe('issued-secret');
    expect(RshakeAlertCredentialsService.issueAlertCredentialForOwnedDevice).toHaveBeenCalledWith({
      username: 'sensor-user',
      identifiers: {
        streamId: 'AM_TEST1_.*/MSEED',
      },
    });
  });
});
