const ROUTINE_READS = ['admin.telemetry.read', 'admin.audit.read'];
const SECURITY_ACTIONS = [
  'admin.authentication', 'admin.signout', 'admin.account.bootstrap',
  'admin.capability.rejected', 'admin.csrf.rejected', 'admin.reauthentication.required',
  'account.admin_role.update', 'account.sessions.revoke',
  'device.tunnel.enroll', 'device.tunnel.revoke',
];
function presetCondition(preset) {
  if (preset === 'important') return { $or: [
    { eventType: { $nin: ROUTINE_READS } },
    { outcome: { $in: ['failed', 'rejected'] } },
  ] };
  if (preset === 'failures') return { outcome: { $in: ['failed', 'rejected'] } };
  if (preset === 'security') return { eventType: { $in: SECURITY_ACTIONS } };
  return null;
}
module.exports = { presetCondition, ROUTINE_READS, SECURITY_ACTIONS };
