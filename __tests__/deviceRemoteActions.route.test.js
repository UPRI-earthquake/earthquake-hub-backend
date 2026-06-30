const jwt = require('jsonwebtoken');
const request = require('supertest');

jest.mock('../src/services/remoteDeviceActions.service', () => {
  class RemoteDeviceActionError extends Error {
    constructor(code, message, httpStatus = 500, meta = {}) {
      super(message);
      this.name = 'RemoteDeviceActionError';
      this.code = code;
      this.httpStatus = httpStatus;
      this.meta = meta;
    }
  }

  return {
    ACTIONS: {
      UNLINK: 'UNLINK',
      RELINK: 'RELINK',
      ADD_SERVER: 'ADD_SERVER',
      REMOVE_SERVER: 'REMOVE_SERVER',
    },
    RemoteDeviceActionError,
    listRemoteActionCapabilities: jest.fn(),
    listRemoteDeviceServers: jest.fn(),
    executeRemoteDeviceAction: jest.fn(),
  };
});

const RemoteDeviceActionsService = require('../src/services/remoteDeviceActions.service');

function signCitizenToken(payload = {}) {
  return jwt.sign(
    {
      username: 'citizen-owner',
      role: 'citizen',
      ...payload,
    },
    process.env.ACCESS_TOKEN_PRIVATE_KEY_WEB,
    { expiresIn: '1h' },
  );
}

describe('Device remote actions routes', () => {
  let app;

  beforeAll(() => {
    process.env.NODE_ENV = 'test';
    process.env.ACCESS_TOKEN_PRIVATE_KEY_WEB = 'test-web-secret';
    process.env.REFRESH_TOKEN_PRIVATE_KEY_WEB = 'test-refresh-secret';
    process.env.ACCESS_TOKEN_PRIVATE_KEY_DEVICE = 'test-device-secret';
    app = require('../src/app');
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects unauthenticated capabilities requests', async () => {
    const response = await request(app)
      .get('/device/remote-actions/capabilities')
      .query({ deviceIds: 'AM_RF47F' });

    expect(response.statusCode).toBe(403);
  });

  it('returns capabilities for authenticated citizen owner', async () => {
    RemoteDeviceActionsService.listRemoteActionCapabilities.mockResolvedValue([
      {
        deviceId: 'AM_RF47F',
        canExecute: true,
        reason: null,
        status: 'active',
        listener: 'up',
        remotePort: 22001,
      },
    ]);

    const token = signCitizenToken();
    const response = await request(app)
      .get('/device/remote-actions/capabilities')
      .query({ deviceIds: 'AM_RF47F' })
      .set('Cookie', [`accessToken=${token}; refreshToken=${token}`]);

    expect(response.statusCode).toBe(200);
    expect(response.body?.payload?.capabilities?.[0]?.deviceId).toBe('AM_RF47F');
    expect(response.body?.payload?.availableActions).toEqual(['UNLINK', 'RELINK', 'ADD_SERVER', 'REMOVE_SERVER']);
    expect(RemoteDeviceActionsService.listRemoteActionCapabilities).toHaveBeenCalledWith({
      username: 'citizen-owner',
      deviceIds: ['AM_RF47F'],
    });
  });

  it('returns remote servers for authenticated citizen owner', async () => {
    RemoteDeviceActionsService.listRemoteDeviceServers.mockResolvedValue({
      deviceId: 'AM_RF47F',
      remotePort: 22001,
      status: 'active',
      listener: 'up',
      servers: [
        { institutionName: 'UP-Diliman', url: 'earthquake.up.edu.ph:16000', status: 'Streaming' },
      ],
    });

    const token = signCitizenToken();
    const response = await request(app)
      .get('/device/remote-actions/servers')
      .query({ deviceId: 'AM_RF47F' })
      .set('Cookie', [`accessToken=${token}; refreshToken=${token}`]);

    expect(response.statusCode).toBe(200);
    expect(response.body?.payload?.deviceId).toBe('AM_RF47F');
    expect(Array.isArray(response.body?.payload?.servers)).toBe(true);
    expect(RemoteDeviceActionsService.listRemoteDeviceServers).toHaveBeenCalledWith({
      username: 'citizen-owner',
      deviceId: 'AM_RF47F',
    });
  });

  it('executes remote action for authenticated citizen owner', async () => {
    RemoteDeviceActionsService.executeRemoteDeviceAction.mockResolvedValue({
      deviceId: 'AM_RF47F',
      action: 'UNLINK',
      result: { ok: true, message: 'unlink done' },
    });

    const token = signCitizenToken();
    const response = await request(app)
      .post('/device/remote-actions/execute')
      .set('Cookie', [`accessToken=${token}; refreshToken=${token}`])
      .send({
        deviceId: 'AM_RF47F',
        action: 'UNLINK',
      });

    expect(response.statusCode).toBe(200);
    expect(response.body?.payload?.action).toBe('UNLINK');
    expect(RemoteDeviceActionsService.executeRemoteDeviceAction).toHaveBeenCalledWith({
      username: 'citizen-owner',
      deviceId: 'AM_RF47F',
      action: 'UNLINK',
      payload: {},
    });
  });

  it('maps ownership errors to 403', async () => {
    const { RemoteDeviceActionError } = RemoteDeviceActionsService;
    RemoteDeviceActionsService.executeRemoteDeviceAction.mockRejectedValue(
      new RemoteDeviceActionError('not_owned', 'Device is not owned by this account.', 403),
    );

    const token = signCitizenToken();
    const response = await request(app)
      .post('/device/remote-actions/execute')
      .set('Cookie', [`accessToken=${token}; refreshToken=${token}`])
      .send({
        deviceId: 'AM_RF47F',
        action: 'UNLINK',
      });

    expect(response.statusCode).toBe(403);
    expect(response.body?.errorCode).toBe('not_owned');
  });

  it('maps offline tunnel errors to 409', async () => {
    const { RemoteDeviceActionError } = RemoteDeviceActionsService;
    RemoteDeviceActionsService.executeRemoteDeviceAction.mockRejectedValue(
      new RemoteDeviceActionError('offline', 'Tunnel is currently offline.', 409),
    );

    const token = signCitizenToken();
    const response = await request(app)
      .post('/device/remote-actions/execute')
      .set('Cookie', [`accessToken=${token}; refreshToken=${token}`])
      .send({
        deviceId: 'AM_RF47F',
        action: 'ADD_SERVER',
        payload: {
          institutionName: 'UP-Diliman',
          url: 'earthquake.up.edu.ph:16000',
        },
      });

    expect(response.statusCode).toBe(409);
    expect(response.body?.errorCode).toBe('offline');
  });

  it('maps timeout errors to 504', async () => {
    const { RemoteDeviceActionError } = RemoteDeviceActionsService;
    RemoteDeviceActionsService.executeRemoteDeviceAction.mockRejectedValue(
      new RemoteDeviceActionError('timeout', 'Remote action timed out.', 504),
    );

    const token = signCitizenToken();
    const response = await request(app)
      .post('/device/remote-actions/execute')
      .set('Cookie', [`accessToken=${token}; refreshToken=${token}`])
      .send({
        deviceId: 'AM_RF47F',
        action: 'UNLINK',
      });

    expect(response.statusCode).toBe(504);
    expect(response.body?.errorCode).toBe('timeout');
  });
});
