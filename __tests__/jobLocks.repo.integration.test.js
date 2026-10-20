// Behavior the job-locks repository must keep, whichever database backs it
const JobLock = require('../src/models/jobLock.model');
const JobLocksRepo = require('../src/repositories/jobLocks.repo');
const { startMongo, MONGO_STARTUP_TIMEOUT_MS } = require('./fixtures/mongo.fixture');

const TTL_MS = 60 * 1000;

describe('jobLocks.repo', () => {
  let mongo;

  beforeAll(async () => {
    mongo = await startMongo();
  }, MONGO_STARTUP_TIMEOUT_MS);

  afterEach(() => mongo.clear());

  afterAll(async () => {
    if (mongo) await mongo.stop();
  });

  test('acquires a free lock until now + ttl', async () => {
    const before = Date.now();

    const result = await JobLocksRepo.acquire('enrichment', 'host-a:1', TTL_MS);

    expect(result.acquired).toBe(true);
    expect(result.expiresAt.getTime()).toBeGreaterThanOrEqual(before + TTL_MS);
    const stored = await JobLock.findOne({ name: 'enrichment' }).lean();
    expect(stored).toMatchObject({ owner: 'host-a:1', expiresAt: result.expiresAt });
  });

  test('refuses a lock another owner holds', async () => {
    await JobLocksRepo.acquire('enrichment', 'host-a:1', TTL_MS);

    const result = await JobLocksRepo.acquire('enrichment', 'host-b:2', TTL_MS);

    expect(result.acquired).toBe(false);
    expect(await JobLock.findOne({ name: 'enrichment' }).lean()).toMatchObject({ owner: 'host-a:1' });
  });

  test('renews a lock the same owner holds', async () => {
    const first = await JobLocksRepo.acquire('enrichment', 'host-a:1', TTL_MS);

    const renewed = await JobLocksRepo.acquire('enrichment', 'host-a:1', 2 * TTL_MS);

    expect(renewed.acquired).toBe(true);
    expect(renewed.expiresAt.getTime()).toBeGreaterThan(first.expiresAt.getTime());
    expect(await JobLock.countDocuments({ name: 'enrichment' })).toBe(1);
  });

  test('takes over an expired lock', async () => {
    await JobLock.create({ name: 'enrichment', owner: 'host-a:1', expiresAt: new Date(Date.now() - 1000) });

    const result = await JobLocksRepo.acquire('enrichment', 'host-b:2', TTL_MS);

    expect(result.acquired).toBe(true);
    expect(await JobLock.findOne({ name: 'enrichment' }).lean()).toMatchObject({ owner: 'host-b:2' });
  });

  test('locks with different names are independent', async () => {
    await JobLocksRepo.acquire('enrichment', 'host-a:1', TTL_MS);

    const result = await JobLocksRepo.acquire('other-job', 'host-b:2', TTL_MS);

    expect(result.acquired).toBe(true);
  });

  test('release frees the lock only for its owner', async () => {
    await JobLocksRepo.acquire('enrichment', 'host-a:1', TTL_MS);

    await JobLocksRepo.release('enrichment', 'host-b:2');
    expect(await JobLock.countDocuments({ name: 'enrichment' })).toBe(1);

    await JobLocksRepo.release('enrichment', 'host-a:1');
    expect(await JobLock.countDocuments({ name: 'enrichment' })).toBe(0);
    expect((await JobLocksRepo.acquire('enrichment', 'host-b:2', TTL_MS)).acquired).toBe(true);
  });
});
