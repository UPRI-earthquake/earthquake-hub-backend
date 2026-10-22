// Behavior of the accounts and devices repositories that API responses don't show. Step 2 - Ticket 3
// runs these same cases against the PostgreSQL versions.
const mongoose = require('mongoose');
const AccountsRepo = require('../src/repositories/accounts.repo');
const DevicesRepo = require('../src/repositories/devices.repo');
const { DuplicateKeyError } = require('../src/repositories/errors');
const { withTransaction } = require('../src/repositories/transactions');
const { startMongo, MONGO_STARTUP_TIMEOUT_MS } = require('./fixtures/mongo.fixture');

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

describe('accounts and devices repositories (mongodb)', () => {
  let mongo;

  beforeAll(async () => {
    mongo = await startMongo();
  }, MONGO_STARTUP_TIMEOUT_MS);

  afterEach(() => mongo.clear());

  afterAll(async () => {
    if (mongo) await mongo.stop();
  });

  describe('accounts', () => {
    test('create returns a plain account, with the email normalized', async () => {
      const created = await AccountsRepo.create(account({ email: '  Juan@Example.ORG ' }));

      expect(created).toMatchObject({ id: expect.any(String), username: 'juan', email: 'juan@example.org' });
      expect(created).not.toHaveProperty('devices');
      expect(await AccountsRepo.findByEmail('juan@example.org')).toMatchObject({ id: created.id });
    });

    test.each([
      ['username', { email: 'other@example.org' }],
      ['email', { username: 'other' }],
    ])('a duplicate %s throws DuplicateKeyError', async (field, other) => {
      await AccountsRepo.create(account());

      await expect(AccountsRepo.create(account(other))).rejects.toMatchObject({
        name: 'DuplicateKeyError',
        fields: [field],
      });
    });

    test('update applies changes, and undefined removes a field', async () => {
      const { id } = await AccountsRepo.create(account({ passwordResetTokenId: 'token-hash' }));

      const updated = await AccountsRepo.update(id, { isApproved: true, passwordResetTokenId: undefined });

      expect(updated).toMatchObject({ isApproved: true, passwordResetTokenId: undefined });
      expect(await mongoose.connection.collection('accounts').findOne({ username: 'juan' }))
        .not.toHaveProperty('passwordResetTokenId');
    });

    test('update resolves to null for an unknown id', async () => {
      await expect(AccountsRepo.update(new mongoose.Types.ObjectId().toString(), { isApproved: true })).resolves.toBeNull();
    });

    test('findByUsername with a role only matches accounts that have it', async () => {
      await AccountsRepo.create(account());

      await expect(AccountsRepo.findByUsername('juan', { role: 'brgy' })).resolves.toBeNull();
      await expect(AccountsRepo.findByUsername('juan', { role: 'citizen' })).resolves.toMatchObject({ username: 'juan' });
    });
  });

  describe('devices', () => {
    test('a duplicate network+station throws DuplicateKeyError', async () => {
      await DevicesRepo.create(device());

      await expect(DevicesRepo.create(device({ latitude: 7 }))).rejects.toBeInstanceOf(DuplicateKeyError);
    });

    test('create derives location from latitude/longitude', async () => {
      const { id } = await DevicesRepo.create(device());

      const stored = await mongoose.connection.collection('devices').findOne({ _id: new mongoose.Types.ObjectId(id) });
      expect(stored.location).toEqual({ type: 'Point', coordinates: [121, 14.6] });
    });

    test('update keeps location in sync with new coordinates', async () => {
      const { id } = await DevicesRepo.create(device());

      await DevicesRepo.update(id, { latitude: 7.07, longitude: 125.6 });

      const stored = await mongoose.connection.collection('devices').findOne({ _id: new mongoose.Types.ObjectId(id) });
      expect(stored.location).toEqual({ type: 'Point', coordinates: [125.6, 7.07] });
    });

    test('an older device missing a required field can still be updated (e.g. unlinked)', async () => {
      const { insertedId } = await mongoose.connection.collection('devices').insertOne({ network: 'AM', station: 'R0002', latitude: 14, longitude: 121 });

      const updated = await DevicesRepo.update(String(insertedId), { activity: 'unlinked' });

      expect(updated).toMatchObject({ activity: 'unlinked' });
    });

    test("an account's device list keeps its order and skips devices that no longer exist", async () => {
      const owner = await AccountsRepo.create(account());
      const [first, second, third] = await Promise.all(['R0001', 'R0002', 'R0003'].map((station) => DevicesRepo.create(device({ station }))));
      await DevicesRepo.addToAccount(owner.id, [third.id, first.id, second.id]);
      await DevicesRepo.remove(first.id);

      expect((await DevicesRepo.listAccountDevices(owner.id)).map((d) => d.station)).toEqual(['R0003', 'R0002']);
      expect(await DevicesRepo.listAccountDeviceIds(owner.id)).toEqual([third.id, first.id, second.id]);
      await expect(DevicesRepo.accountHasDevice(owner.id, second.id)).resolves.toBe(true);
    });

    test('addToAccount skips devices already listed', async () => {
      const owner = await AccountsRepo.create(account());
      const d = await DevicesRepo.create(device());

      await DevicesRepo.addToAccount(owner.id, [d.id]);
      await DevicesRepo.addToAccount(owner.id, [d.id]);

      expect(await DevicesRepo.listAccountDeviceIds(owner.id)).toEqual([d.id]);
    });

    test('findAccountsListing filters by role and by alert emails', async () => {
      const d = await DevicesRepo.create(device());
      const citizen = await AccountsRepo.create(account({ alertPreferences: { rshakeEmailEnabled: true } }));
      const brgy = await AccountsRepo.create(account({ username: 'brgy', email: 'brgy@example.org', roles: ['brgy'] }));
      await DevicesRepo.addToAccount(citizen.id, [d.id]);
      await DevicesRepo.addToAccount(brgy.id, [d.id]);

      expect((await DevicesRepo.findAccountsListing(d.id)).map((a) => a.username)).toEqual(['juan', 'brgy']);
      expect((await DevicesRepo.findAccountsListing(d.id, { role: 'brgy' })).map((a) => a.username)).toEqual(['brgy']);
      expect((await DevicesRepo.findAccountsListing(d.id, { alertsEnabled: true })).map((a) => a.email)).toEqual(['juan@example.org']);
    });

    test('recordRelease moves the device to the release history; clearReleases removes matching entries', async () => {
      const owner = await AccountsRepo.create(account());
      const d = await DevicesRepo.create(device({ streamId: 'AM_R0001_.*/MSEED', macAddress: 'AA:BB:CC:DD:EE:01' }));
      await DevicesRepo.addToAccount(owner.id, [d.id]);
      const releasedAt = new Date('2026-01-01T00:00:00.000Z');

      await DevicesRepo.recordRelease(owner.id, d.id, {
        deviceId: d.id, streamId: d.streamId, macAddress: d.macAddress, network: 'AM', station: 'R0001', releasedAt, reason: 'unlink',
      });

      expect(await DevicesRepo.listAccountDeviceIds(owner.id)).toEqual([]);
      expect(await DevicesRepo.listReleases(owner.id)).toEqual([expect.objectContaining({ deviceId: d.id, station: 'R0001', releasedAt })]);

      await expect(DevicesRepo.clearReleases({ macAddress: 'AA:BB:CC:DD:EE:01' })).resolves.toBe(1);
      expect(await DevicesRepo.listReleases(owner.id)).toEqual([]);
    });
  });

  describe('withTransaction', () => {
    test('commits all writes together', async () => {
      const owner = await AccountsRepo.create(account());
      const d = await DevicesRepo.create(device());
      await DevicesRepo.addToAccount(owner.id, [d.id]);

      await withTransaction(async (tx) => {
        await DevicesRepo.update(d.id, { activity: 'unlinked' }, { tx });
        await DevicesRepo.recordRelease(owner.id, d.id, { deviceId: d.id, station: 'R0001' }, { tx });
      });

      expect(await DevicesRepo.findById(d.id)).toMatchObject({ activity: 'unlinked' });
      expect(await DevicesRepo.listAccountDeviceIds(owner.id)).toEqual([]);
    });

    test('rolls back every write when one step fails', async () => {
      const owner = await AccountsRepo.create(account());
      const d = await DevicesRepo.create(device());
      await DevicesRepo.addToAccount(owner.id, [d.id]);

      await expect(withTransaction(async (tx) => {
        await DevicesRepo.update(d.id, { activity: 'unlinked' }, { tx });
        await DevicesRepo.recordRelease(owner.id, d.id, { deviceId: d.id, station: 'R0001' }, { tx });
        throw new Error('later step failed');
      })).rejects.toThrow('later step failed');

      expect(await DevicesRepo.findById(d.id)).toMatchObject({ activity: 'inactive' });
      expect(await DevicesRepo.listAccountDeviceIds(owner.id)).toEqual([d.id]);
      expect(await DevicesRepo.listReleases(owner.id)).toEqual([]);
    });
  });
});
