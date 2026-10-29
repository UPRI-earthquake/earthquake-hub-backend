// Earthquakes on PostgreSQL (with accounts and devices, which event stations point to): must match the
// same recordings as on MongoDB
jest.mock('axios', () => ({ get: (...args) => require('./fixtures/earthquakesExternal').axiosGet(...args) }));
jest.mock('puppeteer-core', () => ({ launch: async () => require('./fixtures/earthquakesExternal').launchBrowser() }));

const { describeEarthquakesGolden } = require('./fixtures/earthquakesGolden');

describeEarthquakesGolden({ EARTHQUAKES_DB: 'postgres', PEOPLE_AND_SENSORS_DB: 'postgres' });
