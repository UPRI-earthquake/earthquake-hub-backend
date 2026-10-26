// The rules the accounts, devices and device_releases tables enforce on every write, on a real
// PostgreSQL. In MongoDB the app checked most of these by hand.
const { startPostgres, PG_STARTUP_TIMEOUT_MS } = require('./fixtures/postgres.fixture');

describe('accounts, devices and device_releases tables', () => {
  let pg;

  beforeAll(async () => {
    pg = await startPostgres();
  }, PG_STARTUP_TIMEOUT_MS);

  afterEach(() => pg.clear());

  afterAll(async () => {
    if (pg) await pg.stop();
  });

  const insertAccount = async (fields = {}) => {
    const [row] = await pg.db('accounts').insert({
      email: 'juan@example.org',
      username: 'juan',
      password_hash: '$2a$10$hash',
      roles: pg.db.raw("'{citizen,sensor}'"),
      ...fields,
    }).returning('*');
    return row;
  };

  const insertDevice = async (fields = {}) => {
    const [row] = await pg.db('devices').insert({
      network: 'AM',
      station: 'R0001',
      latitude: 14.6,
      longitude: 121,
      elevation_m: 50,
      ...fields,
    }).returning('*');
    return row;
  };

  describe('accounts', () => {
    test('a new account gets defaults: no approval, alerts off, policy version 1', async () => {
      const account = await insertAccount();

      expect(account).toMatchObject({
        is_approved: false,
        rshake_email_enabled: false,
        password_policy_version: 1,
        roles: '{citizen,sensor}',
        legacy_mongo_id: null,
      });
      expect(account.id).toMatch(/^[0-9a-f-]{36}$/);
    });

    test('rejects a second account with the same email in a different case', async () => {
      await insertAccount({ email: 'juan@example.org' });

      await expect(insertAccount({ email: 'Juan@Example.ORG', username: 'other' }))
        .rejects.toThrow(/accounts_email_unique/);
    });

    test('rejects a second account with the same username in a different case', async () => {
      await insertAccount({ username: 'juan' });

      await expect(insertAccount({ username: 'JUAN', email: 'other@example.org' }))
        .rejects.toThrow(/accounts_username_unique/);
    });

    test('finds an account by email or username in any case', async () => {
      const account = await insertAccount();

      expect(await pg.db('accounts').where({ email: 'JUAN@example.org' }).first('id')).toEqual({ id: account.id });
      expect(await pg.db('accounts').where({ username: 'Juan' }).first('id')).toEqual({ id: account.id });
    });

    test('rejects a second brgy with the same ringserver URL, but any number of accounts may have none', async () => {
      await insertAccount({ username: 'brgy1', email: 'b1@example.org', roles: pg.db.raw("'{brgy}'"), ringserver_url: 'ring.example.org' });
      await insertAccount({ username: 'citizen1', email: 'c1@example.org' });
      await insertAccount({ username: 'citizen2', email: 'c2@example.org' });

      await expect(insertAccount({ username: 'brgy2', email: 'b2@example.org', ringserver_url: 'ring.example.org' }))
        .rejects.toThrow(/accounts_ringserver_url_unique/);
    });

    test.each([
      ['an unknown role', { roles: pg => pg.db.raw("'{citizen,superuser}'") }, /invalid input value for enum account_role/],
      ['no email', { email: null }, /null value in column "email"/],
      ['a blank username', { username: '  ' }, /accounts_username_not_blank/],
      ['no password hash', { password_hash: null }, /null value in column "password_hash"/],
      ['ringserver port 70000', { ringserver_port: 70000 }, /accounts_ringserver_port_range/],
    ])('rejects %s', async (_, fields, error) => {
      const resolved = Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, typeof v === 'function' ? v(pg) : v]));
      await expect(insertAccount(resolved)).rejects.toThrow(error);
    });
  });

  describe('devices', () => {
    test('a new device is inactive, has no owner, and gets its location from the coordinates', async () => {
      const device = await insertDevice();

      expect(device).toMatchObject({ activity: 'inactive', owner_account_id: null, stream_id: null, mac_address: null });
      expect(device.activity_toggled_at).toEqual(new Date('1970-01-01T00:00:00.000Z'));
      const { rows: [point] } = await pg.db.raw(
        'SELECT ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lon FROM devices WHERE id = ?', [device.id],
      );
      expect(point).toEqual({ lat: 14.6, lon: 121 });
    });

    test('rejects a second device with the same network and station', async () => {
      await insertDevice();

      await expect(insertDevice({ latitude: 7 })).rejects.toThrow(/devices_network_station_unique/);
    });

    test('rejects a stream ID or MAC address already used by another device', async () => {
      await insertDevice({ station: 'R0001', stream_id: 'AM_R0001_.*/MSEED', mac_address: 'AA:BB:CC:DD:EE:01' });

      await expect(insertDevice({ station: 'R0002', stream_id: 'AM_R0001_.*/MSEED' })).rejects.toThrow(/devices_stream_id_unique/);
      await expect(insertDevice({ station: 'R0003', mac_address: 'AA:BB:CC:DD:EE:01' })).rejects.toThrow(/devices_mac_address_unique/);
    });

    test('any number of devices can be not linked yet (no stream ID or MAC)', async () => {
      await insertDevice({ station: 'R0001' });
      await insertDevice({ station: 'R0002' });

      expect(Number((await pg.db('devices').whereNull('mac_address').count({ n: '*' }).first()).n)).toBe(2);
    });

    test.each([
      ['an empty stream ID', { stream_id: '' }, /devices_stream_id_not_empty/],
      ['an empty MAC address', { mac_address: '' }, /devices_mac_address_not_empty/],
      ['latitude 500', { latitude: 500 }, /devices_latitude_range/],
      ['longitude -200', { longitude: -200 }, /devices_longitude_range/],
      ['no elevation', { elevation_m: null }, /null value in column "elevation_m"/],
      ['an unknown activity', { activity: 'streaming' }, /invalid input value for enum device_activity/],
      ['a station longer than 16 characters', { station: 'R'.repeat(17) }, /value too long/],
    ])('rejects %s', async (_, fields, error) => {
      await expect(insertDevice(fields)).rejects.toThrow(error);
    });

    test('rejects an owner that does not exist', async () => {
      await expect(insertDevice({ owner_account_id: '01890000-0000-7000-8000-000000000000' }))
        .rejects.toThrow(/devices_owner_account_id_foreign/);
    });

    test('deleting an account unlinks its devices instead of deleting them', async () => {
      const owner = await insertAccount();
      const device = await insertDevice({ owner_account_id: owner.id });

      await pg.db('accounts').where({ id: owner.id }).del();

      expect(await pg.db('devices').where({ id: device.id }).first()).toMatchObject({ owner_account_id: null });
    });

    test('updating a device moves its location and bumps updated_at', async () => {
      const device = await insertDevice();

      const [updated] = await pg.db('devices').where({ id: device.id }).update({ latitude: 7.07, longitude: 125.6 }).returning('*');

      const { rows: [point] } = await pg.db.raw('SELECT ST_Y(location::geometry) AS lat FROM devices WHERE id = ?', [device.id]);
      expect(point.lat).toBe(7.07);
      expect(updated.updated_at.getTime()).toBeGreaterThan(device.updated_at.getTime());
    });
  });

  describe('brgy_forwarded_devices', () => {
    const forwarding = async () => {
      const brgy = await insertAccount({ username: 'brgy', email: 'brgy@example.org', roles: pg.db.raw("'{brgy}'") });
      const device = await insertDevice();
      await pg.db('brgy_forwarded_devices').insert({ brgy_account_id: brgy.id, device_id: device.id });
      return { brgy, device };
    };
    const linkCount = async () => Number((await pg.db('brgy_forwarded_devices').count({ n: '*' }).first()).n);

    test('a brgy can forward a sensor only once', async () => {
      const { brgy, device } = await forwarding();

      await expect(pg.db('brgy_forwarded_devices').insert({ brgy_account_id: brgy.id, device_id: device.id }))
        .rejects.toThrow(/brgy_forwarded_devices_pkey/);
    });

    test('deleting the brgy account removes its links', async () => {
      const { brgy } = await forwarding();

      await pg.db('accounts').where({ id: brgy.id }).del();

      expect(await linkCount()).toBe(0);
    });

    test('deleting the device removes its links', async () => {
      const { device } = await forwarding();

      await pg.db('devices').where({ id: device.id }).del();

      expect(await linkCount()).toBe(0);
    });

    test('rejects a link to a device that does not exist', async () => {
      const brgy = await insertAccount({ username: 'brgy', email: 'brgy@example.org' });

      await expect(pg.db('brgy_forwarded_devices').insert({ brgy_account_id: brgy.id, device_id: '01890000-0000-7000-8000-000000000000' }))
        .rejects.toThrow(/brgy_forwarded_devices_device_id_foreign/);
    });
  });

  describe('device_releases', () => {
    const insertRelease = async (fields) => {
      const [row] = await pg.db('device_releases').insert({ network: 'AM', station: 'R0001', ...fields }).returning('*');
      return row;
    };

    test('records a snapshot with reason "unlink" and the time it happened', async () => {
      const account = await insertAccount();
      const device = await insertDevice();

      const release = await insertRelease({ account_id: account.id, device_id: device.id });

      expect(release).toMatchObject({ reason: 'unlink', account_id: account.id, device_id: device.id });
      expect(release.released_at).toBeInstanceOf(Date);
    });

    test('deleting the device keeps the history but clears device_id', async () => {
      const account = await insertAccount();
      const device = await insertDevice();
      const release = await insertRelease({ account_id: account.id, device_id: device.id });

      await pg.db('devices').where({ id: device.id }).del();

      expect(await pg.db('device_releases').where({ id: release.id }).first()).toMatchObject({ device_id: null, station: 'R0001' });
    });

    test('deleting the account deletes its history', async () => {
      const account = await insertAccount();
      await insertRelease({ account_id: account.id });

      await pg.db('accounts').where({ id: account.id }).del();

      expect(Number((await pg.db('device_releases').count({ n: '*' }).first()).n)).toBe(0);
    });

    test('rejects a release without an account', async () => {
      await expect(insertRelease({ account_id: null })).rejects.toThrow(/null value in column "account_id"/);
    });
  });
});
