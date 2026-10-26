// Accounts and devices on MongoDB (PEOPLE_AND_SENSORS_DB unset, the default)
jest.mock('../src/services/email.service', () => ({
  sendMail: jest.fn().mockResolvedValue({ accepted: [] }),
}));

const { describePeopleAndSensorsGolden } = require('./fixtures/peopleAndSensorsGolden');

describePeopleAndSensorsGolden();
