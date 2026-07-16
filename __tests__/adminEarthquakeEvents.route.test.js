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
}));
jest.mock('../src/services/auditLog.service', () => ({ execute: jest.fn() }));

const EQEventsService = require('../src/services/EQevents.service');
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

describe('Admin earthquake event routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    AuditLogService.execute.mockImplementation(async (_req, _event, operation) => operation());
  });

  it('requires an administrator session', async () => {
    const response = await request(app).get('/admin/earthquake-events');
    expect(response.statusCode).toBe(403);
    expect(EQEventsService.getAdminEventQueue).not.toHaveBeenCalled();
  });

  it('lists a filtered event queue', async () => {
    EQEventsService.getAdminEventQueue.mockResolvedValue({ events: [{ publicID: 'event-1' }], total: 1, limit: 25, offset: 0 });
    const response = await request(app)
      .get('/admin/earthquake-events?hasSummary=true&pendingEnrichment=true&search=Batangas')
      .set('Cookie', [`accessToken=${signAdminToken()}`]);

    expect(response.statusCode).toBe(200);
    expect(EQEventsService.getAdminEventQueue).toHaveBeenCalledWith(expect.objectContaining({
      hasSummary: true, pendingEnrichment: true, search: 'Batangas', limit: 25, offset: 0,
    }));
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
      metadata: { summaryLength: 22 },
    }), expect.any(Function));
    expect(EQEventsService.setEventSummary).toHaveBeenCalledWith('event-1', 'Reviewed event summary', 'admin-user');
  });

  it('audits the batch enrichment run', async () => {
    EQEventsService.addAdditionalInformation.mockResolvedValue({ totalProcessed: 3 });
    const response = await request(app)
      .post('/admin/earthquake-events/enrichment/run')
      .set('Cookie', [`accessToken=${signAdminToken()}`, `csrfToken=${csrfToken}`])
      .set('X-CSRF-Token', csrfToken)
      .send({ reason: 'Process eligible pending catalog records.' });

    expect(response.statusCode).toBe(200);
    expect(AuditLogService.execute).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      eventType: 'earthquake_event.enrichment.run',
      target: { type: 'earthquake_event_queue', id: 'pending-enrichment', label: 'Pending catalog enrichment' },
    }), expect.any(Function));
  });
});
