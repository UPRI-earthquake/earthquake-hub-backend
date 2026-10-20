// Behavior the push-subscriptions repository must keep, whichever database backs it
const Subscription = require('../src/models/subscription.model');
const PushSubscriptionsRepo = require('../src/repositories/pushSubscriptions.repo');
const { startMongo, MONGO_STARTUP_TIMEOUT_MS } = require('./fixtures/mongo.fixture');

const DAY_MS = 24 * 60 * 60 * 1000;
// In the future on purpose: the TTL index would otherwise delete documents whose cleanupAfter is
// "past" while a test is still using them
const now = new Date('2036-01-01T00:00:00.000Z');
const daysFrom = (date, days) => new Date(date.getTime() + days * DAY_MS);

const newSubscription = (overrides = {}) => ({
  endpoint: 'https://push.example.org/wpush/v2/abc',
  expirationTime: null,
  keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
  clientMeta: { userAgent: 'Mozilla/5.0', appVersion: '1.0.0', clientTime: null },
  sourceSwScript: 'https://earthquake.up.edu.ph/sw.js',
  ...overrides,
});

// Inserts a stored subscription directly, for setting up states the repository can't create itself
const insert = (overrides = {}) => Subscription.create({
  endpoint: `https://push.example.org/wpush/v2/${Math.random().toString(36).slice(2)}`,
  keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
  status: 'active',
  lastSeenAt: now,
  consecutiveFailures: 0,
  ...overrides,
});

const stored = (id) => Subscription.findById(id).lean();

describe('pushSubscriptions.repo', () => {
  let mongo;

  beforeAll(async () => {
    mongo = await startMongo();
  }, MONGO_STARTUP_TIMEOUT_MS);

  afterEach(() => mongo.clear());

  afterAll(async () => {
    if (mongo) await mongo.stop();
  });

  test('isAvailable is true while connected', () => {
    expect(PushSubscriptionsRepo.isAvailable()).toBe(true);
  });

  describe('upsert', () => {
    test('creates a new active subscription', async () => {
      const result = await PushSubscriptionsRepo.upsert(newSubscription(), now);

      expect(result).toEqual({ created: true });
      const doc = await Subscription.findOne({ endpoint: newSubscription().endpoint }).lean();
      expect(doc).toMatchObject({
        keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
        status: 'active',
        lastSeenAt: now,
        consecutiveFailures: 0,
        clientMeta: { userAgent: 'Mozilla/5.0', appVersion: '1.0.0', clientTime: null },
        sourceSwScript: 'https://earthquake.up.edu.ph/sw.js',
      });
    });

    test('refreshes an existing endpoint and clears its failure history', async () => {
      const existing = await insert({
        endpoint: newSubscription().endpoint,
        status: 'invalid',
        consecutiveFailures: 4,
        lastFailureAt: now,
        lastFailureCode: 410,
        invalidatedAt: now,
        cleanupAfter: daysFrom(now, 7),
        sourceSwScript: 'https://earthquake.up.edu.ph/old-sw.js',
      });
      const later = daysFrom(now, 1);

      const result = await PushSubscriptionsRepo.upsert(
        newSubscription({ keys: { p256dh: 'new-p256dh', auth: 'new-auth' }, sourceSwScript: undefined }),
        later,
      );

      expect(result).toEqual({ created: false });
      const doc = await stored(existing._id);
      expect(doc).toMatchObject({
        keys: { p256dh: 'new-p256dh', auth: 'new-auth' },
        status: 'active',
        lastSeenAt: later,
        consecutiveFailures: 0,
        // not sent this time, so the stored one is kept
        sourceSwScript: 'https://earthquake.up.edu.ph/old-sw.js',
      });
      expect(doc).not.toHaveProperty('lastFailureAt');
      expect(doc).not.toHaveProperty('lastFailureCode');
      expect(doc).not.toHaveProperty('invalidatedAt');
      expect(doc).not.toHaveProperty('cleanupAfter');
      expect(await Subscription.countDocuments()).toBe(1);
    });
  });

  test('listActive returns subscribers that are not invalid, in a storage-neutral shape', async () => {
    const active = await insert({ expirationTime: 1767225600000 });
    await insert({ status: 'invalid' });

    const subscribers = await PushSubscriptionsRepo.listActive();

    expect(subscribers).toEqual([
      {
        id: String(active._id),
        endpoint: active.endpoint,
        expirationTime: 1767225600000,
        keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
      },
    ]);
  });

  test('recordDelivery makes it active again and clears its failure history', async () => {
    const sub = await insert({ consecutiveFailures: 2, lastFailureAt: now, lastFailureCode: 503 });
    const later = daysFrom(now, 1);

    await PushSubscriptionsRepo.recordDelivery(String(sub._id), later);

    const doc = await stored(sub._id);
    expect(doc).toMatchObject({ status: 'active', lastDeliveredAt: later, consecutiveFailures: 0 });
    expect(doc).not.toHaveProperty('lastFailureAt');
    expect(doc).not.toHaveProperty('lastFailureCode');
  });

  test('recordFailure counts the failure and keeps it active', async () => {
    const sub = await insert({ consecutiveFailures: 1 });

    await PushSubscriptionsRepo.recordFailure(String(sub._id), 503, now);
    await PushSubscriptionsRepo.recordFailure(String(sub._id), null, now);

    expect(await stored(sub._id)).toMatchObject({
      status: 'active',
      consecutiveFailures: 3,
      lastFailureAt: now,
      lastFailureCode: null,
    });
  });

  test('markInvalid stops deliveries and schedules deletion', async () => {
    const sub = await insert();
    const cleanupAfter = daysFrom(now, 7);

    await PushSubscriptionsRepo.markInvalid(String(sub._id), { code: 410, cleanupAfter, now });

    expect(await stored(sub._id)).toMatchObject({
      status: 'invalid',
      invalidatedAt: now,
      cleanupAfter,
      lastFailureAt: now,
      lastFailureCode: 410,
      consecutiveFailures: 1,
    });
    expect(await PushSubscriptionsRepo.listActive()).toEqual([]);
  });

  test('markExpiredInvalid invalidates subscriptions past their expirationTime', async () => {
    const expired = await insert({ expirationTime: now.getTime() - 1 });
    const notExpired = await insert({ expirationTime: now.getTime() + DAY_MS });
    const noExpiry = await insert({ expirationTime: null });
    const cleanupAfter = daysFrom(now, 7);

    await expect(PushSubscriptionsRepo.markExpiredInvalid({ cleanupAfter, now })).resolves.toBe(1);

    expect(await stored(expired._id)).toMatchObject({
      status: 'invalid',
      invalidatedAt: now,
      cleanupAfter,
      lastFailureAt: now,
      lastFailureCode: 410,
    });
    expect(await stored(notExpired._id)).toMatchObject({ status: 'active' });
    expect(await stored(noExpiry._id)).toMatchObject({ status: 'active' });
  });

  test('markStaleInvalid invalidates long-unseen subscriptions that keep failing', async () => {
    const staleCutoff = daysFrom(now, -90);
    const longAgo = daysFrom(now, -100);
    const stale = await insert({ lastSeenAt: longAgo, consecutiveFailures: 3 });
    const staleButHealthy = await insert({ lastSeenAt: longAgo, consecutiveFailures: 2 });
    const recentFailing = await insert({ lastSeenAt: now, consecutiveFailures: 5 });
    const cleanupAfter = daysFrom(now, 7);

    await expect(PushSubscriptionsRepo.markStaleInvalid({
      staleCutoff, failureThreshold: 3, cleanupAfter, now,
    })).resolves.toBe(1);

    expect(await stored(stale._id)).toMatchObject({ status: 'invalid', invalidatedAt: now, cleanupAfter });
    expect(await stored(staleButHealthy._id)).toMatchObject({ status: 'active' });
    expect(await stored(recentFailing._id)).toMatchObject({ status: 'active' });
  });

  test('deleteExpired deletes invalid subscriptions whose cleanupAfter has passed', async () => {
    const due = await insert({ status: 'invalid', cleanupAfter: daysFrom(now, -1) });
    const notDue = await insert({ status: 'invalid', cleanupAfter: daysFrom(now, 1) });
    const active = await insert({ status: 'active' });

    await expect(PushSubscriptionsRepo.deleteExpired(now)).resolves.toBe(1);

    expect(await stored(due._id)).toBeNull();
    expect(await stored(notDue._id)).not.toBeNull();
    expect(await stored(active._id)).not.toBeNull();
  });
});
