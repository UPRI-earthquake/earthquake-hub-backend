// Golden-file tests for People & Sensors (accounts, devices) of the PostgreSQL migration. They run the
// real app against seeded data and compare each response with its recording in __tests__/golden/.
// Each peopleAndSensors.golden.*.integration.test.js runs these cases with one set of area settings,
// so every setting must give identical responses.
//
// The test file must mock src/services/email.service (password reset sends mail).
const request = require('supertest');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const { startMongo, MONGO_STARTUP_TIMEOUT_MS } = require('./mongo.fixture');
const { startPostgres, PG_STARTUP_TIMEOUT_MS } = require('./postgres.fixture');
const { expectGolden } = require('./golden');
const { generateAMStationCode } = require('../../src/controllers/helpers');

const oid = (hex) => new mongoose.Types.ObjectId(hex);
const at = (iso) => new Date(iso);

const PASSWORD = 'Golden-Password-2026!';
const NEW_PASSWORD = 'Another-Golden-Pass-2026!';
const PASSWORD_HASH = bcrypt.hashSync(PASSWORD, 10);

const ID = {
  citizen: oid('69000000000000000000a001'),
  other: oid('69000000000000000000a002'),
  brgy: oid('69000000000000000000a003'),
  pendingBrgy: oid('69000000000000000000a004'),
  emptyCitizen: oid('69000000000000000000a005'),
  linked: oid('69000000000000000000d001'),
  notYetLinked: oid('69000000000000000000d002'),
  othersDevice: oid('69000000000000000000d003'),
  released: oid('69000000000000000000d009'),
};

// A device record as stored (all fields set, so no defaults are involved)
const device = (fields) => ({
  description: null,
  streamId: null,
  macAddress: null,
  latitude: 14.65,
  longitude: 121.07,
  elevation: 70,
  location: { type: 'Point', coordinates: [121.07, 14.65] },
  activity: 'inactive',
  activityToggleTime: at('2026-01-01T00:00:00.000Z'),
  rshakeAlertCredentialHash: null,
  rshakeAlertCredentialIssuedAt: null,
  createdAt: at('2025-01-01T00:00:00.000Z'),
  updatedAt: at('2025-01-01T00:00:00.000Z'),
  __v: 0,
  ...fields,
});

const DEVICES = [
  device({
    _id: ID.linked,
    description: "golden_citizen's device",
    network: 'AM',
    station: 'R3B2D',
    streamId: 'AM_R3B2D_.*/MSEED',
    macAddress: 'B8:27:EB:00:3B:2D',
    activity: 'active',
    activityToggleTime: at('2026-05-01T08:00:00.000Z'),
  }),
  device({ _id: ID.notYetLinked, network: 'AM', station: 'RE722' }),
  device({
    _id: ID.othersDevice,
    description: "other_citizen's device",
    network: 'AM',
    station: 'R0001',
    streamId: 'AM_R0001_.*/MSEED',
    macAddress: 'B8:27:EB:00:00:01',
    latitude: 7.07,
    longitude: 125.6,
    elevation: 20,
    location: { type: 'Point', coordinates: [125.6, 7.07] },
  }),
];

// An account record as stored
const account = (fields) => ({
  passwordPolicyVersion: 2,
  passwordUpdatedAt: at('2025-02-01T00:00:00.000Z'),
  isApproved: false,
  devices: [],
  releasedDevices: [],
  alertPreferences: { rshakeEmailEnabled: false },
  createdAt: at('2025-01-01T00:00:00.000Z'),
  updatedAt: at('2025-01-01T00:00:00.000Z'),
  __v: 0,
  password: PASSWORD_HASH,
  ...fields,
});

const ACCOUNTS = [
  account({
    _id: ID.citizen,
    username: 'golden_citizen',
    email: 'golden.citizen@example.org',
    roles: ['citizen', 'sensor'],
    devices: [ID.linked],
    releasedDevices: [{
      _id: oid('69000000000000000000e001'),
      deviceId: ID.released,
      streamId: 'AM_R9999_.*/MSEED',
      macAddress: 'B8:27:EB:00:99:99',
      network: 'AM',
      station: 'R9999',
      description: "golden_citizen's device",
      longitude: 121.05,
      latitude: 14.6,
      elevation: 60,
      releasedAt: at('2026-03-01T00:00:00.000Z'),
      reason: 'unlink',
    }],
    alertPreferences: { rshakeEmailEnabled: true, updatedAt: at('2026-02-01T00:00:00.000Z') },
  }),
  account({
    _id: ID.other,
    username: 'other_citizen',
    email: 'other.citizen@example.org',
    roles: ['citizen', 'sensor'],
    devices: [ID.othersDevice],
  }),
  account({
    _id: ID.emptyCitizen,
    username: 'empty_citizen',
    email: 'empty.citizen@example.org',
    roles: ['citizen', 'sensor'],
    passwordPolicyVersion: 1,
  }),
  account({
    _id: ID.brgy,
    username: 'golden_brgy',
    email: 'golden.brgy@example.org',
    roles: ['brgy'],
    isApproved: true,
    ringserverUrl: 'ringserver.golden.example.org',
    ringserverPort: 18000,
    devices: [ID.linked], // forwards golden_citizen's device
  }),
  account({
    _id: ID.pendingBrgy,
    username: 'pending_brgy',
    email: 'pending.brgy@example.org',
    roles: ['brgy'],
    ringserverUrl: 'pending.golden.example.org',
    ringserverPort: 18000,
  }),
];

const NEW_MAC = 'B8:27:EB:12:AB:CD';
const NEW_STATION = generateAMStationCode(NEW_MAC);
const linkBody = (fields = {}) => ({
  username: 'golden_citizen',
  password: PASSWORD,
  role: 'sensor',
  elevation: '55',
  latitude: '14.64',
  longitude: '121.06',
  macAddress: NEW_MAC,
  streamId: `AM_${NEW_STATION}_.*/MSEED`,
  ...fields,
});

// settings: the area settings to run the app with, e.g. { PEOPLE_AND_SENSORS_DB: 'postgres' }
const describePeopleAndSensorsGolden = (settings = {}) => describe(`People & Sensors: recorded API responses (${
  Object.entries(settings).map(([key, value]) => `${key}=${value}`).join(', ') || 'defaults'
})`, () => {
  let mongo;
  let pg;
  let app;
  let EmailService;
  const webOrigin = () => `http://${process.env.CLIENT_DEV_HOST}:${process.env.CLIENT_DEV_PORT}`;

  const send = (req, agent = null) => {
    let call = (agent || request(app))[req.method.toLowerCase()](req.path);
    Object.entries(req.headers || {}).forEach(([name, value]) => { call = call.set(name, value); });
    return req.body === undefined ? call : call.send(req.body).set('Content-Type', 'application/json');
  };
  // Header values that hold a token are recorded as "<bearer token>", not the token itself
  const recorded = (req) => (req.headers?.Authorization
    ? { ...req, headers: { ...req.headers, Authorization: '<bearer token>' } }
    : req);

  const signIn = async (username, role = 'citizen', headers = {}) => {
    const agent = request.agent(app);
    const res = await send({ method: 'POST', path: '/accounts/authenticate', body: { username, password: PASSWORD, role }, headers }, agent);
    if (res.status !== 200) throw new Error(`Sign-in for ${username} failed: ${res.status}`);
    return { agent, res };
  };
  const sensorToken = async (username = 'golden_citizen') => (await signIn(username, 'sensor')).res.body.accessToken;
  const brgyToken = async () => (await signIn('golden_brgy', 'brgy')).res.body.accessToken;

  // Sends `req` and compares it with the recording `name`
  const check = async (name, req, { agent = null, replace } = {}) => {
    const res = await send(req, agent);
    expectGolden(name, recorded(req), res, { replace });
    return res;
  };

  beforeAll(async () => {
    [mongo, pg] = await Promise.all([startMongo(), startPostgres()]);
    // Before the app loads: repositories pick their database, and src/db/knex.js its connection, on load
    Object.assign(process.env, pg.env, settings);
    app = require('../../src/app');
    EmailService = require('../../src/services/email.service');
    await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
  }, Math.max(MONGO_STARTUP_TIMEOUT_MS, PG_STARTUP_TIMEOUT_MS));

  beforeEach(async () => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    await Promise.all([mongo.clear(), pg.clear()]);
    await mongoose.connection.collection('accounts').insertMany(ACCOUNTS);
    await mongoose.connection.collection('devices').insertMany(DEVICES);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await require('../../src/db/knex').db.destroy();
    await Promise.all([mongo && mongo.stop(), pg && pg.stop()]);
  });

  describe('POST /accounts/register', () => {
    const register = (fields) => ({
      method: 'POST',
      path: '/accounts/register',
      body: {
        role: 'citizen',
        username: 'new_citizen',
        email: 'new.citizen@example.org',
        password: PASSWORD,
        confirmPassword: PASSWORD,
        ...fields,
      },
    });

    test('a new citizen', async () => {
      await check('accounts.register.citizen', register({}));
      await check('accounts.register.citizen.then-sign-in', {
        method: 'POST', path: '/accounts/authenticate', body: { username: 'new_citizen', password: PASSWORD, role: 'citizen' },
      }, {
        replace: { [String((await mongoose.connection.collection('accounts').findOne({ username: 'new_citizen' }))._id)]: '<new account id>' },
      });
    });
    test('a new brgy', () => check('accounts.register.brgy', register({
      role: 'brgy', username: 'new_brgy', email: 'new.brgy@example.org', ringserverUrl: 'new.golden.example.org', ringserverPort: 18000,
    })));
    test('a username already in use', () => check('accounts.register.username-taken', register({ username: 'golden_citizen' })));
    test('an email already in use, in another case', () => check('accounts.register.email-taken', register({ email: 'Golden.Citizen@Example.org' })));
    test('a brgy ringserver already in use', () => check('accounts.register.ringserver-taken', register({
      role: 'brgy', username: 'new_brgy', email: 'new.brgy@example.org', ringserverUrl: 'ringserver.golden.example.org', ringserverPort: 18000,
    })));
    test('an invalid body', () => check('accounts.register.invalid', register({ email: 'not-an-email', confirmPassword: 'different' })));
  });

  describe('POST /accounts/authenticate', () => {
    const authenticate = (body, headers) => ({ method: 'POST', path: '/accounts/authenticate', body, headers });

    test('a citizen by username', () => check('accounts.authenticate.citizen-by-username',
      authenticate({ username: 'golden_citizen', password: PASSWORD, role: 'citizen' })));
    test('a citizen by email in another case', () => check('accounts.authenticate.citizen-by-email',
      authenticate({ identifier: 'GOLDEN.Citizen@example.org', password: PASSWORD, role: 'citizen' })));
    test('a citizen on the legacy password policy', () => check('accounts.authenticate.legacy-policy',
      authenticate({ username: 'empty_citizen', password: PASSWORD, role: 'citizen' })));
    test('a sensor (tokens in the body)', () => check('accounts.authenticate.sensor',
      authenticate({ username: 'golden_citizen', password: PASSWORD, role: 'sensor' })));
    test('a brgy from the web app (cookies)', () => check('accounts.authenticate.brgy-web',
      authenticate({ username: 'golden_brgy', password: PASSWORD, role: 'brgy' }, { Origin: webOrigin() })));
    test('a brgy from a ringserver (tokens in the body)', () => check('accounts.authenticate.brgy-ringserver',
      authenticate({ username: 'golden_brgy', password: PASSWORD, role: 'brgy' })));
    test('a brgy not yet approved', () => check('accounts.authenticate.brgy-not-approved',
      authenticate({ username: 'pending_brgy', password: PASSWORD, role: 'brgy' })));
    test('a wrong password', () => check('accounts.authenticate.wrong-password',
      authenticate({ username: 'golden_citizen', password: 'Wrong-Password-2026!', role: 'citizen' })));
    test('an unknown account', () => check('accounts.authenticate.unknown',
      authenticate({ username: 'nobody', password: PASSWORD, role: 'citizen' })));
    test('a role the account does not have', () => check('accounts.authenticate.wrong-role',
      authenticate({ username: 'golden_citizen', password: PASSWORD, role: 'brgy' })));
  });

  describe('/accounts/profile', () => {
    test('GET, signed in', async () => {
      const { agent } = await signIn('golden_citizen');
      await check('accounts.profile.get', { method: 'GET', path: '/accounts/profile' }, { agent });
    });
    test('GET, signed out', () => check('accounts.profile.get-signed-out', { method: 'GET', path: '/accounts/profile' }));
    test('PATCH a new email and password, then GET', async () => {
      const { agent } = await signIn('golden_citizen');
      await check('accounts.profile.patch', {
        method: 'PATCH', path: '/accounts/profile', body: { email: 'Golden.New@Example.org', newPassword: NEW_PASSWORD, currentPassword: PASSWORD },
      }, { agent });
      await check('accounts.profile.patch.then-get', { method: 'GET', path: '/accounts/profile' }, { agent });
    });
    test('PATCH with a wrong current password', async () => {
      const { agent } = await signIn('golden_citizen');
      await check('accounts.profile.patch-wrong-password', {
        method: 'PATCH', path: '/accounts/profile', body: { email: 'golden.new@example.org', currentPassword: 'Wrong-Password-2026!' },
      }, { agent });
    });
    test("PATCH to another account's email", async () => {
      const { agent } = await signIn('golden_citizen');
      await check('accounts.profile.patch-email-taken', {
        method: 'PATCH', path: '/accounts/profile', body: { email: 'OTHER.citizen@example.org', currentPassword: PASSWORD },
      }, { agent });
    });
  });

  describe('account settings', () => {
    test('PATCH /accounts/alert-preferences', async () => {
      const { agent } = await signIn('golden_citizen');
      await check('accounts.alert-preferences', { method: 'PATCH', path: '/accounts/alert-preferences', body: { rshakeEmailEnabled: false } }, { agent });
      await check('accounts.alert-preferences.unchanged', { method: 'PATCH', path: '/accounts/alert-preferences', body: { rshakeEmailEnabled: false } }, { agent });
    });
    test('PATCH /accounts/email', async () => {
      const { agent } = await signIn('golden_citizen');
      await check('accounts.email', { method: 'PATCH', path: '/accounts/email', body: { email: 'golden.changed@example.org', currentPassword: PASSWORD } }, { agent });
    });
    test('PATCH /accounts/password', async () => {
      const { agent } = await signIn('golden_citizen');
      await check('accounts.password', {
        method: 'PATCH', path: '/accounts/password', body: { currentPassword: PASSWORD, newPassword: NEW_PASSWORD, confirmPassword: NEW_PASSWORD },
      }, { agent });
    });
    test('PATCH /accounts/username renames the devices too', async () => {
      const { agent } = await signIn('golden_citizen');
      await check('accounts.username', { method: 'PATCH', path: '/accounts/username', body: { newUsername: 'renamed_citizen', currentPassword: PASSWORD } }, { agent });
      await check('accounts.username.then-my-devices', { method: 'GET', path: '/device/my-devices' }, { agent });
    });
    test('PATCH /accounts/username to a taken one', async () => {
      const { agent } = await signIn('golden_citizen');
      await check('accounts.username-taken', { method: 'PATCH', path: '/accounts/username', body: { newUsername: 'other_citizen', currentPassword: PASSWORD } }, { agent });
    });
    test('DELETE /accounts with devices', async () => {
      const { agent } = await signIn('golden_citizen');
      await check('accounts.delete.has-devices', { method: 'DELETE', path: '/accounts' }, { agent });
    });
    test('DELETE /accounts without devices', async () => {
      const { agent } = await signIn('empty_citizen');
      await check('accounts.delete', { method: 'DELETE', path: '/accounts' }, { agent });
      await check('accounts.delete.then-sign-in', {
        method: 'POST', path: '/accounts/authenticate', body: { username: 'empty_citizen', password: PASSWORD, role: 'citizen' },
      });
    });
  });

  describe('password reset', () => {
    test('forgot, then reset, then sign in with the new password', async () => {
      await check('accounts.forgot-password', { method: 'POST', path: '/accounts/forgot-password', body: { email: 'GOLDEN.citizen@example.org' } });
      const [[mail]] = EmailService.sendMail.mock.calls;
      const token = decodeURIComponent(/token=([^\s]+)/.exec(mail.text)[1]);

      await check('accounts.reset-password', {
        method: 'POST', path: '/accounts/reset-password', body: { token, password: NEW_PASSWORD, confirmPassword: NEW_PASSWORD },
      });
      await check('accounts.reset-password.reused', {
        method: 'POST', path: '/accounts/reset-password', body: { token, password: NEW_PASSWORD, confirmPassword: NEW_PASSWORD },
      });
      await check('accounts.reset-password.then-sign-in', {
        method: 'POST', path: '/accounts/authenticate', body: { username: 'golden_citizen', password: NEW_PASSWORD, role: 'citizen' },
      });
    });
    test('forgot, for an unknown email', () => check('accounts.forgot-password.unknown', {
      method: 'POST', path: '/accounts/forgot-password', body: { email: 'nobody@example.org' },
    }));
  });

  test('GET /accounts/ringserver-hosts', () => check('accounts.ringserver-hosts', { method: 'GET', path: '/accounts/ringserver-hosts' }));

  describe('brgy and sensor tokens', () => {
    test('POST /accounts/verify-sensor-token adds the sensor\'s devices to the brgy', async () => {
      const [brgy, sensor] = [await brgyToken(), await sensorToken('other_citizen')];
      await check('accounts.verify-sensor-token', {
        method: 'POST', path: '/accounts/verify-sensor-token', body: { token: sensor }, headers: { Authorization: `Bearer ${brgy}` },
      });
      const { agent } = await signIn('golden_brgy', 'brgy', { Origin: webOrigin() });
      await check('accounts.verify-sensor-token.then-brgy-devices', { method: 'GET', path: '/device/my-devices' }, { agent });
    });
    test('POST /accounts/brgy/remove-device', async () => {
      const token = await sensorToken();
      await check('accounts.brgy-remove-device', {
        method: 'POST', path: '/accounts/brgy/remove-device', body: { brgyUsername: 'golden_brgy', streamId: 'AM_R3B2D_.*/MSEED' }, headers: { Authorization: `Bearer ${token}` },
      });
      await check('accounts.brgy-remove-device.again', {
        method: 'POST', path: '/accounts/brgy/remove-device', body: { brgyUsername: 'golden_brgy', streamId: 'AM_R3B2D_.*/MSEED' }, headers: { Authorization: `Bearer ${token}` },
      });
    });
  });

  describe('POST /device/link', () => {
    test('a new device, then my devices', async () => {
      const res = await send({ method: 'POST', path: '/device/link', body: linkBody() });
      const created = await mongoose.connection.collection('devices').findOne({ macAddress: NEW_MAC });
      const replace = { [String(created._id)]: '<new device id>' };
      expectGolden('device.link.new', recorded({ method: 'POST', path: '/device/link', body: linkBody() }), res, { replace });
      const { agent } = await signIn('golden_citizen');
      await check('device.link.new.then-my-devices', { method: 'GET', path: '/device/my-devices' }, { agent, replace });
    });
    test('a device already linked to the account', () => check('device.link.already-linked', {
      method: 'POST', path: '/device/link', body: linkBody({ macAddress: 'B8:27:EB:00:3B:2D', streamId: 'AM_R3B2D_.*/MSEED' }),
    }));
    test("another account's device", () => check('device.link.linked-to-someone-else', {
      method: 'POST', path: '/device/link', body: linkBody({ macAddress: 'B8:27:EB:00:00:01', streamId: 'AM_R0001_.*/MSEED' }),
    }));
    test('a station code that does not match the MAC', () => check('device.link.incorrect-am-station', {
      method: 'POST', path: '/device/link', body: linkBody({ streamId: 'AM_R1234_.*/MSEED' }),
    }));
    test('a wrong password', () => check('device.link.wrong-password', {
      method: 'POST', path: '/device/link', body: linkBody({ password: 'Wrong-Password-2026!' }),
    }));
  });

  describe('POST /device/unlink', () => {
    test('an owned device, then my devices and the brgy\'s devices', async () => {
      const token = await sensorToken();
      await check('device.unlink', {
        method: 'POST', path: '/device/unlink', body: { macAddress: 'B8:27:EB:00:3B:2D', streamId: 'AM_R3B2D_.*/MSEED' }, headers: { Authorization: `Bearer ${token}` },
      });
      const { agent } = await signIn('golden_citizen');
      await check('device.unlink.then-my-devices', { method: 'GET', path: '/device/my-devices' }, { agent });
      const brgy = await signIn('golden_brgy', 'brgy', { Origin: webOrigin() });
      await check('device.unlink.then-brgy-devices', { method: 'GET', path: '/device/my-devices' }, { agent: brgy.agent });
      await check('device.unlink.then-relink', { method: 'POST', path: '/device/link', body: linkBody({ macAddress: 'B8:27:EB:00:3B:2D', streamId: 'AM_R3B2D_.*/MSEED' }) });
    });
    test("another account's device", async () => check('device.unlink.not-owned', {
      method: 'POST', path: '/device/unlink', body: { macAddress: 'B8:27:EB:00:00:01', streamId: 'AM_R0001_.*/MSEED' }, headers: { Authorization: `Bearer ${await sensorToken()}` },
    }));
    test('an unknown device', async () => check('device.unlink.not-found', {
      method: 'POST', path: '/device/unlink', body: { macAddress: 'B8:27:EB:00:77:77', streamId: 'AM_R7777_.*/MSEED' }, headers: { Authorization: `Bearer ${await sensorToken()}` },
    }));
  });

  describe('device tokens and credentials', () => {
    test('POST /device/refresh-token', async () => {
      const { refreshToken } = (await signIn('golden_citizen', 'sensor')).res.body;
      await check('device.refresh-token', { method: 'POST', path: '/device/refresh-token', body: { refreshToken } });
    });
    test('POST /device/alert-credential', async () => check('device.alert-credential', {
      method: 'POST', path: '/device/alert-credential', body: { macAddress: 'B8:27:EB:00:3B:2D' }, headers: { Authorization: `Bearer ${await sensorToken()}` },
    }));
    test('POST /device/alert-credential for a device the account does not own', async () => check('device.alert-credential.not-owned', {
      method: 'POST', path: '/device/alert-credential', body: { macAddress: 'B8:27:EB:00:00:01' }, headers: { Authorization: `Bearer ${await sensorToken()}` },
    }));
    test('POST /device/reset-link by the owner, then the device list', async () => {
      await check('device.reset-link', {
        method: 'POST', path: '/device/reset-link', body: { macAddress: 'B8:27:EB:00:3B:2D', streamId: 'AM_R3B2D_.*/MSEED' }, headers: { Authorization: `Bearer ${await sensorToken()}` },
      });
      await check('device.reset-link.then-all', { method: 'GET', path: '/device/all' });
    });
    test('POST /device/reset-link without signing in, for a device with an owner', () => check('device.reset-link.auth-required', {
      method: 'POST', path: '/device/reset-link', body: { macAddress: 'B8:27:EB:00:3B:2D', streamId: 'AM_R3B2D_.*/MSEED' },
    }));
  });

  describe('device lists', () => {
    test('GET /device/my-devices as a citizen', async () => {
      const { agent } = await signIn('golden_citizen');
      await check('device.my-devices', { method: 'GET', path: '/device/my-devices' }, { agent });
    });
    test('GET /device/my-devices as a brgy', async () => {
      const { agent } = await signIn('golden_brgy', 'brgy', { Origin: webOrigin() });
      await check('device.my-devices.brgy', { method: 'GET', path: '/device/my-devices' }, { agent });
    });
    test('GET /device/all', () => check('device.all', { method: 'GET', path: '/device/all' }));
    test('GET /device/status of a streaming device', () => check('device.status', { method: 'GET', path: '/device/status?network=AM&station=R3B2D' }));
    test('GET /device/status of a device not yet linked', () => check('device.status.not-yet-linked', { method: 'GET', path: '/device/status?network=AM&station=RE722' }));
    test('GET /device/status of an unknown device', () => check('device.status.not-found', { method: 'GET', path: '/device/status?network=AM&station=R7777' }));
    test('GET /device/status with invalid parameters', () => check('device.status.invalid', { method: 'GET', path: '/device/status?network=am' }));
  });
});

module.exports = { describePeopleAndSensorsGolden };
