// Runs before each integration test file (setupFiles in jest.integration.config.js). The app loads the
// developer's .env, but dotenv never overrides a variable that's already set: every area setting starts
// as mongodb here, so a test only runs an area on PostgreSQL when it says so, whatever the dev database uses.
['JOB_LOCKS_DB', 'PUSH_SUBSCRIPTIONS_DB', 'SIGNIFICANT_EQS_DB', 'PEOPLE_AND_SENSORS_DB', 'EARTHQUAKES_DB'].forEach((key) => {
  process.env[key] = 'mongodb';
});
