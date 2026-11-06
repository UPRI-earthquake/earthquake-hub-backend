// Runs before each integration test file (setupFilesAfterEnv in jest.integration.config.js), after
// dotenv/config has loaded the developer's .env. Every area setting is emptied here, replacing the .env's:
// each area then takes its default, postgres. Emptied rather than deleted, because dotenv (which the app
// also calls) never fills in a variable that already exists, so the .env can't set them again.
['JOB_LOCKS_DB', 'PEOPLE_AND_SENSORS_DB', 'EARTHQUAKES_DB', 'COMMUNITY_DB'].forEach((key) => {
  process.env[key] = '';
});
