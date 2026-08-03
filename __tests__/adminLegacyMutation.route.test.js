const jwt = require('jsonwebtoken');
const request = require('supertest');

process.env.NODE_ENV = 'test';
process.env.ACCESS_TOKEN_PRIVATE_KEY_WEB = 'test-web-secret';
process.env.REFRESH_TOKEN_PRIVATE_KEY_WEB = 'test-refresh-secret';

jest.mock('../src/services/comments.service', () => ({
  COMMENT_STATUS: { PENDING: 'pending', APPROVED: 'approved', REJECTED: 'rejected' },
  MODERATION_CASE_STATUSES: ['open', 'investigating', 'escalated', 'resolved'],
  deleteComment: jest.fn(),
  moderateAdminComment: jest.fn(),
  updateCommentStatus: jest.fn(),
}));
jest.mock('../src/services/EQevents.service', () => ({
  addAdditionalInformation: jest.fn(),
  clearEventSummary: jest.fn(),
  setEventSummary: jest.fn(),
  updateOnlineStations: jest.fn(),
}));
jest.mock('../src/services/auditLog.service', () => ({
  execute: jest.fn(),
  record: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../src/services/adminJob.service', () => ({
  enqueue: jest.fn(),
  wake: jest.fn(),
}));

const CommentsService = require('../src/services/comments.service');
const EQEventsService = require('../src/services/EQevents.service');
const AuditLogService = require('../src/services/auditLog.service');
const AdminJobService = require('../src/services/adminJob.service');
const app = require('../src/app');
const csrfToken = 'test-admin-csrf-token';

function signToken(role) {
  return jwt.sign(
    { accountId: `${role}-1`, username: `${role}-user`, role, csrfToken },
    process.env.ACCESS_TOKEN_PRIVATE_KEY_WEB,
    { expiresIn: '1h' },
  );
}

function adminRequest(requestBuilder) {
  return requestBuilder
    .set('Cookie', [`accessToken=${signToken('admin')}`, `csrfToken=${csrfToken}`])
    .set('X-CSRF-Token', csrfToken);
}

describe('legacy administrator mutation routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    AuditLogService.execute.mockImplementation(async (_req, _event, operation) => operation({
      correlationId: 'legacy-correlation',
    }));
    AdminJobService.enqueue.mockResolvedValue({
      reused: false,
      job: {
        _id: '507f1f77bcf86cd799439011',
        status: 'queued',
      },
    });
  });

  it('routes legacy report moderation through the audited admin controller', async () => {
    CommentsService.moderateAdminComment.mockResolvedValue({
      report: { commentId: 'CR-1', status: 'approved' },
      moderationCase: { status: 'resolved', version: 1 },
    });

    const response = await adminRequest(
      request(app)
        .patch('/comments/CR-1/status')
        .send({
          currentCaseStatus: 'open',
          currentCaseVersion: 0,
          currentStatus: 'pending',
          status: 'approved',
          reason: 'Verified against event evidence.',
        }),
    );

    expect(response.statusCode).toBe(200);
    expect(AuditLogService.execute).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      eventType: 'community_report.status.approved',
    }), expect.any(Function));
  });

  it('requires typed confirmation on the legacy report deletion path', async () => {
    const response = await adminRequest(
      request(app)
        .delete('/comments/CR-1')
        .send({ confirmation: 'CR-2', reason: 'Duplicate report.' }),
    );

    expect(response.statusCode).toBe(400);
    expect(response.body.errorCode).toBe('ADMIN_CONFIRMATION_MISMATCH');
    expect(CommentsService.deleteComment).not.toHaveBeenCalled();
  });

  it('routes legacy admin event-summary updates through the audited controller', async () => {
    EQEventsService.setEventSummary.mockResolvedValue({
      summaryOverride: { text: 'Reviewed summary.' },
    });

    const response = await adminRequest(
      request(app)
        .patch('/eq-events/event-1/summary')
        .send({ text: 'Reviewed summary.', reason: 'Verified by operations.' }),
    );

    expect(response.statusCode).toBe(200);
    expect(AuditLogService.execute).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      eventType: 'earthquake_event.summary.update',
    }), expect.any(Function));
  });

  it('preserves the existing citizen event-summary flow', async () => {
    EQEventsService.setEventSummary.mockResolvedValue({
      summaryOverride: { text: 'Citizen summary.' },
    });

    const response = await request(app)
      .patch('/eq-events/event-1/summary')
      .set('Cookie', [`accessToken=${signToken('citizen')}`])
      .send({ text: 'Citizen summary.' });

    expect(response.statusCode).toBe(200);
    expect(AuditLogService.execute).not.toHaveBeenCalled();
    expect(EQEventsService.setEventSummary).toHaveBeenCalled();
  });

  it('audits and queues the compatibility enrichment endpoint', async () => {
    const response = await adminRequest(
      request(app)
        .post('/eq-events/restricted/scrape-additional-information')
        .send({ reason: 'Run the reviewed pending enrichment batch.' }),
    );

    expect(response.statusCode).toBe(200);
    expect(AuditLogService.execute).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      eventType: 'earthquake_event.enrichment.run',
    }), expect.any(Function));
    expect(AdminJobService.enqueue).toHaveBeenCalledWith(expect.objectContaining({
      correlationId: 'legacy-correlation',
      jobType: 'earthquake-event-enrichment',
    }));
  });

  it('audits and queues the compatibility recording-availability refresh endpoint', async () => {
    const response = await adminRequest(
      request(app)
        .post('/eq-events/restricted/update-online-stations')
        .send({ reason: 'Refresh recording evidence after archive verification.' }),
    );

    expect(response.statusCode).toBe(200);
    expect(AuditLogService.execute).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      eventType: 'earthquake_event.recording_availability.refresh',
    }), expect.any(Function));
    expect(AdminJobService.enqueue).toHaveBeenCalledWith(expect.objectContaining({
      correlationId: 'legacy-correlation',
      jobType: 'earthquake-recording-availability-refresh',
    }));
    expect(EQEventsService.updateOnlineStations).not.toHaveBeenCalled();
  });
});
