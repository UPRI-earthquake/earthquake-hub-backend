const AdminJob = require('../src/models/adminJob.model');

describe('AdminJob model', () => {
  it('enforces allowlisted types, durable lifecycle fields, and bounded retention', () => {
    const job = new AdminJob({
      jobType: 'earthquake-event-enrichment',
      activeKey: 'earthquake-event-enrichment',
      idempotencyKey: 'request-123',
      correlationId: 'correlation-123',
      requestedBy: { username: 'ops-admin', adminRole: 'operator' },
      reason: 'Process pending catalog records.',
      target: { type: 'earthquake_event_queue', id: 'pending-enrichment' },
      timeoutAt: new Date(Date.now() + 60_000),
    });

    expect(job.status).toBe('queued');
    expect(job.attempt).toBe(1);
    expect(job.progress.percent).toBe(0);
    expect(AdminJob.ADMIN_JOB_TYPES).toEqual([
      'earthquake-event-enrichment',
      'earthquake-recording-availability-refresh',
    ]);
    expect(AdminJob.ADMIN_JOB_STATUSES).toEqual([
      'queued',
      'running',
      'succeeded',
      'failed',
      'timed_out',
    ]);
  });

  it('has unique active/idempotency indexes and a TTL index for terminal history', () => {
    const indexes = AdminJob.schema.indexes();
    const activeIndex = indexes.find(([fields]) => fields.activeKey === 1);
    const idempotencyIndex = indexes.find(([fields]) => (
      fields.jobType === 1 && fields.idempotencyKey === 1
    ));
    const ttlIndex = indexes.find(([fields]) => fields.expiresAt === 1);

    expect(activeIndex[1]).toEqual(expect.objectContaining({ sparse: true, unique: true }));
    expect(idempotencyIndex[1]).toEqual(expect.objectContaining({ unique: true }));
    expect(ttlIndex[1]).toEqual(expect.objectContaining({ expireAfterSeconds: 0 }));
  });
});
