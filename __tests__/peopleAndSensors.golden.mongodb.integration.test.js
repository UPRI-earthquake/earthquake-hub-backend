// Accounts and devices on MongoDB. Set explicitly: the app loads the developer's .env, which may say postgres
jest.mock('../src/services/email.service', () => ({
  sendMail: jest.fn().mockResolvedValue({ accepted: [] }),
}));

const { describePeopleAndSensorsGolden } = require('./fixtures/peopleAndSensorsGolden');

describePeopleAndSensorsGolden({ PEOPLE_AND_SENSORS_DB: 'mongodb' });
