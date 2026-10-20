const { startPostgres, PG_STARTUP_TIMEOUT_MS } = require('./fixtures/postgres.fixture');

const installedExtensions = async (db) => {
  const { rows } = await db.raw(
    "SELECT extname FROM pg_extension WHERE extname IN ('postgis', 'citext') ORDER BY extname",
  );
  return rows.map((row) => row.extname);
};

describe('PostgreSQL migrations', () => {
  let pg;

  beforeAll(async () => {
    pg = await startPostgres({ migrate: false });
  }, PG_STARTUP_TIMEOUT_MS);

  afterAll(async () => {
    if (pg) await pg.stop();
  });

  test('a fresh database has no extensions until migrated', async () => {
    expect(await installedExtensions(pg.db)).toEqual([]);
  });

  test('migrate:latest enables postgis and citext', async () => {
    await pg.db.migrate.latest();

    expect(await installedExtensions(pg.db)).toEqual(['citext', 'postgis']);
    const { rows: [geo] } = await pg.db.raw(
      "SELECT ST_AsText(ST_SetSRID(ST_MakePoint(121.07, 14.65), 4326)::geography) AS wkt",
    );
    expect(geo.wkt).toBe('POINT(121.07 14.65)');
    const { rows: [ci] } = await pg.db.raw("SELECT 'User@Example.com'::citext = 'user@example.com' AS equal");
    expect(ci.equal).toBe(true);
  });

  test('rolling back every migration leaves the database as it started', async () => {
    await pg.db.migrate.rollback(undefined, true);

    expect(await installedExtensions(pg.db)).toEqual([]);
    const [, pending] = await pg.db.migrate.list();
    expect(pending.length).toBeGreaterThan(0);
  });
});
