const mongoose = require('mongoose');
const { copySubscriptions } = require('../scripts/copy-subscriptions-to-postgres');
const { startMongo, MONGO_STARTUP_TIMEOUT_MS } = require('./fixtures/mongo.fixture');
const { startPostgres, PG_STARTUP_TIMEOUT_MS } = require('./fixtures/postgres.fixture');

const id = (n) => new mongoose.Types.ObjectId(`66000000000000000000000${n}`);
const at = (iso) => new Date(iso);

const fullDoc = {
  _id: id(1),
  endpoint: 'https://push.example.org/wpush/v2/full',
  expirationTime: 2082758400000,
  keys: { auth: 'auth-1', p256dh: 'p256dh-1' },
  status: 'invalid',
  lastSeenAt: at('2026-03-01T00:00:00Z'),
  lastDeliveredAt: at('2026-03-02T00:00:00Z'),
  lastFailureAt: at('2026-03-03T00:00:00Z'),
  lastFailureCode: 410,
  consecutiveFailures: 2,
  invalidatedAt: at('2026-03-03T00:00:00Z'),
  cleanupAfter: at('2026-03-10T00:00:00Z'),
  sourceSwScript: 'https://earthquake.up.edu.ph/sw.js',
  clientMeta: { userAgent: 'Mozilla/5.0', appVersion: '1.2.0', clientTime: at('2026-03-01T00:00:00Z') },
  createdAt: at('2026-01-01T00:00:00Z'),
  updatedAt: at('2026-03-03T00:00:00Z'),
};

// An old document from before most fields existed
const minimalDoc = {
  _id: id(2),
  endpoint: 'https://push.example.org/wpush/v2/minimal',
  keys: { auth: 'auth-2', p256dh: 'p256dh-2' },
};

describe('scripts/copy-subscriptions-to-postgres', () => {
  let mongo;
  let pg;
  const quiet = () => {};
  const subscriptions = () => mongoose.connection.collection('subscriptions');
  const pgRow = (legacyId) => pg.db('push_subscriptions').where({ legacy_mongo_id: String(legacyId) }).first();
  const pgCount = async () => Number((await pg.db('push_subscriptions').count({ n: '*' }).first()).n);
  const copy = (options = {}) => copySubscriptions({ db: pg.db, log: quiet, ...options });

  beforeAll(async () => {
    [mongo, pg] = await Promise.all([startMongo(), startPostgres()]);
  }, Math.max(MONGO_STARTUP_TIMEOUT_MS, PG_STARTUP_TIMEOUT_MS));

  afterEach(() => Promise.all([mongo.clear(), pg.clear()]));

  afterAll(async () => {
    await Promise.all([mongo && mongo.stop(), pg && pg.stop()]);
  });

  test('copies every field, keeping the original timestamps', async () => {
    await subscriptions().insertOne(fullDoc);

    const result = await copy();

    expect(result).toMatchObject({ ok: true, mongoTotal: 1, inserted: 1, updated: 0, problems: [], conflicts: [] });
    expect(await pgRow(id(1))).toMatchObject({
      legacy_mongo_id: String(id(1)),
      endpoint: fullDoc.endpoint,
      expiration_time: '2082758400000',
      key_auth: 'auth-1',
      key_p256dh: 'p256dh-1',
      status: 'invalid',
      last_seen_at: fullDoc.lastSeenAt,
      last_delivered_at: fullDoc.lastDeliveredAt,
      last_failure_at: fullDoc.lastFailureAt,
      last_failure_code: 410,
      consecutive_failures: 2,
      invalidated_at: fullDoc.invalidatedAt,
      cleanup_after: fullDoc.cleanupAfter,
      source_sw_script: fullDoc.sourceSwScript,
      client_user_agent: 'Mozilla/5.0',
      client_app_version: '1.2.0',
      client_time: fullDoc.clientMeta.clientTime,
      created_at: fullDoc.createdAt,
      updated_at: fullDoc.updatedAt,
    });
  });

  test('fills in defaults for old documents', async () => {
    await subscriptions().insertOne(minimalDoc);

    await copy();

    const createdAt = id(2).getTimestamp();
    expect(await pgRow(id(2))).toMatchObject({
      expiration_time: null,
      status: 'active',
      last_seen_at: createdAt,
      consecutive_failures: 0,
      client_user_agent: null,
      created_at: createdAt,
      updated_at: createdAt,
    });
  });

  test('a dry run writes nothing', async () => {
    await subscriptions().insertMany([fullDoc, minimalDoc]);

    const result = await copy({ dryRun: true });

    expect(result).toMatchObject({ ok: true, inserted: 2, updated: 0 });
    expect(await pgCount()).toBe(0);
  });

  test('re-running is safe: no duplicates, and MongoDB changes are picked up', async () => {
    await subscriptions().insertMany([fullDoc, minimalDoc]);
    await copy();

    await subscriptions().updateOne(
      { _id: id(1) },
      { $set: { consecutiveFailures: 3, updatedAt: at('2026-04-01T00:00:00Z') } },
    );
    const result = await copy();

    expect(result).toMatchObject({ ok: true, inserted: 0, updated: 2, keptNewer: 0 });
    expect(await pgCount()).toBe(2);
    expect(await pgRow(id(1))).toMatchObject({ consecutive_failures: 3, updated_at: at('2026-04-01T00:00:00Z') });
  });

  test('re-running never overwrites a row changed in PostgreSQL since it was copied', async () => {
    await subscriptions().insertOne(fullDoc);
    await copy();
    // The backend, now on PostgreSQL, delivers to it (the trigger bumps updated_at)
    await pg.db('push_subscriptions').where({ legacy_mongo_id: String(id(1)) })
      .update({ status: 'active', consecutive_failures: 0 });

    const result = await copy();

    expect(result).toMatchObject({ ok: true, inserted: 0, updated: 0, keptNewer: 1 });
    expect(await pgRow(id(1))).toMatchObject({ status: 'active', consecutive_failures: 0 });
  });

  test('skips an endpoint PostgreSQL already has under another row', async () => {
    await subscriptions().insertOne(fullDoc);
    // The browser subscribed again after the switch: a PostgreSQL row with no legacy id
    await pg.db('push_subscriptions').insert({
      endpoint: fullDoc.endpoint, key_auth: 'new-auth', key_p256dh: 'new-p256dh',
    });

    const result = await copy();

    expect(result).toMatchObject({ ok: true, inserted: 0, conflicts: [String(id(1))] });
    expect(await pg.db('push_subscriptions').where({ endpoint: fullDoc.endpoint }).first())
      .toMatchObject({ legacy_mongo_id: null, key_auth: 'new-auth' });
  });

  test("lists and skips documents that can't be stored", async () => {
    await subscriptions().insertMany([
      minimalDoc,
      { _id: id(3), keys: { auth: 'a', p256dh: 'p' } },
      { _id: id(4), endpoint: 'https://push.example.org/wpush/v2/no-keys' },
      { _id: id(5), endpoint: 'https://push.example.org/wpush/v2/odd', keys: { auth: 'a', p256dh: 'p' }, status: 'paused' },
    ]);

    const result = await copy();

    expect(result.ok).toBe(true);
    expect(result.inserted).toBe(1);
    expect(result.problems).toEqual([
      { id: String(id(3)), reason: 'no endpoint' },
      { id: String(id(4)), reason: 'missing keys' },
      { id: String(id(5)), reason: 'unknown status "paused"' },
    ]);
    expect(await pgCount()).toBe(1);
  });
});
