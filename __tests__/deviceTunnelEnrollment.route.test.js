const jwt = require('jsonwebtoken');
const request = require('supertest');

jest.mock('../src/services/tunnelEnrollment.service', () => {
  class TunnelEnrollmentError extends Error {
    constructor(code, message, meta = {}) {
      super(message);
      this.name = 'TunnelEnrollmentError';
      this.code = code;
      this.meta = meta;
    }
  }

  return {
    TunnelEnrollmentError,
    enrollDeviceTunnel: jest.fn(),
    listActiveMappings: jest.fn(),
    revokeDeviceTunnel: jest.fn(),
  };
});

const TunnelEnrollmentService = require('../src/services/tunnelEnrollment.service');

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

function signWebToken(payload = {}) {
  return jwt.sign(
    {
      username: 'admin-user',
      role: 'admin',
      ...payload,
    },
    process.env.ACCESS_TOKEN_PRIVATE_KEY_WEB,
    { expiresIn: '1h' },
  );
}

describe('Device tunnel enrollment routes', () => {
  let app;

  beforeAll(() => {
    process.env.NODE_ENV = 'test';
    process.env.ACCESS_TOKEN_PRIVATE_KEY_DEVICE = 'test-device-secret';
    process.env.ACCESS_TOKEN_PRIVATE_KEY_WEB = 'test-web-secret';
    app = require('../src/app');
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects unauthenticated enroll requests', async () => {
    const response = await request(app)
      .post('/device/tunnel/enroll')
      .send({
        deviceId: 'AM_R24FA',
        tunnelPublicKey: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIMockPublicKeyValue sender@device',
      });

    expect(response.statusCode).toBe(403);
  });

  it('enrolls device tunnel for authenticated sensor', async () => {
    TunnelEnrollmentService.enrollDeviceTunnel.mockResolvedValue({
      REMOTE_TUNNEL_BASTION_HOST: 'ops.example.org',
      REMOTE_TUNNEL_BASTION_PORT: 443,
      REMOTE_TUNNEL_BASTION_USER: 'rt-am_r24fa',
      REMOTE_TUNNEL_REMOTE_PORT: 22501,
      REMOTE_TUNNEL_BASTION_HOST_KEY: 'ops.example.org ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIMockHostKey',
      REMOTE_TUNNEL_WSS_URL: 'wss://earthquake.science.upd.edu.ph',
      REMOTE_TUNNEL_WSS_PATH_PREFIX: 'api/ws-tunnel/test-secret',
    });

    const token = signDeviceToken();
    const response = await request(app)
      .post('/device/tunnel/enroll')
      .set('Authorization', `Bearer ${token}`)
      .send({
        network: 'AM',
        station: 'R24FA',
        tunnelPublicKey: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIMockPublicKeyValue sender@device',
      });

    expect(response.statusCode).toBe(200);
    expect(response.body?.payload?.REMOTE_TUNNEL_BASTION_HOST).toBe('ops.example.org');
    expect(response.body?.payload?.REMOTE_TUNNEL_BASTION_USER).toBe('rt-am_r24fa');
    expect(response.body?.payload?.REMOTE_TUNNEL_REMOTE_PORT).toBe(22501);
    expect(response.body?.payload?.REMOTE_TUNNEL_WSS_URL).toBe('wss://earthquake.science.upd.edu.ph');
    expect(response.body?.payload?.REMOTE_TUNNEL_WSS_PATH_PREFIX).toBe('api/ws-tunnel/test-secret');
    expect(TunnelEnrollmentService.enrollDeviceTunnel).toHaveBeenCalledWith(
      expect.objectContaining({
        deviceId: 'AM_R24FA',
      }),
    );
  });

  it('returns conflict when enrollment collisions occur', async () => {
    const { TunnelEnrollmentError } = TunnelEnrollmentService;
    TunnelEnrollmentService.enrollDeviceTunnel.mockRejectedValue(
      new TunnelEnrollmentError('COLLISION', 'Remote port already assigned in registry: 22501'),
    );

    const token = signDeviceToken();
    const response = await request(app)
      .post('/device/tunnel/enroll')
      .set('Authorization', `Bearer ${token}`)
      .send({
        deviceId: 'AM_R24FA',
        tunnelPublicKey: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIMockPublicKeyValue sender@device',
      });

    expect(response.statusCode).toBe(409);
  });

  it('rejects enroll requests without device identity', async () => {
    const token = signDeviceToken();
    const response = await request(app)
      .post('/device/tunnel/enroll')
      .set('Authorization', `Bearer ${token}`)
      .send({
        tunnelPublicKey: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIMockPublicKeyValue sender@device',
      });

    expect(response.statusCode).toBe(400);
  });

  it('lists active mappings for admin', async () => {
    TunnelEnrollmentService.listActiveMappings.mockResolvedValue([
      {
        deviceId: 'AM_R24FA',
        bastionUser: 'rt-am_r24fa',
        remotePort: 22501,
      },
    ]);

    const token = signWebToken();
    const response = await request(app)
      .get('/device/tunnel/mappings')
      .set('Cookie', [`accessToken=${token}; refreshToken=${token}`]);

    expect(response.statusCode).toBe(200);
    expect(response.body?.payload).toHaveLength(1);
    expect(response.body?.payload?.[0]?.deviceId).toBe('AM_R24FA');
  });
});
