// Runs before each integration test file (setupFilesAfterEnv in jest.integration.config.js), after
// dotenv/config has loaded the developer's .env. Every area setting starts as mongodb here, replacing the
// .env's, and the app's own dotenv call never overrides a variable that's already set: a test only runs
// an area on PostgreSQL when it says so, whatever the dev database uses.
['JOB_LOCKS_DB', 'PUSH_SUBSCRIPTIONS_DB', 'SIGNIFICANT_EQS_DB', 'PEOPLE_AND_SENSORS_DB', 'EARTHQUAKES_DB', 'COMMUNITY_DB'].forEach((key) => {
  process.env[key] = 'mongodb';
});
