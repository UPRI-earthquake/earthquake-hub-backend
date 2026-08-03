jest.mock('../src/models/adminIncident.model', () => ({
  find: jest.fn(),
  findById: jest.fn(),
  findOneAndUpdate: jest.fn(),
  updateOne: jest.fn(),
}));
jest.mock('../src/models/adminIncidentEvent.model', () => ({
  create: jest.fn(),
  insertMany: jest.fn(),
}));

const AdminIncident = require('../src/models/adminIncident.model');
const AdminIncidentEvent = require('../src/models/adminIncidentEvent.model');
const {
  deriveConditions,
  synchronizeOverview,
  updateIncident,
} = require('../src/services/adminIncident.service');

function leanResult(value) {
  return { lean: jest.fn().mockResolvedValue(value) };
}

describe('AdminIncidentService', () => {
  beforeEach(() => jest.clearAllMocks());

  it('derives stable operational conditions without copying sensitive source fields', () => {
    const conditions = deriveConditions({
      observedAt: '2026-07-31T00:00:00.000Z',
      summary: { archiveAttention: 2, pendingReports: 3 },
      sources: [
        {
          id: 'ringserver',
          label: 'Ringserver',
          route: '/ringserver',
          status: 'unavailable',
          message: 'Ringserver timed out.',
          metrics: { internalCommand: 'must not be copied' },
        },
        {
          id: 'stations',
          label: 'RShake Stations',
          route: '/devices-stations',
          status: 'available',
          metrics: { total: 10, active: 8, inactive: 2, secret: 'must not be copied' },
        },
      ],
    });

    expect(conditions.map((item) => item.fingerprint)).toEqual([
      'overview:source:ringserver:availability',
      'overview:stations:activity-attention',
      'overview:archive:verification-attention',
      'overview:moderation:pending-reports',
    ]);
    expect(conditions[0]).toMatchObject({
      severity: 'critical',
      source: { type: 'overview_source', id: 'ringserver' },
    });
    expect(JSON.stringify(conditions)).not.toContain('internalCommand');
    expect(JSON.stringify(conditions)).not.toContain('secret');
  });

  it('resolves cleared conditions without changing when they were last observed', async () => {
    const existing = {
      _id: '507f1f77bcf86cd799439011',
      fingerprint: 'overview:stations:activity-attention',
      status: 'investigating',
      lastObservedAt: new Date('2026-07-30T23:00:00.000Z'),
    };
    AdminIncident.find
      .mockReturnValueOnce(leanResult([existing]))
      .mockReturnValueOnce(leanResult([]));
    AdminIncident.findOneAndUpdate.mockReturnValue(leanResult(existing));
    AdminIncidentEvent.insertMany.mockResolvedValue([]);

    const result = await synchronizeOverview({
      observedAt: '2026-07-31T00:00:00.000Z',
      summary: {},
      sources: [],
    });

    expect(AdminIncident.findOneAndUpdate).toHaveBeenCalledWith(
      {
        _id: existing._id,
        status: { $in: ['open', 'acknowledged', 'investigating'] },
      },
      {
        $set: {
          status: 'resolved',
          resolvedAt: new Date('2026-07-31T00:00:00.000Z'),
          retentionDays: 730,
          expiresAt: new Date('2028-07-30T00:00:00.000Z'),
        },
      },
      { new: false },
    );
    expect(AdminIncidentEvent.insertMany).toHaveBeenCalledWith(
      [expect.objectContaining({
        eventType: 'resolved',
        fromStatus: 'investigating',
        toStatus: 'resolved',
      })],
      { ordered: false },
    );
    expect(result.summary.active).toBe(0);
  });

  it('appends detection only when this request wins the fingerprint upsert', async () => {
    const activeIncident = {
      _id: '507f1f77bcf86cd799439011',
      fingerprint: 'overview:stations:activity-attention',
      status: 'open',
      severity: 'warning',
      title: 'Station activity needs review',
      detail: '2 inactive.',
      subsystem: 'RShake Stations',
      route: '/devices-stations',
      source: { type: 'derived_metric', id: 'stations' },
      firstDetectedAt: new Date('2026-07-31T00:00:00.000Z'),
      lastObservedAt: new Date('2026-07-31T00:00:00.000Z'),
    };
    AdminIncident.find
      .mockReturnValueOnce(leanResult([]))
      .mockReturnValueOnce(leanResult([activeIncident]));
    AdminIncident.updateOne.mockResolvedValue({ upsertedCount: 1 });
    AdminIncidentEvent.insertMany.mockResolvedValue([]);

    const result = await synchronizeOverview({
      observedAt: '2026-07-31T00:00:00.000Z',
      summary: {},
      sources: [{
        id: 'stations',
        label: 'RShake Stations',
        route: '/devices-stations',
        status: 'available',
        metrics: { total: 10, active: 8, inactive: 2 },
      }],
    });

    expect(AdminIncidentEvent.insertMany).toHaveBeenCalledWith(
      [expect.objectContaining({
        eventType: 'detected',
        toStatus: 'open',
      })],
      { ordered: false },
    );
    expect(result.summary.open).toBe(1);
  });

  it('treats a duplicate-key upsert race as an existing incident', async () => {
    const activeIncident = {
      _id: '507f1f77bcf86cd799439011',
      fingerprint: 'overview:stations:activity-attention',
      status: 'open',
      severity: 'warning',
      title: 'Station activity needs review',
      detail: '2 inactive.',
      subsystem: 'RShake Stations',
      route: '/devices-stations',
      source: { type: 'derived_metric', id: 'stations' },
      firstDetectedAt: new Date('2026-07-31T00:00:00.000Z'),
      lastObservedAt: new Date('2026-07-31T00:00:00.000Z'),
    };
    AdminIncident.find
      .mockReturnValueOnce(leanResult([]))
      .mockReturnValueOnce(leanResult([activeIncident]));
    AdminIncident.updateOne
      .mockRejectedValueOnce(Object.assign(new Error('duplicate key'), { code: 11000 }))
      .mockResolvedValueOnce({ matchedCount: 1 });
    AdminIncident.findOneAndUpdate.mockReturnValue(leanResult(null));

    const result = await synchronizeOverview({
      observedAt: '2026-07-31T00:00:00.000Z',
      summary: {},
      sources: [{
        id: 'stations',
        label: 'RShake Stations',
        route: '/devices-stations',
        status: 'available',
        metrics: { total: 10, active: 8, inactive: 2 },
      }],
    });

    expect(AdminIncidentEvent.insertMany).not.toHaveBeenCalled();
    expect(AdminIncident.updateOne).toHaveBeenCalledTimes(2);
    expect(result.summary.open).toBe(1);
  });

  it('persists an operator transition and append-only history event', async () => {
    const incident = {
      _id: '507f1f77bcf86cd799439011',
      status: 'open',
      assignedTo: null,
      save: jest.fn().mockResolvedValue(undefined),
      toObject() {
        return {
          ...this,
          fingerprint: 'overview:ringserver',
          severity: 'critical',
          title: 'Ringserver unavailable',
          detail: 'No response.',
          subsystem: 'Ringserver',
          route: '/ringserver',
          source: { type: 'overview_source', id: 'ringserver' },
          firstDetectedAt: new Date(),
          lastObservedAt: new Date(),
        };
      },
    };
    AdminIncident.findById.mockResolvedValue(incident);
    AdminIncidentEvent.create.mockResolvedValue({});

    const result = await updateIncident(
      String(incident._id),
      {
        status: 'investigating',
        assignment: 'unchanged',
        reason: 'Investigating Ringserver connectivity.',
      },
      {
        accountId: 'admin-account',
        username: 'ops-admin',
        adminRole: 'operator',
        auditCorrelationId: 'correlation-incident-1',
      },
    );

    expect(incident.status).toBe('investigating');
    expect(incident.assignedTo).toBe('ops-admin');
    expect(incident.save).toHaveBeenCalledTimes(1);
    expect(AdminIncidentEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'investigating',
      correlationId: 'correlation-incident-1',
      actor: {
        accountId: 'admin-account',
        username: 'ops-admin',
        role: 'operator',
      },
      fromStatus: 'open',
      toStatus: 'investigating',
      assignedTo: 'ops-admin',
    }));
    expect(result.incident).toMatchObject({
      status: 'investigating',
      assignedTo: 'ops-admin',
    });
  });

  it('rejects transitions from resolved to investigating', async () => {
    AdminIncident.findById.mockResolvedValue({
      _id: '507f1f77bcf86cd799439011',
      status: 'resolved',
      assignedTo: null,
    });

    await expect(updateIncident(
      '507f1f77bcf86cd799439011',
      { status: 'investigating', reason: 'Invalid direct transition.' },
      { username: 'ops-admin' },
    )).resolves.toEqual({
      invalidTransition: true,
      fromStatus: 'resolved',
      toStatus: 'investigating',
    });
    expect(AdminIncidentEvent.create).not.toHaveBeenCalled();
  });
});
