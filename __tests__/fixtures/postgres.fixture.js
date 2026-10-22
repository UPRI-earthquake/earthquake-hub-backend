// Testcontainers fixture: starts a throwaway PostgreSQL + PostGIS container and runs the Knex
// migrations on it. Needs Docker, so only *.integration.test.js use it (npm run test:integration).
//
//   let pg;
//   beforeAll(async () => { pg = await startPostgres(); }, PG_STARTUP_TIMEOUT_MS);
//   afterEach(() => pg.clear());
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

  // Empties every table except Knex's own migration bookkeeping
  const clear = async () => {
    const { rows } = await db.raw(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT LIKE 'knex_migrations%'",
    );
    if (rows.length === 0) return;
    await db.raw(`TRUNCATE ${rows.map(() => '??').join(', ')}`, rows.map((row) => row.tablename));
  };

  // PG_* settings pointing at this container, for code that reads them (e.g. src/db/knex.js)
  const env = {
    PG_HOST: container.getHost(),
    PG_PORT: String(container.getPort()),
    PG_DATABASE: container.getDatabase(),
    PG_USER: container.getUsername(),
    PG_PASSWORD: container.getPassword(),
  };

  const stop = async () => {
    await db.destroy();
    await container.stop();
  };

  return { container, db, env, clear, stop };
};

module.exports = {
  PG_IMAGE,
  PG_STARTUP_TIMEOUT_MS,
  startPostgres,
};
