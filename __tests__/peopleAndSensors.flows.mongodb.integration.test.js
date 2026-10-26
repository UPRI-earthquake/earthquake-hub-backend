// Accounts and devices end to end with PEOPLE_AND_SENSORS_DB=mongodb
jest.mock('../src/services/email.service', () => ({ sendMail: jest.fn().mockResolvedValue({}) }));
jest.mock('axios', () => ({ get: jest.fn().mockRejectedValue(new Error('no network in tests')), create: jest.fn() }));

const { describePeopleAndSensorsFlows } = require('./fixtures/peopleAndSensorsFlows');

describePeopleAndSensorsFlows('mongodb');
