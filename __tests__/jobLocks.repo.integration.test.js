// Behavior both job-locks repositories must have. The same tests run against MongoDB and PostgreSQL,
// so switching JOB_LOCKS_DB can't change how locking works.
const knex = require('knex');
const JobLock = require('../src/models/jobLock.model');
const mongoJobLocksRepo = require('../src/repositories/mongodb/jobLocks.repo');
const { createJobLocksRepo } = require('../src/repositories/postgres/jobLocks.repo');
const { startMongo, MONGO_STARTUP_TIMEOUT_MS } = require('./fixtures/mongo.fixture');
const { startPostgres, PG_STARTUP_TIMEOUT_MS } = require('./fixtures/postgres.fixture');

const TTL_MS = 60 * 1000;

// Each backend: the repository plus helpers to look at and set up stored locks directly
const backends = [
  {
    name: 'mongodb',
    timeout: MONGO_STARTUP_TIMEOUT_MS,
    start: async () => {
      const mongo = await startMongo();
      return {
        repo: mongoJobLocksRepo,
        // Another process: same database, its own repository instance (one shared connection here)
        startOtherProcess: async () => ({ repo: mongoJobLocksRepo, stop: async () => {} }),
        getLock: async (name) => {
          const doc = await JobLock.findOne({ name }).lean();
          return doc && { owner: doc.owner, expiresAt: doc.expiresAt };
        },
        insertLock: ({ name, owner, expiresAt }) => JobLock.create({ name, owner, expiresAt }),
        countLocks: () => JobLock.countDocuments(),
        clear: mongo.clear,
        stop: mongo.stop,
      };
    },
  },
  {
    name: 'postgres',
    timeout: PG_STARTUP_TIMEOUT_MS,
    start: async () => {
      const pg = await startPostgres();
      return {
        repo: createJobLocksRepo(pg.db),
        // Another process: its own connection pool to the same database
        startOtherProcess: async () => {
          const db = knex(pg.db.client.config);
          return { repo: createJobLocksRepo(db), stop: () => db.destroy() };
        },
        getLock: async (name) => {
          const row = await pg.db('job_locks').where({ name }).first();
          return row && { owner: row.owner, expiresAt: row.expires_at };
        },
        insertLock: ({ name, owner, expiresAt }) => pg.db('job_locks').insert({ name, owner, expires_at: expiresAt }),
        countLocks: async () => Number((await pg.db('job_locks').count({ n: '*' }).first()).n),
        clear: pg.clear,
        stop: pg.stop,
      };
    },
  },
];

describe.each(backends)('jobLocks.repo ($name)', ({ start, timeout }) => {
  let backend;
  let repo;

  beforeAll(async () => {
    backend = await start();
    ({ repo } = backend);
  }, timeout);

  afterEach(() => backend.clear());

  afterAll(async () => {
    if (backend) await backend.stop();
  });

  test('acquires a free lock until now + ttl', async () => {
    const before = Date.now();

    const result = await repo.acquire('enrichment', 'host-a:1', TTL_MS);

    expect(result.acquired).toBe(true);
    expect(result.expiresAt.getTime()).toBeGreaterThanOrEqual(before + TTL_MS);
    expect(await backend.getLock('enrichment')).toEqual({ owner: 'host-a:1', expiresAt: result.expiresAt });
  });

  test('refuses a lock another owner holds', async () => {
    await repo.acquire('enrichment', 'host-a:1', TTL_MS);

    const result = await repo.acquire('enrichment', 'host-b:2', TTL_MS);

    expect(result.acquired).toBe(false);
    expect(await backend.getLock('enrichment')).toMatchObject({ owner: 'host-a:1' });
  });

  test('two processes racing for the same lock: exactly one gets it', async () => {
    const other = await backend.startOtherProcess();
    try {
      const attempts = Array.from({ length: 10 }, (_, i) => (i % 2 ? other.repo : repo)
        .acquire('enrichment', `host-${i}:${i}`, TTL_MS));

      const results = await Promise.all(attempts);

      expect(results.filter((result) => result.acquired)).toHaveLength(1);
      const winner = results.findIndex((result) => result.acquired);
      expect(await backend.getLock('enrichment')).toMatchObject({ owner: `host-${winner}:${winner}` });
      expect(await backend.countLocks()).toBe(1);
    } finally {
      await other.stop();
    }
  });

  test('renews a lock the same owner holds', async () => {
    const first = await repo.acquire('enrichment', 'host-a:1', TTL_MS);

    const renewed = await repo.acquire('enrichment', 'host-a:1', 2 * TTL_MS);

    expect(renewed.acquired).toBe(true);
    expect(renewed.expiresAt.getTime()).toBeGreaterThan(first.expiresAt.getTime());
    expect(await backend.countLocks()).toBe(1);
  });

  test('takes over an expired lock', async () => {
    await backend.insertLock({ name: 'enrichment', owner: 'host-a:1', expiresAt: new Date(Date.now() - 1000) });

    const result = await repo.acquire('enrichment', 'host-b:2', TTL_MS);

    expect(result.acquired).toBe(true);
    expect(await backend.getLock('enrichment')).toMatchObject({ owner: 'host-b:2' });
  });

  test('locks with different names are independent', async () => {
    await repo.acquire('enrichment', 'host-a:1', TTL_MS);

    const result = await repo.acquire('other-job', 'host-b:2', TTL_MS);

    expect(result.acquired).toBe(true);
  });

  test('release frees the lock only for its owner', async () => {
    await repo.acquire('enrichment', 'host-a:1', TTL_MS);

    await repo.release('enrichment', 'host-b:2');
    expect(await backend.countLocks()).toBe(1);

    await repo.release('enrichment', 'host-a:1');
    expect(await backend.countLocks()).toBe(0);
    expect((await repo.acquire('enrichment', 'host-b:2', TTL_MS)).acquired).toBe(true);
  });

  test('deleteExpired deletes only locks that have expired', async () => {
    // Far in the future, so MongoDB's TTL monitor leaves these alone during the test
    const now = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
    await backend.insertLock({ name: 'expired', owner: 'host-a:1', expiresAt: new Date(now.getTime() - 1) });
    await backend.insertLock({ name: 'held', owner: 'host-a:1', expiresAt: new Date(now.getTime() + TTL_MS) });

    await expect(repo.deleteExpired(now)).resolves.toBe(1);

    expect(await backend.getLock('expired')).toBeFalsy();
    expect(await backend.getLock('held')).toBeTruthy();
  });
});
