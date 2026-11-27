jest.mock('../src/repositories/jobLocks.repo', () => ({
  deleteExpired: jest.fn(),
}));

// Read once when the service loads
process.env.JOB_LOCK_CLEANUP_INTERVAL_MIN = '60';

const JobLocksRepo = require('../src/repositories/jobLocks.repo');
const { runJobLockCleanup } = require('../src/services/jobLockCleanup.service');

describe('jobLockCleanup.service', () => {
  const now = new Date('2026-01-01T00:00:00.000Z');

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers({ now });
    JobLocksRepo.deleteExpired.mockResolvedValue(5);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('deletes the locks that expired by now', async () => {
    await expect(runJobLockCleanup()).resolves.toEqual({ removedLocks: 5, intervalMin: 60 });
    expect(JobLocksRepo.deleteExpired).toHaveBeenCalledWith(now);
  });
});
