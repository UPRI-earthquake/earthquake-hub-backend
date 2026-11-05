// Accounts and devices on MongoDB. Set explicitly: the app loads the developer's .env, which may say postgres
jest.mock('../src/services/email.service', () => ({
  sendMail: jest.fn().mockResolvedValue({ accepted: [] }),
}));

// No device tunnel is reachable from a test: every device is "not mapped"
jest.mock('../src/services/tunnelEnrollment.service', () => ({
  ...jest.requireActual('../src/services/tunnelEnrollment.service'),
  // A plain function, not jest.fn: the fixture's restoreAllMocks would strip a mock's implementation
  resolveDeviceMapping: async () => {
    const err = new Error('No tunnel mapping for this device');
    err.name = 'TunnelEnrollmentError';
    err.code = 'NOT_FOUND';
    throw err;
  },
}));

const { describePeopleAndSensorsGolden } = require('./fixtures/peopleAndSensorsGolden');

describePeopleAndSensorsGolden({ PEOPLE_AND_SENSORS_DB: 'mongodb' });
