// Integration tests (npm run test:integration): *.integration.test.js only, against real databases
// started by Testcontainers. Needs Docker. The default `npm test` config skips these files.
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.integration.test.js'],
  testTimeout: 30_000,
  // One file at a time: each starts its own database containers, and starting them all at once
  // overwhelms a typical Docker Desktop VM (containers then time out before becoming healthy)
  maxWorkers: 1,
};
