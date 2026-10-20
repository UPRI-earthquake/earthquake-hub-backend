jest.mock('../src/repositories/pushSubscriptions.repo', () => ({
  isAvailable: jest.fn(),
  upsert: jest.fn(),
  listActive: jest.fn(),
  recordDelivery: jest.fn(),
  recordFailure: jest.fn(),
  markInvalid: jest.fn(),
}));
jest.mock('web-push', () => ({
  setVapidDetails: jest.fn(),
  sendNotification: jest.fn(),
}));
jest.mock('../src/services/EQevents.service', () => ({
  addPlacesAttribute: jest.fn(),
}));

// Read once when the service loads
process.env.NOTIF_INVALID_TTL_DAYS = '7';

const webpush = require('web-push');
const PushSubscriptionsRepo = require('../src/repositories/pushSubscriptions.repo');
const EQEventsService = require('../src/services/EQevents.service');
const NotificationsService = require('../src/services/notifications.service');

const DAY_MS = 24 * 60 * 60 * 1000;

const pushError = (statusCode) => Object.assign(new Error(`push failed ${statusCode}`), { statusCode });

describe('notifications.service', () => {
  const now = new Date('2026-01-01T00:00:00.000Z');

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers({ now });
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    PushSubscriptionsRepo.isAvailable.mockReturnValue(true);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('createSubscription', () => {
    const request = {
      endpoint: 'https://push.example.org/wpush/v2/abc',
      expirationTime: '2026-02-01T00:00:00.000Z',
      keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
      clientMeta: {
        swScriptUrl: '  https://earthquake.up.edu.ph/sw.js  ',
        userAgent: 'Mozilla/5.0',
        time: '2025-12-31T23:59:00.000Z',
      },
    };

    test('creates a new subscription with normalized fields', async () => {
      PushSubscriptionsRepo.upsert.mockResolvedValue({ created: true });

      await expect(NotificationsService.createSubscription(request)).resolves.toBe('success');
      expect(PushSubscriptionsRepo.upsert).toHaveBeenCalledWith(
        {
          endpoint: request.endpoint,
          expirationTime: Date.parse('2026-02-01T00:00:00.000Z'),
          keys: request.keys,
          clientMeta: {
            userAgent: 'Mozilla/5.0',
            appVersion: null,
            clientTime: new Date('2025-12-31T23:59:00.000Z'),
          },
          sourceSwScript: 'https://earthquake.up.edu.ph/sw.js',
        },
        now,
      );
    });

    test('leaves sourceSwScript unset and defaults clientMeta when the client sends none', async () => {
      PushSubscriptionsRepo.upsert.mockResolvedValue({ created: true });

      await NotificationsService.createSubscription({
        endpoint: request.endpoint,
        expirationTime: null,
        keys: request.keys,
      });

      expect(PushSubscriptionsRepo.upsert).toHaveBeenCalledWith(
        {
          endpoint: request.endpoint,
          expirationTime: null,
          keys: request.keys,
          clientMeta: { userAgent: null, appVersion: null, clientTime: null },
          sourceSwScript: undefined,
        },
        now,
      );
    });

    test('keeps a numeric expirationTime as is', async () => {
      PushSubscriptionsRepo.upsert.mockResolvedValue({ created: true });

      await NotificationsService.createSubscription({ ...request, expirationTime: 1767225600000 });

      expect(PushSubscriptionsRepo.upsert.mock.calls[0][0].expirationTime).toBe(1767225600000);
    });

    test('reports an existing endpoint', async () => {
      PushSubscriptionsRepo.upsert.mockResolvedValue({ created: false });

      await expect(NotificationsService.createSubscription(request)).resolves.toBe('subscriptionExists');
    });

    test('reports an unavailable database without writing', async () => {
      PushSubscriptionsRepo.isAvailable.mockReturnValue(false);

      await expect(NotificationsService.createSubscription(request)).resolves.toBe('dbNotAccessible');
      expect(PushSubscriptionsRepo.upsert).not.toHaveBeenCalled();
    });
  });

  describe('notifySubscribersEQ', () => {
    const message = { magnitude_value: 6.1, text: '10 km N of Somewhere', publicID: 'ph2026abcd' };
    const subscriber = (id) => ({
      id,
      endpoint: `https://push.example.org/wpush/v2/${id}`,
      expirationTime: null,
      keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
    });

    beforeEach(() => {
      EQEventsService.addPlacesAttribute.mockImplementation(async (events) =>
        events.map((event) => ({ ...event, place: 'Davao del Sur' })),
      );
    });

    test('skips earthquakes at or below the notify threshold', async () => {
      await expect(NotificationsService.notifySubscribersEQ({ magnitude_value: 5.5 })).resolves.toBe('success');
      expect(PushSubscriptionsRepo.listActive).not.toHaveBeenCalled();
      expect(webpush.sendNotification).not.toHaveBeenCalled();
    });

    test('reports an unavailable database without sending', async () => {
      PushSubscriptionsRepo.isAvailable.mockReturnValue(false);

      await expect(NotificationsService.notifySubscribersEQ(message)).resolves.toBe('dbNotAccessible');
      expect(webpush.sendNotification).not.toHaveBeenCalled();
    });

    test('sends to every active subscriber and records the delivery', async () => {
      PushSubscriptionsRepo.listActive.mockResolvedValue([subscriber('s1'), subscriber('s2')]);
      webpush.sendNotification.mockResolvedValue({ statusCode: 201 });

      await expect(NotificationsService.notifySubscribersEQ(message)).resolves.toBe('success');

      expect(webpush.sendNotification).toHaveBeenCalledTimes(2);
      const [sentTo, payload] = webpush.sendNotification.mock.calls[0];
      expect(sentTo).toEqual(subscriber('s1'));
      expect(JSON.parse(payload)).toMatchObject({
        title: 'Earthquake Alert',
        body: 'Magnitude 6.1 in Davao del Sur',
        data: { eventType: 'NEW', publicID: 'ph2026abcd', place: 'Davao del Sur' },
      });
      expect(PushSubscriptionsRepo.recordDelivery).toHaveBeenCalledWith('s1', now);
      expect(PushSubscriptionsRepo.recordDelivery).toHaveBeenCalledWith('s2', now);
    });

    test.each([400, 404, 410])('marks the subscription invalid when the push service answers %i', async (code) => {
      PushSubscriptionsRepo.listActive.mockResolvedValue([subscriber('s1')]);
      webpush.sendNotification.mockRejectedValue(pushError(code));

      await NotificationsService.notifySubscribersEQ(message);

      expect(PushSubscriptionsRepo.markInvalid).toHaveBeenCalledWith('s1', {
        code,
        cleanupAfter: new Date(now.getTime() + 7 * DAY_MS),
        now,
      });
      expect(PushSubscriptionsRepo.recordFailure).not.toHaveBeenCalled();
    });

    test('records other failures without invalidating', async () => {
      PushSubscriptionsRepo.listActive.mockResolvedValue([subscriber('s1')]);
      webpush.sendNotification.mockRejectedValue(pushError(503));

      await NotificationsService.notifySubscribersEQ(message);

      expect(PushSubscriptionsRepo.recordFailure).toHaveBeenCalledWith('s1', 503, now);
      expect(PushSubscriptionsRepo.markInvalid).not.toHaveBeenCalled();
    });

    test('records a failure without a status code as null', async () => {
      PushSubscriptionsRepo.listActive.mockResolvedValue([subscriber('s1')]);
      webpush.sendNotification.mockRejectedValue(new Error('socket hang up'));

      await NotificationsService.notifySubscribersEQ(message);

      expect(PushSubscriptionsRepo.recordFailure).toHaveBeenCalledWith('s1', null, now);
    });

    test('one subscriber failing to update does not stop the others', async () => {
      PushSubscriptionsRepo.listActive.mockResolvedValue([subscriber('s1'), subscriber('s2')]);
      webpush.sendNotification
        .mockRejectedValueOnce(pushError(410))
        .mockResolvedValueOnce({ statusCode: 201 });
      PushSubscriptionsRepo.markInvalid.mockRejectedValue(new Error('db write failed'));

      await expect(NotificationsService.notifySubscribersEQ(message)).resolves.toBe('success');
      expect(PushSubscriptionsRepo.recordDelivery).toHaveBeenCalledWith('s2', now);
    });
  });
});
