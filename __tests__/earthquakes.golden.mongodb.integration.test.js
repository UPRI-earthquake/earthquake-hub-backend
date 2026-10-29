// Earthquakes on MongoDB (the only option until Step 3 - Ticket 3 adds PostgreSQL)
jest.mock('axios', () => ({ get: (...args) => require('./fixtures/earthquakesExternal').axiosGet(...args) }));
jest.mock('puppeteer-core', () => ({ launch: async () => require('./fixtures/earthquakesExternal').launchBrowser() }));

const { describeEarthquakesGolden } = require('./fixtures/earthquakesGolden');

describeEarthquakesGolden();
