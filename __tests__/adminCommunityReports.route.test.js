const jwt = require('jsonwebtoken');
const request = require('supertest');

process.env.NODE_ENV = 'test';
process.env.ACCESS_TOKEN_PRIVATE_KEY_WEB = 'test-web-secret';
process.env.REFRESH_TOKEN_PRIVATE_KEY_WEB = 'test-refresh-secret';

jest.mock('../src/services/comments.service', () => ({
  COMMENT_STATUS: { PENDING: 'pending', APPROVED: 'approved', REJECTED: 'rejected' },
  deleteComment: jest.fn(),
  getAdminModerationQueue: jest.fn(),
  updateCommentStatus: jest.fn(),
}));
jest.mock('../src/services/auditLog.service', () => ({ execute: jest.fn() }));

const CommentsService = require('../src/services/comments.service');
const AuditLogService = require('../src/services/auditLog.service');
const app = require('../src/app');
const csrfToken = 'test-admin-csrf-token';

function signAdminToken() {
  return jwt.sign(
    { accountId: 'account-1', username: 'admin-user', role: 'admin', csrfToken },
    process.env.ACCESS_TOKEN_PRIVATE_KEY_WEB,
    { expiresIn: '1h' },
  );
}

describe('Admin community reports routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    AuditLogService.execute.mockImplementation(async (_req, _event, operation) => operation());
  });

  it('requires an administrator session', async () => {
    const response = await request(app).get('/admin/community-reports');

    expect(response.statusCode).toBe(403);
    expect(CommentsService.getAdminModerationQueue).not.toHaveBeenCalled();
  });

  it('lists filtered reports for an administrator', async () => {
    CommentsService.getAdminModerationQueue.mockResolvedValue({
      comments: [{ commentId: 'CR-1', status: 'pending' }],
      total: 1,
      limit: 25,
      offset: 0,
      summary: { total: 1, pending: 1 },
    });

    const response = await request(app)
      .get('/admin/community-reports?status=pending&hasImage=true&hasIssues=true&startTime=2026-07-01T00:00:00.000Z&endTime=2026-07-22T00:00:00.000Z&search=Batangas')
      .set('Cookie', [`accessToken=${signAdminToken()}`]);

    expect(response.statusCode).toBe(200);
    expect(CommentsService.getAdminModerationQueue).toHaveBeenCalledWith(expect.objectContaining({
      status: 'pending', hasImage: true, hasIssues: true, includeSummary: true,
      startTime: expect.any(Date), endTime: expect.any(Date), search: 'Batangas', limit: 25, offset: 0,
    }));
    expect(response.body.payload).toEqual([{ commentId: 'CR-1', status: 'pending' }]);
    expect(response.body.summary).toEqual({ total: 1, pending: 1 });
  });

  it('audits an approval before updating report status', async () => {
    CommentsService.updateCommentStatus.mockResolvedValue({ commentId: 'CR-1', status: 'approved' });

    const response = await request(app)
      .patch('/admin/community-reports/CR-1/status')
      .set('Cookie', [`accessToken=${signAdminToken()}`, `csrfToken=${csrfToken}`])
      .set('X-CSRF-Token', csrfToken)
      .send({ status: 'approved', reason: 'Verified against the event record.' });

    expect(response.statusCode).toBe(200);
    expect(AuditLogService.execute).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      eventType: 'community_report.status.approved',
      reason: 'Verified against the event record.',
      target: { type: 'community_report', id: 'CR-1', label: 'CR-1' },
    }), expect.any(Function));
    expect(CommentsService.updateCommentStatus).toHaveBeenCalledWith('CR-1', 'approved', 'admin-user');
  });

  it('audits deletion before removing a report', async () => {
    CommentsService.deleteComment.mockResolvedValue({ commentId: 'CR-1' });

    const response = await request(app)
      .delete('/admin/community-reports/CR-1')
      .set('Cookie', [`accessToken=${signAdminToken()}`, `csrfToken=${csrfToken}`])
      .set('X-CSRF-Token', csrfToken)
      .send({ reason: 'Duplicate report with no additional information.' });

    expect(response.statusCode).toBe(200);
    expect(AuditLogService.execute).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      eventType: 'community_report.delete',
      target: { type: 'community_report', id: 'CR-1', label: 'CR-1' },
    }), expect.any(Function));
    expect(CommentsService.deleteComment).toHaveBeenCalledWith('CR-1');
  });
});
