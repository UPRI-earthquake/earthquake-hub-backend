const AdminIncident = require('../src/models/adminIncident.model');
const AdminIncidentEvent = require('../src/models/adminIncidentEvent.model');

describe('admin incident retention models', () => {
  it('expires only incidents with an explicitly assigned absolute date', () => {
    const ttlIndex = AdminIncident.schema.indexes()
      .find(([fields]) => fields.expiresAt === 1);

    expect(AdminIncident.schema.path('retentionDays')).toBeDefined();
    expect(AdminIncident.schema.path('expiresAt')).toBeDefined();
    expect(ttlIndex).toBeDefined();
    expect(ttlIndex[1]).toEqual(expect.objectContaining({ expireAfterSeconds: 0 }));
  });

  it('assigns bounded retention metadata to append-only incident history', () => {
    const event = new AdminIncidentEvent({
      incidentId: '507f1f77bcf86cd799439011',
      eventType: 'detected',
    });
    const ttlIndex = AdminIncidentEvent.schema.indexes()
      .find(([fields]) => fields.expiresAt === 1);

    expect(event.retentionDays).toBe(730);
    expect(event.expiresAt).toBeInstanceOf(Date);
    expect(AdminIncidentEvent.schema.path('correlationId')).toBeDefined();
    expect(ttlIndex).toBeDefined();
    expect(ttlIndex[1]).toEqual(expect.objectContaining({ expireAfterSeconds: 0 }));
  });
});
