// Earthquakes on PostgreSQL, with every other area there too: must match the recordings made on MongoDB
jest.mock('axios', () => ({ get: (...args) => require('./fixtures/earthquakesExternal').axiosGet(...args) }));
jest.mock('puppeteer-core', () => ({ launch: async () => require('./fixtures/earthquakesExternal').launchBrowser() }));

const { describeEarthquakesGolden } = require('./fixtures/earthquakesGolden');

describeEarthquakesGolden();
