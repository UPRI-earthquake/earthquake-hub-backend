// End-to-end flows for accounts and devices through the real app, run once per database setting
// (peopleAndSensors.flows.*.integration.test.js): the same flows must work on MongoDB and PostgreSQL.
// Covers sign-up and sign-in, linking/unlinking a device and its history, deleting an account, a failed
// step inside link/unlink rolling everything back, and the other areas that look devices up (station
// status updates, nearest stations for a new earthquake).
//
// The test file must mock src/services/email.service and axios (place-name lookups).
const request = require('supertest');
const mongoose = require('mongoose');
const { startMongo, MONGO_STARTUP_TIMEOUT_MS } = require('./mongo.fixture');
const { startPostgres, PG_STARTUP_TIMEOUT_MS } = require('./postgres.fixture');
const { generateAMStationCode } = require('../../src/controllers/helpers');

const PASSWORD = 'Flows-Password-2026!';
const MAC = 'B8:27:EB:12:AB:CD';
const STATION = generateAMStationCode(MAC);
const STREAM_ID = `AM_${STATION}_.*/MSEED`;

const describePeopleAndSensorsFlows = (database) => describe(`accounts and devices end to end (PEOPLE_AND_SENSORS_DB=${database})`, () => {
  let mongo;
  let pg;
  let app;
  let DevicesRepo;
  let EQEventsService;

  const register = (username, email) => request(app).post('/accounts/register').send({
    role: 'citizen', username, email, password: PASSWORD, confirmPassword: PASSWORD,
  });
  const signIn = (identifier, role = 'citizen', agent = request(app)) => agent.post('/accounts/authenticate')
    .send({ identifier, password: PASSWORD, role });
  const signedIn = async (username) => {
    const agent = request.agent(app);
    const res = await signIn(username, 'citizen', agent);
    if (res.status !== 200) throw new Error(`sign-in failed: ${res.status}`);
    return agent;
  };
  const sensorToken = async (username) => (await signIn(username, 'sensor')).body.accessToken;
  const link = (username) => request(app).post('/device/link').send({
    username, password: PASSWORD, role: 'sensor', elevation: '55', latitude: '14.64', longitude: '121.06', macAddress: MAC, streamId: STREAM_ID,
  });
  const unlink = async (username) => request(app).post('/device/unlink')
    .set('Authorization', `Bearer ${await sensorToken(username)}`)
    .send({ macAddress: MAC, streamId: STREAM_ID });
  const myDevices = async (username) => (await (await signedIn(username)).get('/device/my-devices')).body;

  beforeAll(async () => {
    [mongo, pg] = await Promise.all([startMongo(), startPostgres()]);
    Object.assign(process.env, pg.env, { PEOPLE_AND_SENSORS_DB: database });
    app = require('../../src/app');
    DevicesRepo = require('../../src/repositories/devices.repo');
    EQEventsService = require('../../src/services/EQevents.service');
    await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
  }, Math.max(MONGO_STARTUP_TIMEOUT_MS, PG_STARTUP_TIMEOUT_MS));

  beforeEach(async () => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    await Promise.all([mongo.clear(), pg.clear()]);
    await register('juan', 'juan@example.org');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await require('../../src/db/knex').db.destroy();
    await Promise.all([mongo && mongo.stop(), pg && pg.stop()]);
  });

  describe('register and sign in', () => {
    test('a registered account signs in by username, and by email in any case', async () => {
      expect((await signIn('juan')).status).toBe(200);
      expect((await signIn('JUAN@Example.ORG')).status).toBe(200);
    });

    test('a username or email already in use, in any case, cannot register again', async () => {
      expect((await register('juan', 'other@example.org')).body.message).toBe('Username already in use');
      expect((await register('maria', 'Juan@EXAMPLE.org')).body.message).toBe('Email address already in use');
    });

    test(`signing in by username in another case: ${database === 'postgres' ? 'works (citext)' : 'fails (MongoDB matches usernames exactly)'}`, async () => {
      expect((await signIn('JUAN')).status).toBe(database === 'postgres' ? 200 : 401);
    });
  });

  describe('link and unlink a device', () => {
    test('linking adds the device to my devices; unlinking moves it to the history; relinking brings it back', async () => {
      expect((await link('juan')).body.message).toBe('Device-Account Linking Successful');
      expect((await myDevices('juan')).devices.map((d) => d.station)).toEqual([STATION]);

      expect((await unlink('juan')).status).toBe(200);
      const afterUnlink = await myDevices('juan');
      expect(afterUnlink.devices).toEqual([]);
      expect(afterUnlink.releasedDevices).toEqual([expect.objectContaining({ station: STATION, streamId: STREAM_ID, macAddress: MAC, reason: 'unlink' })]);
      expect((await request(app).get(`/device/status?network=AM&station=${STATION}`)).body.payload).toMatchObject({ activity: 'unlinked' });

      expect((await link('juan')).body.message).toBe('Device-Account Linking Successful');
      const afterRelink = await myDevices('juan');
      expect(afterRelink.devices.map((d) => d.station)).toEqual([STATION]);
      expect(afterRelink.releasedDevices).toEqual([]);
    });

    test("another account cannot link or unlink someone else's device", async () => {
      await register('maria', 'maria@example.org');
      await link('juan');

      expect((await link('maria')).status).toBe(409);
      expect((await unlink('maria')).body.message).toBe('Device does not belong to you');
    });
  });

  describe('delete an account', () => {
    test('blocked while it has devices; allowed after unlinking; then it can no longer sign in', async () => {
      await link('juan');
      expect((await (await signedIn('juan')).delete('/accounts')).status).toBe(409);

      await unlink('juan');
      expect((await (await signedIn('juan')).delete('/accounts')).status).toBe(200);
      expect((await signIn('juan')).status).toBe(401);
    });
  });

  describe('a failed step rolls back the whole link or unlink', () => {
    test('unlink: the device stays linked and active, with no history entry', async () => {
      await link('juan');
      jest.spyOn(DevicesRepo, 'recordRelease').mockRejectedValueOnce(new Error('release write failed'));

      expect((await unlink('juan')).status).toBe(500);

      const after = await myDevices('juan');
      expect(after.devices).toEqual([expect.objectContaining({ station: STATION, activity: 'inactive' })]);
      expect(after.releasedDevices).toEqual([]);
    });

    test('link: no device is left behind', async () => {
      jest.spyOn(DevicesRepo, 'addToAccount').mockRejectedValueOnce(new Error('account list write failed'));

      expect((await link('juan')).status).toBe(500);

      expect(await DevicesRepo.findByMacAddress(MAC)).toBeNull();
      expect((await myDevices('juan')).devices).toEqual([]);
    });
  });

  describe('device lookups from other areas', () => {
    test('a station status update changes the device found by network and station', async () => {
      await link('juan');

      const res = await request(app).post('/messaging/restricted/station-status').send({ network: 'AM', station: STATION, status: 'streaming' });

      expect(res.status).toBe(200);
      expect((await request(app).get(`/device/status?network=AM&station=${STATION}`)).body.payload).toMatchObject({ activity: 'active', status: 'Streaming' });
    });

    test("a new earthquake lists the nearest active station (events are still on MongoDB)", async () => {
      await link('juan');
      await request(app).post('/messaging/restricted/station-status').send({ network: 'AM', station: STATION, status: 'streaming' });

      await EQEventsService.addEQEvent('flows2026abcd', new Date().toISOString(), 14.6, 121.0, 10, 4.5, 'NEW', 'Test event', new Date().toISOString());

      const event = await mongoose.connection.collection('events').findOne({ publicID: 'flows2026abcd' });
      expect(event.onlineStations).toContain(STATION);
    });
  });
});

module.exports = { describePeopleAndSensorsFlows };
