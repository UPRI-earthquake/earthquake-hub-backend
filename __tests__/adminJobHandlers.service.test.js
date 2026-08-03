jest.mock('../src/services/EQevents.service', () => ({
  addAdditionalInformation: jest.fn(),
  updateOnlineStations: jest.fn(),
}));
jest.mock('../src/services/jobLock.service', () => ({
  acquireJobLock: jest.fn(),
}));

const EQEventsService = require('../src/services/EQevents.service');
const JobLockService = require('../src/services/jobLock.service');
const AdminJobHandlers = require('../src/services/adminJobHandlers.service');

describe('Admin job handlers', () => {
  const originalBatchSize = process.env.RECORDING_AVAILABILITY_JOB_BATCH_SIZE;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.RECORDING_AVAILABILITY_JOB_BATCH_SIZE;
  });

  afterAll(() => {
    if (originalBatchSize === undefined) delete process.env.RECORDING_AVAILABILITY_JOB_BATCH_SIZE;
    else process.env.RECORDING_AVAILABILITY_JOB_BATCH_SIZE = originalBatchSize;
  });

  it('registers only explicitly allowlisted handlers', () => {
    expect(AdminJobHandlers.getHandler('earthquake-event-enrichment')).toBeInstanceOf(Function);
    expect(AdminJobHandlers.getHandler('earthquake-recording-availability-refresh')).toBeInstanceOf(Function);
    expect(AdminJobHandlers.getHandler('arbitrary-command')).toBeNull();
  });

  it('runs recording verification with a bounded attention-only plan', async () => {
    process.env.RECORDING_AVAILABILITY_JOB_BATCH_SIZE = '75';
    const signal = new AbortController().signal;
    const updateProgress = jest.fn();
    EQEventsService.updateOnlineStations.mockResolvedValue({ totalProcessed: 4 });

    await expect(AdminJobHandlers.runRecordingAvailabilityRefresh({
      signal,
      updateProgress,
    })).resolves.toEqual({ totalProcessed: 4 });
    expect(EQEventsService.updateOnlineStations).toHaveBeenCalledWith({
      batchSize: 75,
      onlyAttention: true,
      signal,
      onProgress: updateProgress,
    });
    expect(JobLockService.acquireJobLock).not.toHaveBeenCalled();
  });

  it('caps the browser-triggered recording batch size', async () => {
    process.env.RECORDING_AVAILABILITY_JOB_BATCH_SIZE = '5000';
    EQEventsService.updateOnlineStations.mockResolvedValue({ totalProcessed: 0 });

    await AdminJobHandlers.runRecordingAvailabilityRefresh({
      signal: new AbortController().signal,
      updateProgress: jest.fn(),
    });
    expect(EQEventsService.updateOnlineStations).toHaveBeenCalledWith(expect.objectContaining({
      batchSize: 500,
    }));
  });
});
