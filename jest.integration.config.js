// Integration tests (npm run test:integration): *.integration.test.js only, against real databases
// started by Testcontainers. Needs Docker. The default `npm test` config skips these files.
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.integration.test.js'],
  testTimeout: 30_000,
};
