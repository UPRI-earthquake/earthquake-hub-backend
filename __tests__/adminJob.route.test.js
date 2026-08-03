const jwt = require('jsonwebtoken');
const request = require('supertest');

process.env.NODE_ENV = 'test';
process.env.ACCESS_TOKEN_PRIVATE_KEY_WEB = 'test-web-secret';
process.env.REFRESH_TOKEN_PRIVATE_KEY_WEB = 'test-refresh-secret';

jest.mock('../src/services/adminJob.service', () => ({
  enqueue: jest.fn(),
  getById: jest.fn(),
  list: jest.fn(),
  retry: jest.fn(),
  wake: jest.fn(),
}));
jest.mock('../src/services/auditLog.service', () => ({
  execute: jest.fn(),
  record: jest.fn(),
}));

const AdminJobService = require('../src/services/adminJob.service');
const AuditLogService = require('../src/services/auditLog.service');
const app = require('../src/app');
const csrfToken = 'admin-job-csrf';

function signAdminToken(adminRole = 'operator') {
  return jwt.sign(
    {
      accountId: 'account-1',
      username: 'ops-admin',
      role: 'admin',
      adminRole,
      csrfToken,
    },
    process.env.ACCESS_TOKEN_PRIVATE_KEY_WEB,
    { expiresIn: '1h' },
  );
}

describe('Admin job routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    AuditLogService.execute.mockImplementation((_req, _event, operation) => operation({
      correlationId: 'retry-correlation',
    }));
  });

  it('requires an administrator session for job history', async () => {
    const response = await request(app).get('/admin/jobs');
    expect(response.statusCode).toBe(403);
    expect(AdminJobService.list).not.toHaveBeenCalled();
  });

  it('lists filtered job history', async () => {
    AdminJobService.list.mockResolvedValue({
      jobs: [{
        _id: '507f1f77bcf86cd799439011',
        status: 'running',
        idempotencyKey: 'must-not-leave-server',
        lease: { owner: 'backend-host:123' },
      }],
      total: 1,
      limit: 5,
      offset: 0,
    });

    const response = await request(app)
      .get('/admin/jobs?jobType=earthquake-event-enrichment&status=running&limit=5')
      .set('Cookie', [`accessToken=${signAdminToken()}`]);

    expect(response.statusCode).toBe(200);
    expect(AdminJobService.list).toHaveBeenCalledWith(
      { jobType: 'earthquake-event-enrichment', status: 'running' },
      expect.objectContaining({ limit: 5, offset: 0 }),
    );
    expect(response.body.pagination.total).toBe(1);
    expect(response.body.payload[0].idempotencyKey).toBeUndefined();
    expect(response.body.payload[0].lease).toBeUndefined();
  });

  it('queues an audited retry with the same job lineage', async () => {
    AdminJobService.getById.mockResolvedValue({
      _id: '507f1f77bcf86cd799439011',
      jobType: 'earthquake-event-enrichment',
      status: 'failed',
    });
    AdminJobService.retry.mockResolvedValue({
      reused: false,
      job: {
        _id: '507f1f77bcf86cd799439012',
        retryOf: '507f1f77bcf86cd799439011',
        attempt: 2,
        status: 'queued',
      },
    });

    const response = await request(app)
      .post('/admin/jobs/507f1f77bcf86cd799439011/retry')
      .set('Cookie', [`accessToken=${signAdminToken()}`, `csrfToken=${csrfToken}`])
      .set('X-CSRF-Token', csrfToken)
      .set('Idempotency-Key', 'retry-request-123')
      .send({ reason: 'Retry after the external catalog recovered.' });

    expect(response.statusCode).toBe(202);
    expect(AuditLogService.execute).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      eventType: 'admin_job.retry',
      target: {
        type: 'admin_job',
        id: '507f1f77bcf86cd799439011',
        label: '507f1f77bcf86cd799439011',
      },
    }), expect.any(Function));
    expect(AdminJobService.retry).toHaveBeenCalledWith(
      '507f1f77bcf86cd799439011',
      expect.objectContaining({
        correlationId: 'retry-correlation',
        idempotencyKey: 'retry-request-123',
        requestedBy: expect.objectContaining({ adminRole: 'operator' }),
      }),
    );
    expect(AdminJobService.wake).toHaveBeenCalled();
  });

  it('requires CSRF and an idempotency key for retries', async () => {
    const noCsrf = await request(app)
      .post('/admin/jobs/507f1f77bcf86cd799439011/retry')
      .set('Cookie', [`accessToken=${signAdminToken()}`])
      .send({ reason: 'Retry after recovery.' });
    expect(noCsrf.statusCode).toBe(403);

    const noKey = await request(app)
      .post('/admin/jobs/507f1f77bcf86cd799439011/retry')
      .set('Cookie', [`accessToken=${signAdminToken()}`, `csrfToken=${csrfToken}`])
      .set('X-CSRF-Token', csrfToken)
      .send({ reason: 'Retry after recovery.' });
    expect(noKey.statusCode).toBe(400);
    expect(AdminJobService.retry).not.toHaveBeenCalled();
  });

  it('re-authorizes a recording job retry against its own capability', async () => {
    AdminJobService.getById.mockResolvedValue({
      _id: '507f1f77bcf86cd799439011',
      jobType: 'earthquake-recording-availability-refresh',
      status: 'failed',
    });
    AdminJobService.retry.mockResolvedValue({
      reused: false,
      job: { _id: '507f1f77bcf86cd799439012', status: 'queued', attempt: 2 },
    });

    const response = await request(app)
      .post('/admin/jobs/507f1f77bcf86cd799439011/retry')
      .set('Cookie', [`accessToken=${signAdminToken()}`, `csrfToken=${csrfToken}`])
      .set('X-CSRF-Token', csrfToken)
      .set('Idempotency-Key', 'recording-retry-123')
      .send({ reason: 'Retry after FDSNWS recovered.' });

    expect(response.statusCode).toBe(202);
    expect(AdminJobService.retry).toHaveBeenCalled();
  });

  it('fails closed when the current role cannot retry the job type', async () => {
    AdminJobService.getById.mockResolvedValue({
      _id: '507f1f77bcf86cd799439011',
      jobType: 'earthquake-recording-availability-refresh',
      status: 'failed',
    });

    const response = await request(app)
      .post('/admin/jobs/507f1f77bcf86cd799439011/retry')
      .set('Cookie', [`accessToken=${signAdminToken('viewer')}`, `csrfToken=${csrfToken}`])
      .set('X-CSRF-Token', csrfToken)
      .set('Idempotency-Key', 'recording-retry-456')
      .send({ reason: 'Retry this recording verification.' });

    expect(response.statusCode).toBe(403);
    expect(response.body.errorCode).toBe('ADMIN_JOB_CAPABILITY_DISABLED');
    expect(AuditLogService.record).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      eventType: 'admin.capability.rejected',
      metadata: expect.objectContaining({
        actionId: 'earthquakeEvent.recordingRefresh',
        jobType: 'earthquake-recording-availability-refresh',
      }),
    }));
    expect(AdminJobService.retry).not.toHaveBeenCalled();
  });
});
