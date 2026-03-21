const jwt = require('jsonwebtoken');
const request = require('supertest');

jest.mock('../src/models/account.model', () => ({
  findOne: jest.fn(),
}));

jest.mock('../src/services/device.service', () => ({
  getAccountDevices: jest.fn(),
}));

const Account = require('../src/models/account.model');
const DeviceService = require('../src/services/device.service');

function signRefreshToken(payload = {}, scope = 'device') {
  const defaults = scope === 'brgy'
    ? { username: 'brgy-user', role: 'brgy' }
    : { username: 'sensor-user', role: 'sensor' };
  const secret = scope === 'brgy'
    ? process.env.REFRESH_TOKEN_PRIVATE_KEY_BRGY
    : process.env.REFRESH_TOKEN_PRIVATE_KEY;

  return jwt.sign(
    {
      ...defaults,
      ...payload,
    },
    secret,
    { expiresIn: '1h' },
  );
}

describe('Device refresh token route', () => {
  let app;

  beforeAll(() => {
    process.env.NODE_ENV = 'test';
    process.env.ACCESS_TOKEN_PRIVATE_KEY_DEVICE = 'test-device-access-secret';
    process.env.ACCESS_TOKEN_PRIVATE_KEY_BRGY = 'test-brgy-access-secret';
    process.env.REFRESH_TOKEN_PRIVATE_KEY = 'test-device-refresh-secret';
    process.env.REFRESH_TOKEN_PRIVATE_KEY_BRGY = 'test-brgy-refresh-secret';
    app = require('../src/app');
  });

  beforeEach(() => {
    jest.clearAllMocks();
    Account.findOne.mockResolvedValue({
      username: 'sensor-user',
      roles: ['sensor'],
      isApproved: true,
    });
    DeviceService.getAccountDevices.mockResolvedValue({
      str: 'success',
      devices: [
        {
          network: 'AM',
          station: 'TEST1',
        },
      ],
    });
  });

  it('exchanges a valid sensor refresh token', async () => {
    const response = await request(app)
      .post('/device/refresh-token')
      .send({
        refreshToken: signRefreshToken(),
      });

    expect(response.statusCode).toBe(200);
    expect(response.body?.payload?.accessToken).toBeTruthy();
    expect(response.body?.payload?.refreshToken).toBeTruthy();
    expect(response.body?.payload?.deviceInfo).toEqual({
      network: 'AM',
      station: 'TEST1',
    });
    expect(Account.findOne).toHaveBeenCalledWith({ username: 'sensor-user' });
    expect(DeviceService.getAccountDevices).toHaveBeenCalledWith('sensor-user');
  });

  it('rejects an invalid refresh token', async () => {
    const response = await request(app)
      .post('/device/refresh-token')
      .send({
        refreshToken: 'not-a-valid-token',
      });

    expect(response.statusCode).toBe(401);
    expect(Account.findOne).not.toHaveBeenCalled();
    expect(DeviceService.getAccountDevices).not.toHaveBeenCalled();
  });

  it('rejects refresh tokens with unexpected roles', async () => {
    const response = await request(app)
      .post('/device/refresh-token')
      .send({
        refreshToken: signRefreshToken({ role: 'citizen' }),
      });

    expect(response.statusCode).toBe(403);
    expect(response.body?.message).toBe('Session role not permitted for this route');
    expect(DeviceService.getAccountDevices).not.toHaveBeenCalled();
  });

  it('rejects refresh tokens for deleted accounts', async () => {
    Account.findOne.mockResolvedValue(null);

    const response = await request(app)
      .post('/device/refresh-token')
      .send({
        refreshToken: signRefreshToken(),
      });

    expect(response.statusCode).toBe(401);
    expect(response.body?.message).toBe('Invalid refresh token');
    expect(DeviceService.getAccountDevices).not.toHaveBeenCalled();
  });

  it('rejects refresh tokens for unapproved brgy accounts', async () => {
    Account.findOne.mockResolvedValue({
      username: 'brgy-user',
      roles: ['brgy'],
      isApproved: false,
    });

    const response = await request(app)
      .post('/device/refresh-token')
      .send({
        refreshToken: signRefreshToken({}, 'brgy'),
      });

    expect(response.statusCode).toBe(403);
    expect(response.body?.message).toBe('Account is not yet approved');
    expect(DeviceService.getAccountDevices).not.toHaveBeenCalled();
  });
});
