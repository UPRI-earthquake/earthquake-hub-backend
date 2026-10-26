const mongoose = require('mongoose');
const { copyPeopleAndSensors } = require('../scripts/copy-people-and-sensors-to-postgres');
const { startMongo, MONGO_STARTUP_TIMEOUT_MS } = require('./fixtures/mongo.fixture');
const { startPostgres, PG_STARTUP_TIMEOUT_MS } = require('./fixtures/postgres.fixture');

const oid = (hex) => new mongoose.Types.ObjectId(hex);
const HASH = '$2a$10$abcdefghijklmnopqrstuuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0';

const ID = {
  juan: oid('6a0000000000000000000a01'),
  maria: oid('6a0000000000000000000a02'),
  brgy: oid('6a0000000000000000000a03'),
  jose: oid('6a0000000000000000000a04'),
  owned: oid('6a0000000000000000000d01'),
  shared: oid('6a0000000000000000000d02'),
  noCoords: oid('6a0000000000000000000d03'),
  unowned: oid('6a0000000000000000000d04'),
  ghost: oid('6a0000000000000000000d99'),
  release: oid('6a0000000000000000000e01'),
};

const account = (fields) => ({
  password: HASH,
  roles: ['citizen', 'sensor'],
  passwordPolicyVersion: 2,
  isApproved: false,
  devices: [],
  releasedDevices: [],
  alertPreferences: { rshakeEmailEnabled: false },
  createdAt: new Date('2025-01-01T00:00:00.000Z'),
  updatedAt: new Date('2025-02-01T00:00:00.000Z'),
  ...fields,
});

const device = (fields) => ({
  network: 'AM',
  latitude: 14.6,
  longitude: 121,
  elevation: 50,
  activity: 'inactive',
  activityToggleTime: new Date('2026-01-01T00:00:00.000Z'),
  createdAt: new Date('2025-01-01T00:00:00.000Z'),
  updatedAt: new Date('2025-02-01T00:00:00.000Z'),
  ...fields,
});

describe('scripts/copy-people-and-sensors-to-postgres', () => {
  let mongo;
  let pg;
  let lines;
  const accounts = () => mongoose.connection.collection('accounts');
  const devices = () => mongoose.connection.collection('devices');
  const copy = (options = {}) => copyPeopleAndSensors({ db: pg.db, log: (line) => lines.push(line), ...options });
  const pgRow = (table, legacyId) => pg.db(table).where({ legacy_mongo_id: String(legacyId) }).first();
  const pgCount = async (table) => Number((await pg.db(table).count({ n: '*' }).first()).n);

  beforeAll(async () => {
    [mongo, pg] = await Promise.all([startMongo(), startPostgres()]);
  }, Math.max(MONGO_STARTUP_TIMEOUT_MS, PG_STARTUP_TIMEOUT_MS));

  beforeEach(() => { lines = []; });
  afterEach(() => Promise.all([mongo.clear(), pg.clear()]));

  afterAll(async () => {
    await Promise.all([mongo && mongo.stop(), pg && pg.stop()]);
  });

  test('copies an account, its device (with the owner) and its release history', async () => {
    await devices().insertOne(device({
      _id: ID.owned, station: 'R0001', streamId: 'AM_R0001_.*/MSEED', macAddress: 'AA:BB:CC:DD:EE:01',
      description: "juan's device", activity: 'streaming', rshakeAlertCredentialHash: 'cred-hash',
    }));
    await accounts().insertOne(account({
      _id: ID.juan,
      email: 'juan@example.org',
      username: 'Juan',
      devices: [ID.owned],
      alertPreferences: { rshakeEmailEnabled: true, updatedAt: new Date('2026-02-01T00:00:00.000Z') },
      passwordResetTokenId: 'reset-hash',
      releasedDevices: [{
        _id: ID.release, deviceId: ID.owned, network: 'AM', station: 'R0001', streamId: 'AM_R0001_.*/MSEED',
        macAddress: 'AA:BB:CC:DD:EE:01', latitude: 14.5, longitude: 121.1, elevation: 40,
        releasedAt: new Date('2025-06-01T00:00:00.000Z'), reason: 'unlink',
      }],
    }));

    const result = await copy();

    expect(result.ok).toBe(true);
    const juan = await pgRow('accounts', ID.juan);
    expect(juan).toMatchObject({
      email: 'juan@example.org',
      username: 'Juan',
      password_hash: HASH,
      roles: '{citizen,sensor}',
      password_policy_version: 2,
      password_reset_token_id: 'reset-hash',
      rshake_email_enabled: true,
      alert_prefs_updated_at: new Date('2026-02-01T00:00:00.000Z'),
      created_at: new Date('2025-01-01T00:00:00.000Z'),
      updated_at: new Date('2025-02-01T00:00:00.000Z'),
    });
    const owned = await pgRow('devices', ID.owned);
    expect(owned).toMatchObject({
      owner_account_id: juan.id,
      station: 'R0001',
      stream_id: 'AM_R0001_.*/MSEED',
      mac_address: 'AA:BB:CC:DD:EE:01',
      elevation_m: 50,
      activity: 'active', // legacy 'streaming'
      rshake_alert_credential_hash: 'cred-hash',
    });
    expect(await pgRow('device_releases', ID.release)).toMatchObject({
      account_id: juan.id,
      device_id: owned.id,
      station: 'R0001',
      elevation_m: 40,
      released_at: new Date('2025-06-01T00:00:00.000Z'),
    });
    expect(result.accounts).toMatchObject({ mongoTotal: 1, inserted: 1, skipped: [] });
    expect(result.devices).toMatchObject({ mongoTotal: 1, inserted: 1, skipped: [] });
    expect(result.releases).toMatchObject({ mongoTotal: 1, inserted: 1, skipped: [] });
  });

  test("a brgy's device list is forwarding, not ownership", async () => {
    await devices().insertOne(device({ _id: ID.owned, station: 'R0001' }));
    await accounts().insertMany([
      account({ _id: ID.juan, email: 'juan@example.org', username: 'juan', devices: [ID.owned] }),
      account({ _id: ID.brgy, email: 'brgy@example.org', username: 'brgy', roles: ['brgy'], isApproved: true, ringserverUrl: 'ring.example.org', ringserverPort: 18000, devices: [ID.owned] }),
    ]);

    const { ownership } = await copy();

    expect((await pgRow('devices', ID.owned)).owner_account_id).toBe((await pgRow('accounts', ID.juan)).id);
    expect(ownership).toMatchObject({ brgyForwardingLinks: 1, sharedDevices: [] });
    expect(await pgRow('accounts', ID.brgy)).toMatchObject({ roles: '{brgy}', ringserver_url: 'ring.example.org', ringserver_port: 18000, is_approved: true });
  });

  test('reports ownership it cannot decide, and copies those devices without an owner', async () => {
    await devices().insertMany([
      device({ _id: ID.shared, station: 'R0002' }),
      device({ _id: ID.unowned, station: 'R0004' }),
    ]);
    await accounts().insertMany([
      account({ _id: ID.juan, email: 'juan@example.org', username: 'juan', devices: [ID.shared, ID.ghost] }),
      account({ _id: ID.maria, email: 'maria@example.org', username: 'maria', devices: [ID.shared] }),
    ]);

    const result = await copy();

    expect(result.ok).toBe(true);
    expect(result.ownership.sharedDevices).toEqual([{ id: String(ID.shared), accountIds: [String(ID.juan), String(ID.maria)] }]);
    expect(result.ownership.missingDevices).toEqual([{ accountId: String(ID.juan), deviceId: String(ID.ghost) }]);
    expect(await pgRow('devices', ID.shared)).toMatchObject({ owner_account_id: null });
    expect(await pgRow('devices', ID.unowned)).toMatchObject({ owner_account_id: null });
  });

  test('skips and reports devices with missing or invalid coordinates or elevation', async () => {
    await devices().insertMany([
      device({ _id: ID.noCoords, station: 'R0003', latitude: null }),
      device({ _id: ID.shared, station: 'R0002', longitude: 500 }),
      device({ _id: ID.unowned, station: 'R0004', elevation: undefined }),
      device({ _id: ID.owned, station: 'R0001' }),
    ]);

    const result = await copy();

    expect(result.ok).toBe(true);
    expect(result.devices.skipped).toEqual(expect.arrayContaining([
      { id: String(ID.noCoords), reason: 'missing coordinates' },
      { id: String(ID.shared), reason: 'invalid coordinates (14.6, 500)' },
      { id: String(ID.unowned), reason: 'missing elevation' },
    ]));
    expect(result.devices.inserted).toBe(1);
    expect(await pgCount('devices')).toBe(1);
  });

  test('skips accounts whose email or username collide ignoring case, and their devices lose the owner', async () => {
    await devices().insertOne(device({ _id: ID.owned, station: 'R0001' }));
    await accounts().insertMany([
      account({ _id: ID.juan, email: 'juan@example.org', username: 'juan', devices: [ID.owned] }),
      account({ _id: ID.maria, email: 'maria@example.org', username: 'JUAN' }),
      account({ _id: ID.jose, email: 'jose@example.org', username: 'jose' }),
      account({ _id: ID.brgy, email: 'JOSE@example.org', username: 'brgy', roles: ['brgy'] }),
    ]);

    const result = await copy();

    expect(result.ok).toBe(true);
    expect(result.accounts.skipped).toEqual(expect.arrayContaining([
      { id: String(ID.juan), reason: `same username as ${ID.maria} (ignoring case)` },
      { id: String(ID.maria), reason: `same username as ${ID.juan} (ignoring case)` },
      { id: String(ID.jose), reason: `same email as ${ID.brgy} (ignoring case)` },
      { id: String(ID.brgy), reason: `same email as ${ID.jose} (ignoring case)` },
    ]));
    expect(await pgCount('accounts')).toBe(0);
    expect(result.ownership.ownerNotCopied).toEqual([{ id: String(ID.owned), accountId: String(ID.juan) }]);
    expect(await pgRow('devices', ID.owned)).toMatchObject({ owner_account_id: null });
  });

  test('skips devices that would collide, in MongoDB or with a PostgreSQL row', async () => {
    await devices().insertMany([
      device({ _id: ID.owned, station: 'R0001', macAddress: 'AA:BB:CC:DD:EE:01' }),
      device({ _id: ID.shared, station: 'R0002', macAddress: 'AA:BB:CC:DD:EE:01' }),
      device({ _id: ID.unowned, station: 'R0004', streamId: '' }),
      device({ _id: ID.noCoords, station: 'R0003' }),
    ]);
    // Registered after the switch, in PostgreSQL
    await pg.db('devices').insert({ network: 'AM', station: 'R0003', latitude: 7, longitude: 125, elevation_m: 10 });

    const result = await copy();

    expect(result.ok).toBe(true);
    expect(result.devices.skipped).toEqual(expect.arrayContaining([
      { id: String(ID.owned), reason: `same MAC address as ${ID.shared}` },
      { id: String(ID.shared), reason: `same MAC address as ${ID.owned}` },
      { id: String(ID.noCoords), reason: 'network and station already used by another PostgreSQL device' },
    ]));
    // An empty stream ID means "not linked yet"
    expect(await pgRow('devices', ID.unowned)).toMatchObject({ stream_id: null });
  });

  test('skips accounts that cannot be stored', async () => {
    await accounts().insertMany([
      account({ _id: ID.juan, email: '', username: 'juan' }),
      account({ _id: ID.maria, email: 'maria@example.org', username: 'maria', roles: ['citizen', 'superuser'] }),
      account({ _id: ID.jose, email: 'jose@example.org', username: 'jose', password: undefined }),
    ]);

    const result = await copy();

    expect(result.accounts.skipped).toEqual([
      { id: String(ID.juan), reason: 'no email' },
      { id: String(ID.maria), reason: 'unknown role ["superuser"]' },
      { id: String(ID.jose), reason: 'no password' },
    ]);
  });

  test('skips an account whose email PostgreSQL already has under another row', async () => {
    await accounts().insertOne(account({ _id: ID.juan, email: 'juan@example.org', username: 'juan' }));
    // Signed up again after the switch, in PostgreSQL
    await pg.db('accounts').insert({ email: 'Juan@Example.org', username: 'juan-new', password_hash: HASH });

    const result = await copy();

    expect(result.ok).toBe(true);
    expect(result.accounts.skipped).toEqual([{ id: String(ID.juan), reason: 'email already used by another PostgreSQL account' }]);
  });

  test('re-running is safe: no duplicates, MongoDB changes are picked up, PostgreSQL changes kept', async () => {
    await devices().insertMany([device({ _id: ID.owned, station: 'R0001' }), device({ _id: ID.unowned, station: 'R0004' })]);
    await accounts().insertOne(account({
      _id: ID.juan, email: 'juan@example.org', username: 'juan', devices: [ID.owned],
      releasedDevices: [{ _id: ID.release, deviceId: ID.owned, network: 'AM', station: 'R0001', releasedAt: new Date('2025-06-01T00:00:00.000Z') }],
    }));
    await copy();

    await accounts().updateOne({ _id: ID.juan }, { $set: { isApproved: true, updatedAt: new Date('2025-03-01T00:00:00.000Z') } });
    await pg.db('devices').where({ legacy_mongo_id: String(ID.unowned) }).update({ activity: 'active' }); // trigger bumps updated_at

    const result = await copy();

    expect(result.ok).toBe(true);
    expect(result.accounts).toMatchObject({ inserted: 0, updated: 1, keptNewer: 0 });
    expect(result.devices).toMatchObject({ inserted: 0, updated: 1, keptNewer: 1 });
    expect(result.releases).toMatchObject({ inserted: 0, alreadyCopied: 1 });
    expect([await pgCount('accounts'), await pgCount('devices'), await pgCount('device_releases')]).toEqual([1, 2, 1]);
    expect(await pgRow('accounts', ID.juan)).toMatchObject({ is_approved: true });
    expect(await pgRow('devices', ID.unowned)).toMatchObject({ activity: 'active' });
  });

  test('a dry run writes nothing', async () => {
    await devices().insertOne(device({ _id: ID.owned, station: 'R0001' }));
    await accounts().insertOne(account({ _id: ID.juan, email: 'juan@example.org', username: 'juan', devices: [ID.owned] }));

    const result = await copy({ dryRun: true });

    expect(result).toMatchObject({ ok: true, accounts: { inserted: 1 }, devices: { inserted: 1 } });
    expect([await pgCount('accounts'), await pgCount('devices')]).toEqual([0, 0]);
  });

  test('the report never shows emails, usernames or password hashes', async () => {
    await devices().insertOne(device({ _id: ID.owned, station: 'R0001', latitude: null }));
    await accounts().insertMany([
      account({ _id: ID.juan, email: 'juan@example.org', username: 'juanito', devices: [ID.owned, ID.ghost] }),
      account({ _id: ID.maria, email: 'maria@example.org', username: 'JUANITO' }),
    ]);

    await copy();

    const report = lines.join('\n');
    expect(report).toContain(String(ID.juan));
    ['juan@example.org', 'maria@example.org', 'juanito', 'JUANITO', HASH].forEach((secret) => {
      expect(report).not.toContain(secret);
    });
  });
});
