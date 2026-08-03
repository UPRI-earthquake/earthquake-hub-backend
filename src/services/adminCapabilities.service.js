const ACTIONS = Object.freeze({
  ACCOUNT_BRGY_APPROVAL: 'account.brgyApproval',
  ACCOUNT_LIFECYCLE: 'account.lifecycle',
  ACCOUNT_SESSION_REVOCATION: 'account.sessionRevocation',
  ACCOUNT_ADMIN_ROLE: 'account.adminRole',
  INCIDENT_MANAGEMENT: 'incident.management',
  COMMUNITY_REPORT_MODERATION: 'communityReport.moderation',
  COMMUNITY_REPORT_DELETION: 'communityReport.deletion',
  EARTHQUAKE_EVENT_SUMMARY: 'earthquakeEvent.summary',
  EARTHQUAKE_EVENT_SUMMARY_REVIEW: 'earthquakeEvent.summaryReview',
  EARTHQUAKE_EVENT_ENRICHMENT: 'earthquakeEvent.enrichment',
  EARTHQUAKE_EVENT_RECORDING_REFRESH: 'earthquakeEvent.recordingRefresh',
  DEVICE_REMOTE_CONFIGURATION: 'device.remoteConfiguration',
  DEVICE_TUNNEL_REVOCATION: 'device.tunnelRevocation',
  INVENTORY_APPLY: 'inventory.apply',
  SEISCOMP_SERVICE_CONTROL: 'seiscomp.serviceControl',
  DEPLOYMENT_SERVICE_CONTROL: 'deployment.serviceControl',
});

function enabledUnlessFalse(name) {
  return !['0', 'false', 'no', 'off'].includes(
    String(process.env[name] || '').trim().toLowerCase(),
  );
}

function controlledAction({
  adminRole,
  allowedAdminRoles = ['operator', 'super_admin'],
  deploymentEnabled,
  risk = 'controlled',
  typedTargetRequired = false,
  unavailableReason,
}) {
  const roleAllowed = allowedAdminRoles.includes(adminRole);
  const enabled = deploymentEnabled && roleAllowed;
  return {
    enabled,
    authorization: 'admin',
    allowedAdminRoles,
    auditRequired: true,
    confirmation: {
      reasonRequired: true,
      typedTargetRequired,
    },
    risk,
    ...(enabled ? {} : {
      unavailableReason: deploymentEnabled && !roleAllowed
        ? 'Your admin role does not authorize this action.'
        : unavailableReason || 'This action is disabled for the current deployment.',
    }),
  };
}

function unavailableHostAction(unavailableReason) {
  return {
    enabled: false,
    authorization: 'host',
    auditRequired: true,
    confirmation: {
      reasonRequired: true,
      typedTargetRequired: true,
    },
    risk: 'host-destructive',
    unavailableReason,
  };
}

function getCapabilities(adminRole = 'super_admin') {
  return {
    schemaVersion: '1.2',
    adminRole,
    actions: {
      [ACTIONS.ACCOUNT_BRGY_APPROVAL]: controlledAction({
        adminRole,
        deploymentEnabled: enabledUnlessFalse('ADMIN_ACCOUNT_APPROVAL_ENABLED'),
      }),
      [ACTIONS.ACCOUNT_LIFECYCLE]: controlledAction({
        adminRole,
        allowedAdminRoles: ['super_admin'],
        deploymentEnabled: enabledUnlessFalse('ADMIN_ACCOUNT_LIFECYCLE_ENABLED'),
        risk: 'destructive',
        typedTargetRequired: true,
      }),
      [ACTIONS.ACCOUNT_SESSION_REVOCATION]: controlledAction({
        adminRole,
        allowedAdminRoles: ['super_admin'],
        deploymentEnabled: enabledUnlessFalse('ADMIN_ACCOUNT_SESSION_REVOCATION_ENABLED'),
        risk: 'security',
      }),
      [ACTIONS.ACCOUNT_ADMIN_ROLE]: controlledAction({
        adminRole,
        allowedAdminRoles: ['super_admin'],
        deploymentEnabled: enabledUnlessFalse('ADMIN_ACCOUNT_ROLE_MANAGEMENT_ENABLED'),
        risk: 'privilege',
        typedTargetRequired: true,
      }),
      [ACTIONS.INCIDENT_MANAGEMENT]: controlledAction({
        adminRole,
        deploymentEnabled: enabledUnlessFalse('ADMIN_INCIDENT_MANAGEMENT_ENABLED'),
      }),
      [ACTIONS.COMMUNITY_REPORT_MODERATION]: controlledAction({
        adminRole,
        deploymentEnabled: enabledUnlessFalse('ADMIN_REPORT_MODERATION_ENABLED'),
      }),
      [ACTIONS.COMMUNITY_REPORT_DELETION]: controlledAction({
        adminRole,
        deploymentEnabled: enabledUnlessFalse('ADMIN_REPORT_DELETION_ENABLED'),
        risk: 'destructive',
        typedTargetRequired: true,
      }),
      [ACTIONS.EARTHQUAKE_EVENT_SUMMARY]: controlledAction({
        adminRole,
        deploymentEnabled: enabledUnlessFalse('ADMIN_EVENT_SUMMARY_ENABLED'),
      }),
      [ACTIONS.EARTHQUAKE_EVENT_SUMMARY_REVIEW]: controlledAction({
        adminRole,
        deploymentEnabled: enabledUnlessFalse('ADMIN_EVENT_SUMMARY_REVIEW_ENABLED'),
      }),
      [ACTIONS.EARTHQUAKE_EVENT_ENRICHMENT]: controlledAction({
        adminRole,
        deploymentEnabled: enabledUnlessFalse('ADMIN_EVENT_ENRICHMENT_ENABLED'),
        risk: 'batch',
      }),
      [ACTIONS.EARTHQUAKE_EVENT_RECORDING_REFRESH]: controlledAction({
        adminRole,
        deploymentEnabled: enabledUnlessFalse('ADMIN_EVENT_RECORDING_REFRESH_ENABLED'),
        risk: 'batch',
      }),
      [ACTIONS.DEVICE_REMOTE_CONFIGURATION]: controlledAction({
        adminRole,
        deploymentEnabled: enabledUnlessFalse('ADMIN_DEVICE_REMOTE_ACTIONS_ENABLED'),
        risk: 'remote',
      }),
      [ACTIONS.DEVICE_TUNNEL_REVOCATION]: controlledAction({
        adminRole,
        deploymentEnabled: enabledUnlessFalse('ADMIN_TUNNEL_REVOCATION_ENABLED'),
        risk: 'destructive',
        typedTargetRequired: true,
      }),
      [ACTIONS.INVENTORY_APPLY]: unavailableHostAction(
        'Inventory apply remains host-only until a separately authorized executor and rollback workflow are implemented.',
      ),
      [ACTIONS.SEISCOMP_SERVICE_CONTROL]: unavailableHostAction(
        'SeisComP service control remains host-only and is not exposed by the Admin API.',
      ),
      [ACTIONS.DEPLOYMENT_SERVICE_CONTROL]: unavailableHostAction(
        'Container and deployment lifecycle control remains outside the Admin Console.',
      ),
    },
  };
}

function getCapability(actionId, adminRole = 'super_admin') {
  return getCapabilities(adminRole).actions[actionId] || null;
}

function isCapabilityEnabled(actionId, adminRole = 'super_admin') {
  return getCapability(actionId, adminRole)?.enabled === true;
}

module.exports = {
  ACTIONS,
  getCapabilities,
  getCapability,
  isCapabilityEnabled,
};
