jest.mock('../src/models/account.model', () => ({
  find: jest.fn(),
}));

jest.mock('../src/models/device.model', () => ({
  findOne: jest.fn(),
}));

jest.mock('../src/services/email.service', () => ({
  sendMail: jest.fn().mockResolvedValue({ messageId: 'mock-id' }),
}));

const Account = require('../src/models/account.model');
const Device = require('../src/models/device.model');
const EmailService = require('../src/services/email.service');
const DeviceAlertsService = require('../src/services/deviceAlerts.service');

describe('deviceAlerts.service admin-only routing', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = {
      ...originalEnv,
      EMAIL_FROM: 'earthquake@science.upd.edu.ph',
    };

    Device.findOne.mockResolvedValue({
      _id: 'device-1',
      network: 'AM',
      station: 'TEST1',
      streamId: 'AM_TEST1_.*/MSEED',
      macAddress: 'AA:BB:CC:DD:EE:FF',
      latitude: 14.6,
      longitude: 121.04,
      elevation: 35,
    });
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  function mockAccounts(emails) {
    Account.find.mockReturnValue({
      select: jest.fn().mockResolvedValue((emails || []).map((email) => ({ email }))),
    });
  }

  function basePayload(alertCode = 'STREAM_ERROR') {
    return {
      schemaVersion: '1.0',
      messageId: 'test-message-id',
      type: 'device.alert',
      occurredAt: new Date().toISOString(),
      device: {
        streamId: 'AM_TEST1_.*/MSEED',
      },
      status: 'Error',
      alertCode,
      severity: 'warning',
      summary: 'Test alert',
      details: {},
      dedupeKey: 'test-key',
    };
  }

  it('routes AUTO_UPDATE alerts to admin recipients only', async () => {
    mockAccounts(['user1@example.com']);

    const result = await DeviceAlertsService.sendDeviceAlertEmails(basePayload('AUTO_UPDATE_EXECUTED'));

    expect(result.str).toBe('success');
    expect(result.recipients.users).toEqual([]);
    expect(result.recipients.admin).toEqual(['earthquake@science.upd.edu.ph']);
    expect(EmailService.sendMail).toHaveBeenCalledTimes(1);
    expect(EmailService.sendMail.mock.calls[0][0]).toMatchObject({
      to: 'earthquake@science.upd.edu.ph',
      subject: 'UPRI RShake Device Alerts',
    });
  });

  it('routes DISK_SPACE alerts to admin recipients only', async () => {
    mockAccounts(['user1@example.com']);

    const result = await DeviceAlertsService.sendDeviceAlertEmails(basePayload('DISK_SPACE_WARN'));

    expect(result.str).toBe('success');
    expect(result.recipients.users).toEqual([]);
    expect(result.recipients.admin).toEqual(['earthquake@science.upd.edu.ph']);
    expect(EmailService.sendMail).toHaveBeenCalledTimes(1);
  });

  it('routes TOKEN_REFRESH alerts to admin recipients only', async () => {
    mockAccounts(['user1@example.com']);

    const result = await DeviceAlertsService.sendDeviceAlertEmails(basePayload('TOKEN_REFRESH_FAILED'));

    expect(result.str).toBe('success');
    expect(result.recipients.users).toEqual([]);
    expect(result.recipients.admin).toEqual(['earthquake@science.upd.edu.ph']);
    expect(EmailService.sendMail).toHaveBeenCalledTimes(1);
  });

  it('routes WATCHDOG alerts to admin recipients only', async () => {
    mockAccounts(['user1@example.com']);

    const result = await DeviceAlertsService.sendDeviceAlertEmails(basePayload('WATCHDOG_CONTAINER_RESTART_FAILED'));

    expect(result.str).toBe('success');
    expect(result.recipients.users).toEqual([]);
    expect(result.recipients.admin).toEqual(['earthquake@science.upd.edu.ph']);
    expect(EmailService.sendMail).toHaveBeenCalledTimes(1);
  });

  it('routes notificationScope=admin-only to admin recipients only', async () => {
    mockAccounts(['user1@example.com']);

    const payload = basePayload('STREAM_ERROR');
    payload.details = { notificationScope: 'admin-only' };

    const result = await DeviceAlertsService.sendDeviceAlertEmails(payload);

    expect(result.str).toBe('success');
    expect(result.recipients.users).toEqual([]);
    expect(result.recipients.admin).toEqual(['earthquake@science.upd.edu.ph']);
    expect(EmailService.sendMail).toHaveBeenCalledTimes(1);
  });

  it('keeps normal alerts going to opted-in users and admin', async () => {
    mockAccounts(['user1@example.com']);

    const result = await DeviceAlertsService.sendDeviceAlertEmails(basePayload('STREAM_ERROR'));

    expect(result.str).toBe('success');
    expect(result.recipients.users).toEqual(['user1@example.com']);
    expect(result.recipients.admin).toEqual(['earthquake@science.upd.edu.ph']);
    expect(EmailService.sendMail).toHaveBeenCalledTimes(2);
  });
});
