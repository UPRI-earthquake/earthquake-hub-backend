// Accounts and devices on PostgreSQL: must match the same recordings as on MongoDB
jest.mock('../src/services/email.service', () => ({
  sendMail: jest.fn().mockResolvedValue({ accepted: [] }),
}));

const { describePeopleAndSensorsGolden } = require('./fixtures/peopleAndSensorsGolden');

describePeopleAndSensorsGolden({ PEOPLE_AND_SENSORS_DB: 'postgres' });
