const jwt = require('jsonwebtoken');
const request = require('supertest');

process.env.NODE_ENV = 'test';
process.env.ACCESS_TOKEN_PRIVATE_KEY_WEB = 'test-web-secret';
process.env.REFRESH_TOKEN_PRIVATE_KEY_WEB = 'test-refresh-secret';

jest.mock('../src/services/EQevents.service', () => ({
  addAdditionalInformation: jest.fn(),
  clearEventSummary: jest.fn(),
  getAdminEventQueue: jest.fn(),
  setEventSummary: jest.fn(),
  transitionEventSummaryReview: jest.fn(),
  updateOnlineStations: jest.fn(),
}));
jest.mock('../src/services/auditLog.service', () => ({ execute: jest.fn() }));
jest.mock('../src/services/adminJob.service', () => ({
  enqueue: jest.fn(),
  wake: jest.fn(),
}));

const EQEventsService = require('../src/services/EQevents.service');
const AuditLogService = require('../src/services/auditLog.service');
const AdminJobService = require('../src/services/adminJob.service');
const app = require('../src/app');
const csrfToken = 'test-admin-csrf-token';

function signAdminToken() {
  return jwt.sign(
    { accountId: 'account-1', username: 'admin-user', role: 'admin', csrfToken },
    process.env.ACCESS_TOKEN_PRIVATE_KEY_WEB,
    { expiresIn: '1h' },
  );
}

describe('Admin earthquake event routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    AuditLogService.execute.mockImplementation(async (_req, _event, operation) => operation({
      correlationId: 'correlation-1',
    }));
    AdminJobService.enqueue.mockResolvedValue({
      reused: false,
      job: {
        _id: '507f1f77bcf86cd799439011',
        jobType: 'earthquake-event-enrichment',
        status: 'queued',
      },
    });
  });

  it('requires an administrator session', async () => {
    const response = await request(app).get('/admin/earthquake-events');
    expect(response.statusCode).toBe(403);
    expect(EQEventsService.getAdminEventQueue).not.toHaveBeenCalled();
  });

  it('lists a filtered event queue', async () => {
    EQEventsService.getAdminEventQueue.mockResolvedValue({ events: [{ publicID: 'event-1' }], total: 1, limit: 25, offset: 0, summary: { total: 1 } });
    const response = await request(app)
      .get('/admin/earthquake-events?hasSummary=true&pendingEnrichment=true&recordingAttention=true&minMagnitude=4&sourceCatalog=upri-current&search=Batangas')
      .set('Cookie', [`accessToken=${signAdminToken()}`]);

    expect(response.statusCode).toBe(200);
    expect(EQEventsService.getAdminEventQueue).toHaveBeenCalledWith(expect.objectContaining({
      hasSummary: true, includeSummary: true, pendingEnrichment: true, recordingAttention: true,
      minMagnitude: 4, sourceCatalog: 'upri-current', search: 'Batangas', limit: 25, offset: 0,
    }));
    expect(response.body.summary).toEqual({ total: 1 });
  });

  it('audits a public-facing summary update', async () => {
    EQEventsService.setEventSummary.mockResolvedValue({ summaryOverride: { text: 'Reviewed event summary' } });
    const response = await request(app)
      .patch('/admin/earthquake-events/event-1/summary')
      .set('Cookie', [`accessToken=${signAdminToken()}`, `csrfToken=${csrfToken}`])
      .set('X-CSRF-Token', csrfToken)
      .send({ text: 'Reviewed event summary', reason: 'Verified against authoritative sources.' });

    expect(response.statusCode).toBe(200);
    expect(AuditLogService.execute).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      eventType: 'earthquake_event.summary.update',
      target: { type: 'earthquake_event', id: 'event-1', label: 'event-1' },
      metadata: { reviewStatus: 'draft', summaryLength: 22 },
    }), expect.any(Function));
    expect(EQEventsService.setEventSummary).toHaveBeenCalledWith('event-1', 'Reviewed event summary', 'admin-user');
  });

  it('audits and applies an optimistic summary review transition', async () => {
    EQEventsService.transitionEventSummaryReview.mockResolvedValue({
      summaryOverride: { text: 'Reviewed event summary', reviewStatus: 'needs_review' },
    });
    const response = await request(app)
      .patch('/admin/earthquake-events/event-1/summary/review')
      .set('Cookie', [`accessToken=${signAdminToken()}`, `csrfToken=${csrfToken}`])
      .set('X-CSRF-Token', csrfToken)
      .send({
        currentStatus: 'draft',
        status: 'needs_review',
        reason: 'Ready for an independent content check.',
      });

    expect(response.statusCode).toBe(200);
    expect(AuditLogService.execute).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      eventType: 'earthquake_event.summary.review.draft.to.needs_review',
      target: { type: 'earthquake_event', id: 'event-1', label: 'event-1' },
      metadata: { fromStatus: 'draft', toStatus: 'needs_review' },
    }), expect.any(Function));
    expect(EQEventsService.transitionEventSummaryReview).toHaveBeenCalledWith(
      'event-1',
      'draft',
      'needs_review',
      'admin-user',
    );
    expect(response.body.payload.reviewStatus).toBe('needs_review');
  });

  it('rejects an incomplete summary review transition before auditing', async () => {
    const response = await request(app)
      .patch('/admin/earthquake-events/event-1/summary/review')
      .set('Cookie', [`accessToken=${signAdminToken()}`, `csrfToken=${csrfToken}`])
      .set('X-CSRF-Token', csrfToken)
      .send({ status: 'approved', reason: 'Missing expected state.' });

    expect(response.statusCode).toBe(400);
    expect(AuditLogService.execute).not.toHaveBeenCalled();
  });

  it('audits the batch enrichment run', async () => {
    const response = await request(app)
      .post('/admin/earthquake-events/enrichment/run')
      .set('Cookie', [`accessToken=${signAdminToken()}`, `csrfToken=${csrfToken}`])
      .set('X-CSRF-Token', csrfToken)
      .set('Idempotency-Key', 'enrichment-request-1')
      .send({ reason: 'Process eligible pending catalog records.' });

    expect(response.statusCode).toBe(202);
    expect(AuditLogService.execute).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      eventType: 'earthquake_event.enrichment.run',
      target: { type: 'earthquake_event_queue', id: 'pending-enrichment', label: 'Pending catalog enrichment' },
    }), expect.any(Function));
    expect(AdminJobService.enqueue).toHaveBeenCalledWith(expect.objectContaining({
      correlationId: 'correlation-1',
      idempotencyKey: 'enrichment-request-1',
      jobType: 'earthquake-event-enrichment',
      requestedBy: expect.objectContaining({ username: 'admin-user' }),
    }));
    expect(AdminJobService.wake).toHaveBeenCalled();
  });

  it('rejects a concurrent enrichment run without executing the service', async () => {
    AdminJobService.enqueue.mockRejectedValue(Object.assign(
      new Error('A job of this type is already queued or running.'),
      {
        code: 'ADMIN_JOB_ALREADY_ACTIVE',
        statusCode: 409,
        activeJob: { _id: '507f1f77bcf86cd799439012', status: 'running' },
      },
    ));

    const response = await request(app)
      .post('/admin/earthquake-events/enrichment/run')
      .set('Cookie', [`accessToken=${signAdminToken()}`, `csrfToken=${csrfToken}`])
      .set('X-CSRF-Token', csrfToken)
      .set('Idempotency-Key', 'enrichment-request-2')
      .send({ reason: 'Process eligible pending catalog records.' });

    expect(response.statusCode).toBe(409);
    expect(response.body.errorCode).toBe('ADMIN_JOB_ALREADY_ACTIVE');
    expect(response.body.payload.status).toBe('running');
    expect(EQEventsService.addAdditionalInformation).not.toHaveBeenCalled();
  });

  it('requires an idempotency key for enrichment requests', async () => {
    const response = await request(app)
      .post('/admin/earthquake-events/enrichment/run')
      .set('Cookie', [`accessToken=${signAdminToken()}`, `csrfToken=${csrfToken}`])
      .set('X-CSRF-Token', csrfToken)
      .send({ reason: 'Process eligible pending catalog records.' });

    expect(response.statusCode).toBe(400);
    expect(response.body.errorCode).toBe('VALIDATION_ERROR');
    expect(AdminJobService.enqueue).not.toHaveBeenCalled();
  });

  it('audits and queues a bounded recording-availability verification', async () => {
    AdminJobService.enqueue.mockResolvedValueOnce({
      reused: false,
      job: {
        _id: '507f1f77bcf86cd799439013',
        jobType: 'earthquake-recording-availability-refresh',
        status: 'queued',
      },
    });
    const response = await request(app)
      .post('/admin/earthquake-events/recording-availability/run')
      .set('Cookie', [`accessToken=${signAdminToken()}`, `csrfToken=${csrfToken}`])
      .set('X-CSRF-Token', csrfToken)
      .set('Idempotency-Key', 'recording-request-1')
      .send({ reason: 'Verify recording evidence for events requiring attention.' });

    expect(response.statusCode).toBe(202);
    expect(AuditLogService.execute).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      eventType: 'earthquake_event.recording_availability.refresh',
      target: {
        type: 'earthquake_event_queue',
        id: 'recording-availability',
        label: 'Recording availability',
      },
    }), expect.any(Function));
    expect(AdminJobService.enqueue).toHaveBeenCalledWith(expect.objectContaining({
      correlationId: 'correlation-1',
      idempotencyKey: 'recording-request-1',
      jobType: 'earthquake-recording-availability-refresh',
      requestedBy: expect.objectContaining({ username: 'admin-user' }),
    }));
    expect(EQEventsService.updateOnlineStations).not.toHaveBeenCalled();
  });

  it('requires an idempotency key for recording verification requests', async () => {
    const response = await request(app)
      .post('/admin/earthquake-events/recording-availability/run')
      .set('Cookie', [`accessToken=${signAdminToken()}`, `csrfToken=${csrfToken}`])
      .set('X-CSRF-Token', csrfToken)
      .send({ reason: 'Verify recording evidence for events requiring attention.' });

    expect(response.statusCode).toBe(400);
    expect(response.body.errorCode).toBe('VALIDATION_ERROR');
    expect(AdminJobService.enqueue).not.toHaveBeenCalled();
  });
});
