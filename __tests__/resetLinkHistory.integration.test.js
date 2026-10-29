// POST /device/reset-link for a device that earthquake history lists, with accounts and devices on
// PostgreSQL: event_stations keeps such a device (ON DELETE RESTRICT), so the reset clears it instead
// of deleting it, and linking the sensor again takes the same record back.
jest.mock('../src/services/email.service', () => ({ sendMail: jest.fn().mockResolvedValue({}) }));
jest.mock('axios', () => ({ get: () => Promise.reject(new Error('no network in tests')) }));

const request = require('supertest');
const mongoose = require('mongoose');
const { startMongo, MONGO_STARTUP_TIMEOUT_MS } = require('./fixtures/mongo.fixture');
const { startPostgres, PG_STARTUP_TIMEOUT_MS } = require('./fixtures/postgres.fixture');
const { generateAMStationCode } = require('../src/controllers/helpers');

const PASSWORD = 'Reset-Password-2026!';
const MAC = 'B8:27:EB:12:AB:CD';
const STATION = generateAMStationCode(MAC);
const STREAM_ID = `AM_${STATION}_.*/MSEED`;

describe('reset-link for a device with earthquake history (PEOPLE_AND_SENSORS_DB=postgres)', () => {
  let mongo;
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
  const resetLink = async (username) => request(app).post('/device/reset-link')
    .set('Authorization', `Bearer ${await sensorToken(username)}`)
    .send({ macAddress: MAC, streamId: STREAM_ID });
  const deviceRow = () => pg.db('devices').where({ network: 'AM', station: STATION }).first();
  const ownerName = async () => {
    const row = await pg.db('devices AS d').leftJoin('accounts AS a', 'a.id', 'd.owner_account_id')
      .where({ 'd.station': STATION }).select('a.username').first();
    return row.username;
  };
  const listOnEarthquake = async (deviceId) => {
    const [event] = await pg.db('events').insert({ public_id: 'upri2026jabc', origin_time: new Date('2026-05-01T08:00:00.000Z'), latitude: 14.67, longitude: 121.06 }).returning('id');
    await pg.db('event_stations').insert({ event_id: event.id, device_id: deviceId, kind: 'recording', position: 0 });
  };

  beforeAll(async () => {
    [mongo, pg] = await Promise.all([startMongo(), startPostgres()]);
    Object.assign(process.env, pg.env, {
      PEOPLE_AND_SENSORS_DB: 'postgres', JOB_LOCKS_DB: 'mongodb', PUSH_SUBSCRIPTIONS_DB: 'mongodb', SIGNIFICANT_EQS_DB: 'mongodb',
    });
    app = require('../src/app');
    await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
  }, Math.max(MONGO_STARTUP_TIMEOUT_MS, PG_STARTUP_TIMEOUT_MS));

  beforeEach(async () => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    await Promise.all([mongo.clear(), pg.clear()]);
    await register('juan');
    await register('maria');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await require('../src/db/knex').db.destroy();
    await Promise.all([mongo && mongo.stop(), pg && pg.stop()]);
  });

  test('without history the device is deleted, as before', async () => {
    await link('juan');

    expect((await resetLink('juan')).body.message).toMatch(/reset/i);

    expect(await deviceRow()).toBeUndefined();
  });

  test('with history the record stays, cleared; the history keeps its station', async () => {
    await link('juan');
    const before = await deviceRow();
    await listOnEarthquake(before.id);

    const res = await resetLink('juan');

    expect(res.status).toBe(200);
    expect(res.body.payload).toEqual({ removedAccounts: ['juan'], ownershipConfirmed: true });
    expect(await deviceRow()).toMatchObject({
      id: before.id, owner_account_id: null, stream_id: null, mac_address: null, activity: 'unlinked', rshake_alert_credential_hash: null,
    });
    expect(await pg.db('event_stations').where({ device_id: before.id })).toHaveLength(1);
  });

  test('linking the sensor again takes the same record back, for any account', async () => {
    await link('juan');
    const before = await deviceRow();
    await listOnEarthquake(before.id);
    await resetLink('juan');

    expect((await link('maria')).body.message).toBe('Device-Account Linking Successful');

    expect(await deviceRow()).toMatchObject({ id: before.id, stream_id: STREAM_ID, mac_address: MAC, activity: 'inactive' });
    expect(await ownerName()).toBe('maria');
    expect(await pg.db('event_stations').where({ device_id: before.id })).toHaveLength(1);
  });

  test('a cleared record is only taken back by the MAC its station code comes from', async () => {
    await link('juan');
    await listOnEarthquake((await deviceRow()).id);
    await resetLink('juan');

    const otherMac = 'B8:27:EB:99:99:99';
    const res = await request(app).post('/device/link').send({
      username: 'maria', password: PASSWORD, role: 'sensor', elevation: '55', latitude: '14.64', longitude: '121.06', macAddress: otherMac, streamId: STREAM_ID,
    });

    expect(res.status).not.toBe(200);
    expect(await deviceRow()).toMatchObject({ mac_address: null, stream_id: null });
  });
});
