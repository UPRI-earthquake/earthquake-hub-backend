// Earthquakes on MongoDB: the recordings both settings must match
jest.mock('axios', () => ({ get: (...args) => require('./fixtures/earthquakesExternal').axiosGet(...args) }));
jest.mock('puppeteer-core', () => ({ launch: async () => require('./fixtures/earthquakesExternal').launchBrowser() }));

const { describeEarthquakesGolden } = require('./fixtures/earthquakesGolden');

describeEarthquakesGolden();
