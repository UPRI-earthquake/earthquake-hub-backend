// Accounts and devices on MongoDB (the only option until Step 2 - Ticket 3 adds PostgreSQL)
jest.mock('../src/services/email.service', () => ({
  sendMail: jest.fn().mockResolvedValue({ accepted: [] }),
}));

const { describePeopleAndSensorsGolden } = require('./fixtures/peopleAndSensorsGolden');

describePeopleAndSensorsGolden();
