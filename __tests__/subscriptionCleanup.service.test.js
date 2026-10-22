jest.mock('../src/repositories/pushSubscriptions.repo', () => ({
  isAvailable: jest.fn(),
  markExpiredInvalid: jest.fn(),
  markStaleInvalid: jest.fn(),
  deleteExpired: jest.fn(),
}));
jest.mock('../src/repositories/jobLocks.repo', () => ({
  deleteExpired: jest.fn(),
}));

// Read once when the service loads
process.env.NOTIF_STALE_DAYS = '90';
process.env.NOTIF_FAILURE_THRESHOLD = '3';
process.env.NOTIF_INVALID_TTL_DAYS = '7';
process.env.NOTIF_CLEANUP_INTERVAL_MIN = '60';

const PushSubscriptionsRepo = require('../src/repositories/pushSubscriptions.repo');
const JobLocksRepo = require('../src/repositories/jobLocks.repo');
const { runSubscriptionCleanup } = require('../src/services/subscriptionCleanup.service');

const DAY_MS = 24 * 60 * 60 * 1000;

describe('subscriptionCleanup.service', () => {
  const now = new Date('2026-01-01T00:00:00.000Z');

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers({ now });
    PushSubscriptionsRepo.isAvailable.mockResolvedValue(true);
    PushSubscriptionsRepo.markExpiredInvalid.mockResolvedValue(2);
    PushSubscriptionsRepo.markStaleInvalid.mockResolvedValue(1);
    PushSubscriptionsRepo.deleteExpired.mockResolvedValue(4);
    JobLocksRepo.deleteExpired.mockResolvedValue(5);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('skips when the database is unavailable', async () => {
    PushSubscriptionsRepo.isAvailable.mockResolvedValue(false);

    await expect(runSubscriptionCleanup()).resolves.toEqual({ skipped: true, reason: 'dbNotAccessible' });
    expect(PushSubscriptionsRepo.markExpiredInvalid).not.toHaveBeenCalled();
    expect(PushSubscriptionsRepo.markStaleInvalid).not.toHaveBeenCalled();
    expect(PushSubscriptionsRepo.deleteExpired).not.toHaveBeenCalled();
    expect(JobLocksRepo.deleteExpired).not.toHaveBeenCalled();
  });

  test('invalidates expired and stale subscriptions, deletes due ones and expired locks', async () => {
    const cleanupAfter = new Date(now.getTime() + 7 * DAY_MS);
    const staleCutoff = new Date(now.getTime() - 90 * DAY_MS);

    const result = await runSubscriptionCleanup();

    expect(PushSubscriptionsRepo.markExpiredInvalid).toHaveBeenCalledWith({ cleanupAfter, now });
    expect(PushSubscriptionsRepo.markStaleInvalid).toHaveBeenCalledWith({
      staleCutoff,
      failureThreshold: 3,
      cleanupAfter,
      now,
    });
    expect(PushSubscriptionsRepo.deleteExpired).toHaveBeenCalledWith(now);
    expect(JobLocksRepo.deleteExpired).toHaveBeenCalledWith(now);
    expect(result).toEqual({
      skipped: false,
      invalidatedExpired: 2,
      invalidatedStale: 1,
      removedDue: 4,
      removedLocks: 5,
      staleCutoff,
      intervalMin: 60,
    });
  });
});
