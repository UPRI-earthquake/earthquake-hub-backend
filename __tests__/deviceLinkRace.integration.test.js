// Two accounts linking the same unlinked or cleared device record at the same time: both pass the
// checks made before the link's transaction, so the transaction locks the record and checks it again.
// The first link takes the record; the second is told someone else has it, and the owner stays the first.
jest.mock('../src/services/email.service', () => ({ sendMail: jest.fn().mockResolvedValue({}) }));
jest.mock('axios', () => ({ get: () => Promise.reject(new Error('no network in tests')) }));

const request = require('supertest');
const { startPostgres, PG_STARTUP_TIMEOUT_MS } = require('./fixtures/postgres.fixture');
const { generateAMStationCode } = require('../src/controllers/helpers');

const PASSWORD = 'Race-Password-2026!';
const MAC = 'B8:27:EB:34:CD:EF';
const STATION = generateAMStationCode(MAC);
const STREAM_ID = `AM_${STATION}_.*/MSEED`;

describe('two accounts linking the same device record at once', () => {
  let pg;
  let app;

  const register = (username) => request(app).post('/accounts/register').send({
    role: 'citizen', username, email: `${username}@example.org`, password: PASSWORD, confirmPassword: PASSWORD,
  });
  const link = (username) => request(app).post('/device/link').send({
    username, password: PASSWORD, role: 'sensor', elevation: '55', latitude: '14.64', longitude: '121.06', macAddress: MAC, streamId: STREAM_ID,
  });
  const sensorToken = async (username) => (await request(app).post('/accounts/authenticate')
    .send({ username, password: PASSWORD, role: 'sensor' })).body.accessToken;
  const postWithToken = async (path, username) => request(app).post(path)
    .set('Authorization', `Bearer ${await sensorToken(username)}`)
    .send({ macAddress: MAC, streamId: STREAM_ID });
  const deviceRow = () => pg.db('devices').where({ network: 'AM', station: STATION }).first();
  const ownerName = async () => {
    const row = await pg.db('devices AS d').leftJoin('accounts AS a', 'a.id', 'd.owner_account_id')
      .where({ 'd.station': STATION }).select('a.username').first();
    return row.username;
  };
  const listOnEarthquake = async (deviceId) => {
    const [event] = await pg.db('events').insert({ public_id: 'upri2026jrace', origin_time: new Date('2026-05-01T08:00:00.000Z'), latitude: 14.67, longitude: 121.06 }).returning('id');
    await pg.db('event_stations').insert({ event_id: event.id, device_id: deviceId, kind: 'recording', position: 0 });
  };

  // Holds each link at the repository lookup it makes before its transaction until both links have made
  // it, so both see the record as free: the race the transaction's check must settle
  const holdBothAt = (lookup) => {
    const DevicesRepo = require('../src/repositories/devices.repo');
    const original = DevicesRepo[lookup];
    let arrived = 0;
    let release;
    const bothArrived = new Promise((resolve) => { release = resolve; });
    jest.spyOn(DevicesRepo, lookup).mockImplementation(async (...args) => {
      const result = await original(...args);
      arrived += 1;
      if (arrived === 2) release();
      await bothArrived;
      return result;
    });
  };

  const expectOneWinner = async ([first, second]) => {
    const messages = [first.body.message, second.body.message];
    expect(messages.filter((m) => m === 'Device-Account Linking Successful')).toHaveLength(1);
    const winner = first.body.message === 'Device-Account Linking Successful' ? 'maria' : 'pedro';
    const loser = winner === 'maria' ? second : first;
    expect(loser.status).not.toBe(200);
    expect(await ownerName()).toBe(winner);
  };

  beforeAll(async () => {
    pg = await startPostgres();
    Object.assign(process.env, pg.env);
    app = require('../src/app');
  }, PG_STARTUP_TIMEOUT_MS);

  beforeEach(async () => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    await pg.clear();
    await register('juan');
    await register('maria');
    await register('pedro');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await require('../src/db/knex').db.destroy();
    if (pg) await pg.stop();
  });

  test('a cleared record (reset while earthquake history lists it) goes to one of them', async () => {
    await link('juan');
    const before = await deviceRow();
    await listOnEarthquake(before.id);
    expect((await postWithToken('/device/reset-link', 'juan')).status).toBe(200);
    expect(await deviceRow()).toMatchObject({ mac_address: null, stream_id: null, owner_account_id: null });

    holdBothAt('findByNetworkStation');
    await expectOneWinner(await Promise.all([link('maria'), link('pedro')]));

    expect(await deviceRow()).toMatchObject({ id: before.id, mac_address: MAC, stream_id: STREAM_ID, activity: 'inactive' });
  });

  test('an unlinked record (unlinked by its owner) goes to one of them', async () => {
    await link('juan');
    const before = await deviceRow();
    expect((await postWithToken('/device/unlink', 'juan')).status).toBe(200);
    expect(await deviceRow()).toMatchObject({ activity: 'unlinked', owner_account_id: null, mac_address: MAC });

    holdBothAt('findByMacAddress');
    await expectOneWinner(await Promise.all([link('maria'), link('pedro')]));

    expect(await deviceRow()).toMatchObject({ id: before.id, activity: 'inactive' });
  });

  test('the same account sending its link twice at once is told it is already linked', async () => {
    await link('juan');
    expect((await postWithToken('/device/unlink', 'juan')).status).toBe(200);

    holdBothAt('findByMacAddress');
    const responses = await Promise.all([link('maria'), link('maria')]);

    expect(responses.map((res) => res.status)).toEqual([200, 200]);
    expect(responses.map((res) => res.body.message).sort()).toEqual([
      'Device-Account Linking Successful',
      'Device-Account already linked',
    ]);
    expect(await ownerName()).toBe('maria');
  });
});
