// End-to-end check, frontend: the tests run against the served frontend (scripts/e2e/serve-frontend.js)
// and its backend, one at a time. Run from this folder: npx playwright test
const path = require('path');
const { defineConfig } = require('@playwright/test');

const OUTPUT = process.env.E2E_OUTPUT_DIR || path.join(__dirname, '..', '..', '..', 'e2e-output');

module.exports = defineConfig({
  testDir: './tests',
  // Playwright's own files (a failed test's screenshot and trace) can show production data: keep them
  // in the output folder, outside the repos, with everything else the check produces
  outputDir: path.join(OUTPUT, 'frontend', 'test-results'),
  workers: 1,
  fullyParallel: false,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  reporter: [['list']],
  use: {
    viewport: { width: 1366, height: 900 },
    timezoneId: 'Asia/Manila',
    locale: 'en-PH',
    permissions: [], // notification prompts are denied
    serviceWorkers: 'block',
  },
  projects: [
    { name: 'postgres', use: { baseURL: 'http://localhost:3102', backendURL: 'http://localhost:5102' } },
  ],
});
