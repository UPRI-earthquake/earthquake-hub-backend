// Behavior both push-subscriptions repositories must have. The same tests run against MongoDB and
// PostgreSQL, so switching PUSH_SUBSCRIPTIONS_DB can't change what is stored or sent.
const Subscription = require('../src/models/subscription.model');
const mongoPushSubscriptionsRepo = require('../src/repositories/mongodb/pushSubscriptions.repo');
const { createPushSubscriptionsRepo } = require('../src/repositories/postgres/pushSubscriptions.repo');
const { startMongo, MONGO_STARTUP_TIMEOUT_MS } = require('./fixtures/mongo.fixture');
const { startPostgres, PG_STARTUP_TIMEOUT_MS } = require('./fixtures/postgres.fixture');

const DAY_MS = 24 * 60 * 60 * 1000;
// In the future on purpose: MongoDB's TTL index would otherwise delete documents whose cleanupAfter
// is "past" while a test is still using them
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

// A stored subscription in one shape for both databases; fields that aren't set are null
const DEFAULTS = {
  expirationTime: null,
  status: 'active',
  lastSeenAt: now,
  lastDeliveredAt: null,
  lastFailureAt: null,
  lastFailureCode: null,
  consecutiveFailures: 0,
  invalidatedAt: null,
  cleanupAfter: null,
  sourceSwScript: null,
  clientMeta: { userAgent: null, appVersion: null, clientTime: null },
};

let endpointCounter = 0;
const uniqueEndpoint = () => `https://push.example.org/wpush/v2/sub-${(endpointCounter += 1)}`;

// Each backend: the repository plus helpers to set up and read stored subscriptions directly
const backends = [
  {
    name: 'mongodb',
    timeout: MONGO_STARTUP_TIMEOUT_MS,
    start: async () => {
      const mongo = await startMongo();
      const toView = (doc) => doc && ({
        endpoint: doc.endpoint,
        expirationTime: doc.expirationTime ?? null,
        keys: { p256dh: doc.keys.p256dh, auth: doc.keys.auth },
        status: doc.status,
        lastSeenAt: doc.lastSeenAt ?? null,
        lastDeliveredAt: doc.lastDeliveredAt ?? null,
        lastFailureAt: doc.lastFailureAt ?? null,
        lastFailureCode: doc.lastFailureCode ?? null,
        consecutiveFailures: doc.consecutiveFailures,
        invalidatedAt: doc.invalidatedAt ?? null,
        cleanupAfter: doc.cleanupAfter ?? null,
        sourceSwScript: doc.sourceSwScript ?? null,
        clientMeta: {
          userAgent: doc.clientMeta?.userAgent ?? null,
          appVersion: doc.clientMeta?.appVersion ?? null,
          clientTime: doc.clientMeta?.clientTime ?? null,
        },
      });
      return {
        repo: mongoPushSubscriptionsRepo,
        insert: async (fields = {}) => {
          const doc = await Subscription.create({
            ...DEFAULTS,
            endpoint: uniqueEndpoint(),
            keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
            ...fields,
          });
          return String(doc._id);
        },
        get: async (id) => toView(await Subscription.findById(id).lean()),
        getByEndpoint: async (endpoint) => toView(await Subscription.findOne({ endpoint }).lean()),
        count: () => Subscription.countDocuments(),
        clear: mongo.clear,
        stop: mongo.stop,
      };
    },
  },
  {
    name: 'postgres',
    timeout: PG_STARTUP_TIMEOUT_MS,
    start: async () => {
      const pg = await startPostgres();
      const table = () => pg.db('push_subscriptions');
      const toView = (row) => row && ({
        endpoint: row.endpoint,
        expirationTime: row.expiration_time === null ? null : Number(row.expiration_time),
        keys: { p256dh: row.key_p256dh, auth: row.key_auth },
        status: row.status,
        lastSeenAt: row.last_seen_at,
        lastDeliveredAt: row.last_delivered_at,
        lastFailureAt: row.last_failure_at,
        lastFailureCode: row.last_failure_code,
        consecutiveFailures: row.consecutive_failures,
        invalidatedAt: row.invalidated_at,
        cleanupAfter: row.cleanup_after,
        sourceSwScript: row.source_sw_script,
        clientMeta: {
          userAgent: row.client_user_agent,
          appVersion: row.client_app_version,
          clientTime: row.client_time,
        },
      });
      return {
        repo: createPushSubscriptionsRepo(pg.db),
        insert: async (fields = {}) => {
          const s = { ...DEFAULTS, endpoint: uniqueEndpoint(), keys: { p256dh: 'p256dh-key', auth: 'auth-key' }, ...fields };
          const [{ id }] = await table().insert({
            endpoint: s.endpoint,
            expiration_time: s.expirationTime,
            key_p256dh: s.keys.p256dh,
            key_auth: s.keys.auth,
            status: s.status,
            last_seen_at: s.lastSeenAt,
            last_delivered_at: s.lastDeliveredAt,
            last_failure_at: s.lastFailureAt,
            last_failure_code: s.lastFailureCode,
            consecutive_failures: s.consecutiveFailures,
            invalidated_at: s.invalidatedAt,
            cleanup_after: s.cleanupAfter,
            source_sw_script: s.sourceSwScript,
            client_user_agent: s.clientMeta.userAgent,
            client_app_version: s.clientMeta.appVersion,
            client_time: s.clientMeta.clientTime,
          }).returning('id');
          return id;
        },
        get: async (id) => toView(await table().where({ id }).first()),
        getByEndpoint: async (endpoint) => toView(await table().where({ endpoint }).first()),
        count: async () => Number((await table().count({ n: '*' }).first()).n),
        clear: pg.clear,
        stop: pg.stop,
      };
    },
  },
];

describe.each(backends)('pushSubscriptions.repo ($name)', ({ start, timeout }) => {
  let backend;
  let repo;

  beforeAll(async () => {
    backend = await start();
    ({ repo } = backend);
  }, timeout);

  afterEach(() => backend.clear());

  afterAll(async () => {
    if (backend) await backend.stop();
  });

  test('isAvailable resolves true while connected', async () => {
    await expect(repo.isAvailable()).resolves.toBe(true);
  });

  describe('upsert', () => {
    test('creates a new active subscription', async () => {
      const result = await repo.upsert(newSubscription(), now);

      expect(result).toEqual({ created: true });
      expect(await backend.getByEndpoint(newSubscription().endpoint)).toEqual({
        ...DEFAULTS,
        endpoint: newSubscription().endpoint,
        keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
        clientMeta: { userAgent: 'Mozilla/5.0', appVersion: '1.0.0', clientTime: null },
        sourceSwScript: 'https://earthquake.up.edu.ph/sw.js',
      });
    });

    test('a duplicate endpoint refreshes the existing subscription and clears its failure history', async () => {
      const endpoint = newSubscription().endpoint;
      await backend.insert({
        endpoint,
        status: 'invalid',
        consecutiveFailures: 4,
        lastFailureAt: now,
        lastFailureCode: 410,
        invalidatedAt: now,
        cleanupAfter: daysFrom(now, 7),
        lastDeliveredAt: now,
        sourceSwScript: 'https://earthquake.up.edu.ph/old-sw.js',
      });
      const later = daysFrom(now, 1);
      const clientTime = new Date('2035-12-31T00:00:00.000Z');

      const result = await repo.upsert(newSubscription({
        expirationTime: 1767225600000,
        keys: { p256dh: 'new-p256dh', auth: 'new-auth' },
        clientMeta: { userAgent: 'Firefox', appVersion: null, clientTime },
        sourceSwScript: undefined,
      }), later);

      expect(result).toEqual({ created: false });
      expect(await backend.count()).toBe(1);
      expect(await backend.getByEndpoint(endpoint)).toEqual({
        ...DEFAULTS,
        endpoint,
        expirationTime: 1767225600000,
        keys: { p256dh: 'new-p256dh', auth: 'new-auth' },
        lastSeenAt: later,
        lastDeliveredAt: now, // untouched
        clientMeta: { userAgent: 'Firefox', appVersion: null, clientTime },
        // not sent this time, so the stored one is kept
        sourceSwScript: 'https://earthquake.up.edu.ph/old-sw.js',
      });
    });
  });

  test('listActive returns subscribers that are not invalid, in a storage-neutral shape', async () => {
    const activeId = await backend.insert({ endpoint: 'https://push.example.org/wpush/v2/active', expirationTime: 1767225600000 });
    await backend.insert({ status: 'invalid' });

    const subscribers = await repo.listActive();

    expect(subscribers).toEqual([
      {
        id: activeId,
        endpoint: 'https://push.example.org/wpush/v2/active',
        expirationTime: 1767225600000,
        keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
      },
    ]);
  });

  test('recordDelivery makes it active again and clears its failure history', async () => {
    const id = await backend.insert({ consecutiveFailures: 2, lastFailureAt: now, lastFailureCode: 503 });
    const later = daysFrom(now, 1);

    await repo.recordDelivery(id, later);

    expect(await backend.get(id)).toMatchObject({
      status: 'active',
      lastDeliveredAt: later,
      consecutiveFailures: 0,
      lastFailureAt: null,
      lastFailureCode: null,
      invalidatedAt: null,
      cleanupAfter: null,
    });
  });

  test('recordFailure counts the failure and keeps it active', async () => {
    const id = await backend.insert({ consecutiveFailures: 1 });

    await repo.recordFailure(id, 503, now);
    await repo.recordFailure(id, null, now);

    expect(await backend.get(id)).toMatchObject({
      status: 'active',
      consecutiveFailures: 3,
      lastFailureAt: now,
      lastFailureCode: null,
    });
  });

  test('markInvalid stops deliveries and schedules deletion', async () => {
    const id = await backend.insert();
    const cleanupAfter = daysFrom(now, 7);

    await repo.markInvalid(id, { code: 410, cleanupAfter, now });

    expect(await backend.get(id)).toMatchObject({
      status: 'invalid',
      invalidatedAt: now,
      cleanupAfter,
      lastFailureAt: now,
      lastFailureCode: 410,
      consecutiveFailures: 1,
    });
    expect(await repo.listActive()).toEqual([]);
  });

  test('markExpiredInvalid invalidates subscriptions past their expirationTime', async () => {
    const expired = await backend.insert({ expirationTime: now.getTime() - 1 });
    const notExpired = await backend.insert({ expirationTime: now.getTime() + DAY_MS });
    const noExpiry = await backend.insert({ expirationTime: null });
    const cleanupAfter = daysFrom(now, 7);

    await expect(repo.markExpiredInvalid({ cleanupAfter, now })).resolves.toBe(1);

    expect(await backend.get(expired)).toMatchObject({
      status: 'invalid',
      invalidatedAt: now,
      cleanupAfter,
      lastFailureAt: now,
      lastFailureCode: 410,
    });
    expect(await backend.get(notExpired)).toMatchObject({ status: 'active' });
    expect(await backend.get(noExpiry)).toMatchObject({ status: 'active' });
  });

  test('markStaleInvalid invalidates long-unseen subscriptions that keep failing', async () => {
    const staleCutoff = daysFrom(now, -90);
    const longAgo = daysFrom(now, -100);
    const stale = await backend.insert({ lastSeenAt: longAgo, consecutiveFailures: 3 });
    const staleButHealthy = await backend.insert({ lastSeenAt: longAgo, consecutiveFailures: 2 });
    const recentFailing = await backend.insert({ lastSeenAt: now, consecutiveFailures: 5 });
    const cleanupAfter = daysFrom(now, 7);

    await expect(repo.markStaleInvalid({
      staleCutoff, failureThreshold: 3, cleanupAfter, now,
    })).resolves.toBe(1);

    expect(await backend.get(stale)).toMatchObject({ status: 'invalid', invalidatedAt: now, cleanupAfter });
    expect(await backend.get(staleButHealthy)).toMatchObject({ status: 'active' });
    expect(await backend.get(recentFailing)).toMatchObject({ status: 'active' });
  });

  test('deleteExpired deletes invalid subscriptions whose cleanupAfter has passed', async () => {
    const due = await backend.insert({ status: 'invalid', cleanupAfter: daysFrom(now, -1) });
    const notDue = await backend.insert({ status: 'invalid', cleanupAfter: daysFrom(now, 1) });
    const active = await backend.insert({ status: 'active' });

    await expect(repo.deleteExpired(now)).resolves.toBe(1);

    expect(await backend.get(due)).toBeFalsy();
    expect(await backend.get(notDue)).toBeTruthy();
    expect(await backend.get(active)).toBeTruthy();
  });
});
