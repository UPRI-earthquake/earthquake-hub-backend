const AuditLog = require('../src/models/auditLog.model');

describe('AuditLog model retention', () => {
  it('declares a per-record expiration field with an absolute TTL index', () => {
    const ttlIndex = AuditLog.schema.indexes().find(([fields]) => fields.expiresAt === 1);

    expect(AuditLog.schema.path('retentionClass').isRequired).toBe(true);
    expect(ttlIndex).toBeDefined();
    expect(ttlIndex[1]).toEqual(expect.objectContaining({ expireAfterSeconds: 0 }));
  });
});
