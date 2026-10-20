// Testcontainers fixture: starts a throwaway PostgreSQL + PostGIS container and runs the Knex
// migrations on it. Needs Docker, so only *.integration.test.js use it (npm run test:integration).
//
//   let pg;
//   beforeAll(async () => { pg = await startPostgres(); }, PG_STARTUP_TIMEOUT_MS);
//   afterAll(() => pg && pg.stop());
//   test('...', async () => { await pg.db('job_locks').insert({ ... }); });
const knex = require('knex');
const { PostgreSqlContainer } = require('@testcontainers/postgresql');
const knexConfig = require('../../src/db/knexfile');

// Keep in sync with the postgres service in docker-compose.yml (image and entrypoint)
const PG_IMAGE = 'postgis/postgis:18-3.6';
const PG_ENTRYPOINT = ['sh', '-c', 'rm -f /docker-entrypoint-initdb.d/10_postgis.sh && exec docker-entrypoint.sh postgres'];

// The first run pulls the image, which can take a while
const PG_STARTUP_TIMEOUT_MS = 180_000;

const startPostgres = async ({ migrate = true } = {}) => {
  const container = await new PostgreSqlContainer(PG_IMAGE)
    .withEntrypoint(PG_ENTRYPOINT)
    .start();

  const db = knex({
    ...knexConfig,
    connection: {
      host: container.getHost(),
      port: container.getPort(),
      database: container.getDatabase(),
      user: container.getUsername(),
      password: container.getPassword(),
    },
  });

  if (migrate) await db.migrate.latest();

  const stop = async () => {
    await db.destroy();
    await container.stop();
  };

  return { container, db, stop };
};

module.exports = {
  PG_IMAGE,
  PG_STARTUP_TIMEOUT_MS,
  startPostgres,
};
