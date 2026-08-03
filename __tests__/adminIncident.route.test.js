const jwt = require('jsonwebtoken');
const request = require('supertest');

process.env.NODE_ENV = 'test';
process.env.ACCESS_TOKEN_PRIVATE_KEY_WEB = 'test-web-secret';
process.env.REFRESH_TOKEN_PRIVATE_KEY_WEB = 'test-refresh-secret';

jest.mock('../src/services/adminIncident.service', () => ({
  listEvents: jest.fn(),
  listIncidents: jest.fn(),
  updateIncident: jest.fn(),
}));
jest.mock('../src/services/adminOverview.service', () => ({
  resetOverviewState: jest.fn(),
}));
jest.mock('../src/services/auditLog.service', () => ({
  execute: jest.fn(),
  record: jest.fn(),
}));

const AdminIncidentService = require('../src/services/adminIncident.service');
const AdminOverviewService = require('../src/services/adminOverview.service');
const AuditLogService = require('../src/services/auditLog.service');
const app = require('../src/app');

const incidentId = '507f1f77bcf86cd799439011';
const csrfToken = 'incident-csrf-token';

function signAdminToken(adminRole = 'operator') {
  return jwt.sign(
    {
      accountId: 'admin-account',
      username: 'ops-admin',
      role: 'admin',
      adminRole,
      csrfToken,
    },
    process.env.ACCESS_TOKEN_PRIVATE_KEY_WEB,
    { expiresIn: '1h' },
  );
}

function adminCookies(adminRole) {
  return [
    `accessToken=${signAdminToken(adminRole)}`,
    `csrfToken=${csrfToken}`,
  ];
}

describe('Admin incident routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    AuditLogService.execute.mockImplementation(
      async (_req, _event, operation) => operation({ correlationId: 'audit-correlation-1' }),
    );
  });

  it('lists persisted incidents for a read-only administrator', async () => {
    AdminIncidentService.listIncidents.mockResolvedValue({
      incidents: [{ incidentId, status: 'open' }],
      limit: 50,
      offset: 0,
      total: 1,
    });

    const response = await request(app)
      .get('/admin/incidents?status=open')
      .set('Cookie', [`accessToken=${signAdminToken('viewer')}`]);

    expect(response.statusCode).toBe(200);
    expect(response.body.payload).toEqual([{ incidentId, status: 'open' }]);
    expect(AdminIncidentService.listIncidents).toHaveBeenCalledWith(expect.objectContaining({
      status: 'open',
      limit: 50,
      offset: 0,
    }));
  });

  it('lets an operator acknowledge an incident through an audited mutation', async () => {
    AdminIncidentService.updateIncident.mockResolvedValue({
      incident: { incidentId, status: 'acknowledged', assignedTo: 'ops-admin' },
    });

    const response = await request(app)
      .patch(`/admin/incidents/${incidentId}`)
      .set('Cookie', adminCookies('operator'))
      .set('X-CSRF-Token', csrfToken)
      .send({
        status: 'acknowledged',
        assignment: 'self',
        reason: 'I am reviewing the source evidence.',
      });

    expect(response.statusCode).toBe(200);
    expect(AuditLogService.execute).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventType: 'incident.lifecycle.update',
        target: { type: 'operational_incident', id: incidentId, label: incidentId },
      }),
      expect.any(Function),
    );
    expect(AdminIncidentService.updateIncident).toHaveBeenCalledWith(
      incidentId,
      expect.objectContaining({
        status: 'acknowledged',
        assignment: 'self',
      }),
      expect.anything(),
    );
    expect(AdminOverviewService.resetOverviewState).toHaveBeenCalledTimes(1);
    expect(AdminIncidentService.updateIncident.mock.calls[0][2].auditCorrelationId)
      .toBe('audit-correlation-1');
  });

  it('returns immutable history, including audit correlation, to a viewer', async () => {
    AdminIncidentService.listEvents.mockResolvedValue([{
      eventId: 'event-1',
      incidentId,
      correlationId: 'audit-correlation-1',
      eventType: 'acknowledged',
      actor: { username: 'ops-admin', role: 'operator' },
      reason: 'Reviewed the current evidence.',
    }]);

    const response = await request(app)
      .get(`/admin/incidents/${incidentId}/events`)
      .set('Cookie', [`accessToken=${signAdminToken('viewer')}`]);

    expect(response.statusCode).toBe(200);
    expect(response.body.payload).toEqual([
      expect.objectContaining({
        correlationId: 'audit-correlation-1',
        eventType: 'acknowledged',
      }),
    ]);
    expect(AdminIncidentService.listEvents).toHaveBeenCalledWith(incidentId, { limit: 100 });
  });

  it('lets an operator append an audited note without changing lifecycle state', async () => {
    AdminIncidentService.updateIncident.mockResolvedValue({
      incident: { incidentId, status: 'investigating', assignedTo: 'ops-admin' },
    });

    const response = await request(app)
      .post(`/admin/incidents/${incidentId}/notes`)
      .set('Cookie', adminCookies('operator'))
      .set('X-CSRF-Token', csrfToken)
      .send({ reason: 'Ringserver service is reachable; checking stream freshness next.' });

    expect(response.statusCode).toBe(200);
    expect(AuditLogService.execute).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventType: 'incident.note.add',
        target: { type: 'operational_incident', id: incidentId, label: incidentId },
      }),
      expect.any(Function),
    );
    expect(AdminIncidentService.updateIncident).toHaveBeenCalledWith(
      incidentId,
      {
        assignment: 'unchanged',
        reason: 'Ringserver service is reachable; checking stream freshness next.',
      },
      expect.objectContaining({ auditCorrelationId: 'audit-correlation-1' }),
    );
  });

  it('fails closed for a viewer attempting to mutate an incident', async () => {
    const response = await request(app)
      .patch(`/admin/incidents/${incidentId}`)
      .set('Cookie', adminCookies('viewer'))
      .set('X-CSRF-Token', csrfToken)
      .send({
        status: 'resolved',
        reason: 'A viewer must not resolve this incident.',
      });

    expect(response.statusCode).toBe(403);
    expect(response.body.errorCode).toBe('ADMIN_CAPABILITY_DISABLED');
    expect(AdminIncidentService.updateIncident).not.toHaveBeenCalled();
    expect(AuditLogService.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventType: 'admin.capability.rejected' }),
    );
  });

  it('returns a stable conflict when a lifecycle transition is invalid', async () => {
    AdminIncidentService.updateIncident.mockResolvedValue({
      invalidTransition: true,
      fromStatus: 'resolved',
      toStatus: 'investigating',
    });

    const response = await request(app)
      .patch(`/admin/incidents/${incidentId}`)
      .set('Cookie', adminCookies('operator'))
      .set('X-CSRF-Token', csrfToken)
      .send({
        status: 'investigating',
        reason: 'This transition should require reopening first.',
      });

    expect(response.statusCode).toBe(409);
    expect(response.body.errorCode).toBe('ADMIN_INCIDENT_INVALID_TRANSITION');
    expect(AdminOverviewService.resetOverviewState).not.toHaveBeenCalled();
  });
});
