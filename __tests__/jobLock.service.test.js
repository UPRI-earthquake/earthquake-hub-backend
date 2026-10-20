jest.mock('../src/repositories/jobLocks.repo', () => ({
  acquire: jest.fn(),
  release: jest.fn(),
}));

const os = require('os');
const JobLocksRepo = require('../src/repositories/jobLocks.repo');
const { acquireJobLock } = require('../src/services/jobLock.service');

describe('jobLock.service', () => {
  const owner = `${os.hostname()}:${process.pid}`;
  const expiresAt = new Date('2026-01-01T01:00:00.000Z');

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('acquires the lock for this process', async () => {
    JobLocksRepo.acquire.mockResolvedValue({ acquired: true, expiresAt });

    const lock = await acquireJobLock('enrichment', 5000);

    expect(JobLocksRepo.acquire).toHaveBeenCalledWith('enrichment', owner, 5000);
    expect(lock).toMatchObject({ acquired: true, name: 'enrichment', owner, expiresAt });
  });

  test('reports a lock held by another process as not acquired', async () => {
    JobLocksRepo.acquire.mockResolvedValue({ acquired: false, expiresAt });

    const lock = await acquireJobLock('enrichment', 5000);

    expect(lock.acquired).toBe(false);
  });

  test('defaults to a one-hour TTL', async () => {
    JobLocksRepo.acquire.mockResolvedValue({ acquired: true, expiresAt });

    await acquireJobLock('enrichment');

    expect(JobLocksRepo.acquire).toHaveBeenCalledWith('enrichment', owner, 60 * 60 * 1000);
  });

  test('release() releases the lock for the same owner', async () => {
    JobLocksRepo.acquire.mockResolvedValue({ acquired: true, expiresAt });

    const lock = await acquireJobLock('enrichment', 5000);
    await lock.release();

    expect(JobLocksRepo.release).toHaveBeenCalledWith('enrichment', owner);
  });

  test('passes repository errors through', async () => {
    JobLocksRepo.acquire.mockRejectedValue(new Error('db down'));

    await expect(acquireJobLock('enrichment', 5000)).rejects.toThrow('db down');
  });
});
