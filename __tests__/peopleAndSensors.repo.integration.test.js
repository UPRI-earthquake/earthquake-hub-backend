// Behavior both versions of the accounts and devices repositories must have, run against MongoDB and
// PostgreSQL alike, so switching accounts and devices to PostgreSQL can't change what services see.
// Behavior only one database has (case-insensitive lookups, legacy records) is tested per database.
const mongoose = require('mongoose');
const mongoAccountsRepo = require('../src/repositories/mongodb/accounts.repo');
const mongoDevicesRepo = require('../src/repositories/mongodb/devices.repo');
const mongoTransactions = require('../src/repositories/mongodb/transactions');
const { createAccountsRepo } = require('../src/repositories/postgres/accounts.repo');
const { createDevicesRepo } = require('../src/repositories/postgres/devices.repo');
const { createPostgresTransactions } = require('../src/repositories/postgres/transactions');
const { DuplicateKeyError } = require('../src/repositories/errors');
const { startMongo, MONGO_STARTUP_TIMEOUT_MS } = require('./fixtures/mongo.fixture');
const { startPostgres, PG_STARTUP_TIMEOUT_MS } = require('./fixtures/postgres.fixture');

const account = (fields = {}) => ({
  username: 'juan',
  email: 'juan@example.org',
  password: 'hash',
  roles: ['citizen', 'sensor'],
  ...fields,
});
const device = (fields = {}) => ({
  network: 'AM',
  station: 'R0001',
  latitude: 14.6,
  longitude: 121,
  elevation: 50,
  ...fields,
});

// Each backend: the repositories, its transactions, and helpers to look at stored data directly
const backends = [
  {
    name: 'mongodb',
    timeout: MONGO_STARTUP_TIMEOUT_MS,
    start: async () => {
      const mongo = await startMongo();
      const oid = (id) => new mongoose.Types.ObjectId(id);
      return {
        Accounts: mongoAccountsRepo,
        Devices: mongoDevicesRepo,
        withTransaction: mongoTransactions.withTransaction,
        unknownId: () => new mongoose.Types.ObjectId().toString(),
        storedAccount: async (id) => {
          const doc = await mongoose.connection.collection('accounts').findOne({ _id: oid(id) });
          return { email: doc.email, passwordResetTokenId: doc.passwordResetTokenId ?? null };
        },
        storedLocation: async (id) => (await mongoose.connection.collection('devices').findOne({ _id: oid(id) })).location.coordinates,
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
      return {
        Accounts: createAccountsRepo(pg.db),
        Devices: createDevicesRepo(pg.db),
        withTransaction: createPostgresTransactions(pg.db).withTransaction,
        unknownId: () => '01890000-0000-7000-8000-000000000000',
        storedAccount: async (id) => {
          const row = await pg.db('accounts').where({ id }).first();
          return { email: row.email, passwordResetTokenId: row.password_reset_token_id };
        },
        storedLocation: async (id) => {
          const { rows: [point] } = await pg.db.raw(
            'SELECT ST_X(location::geometry) AS lon, ST_Y(location::geometry) AS lat FROM devices WHERE id = ?', [id],
          );
          return [point.lon, point.lat];
        },
        pg,
        clear: pg.clear,
        stop: pg.stop,
      };
    },
  },
];

describe.each(backends)('accounts and devices repositories ($name)', ({ name, start, timeout }) => {
  let backend;
  let Accounts;
  let Devices;

  beforeAll(async () => {
    backend = await start();
    ({ Accounts, Devices } = backend);
  }, timeout);

  afterEach(() => backend.clear());

  afterAll(async () => {
    if (backend) await backend.stop();
  });

  describe('accounts', () => {
    test('create returns a plain account, with the email trimmed and lowercased', async () => {
      const created = await Accounts.create(account({ email: '  Juan@Example.ORG ' }));

      expect(created).toMatchObject({
        id: expect.any(String),
        username: 'juan',
        email: 'juan@example.org',
        password: 'hash',
        roles: ['citizen', 'sensor'],
        isApproved: false,
        passwordPolicyVersion: 1,
        alertPreferences: { rshakeEmailEnabled: false },
      });
      expect(created).not.toHaveProperty('devices');
      expect((await backend.storedAccount(created.id)).email).toBe('juan@example.org');
      expect(await Accounts.findByEmail('juan@example.org')).toMatchObject({ id: created.id });
      expect(await Accounts.findById(created.id)).toMatchObject({ id: created.id });
    });

    test('every account has a MongoDB-style legacyId (what session tokens carry until Step 4)', async () => {
      const first = await Accounts.create(account());
      const second = await Accounts.create(account({ username: 'maria', email: 'maria@example.org' }));

      expect(first.legacyId).toMatch(/^[0-9a-f]{24}$/);
      expect(second.legacyId).toMatch(/^[0-9a-f]{24}$/);
      expect(second.legacyId).not.toBe(first.legacyId);
      expect(await Accounts.findByUsername('juan')).toMatchObject({ legacyId: first.legacyId });
    });

    test.each([
      ['username', { email: 'other@example.org' }],
      ['email', { username: 'other' }],
    ])('a duplicate %s throws DuplicateKeyError', async (field, other) => {
      await Accounts.create(account());

      await expect(Accounts.create(account(other))).rejects.toMatchObject({ name: 'DuplicateKeyError', fields: [field] });
    });

    test('update applies changes, and undefined removes a field', async () => {
      const { id } = await Accounts.create(account({ passwordResetTokenId: 'token-hash' }));

      const updated = await Accounts.update(id, {
        isApproved: true,
        passwordResetTokenId: undefined,
        alertPreferences: { rshakeEmailEnabled: true, updatedAt: new Date('2026-01-01T00:00:00.000Z') },
      });

      expect(updated).toMatchObject({
        isApproved: true,
        passwordResetTokenId: undefined,
        alertPreferences: { rshakeEmailEnabled: true, updatedAt: new Date('2026-01-01T00:00:00.000Z') },
      });
      expect((await backend.storedAccount(id)).passwordResetTokenId).toBeNull();
    });

    test('update to a taken email throws DuplicateKeyError', async () => {
      await Accounts.create(account());
      const other = await Accounts.create(account({ username: 'maria', email: 'maria@example.org' }));

      await expect(Accounts.update(other.id, { email: 'juan@example.org' })).rejects.toBeInstanceOf(DuplicateKeyError);
    });

    test('update and findById resolve to null for an unknown id', async () => {
      await expect(Accounts.update(backend.unknownId(), { isApproved: true })).resolves.toBeNull();
      await expect(Accounts.findById(backend.unknownId())).resolves.toBeNull();
    });

    test('findByUsername with a role only matches accounts that have it', async () => {
      await Accounts.create(account());

      await expect(Accounts.findByUsername('juan', { role: 'brgy' })).resolves.toBeNull();
      await expect(Accounts.findByUsername('juan', { role: 'citizen' })).resolves.toMatchObject({ username: 'juan' });
    });

    test('remove deletes the account', async () => {
      const { id } = await Accounts.create(account());

      await Accounts.remove(id);

      await expect(Accounts.findById(id)).resolves.toBeNull();
    });

    test('listApprovedRingserverHosts lists approved brgys only', async () => {
      await Accounts.create(account({ username: 'brgy1', email: 'b1@example.org', roles: ['brgy'], isApproved: true, ringserverUrl: 'one.example.org', ringserverPort: 18000 }));
      await Accounts.create(account({ username: 'brgy2', email: 'b2@example.org', roles: ['brgy'], ringserverUrl: 'two.example.org', ringserverPort: 18000 }));
      await Accounts.create(account());

      expect(await Accounts.listApprovedRingserverHosts()).toEqual([
        { username: 'brgy1', ringserverUrl: 'one.example.org', ringserverPort: 18000 },
      ]);
    });
  });

  describe('devices', () => {
    test('a duplicate network+station throws DuplicateKeyError', async () => {
      await Devices.create(device());

      await expect(Devices.create(device({ latitude: 7 }))).rejects.toMatchObject({
        name: 'DuplicateKeyError', fields: expect.arrayContaining(['network', 'station']),
      });
    });

    test('a duplicate MAC address throws DuplicateKeyError on update', async () => {
      await Devices.create(device({ macAddress: 'AA:BB:CC:DD:EE:01' }));
      const other = await Devices.create(device({ station: 'R0002' }));

      await expect(Devices.update(other.id, { macAddress: 'AA:BB:CC:DD:EE:01' })).rejects.toMatchObject({ fields: ['macAddress'] });
    });

    test('create returns a plain device with defaults, and derives location from the coordinates', async () => {
      const created = await Devices.create(device());

      expect(created).toMatchObject({
        id: expect.any(String), network: 'AM', station: 'R0001', streamId: null, macAddress: null,
        elevation: 50, activity: 'inactive', activityToggleTime: new Date(0),
      });
      expect(await backend.storedLocation(created.id)).toEqual([121, 14.6]);
    });

    test('update keeps location in sync with new coordinates', async () => {
      const { id } = await Devices.create(device());

      const updated = await Devices.update(id, { latitude: 7.07, longitude: 125.6, activity: 'active' });

      expect(updated).toMatchObject({ latitude: 7.07, longitude: 125.6, activity: 'active' });
      expect(await backend.storedLocation(id)).toEqual([125.6, 7.07]);
    });

    test('finds devices by stream ID, MAC address, network+station, or either identifier', async () => {
      const d = await Devices.create(device({ streamId: 'AM_R0001_.*/MSEED', macAddress: 'AA:BB:CC:DD:EE:01' }));
      const other = await Devices.create(device({ station: 'R0002', macAddress: 'AA:BB:CC:DD:EE:02' }));

      expect(await Devices.findByStreamId('AM_R0001_.*/MSEED')).toMatchObject({ id: d.id });
      expect(await Devices.findByMacAddress('AA:BB:CC:DD:EE:01')).toMatchObject({ id: d.id });
      expect(await Devices.findByNetworkStation('AM', 'R0002')).toMatchObject({ id: other.id });
      expect((await Devices.findByMacAddressOrStreamId({ macAddress: 'AA:BB:CC:DD:EE:02', streamId: 'AM_R0001_.*/MSEED' }))
        .map((x) => x.id).sort()).toEqual([d.id, other.id].sort());
    });

    test('listByStreamIds returns activity details for the listed streams (ringserver status listener)', async () => {
      const toggled = new Date('2026-01-01T00:00:00.000Z');
      const d = await Devices.create(device({ streamId: 'AM_R0001_.*/MSEED', activity: 'active', activityToggleTime: toggled }));
      await Devices.create(device({ station: 'R0002', streamId: 'AM_R0002_.*/MSEED' }));

      expect(await Devices.listByStreamIds(['AM_R0001_.*/MSEED', 'AM_R9999_.*/MSEED'])).toEqual([
        { id: d.id, streamId: 'AM_R0001_.*/MSEED', activity: 'active', activityToggleTime: toggled },
      ]);
      expect(await Devices.listByStreamIds([])).toEqual([]);
    });

    test('listStationLocations lists station coordinates, optionally by activity (nearest stations for an event)', async () => {
      await Devices.create(device({ activity: 'active' }));
      await Devices.create(device({ station: 'R0002', latitude: 7.07, longitude: 125.6 }));

      expect(await Devices.listStationLocations({ activity: 'active' })).toEqual([{ station: 'R0001', latitude: 14.6, longitude: 121 }]);
      expect((await Devices.listStationLocations()).map((s) => s.station).sort()).toEqual(['R0001', 'R0002']);
    });

    test('setDescription updates every listed device and resolves to how many', async () => {
      const a = await Devices.create(device({ description: 'old' }));
      const b = await Devices.create(device({ station: 'R0002', description: 'new' }));

      await expect(Devices.setDescription([a.id, b.id], 'new')).resolves.toBe(2);
      expect(await Devices.findById(a.id)).toMatchObject({ description: 'new' });
    });

    test("an account's device list holds its devices, and addToAccount skips ones already listed", async () => {
      const owner = await Accounts.create(account());
      const first = await Devices.create(device({ station: 'R0001' }));
      const second = await Devices.create(device({ station: 'R0002' }));

      await Devices.addToAccount(owner.id, [first.id, second.id]);
      await Devices.addToAccount(owner.id, [first.id]);

      expect((await Devices.listAccountDevices(owner.id)).map((d) => d.station)).toEqual(['R0001', 'R0002']);
      expect(await Devices.listAccountDeviceIds(owner.id)).toEqual([first.id, second.id]);
      await expect(Devices.accountHasDevice(owner.id, second.id)).resolves.toBe(true);
    });

    test("a brgy's list is separate from the owner's: adding or removing there leaves the owner alone", async () => {
      const owner = await Accounts.create(account());
      const brgy = await Accounts.create(account({ username: 'brgy', email: 'brgy@example.org', roles: ['brgy'] }));
      const d = await Devices.create(device());
      await Devices.addToAccount(owner.id, [d.id]);

      await Devices.addToAccount(brgy.id, [d.id]);
      expect(await Devices.listAccountDeviceIds(brgy.id)).toEqual([d.id]);
      expect(await Devices.listAccountDeviceIds(owner.id)).toEqual([d.id]);

      await Devices.removeFromAccount(brgy.id, d.id);
      expect(await Devices.listAccountDeviceIds(brgy.id)).toEqual([]);
      expect(await Devices.listAccountDeviceIds(owner.id)).toEqual([d.id]);
    });

    test('removeFromAllAccounts takes the device out of every list', async () => {
      const owner = await Accounts.create(account());
      const brgy = await Accounts.create(account({ username: 'brgy', email: 'brgy@example.org', roles: ['brgy'] }));
      const d = await Devices.create(device());
      await Devices.addToAccount(owner.id, [d.id]);
      await Devices.addToAccount(brgy.id, [d.id]);

      await Devices.removeFromAllAccounts(d.id);

      expect(await Devices.listAccountDeviceIds(owner.id)).toEqual([]);
      expect(await Devices.listAccountDeviceIds(brgy.id)).toEqual([]);
      expect(await Devices.findById(d.id)).toMatchObject({ id: d.id });
    });

    test('findAccountsListing: the owner first, then brgys; filtered by role and by alert emails', async () => {
      const d = await Devices.create(device());
      const citizen = await Accounts.create(account({ alertPreferences: { rshakeEmailEnabled: true } }));
      const brgy = await Accounts.create(account({ username: 'brgy', email: 'brgy@example.org', roles: ['brgy'] }));
      await Devices.addToAccount(citizen.id, [d.id]);
      await Devices.addToAccount(brgy.id, [d.id]);

      expect((await Devices.findAccountsListing(d.id)).map((a) => a.username)).toEqual(['juan', 'brgy']);
      expect((await Devices.findAccountsListing(d.id, { role: 'brgy' })).map((a) => a.username)).toEqual(['brgy']);
      expect((await Devices.findAccountsListing(d.id, { alertsEnabled: true })).map((a) => a.email)).toEqual(['juan@example.org']);
    });

    test('recordRelease moves the device to the release history; clearReleases removes matching entries', async () => {
      const owner = await Accounts.create(account());
      const d = await Devices.create(device({ streamId: 'AM_R0001_.*/MSEED', macAddress: 'AA:BB:CC:DD:EE:01' }));
      await Devices.addToAccount(owner.id, [d.id]);
      const releasedAt = new Date('2026-01-01T00:00:00.000Z');

      await Devices.recordRelease(owner.id, d.id, {
        deviceId: d.id, streamId: d.streamId, macAddress: d.macAddress, network: 'AM', station: 'R0001', releasedAt, reason: 'unlink',
      });

      expect(await Devices.listAccountDeviceIds(owner.id)).toEqual([]);
      expect(await Devices.listReleases(owner.id)).toEqual([expect.objectContaining({
        deviceId: d.legacyId, station: 'R0001', streamId: 'AM_R0001_.*/MSEED', releasedAt, reason: 'unlink',
      })]);

      await expect(Devices.clearReleases({ macAddress: 'AA:BB:CC:DD:EE:01' })).resolves.toBe(1);
      expect(await Devices.listReleases(owner.id)).toEqual([]);
    });

    test('every device has a MongoDB-style legacyId (what the API returns as deviceId)', async () => {
      const first = await Devices.create(device());
      const second = await Devices.create(device({ station: 'R0002' }));

      expect(first.legacyId).toMatch(/^[0-9a-f]{24}$/);
      expect(second.legacyId).not.toBe(first.legacyId);
      expect(await Devices.findByNetworkStation('AM', 'R0001')).toMatchObject({ legacyId: first.legacyId });
    });

    test('a released device keeps its legacyId in the history, also after the device is deleted', async () => {
      const owner = await Accounts.create(account());
      const d = await Devices.create(device());
      await Devices.addToAccount(owner.id, [d.id]);
      await Devices.recordRelease(owner.id, d.id, { deviceId: d.id, station: 'R0001', reason: 'unlink' });

      await Devices.remove(d.id);

      expect(await Devices.listReleases(owner.id)).toEqual([expect.objectContaining({ deviceId: d.legacyId, station: 'R0001' })]);
    });
  });

  describe('withTransaction', () => {
    const setUp = async () => {
      const owner = await Accounts.create(account());
      const d = await Devices.create(device());
      await Devices.addToAccount(owner.id, [d.id]);
      return { owner, d };
    };

    test('commits all writes together', async () => {
      const { owner, d } = await setUp();

      await backend.withTransaction(async (tx) => {
        await Devices.update(d.id, { activity: 'unlinked' }, { tx });
        await Devices.recordRelease(owner.id, d.id, { deviceId: d.id, station: 'R0001' }, { tx });
      });

      expect(await Devices.findById(d.id)).toMatchObject({ activity: 'unlinked' });
      expect(await Devices.listAccountDeviceIds(owner.id)).toEqual([]);
      expect(await Devices.listReleases(owner.id)).toHaveLength(1);
    });

    test('rolls back every write when one step fails', async () => {
      const { owner, d } = await setUp();

      await expect(backend.withTransaction(async (tx) => {
        await Devices.update(d.id, { activity: 'unlinked' }, { tx });
        await Devices.recordRelease(owner.id, d.id, { deviceId: d.id, station: 'R0001' }, { tx });
        throw new Error('later step failed');
      })).rejects.toThrow('later step failed');

      expect(await Devices.findById(d.id)).toMatchObject({ activity: 'inactive' });
      expect(await Devices.listAccountDeviceIds(owner.id)).toEqual([d.id]);
      expect(await Devices.listReleases(owner.id)).toEqual([]);
    });

    test('a device created and listed in a transaction that fails is not kept (link)', async () => {
      const owner = await Accounts.create(account());

      await expect(backend.withTransaction(async (tx) => {
        const d = await Devices.create(device({ macAddress: 'AA:BB:CC:DD:EE:01' }), { tx });
        await Devices.addToAccount(owner.id, [d.id], { tx });
        throw new Error('later step failed');
      })).rejects.toThrow('later step failed');

      expect(await Devices.findByMacAddress('AA:BB:CC:DD:EE:01')).toBeNull();
      expect(await Devices.listAccountDeviceIds(owner.id)).toEqual([]);
    });

    test('an account renamed in a transaction that fails keeps its old username', async () => {
      const { owner } = await setUp();

      await expect(backend.withTransaction(async (tx) => {
        await Accounts.update(owner.id, { username: 'renamed' }, { tx });
        throw new Error('later step failed');
      })).rejects.toThrow('later step failed');

      expect(await Accounts.findById(owner.id)).toMatchObject({ username: 'juan' });
    });
  });

  if (name === 'mongodb') {
    describe('MongoDB only', () => {
      test('legacyId is the account id itself', async () => {
        const created = await Accounts.create(account());

        expect(created.legacyId).toBe(created.id);
      });

      test('an older device missing a required field can still be updated (e.g. unlinked)', async () => {
        const { insertedId } = await mongoose.connection.collection('devices').insertOne({ network: 'AM', station: 'R0009', latitude: 14, longitude: 121 });

        await expect(Devices.update(String(insertedId), { activity: 'unlinked' })).resolves.toMatchObject({ activity: 'unlinked' });
      });

      test('an account listing a device that no longer exists skips it', async () => {
        const owner = await Accounts.create(account());
        const [first, second] = [await Devices.create(device()), await Devices.create(device({ station: 'R0002' }))];
        await Devices.addToAccount(owner.id, [first.id, second.id]);
        await Devices.remove(first.id);

        expect((await Devices.listAccountDevices(owner.id)).map((d) => d.station)).toEqual(['R0002']);
        expect(await Devices.listAccountDeviceIds(owner.id)).toEqual([first.id, second.id]);
      });
    });
  }

  if (name === 'postgres') {
    describe('PostgreSQL only', () => {
      test('an account created here gets a new ObjectId as legacyId, separate from its uuid', async () => {
        const created = await Accounts.create(account());

        expect(created.id).toMatch(/^[0-9a-f]{8}-/);
        expect(created.legacyId).not.toBe(created.id);
        expect((await backend.pg.db('accounts').where({ id: created.id }).first()).legacy_mongo_id).toBe(created.legacyId);
      });

      test('a copied account keeps its MongoDB _id as legacyId', async () => {
        const [{ id }] = await backend.pg.db('accounts')
          .insert({ legacy_mongo_id: '69000000000000000000a001', email: 'copied@example.org', username: 'copied', password_hash: 'hash' })
          .returning('id');

        expect(await Accounts.findById(id)).toMatchObject({ legacyId: '69000000000000000000a001' });
      });

      test('email and username lookups ignore case (citext), with no lowercasing in code', async () => {
        const created = await Accounts.create(account({ username: 'Juan' }));

        expect(await Accounts.findByUsername('JUAN')).toMatchObject({ id: created.id, username: 'Juan' });
        expect(await Accounts.findByEmail('JUAN@Example.org')).toMatchObject({ id: created.id });
        expect(await Accounts.findByUsernameAndEmail('juan', 'Juan@example.ORG')).toMatchObject({ id: created.id });
      });

      test('a duplicate username in another case throws DuplicateKeyError', async () => {
        await Accounts.create(account({ username: 'juan' }));

        await expect(Accounts.create(account({ username: 'JUAN', email: 'other@example.org' }))).rejects.toMatchObject({ fields: ['username'] });
      });

      test('deleting the owner unlinks the device; a brgy forwarding it keeps the link until the device goes', async () => {
        const owner = await Accounts.create(account());
        const brgy = await Accounts.create(account({ username: 'brgy', email: 'brgy@example.org', roles: ['brgy'] }));
        const d = await Devices.create(device());
        await Devices.addToAccount(owner.id, [d.id]);
        await Devices.addToAccount(brgy.id, [d.id]);

        await Accounts.remove(owner.id);
        expect(await Devices.findAccountsListing(d.id)).toEqual([expect.objectContaining({ username: 'brgy' })]);

        await Devices.remove(d.id);
        expect(await Devices.listAccountDeviceIds(brgy.id)).toEqual([]);
      });

      test('recordRelease outside a transaction still writes both changes together', async () => {
        const owner = await Accounts.create(account());
        const d = await Devices.create(device());
        await Devices.addToAccount(owner.id, [d.id]);

        // A snapshot the table rejects (station longer than 16 characters) fails the second write
        await expect(Devices.recordRelease(owner.id, d.id, { deviceId: d.id, station: 'R'.repeat(17) }))
          .rejects.toThrow(/value too long/);

        expect(await Devices.listAccountDeviceIds(owner.id)).toEqual([d.id]);
        expect(await Devices.listReleases(owner.id)).toEqual([]);
      });
    });
  }
});
