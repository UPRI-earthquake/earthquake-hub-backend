// Accounts and devices end to end, with every area on PostgreSQL
jest.mock('../src/services/email.service', () => ({ sendMail: jest.fn().mockResolvedValue({}) }));
jest.mock('axios', () => ({ get: jest.fn().mockRejectedValue(new Error('no network in tests')), create: jest.fn() }));

const { describePeopleAndSensorsFlows } = require('./fixtures/peopleAndSensorsFlows');

describePeopleAndSensorsFlows();
