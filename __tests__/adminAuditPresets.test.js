const { presetCondition, SECURITY_ACTIONS } = require('../src/services/adminAuditPresets');
test('Important hides routine reads but retains their failures', () => {
  expect(presetCondition('important')).toEqual({ $or: [
    { eventType: { $nin: ['admin.telemetry.read', 'admin.audit.read'] } },
    { outcome: { $in: ['failed', 'rejected'] } },
  ] });
});
test('failure and security presets use stored action/outcome names', () => {
  expect(presetCondition('failures')).toEqual({ outcome: { $in: ['failed', 'rejected'] } });
  expect(presetCondition('security')).toEqual({ eventType: { $in: SECURITY_ACTIONS } });
  expect(SECURITY_ACTIONS).toContain('admin.csrf.rejected');
  expect(SECURITY_ACTIONS).toContain('account.admin_role.update');
});
test('All Records adds no filter and does not delete or rewrite records', () => {
  expect(presetCondition('all')).toBeNull();
});
