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

const UNAVAILABILITY_KINDS = Object.freeze({
  ROLE_RESTRICTED: 'role_restricted',
  DEPLOYMENT_DISABLED: 'deployment_disabled',
  HOST_SETUP_REQUIRED: 'host_setup_required',
  IMPLEMENTATION_REQUIRED: 'implementation_required',
  INTENTIONALLY_UNSUPPORTED: 'intentionally_unsupported',
});

const RUNBOOKS = Object.freeze({
  ACTION_CAPABILITIES: Object.freeze({
    label: 'Admin action capability policy',
    repository: 'earthquake-hub-backend',
    path: 'docs/admin-action-capabilities.md',
  }),
  HOST_BOOTSTRAP: Object.freeze({
    label: 'Admin Console host bootstrap and migration guide',
    repository: 'earthquake-hub-commons',
    path: 'docs/admin-backend/host-bootstrap-and-migration.md',
  }),
});

function buildUnavailability({
  kind,
  prerequisites = [],
  runbook = null,
  summary,
  title,
}) {
  return {
    kind,
    title,
    summary,
    prerequisites,
    runbook,
  };
}

function roleUnavailability(summary = 'Your admin role does not authorize this action.') {
  return buildUnavailability({
    kind: UNAVAILABILITY_KINDS.ROLE_RESTRICTED,
    title: 'Permission required',
    summary,
    prerequisites: ['Use an operator or super-admin account authorized for this workflow.'],
  });
}

function deploymentUnavailability({ configurationName, summary }) {
  return buildUnavailability({
    kind: UNAVAILABILITY_KINDS.DEPLOYMENT_DISABLED,
    title: 'Disabled for this deployment',
    summary,
    prerequisites: [
      'Confirm that this administrative workflow is approved for the deployment.',
      `Enable ${configurationName} in the protected hub-backend environment.`,
      'Restart the hub backend and verify the capability response before use.',
    ],
    runbook: RUNBOOKS.ACTION_CAPABILITIES,
  });
}

function enabledUnlessFalse(name) {
  return !['0', 'false', 'no', 'off'].includes(
    String(process.env[name] || '').trim().toLowerCase(),
  );
}

function controlledAction({
  adminRole,
  allowedAdminRoles = ['operator', 'super_admin'],
  configurationName,
  deploymentEnabled,
  risk = 'controlled',
  typedTargetRequired = false,
  unavailableReason,
}) {
  const roleAllowed = allowedAdminRoles.includes(adminRole);
  const enabled = deploymentEnabled && roleAllowed;
  const reason = deploymentEnabled && !roleAllowed
    ? 'Your admin role does not authorize this action.'
    : unavailableReason || 'This action is disabled for the current deployment.';
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
      unavailableReason: reason,
      unavailability: deploymentEnabled && !roleAllowed
        ? roleUnavailability(reason)
        : deploymentUnavailability({ configurationName, summary: reason }),
    }),
  };
}

function unavailableHostAction({
  kind = UNAVAILABILITY_KINDS.IMPLEMENTATION_REQUIRED,
  prerequisites,
  runbook = RUNBOOKS.ACTION_CAPABILITIES,
  title,
  unavailableReason,
}) {
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
    unavailability: buildUnavailability({
      kind,
      title,
      summary: unavailableReason,
      prerequisites,
      runbook,
    }),
  };
}

function getCapabilities(adminRole = 'super_admin') {
  return {
    schemaVersion: '1.3',
    adminRole,
    actions: {
      [ACTIONS.ACCOUNT_BRGY_APPROVAL]: controlledAction({
        adminRole,
        configurationName: 'ADMIN_ACCOUNT_APPROVAL_ENABLED',
        deploymentEnabled: enabledUnlessFalse('ADMIN_ACCOUNT_APPROVAL_ENABLED'),
      }),
      [ACTIONS.ACCOUNT_LIFECYCLE]: controlledAction({
        adminRole,
        allowedAdminRoles: ['super_admin'],
        configurationName: 'ADMIN_ACCOUNT_LIFECYCLE_ENABLED',
        deploymentEnabled: enabledUnlessFalse('ADMIN_ACCOUNT_LIFECYCLE_ENABLED'),
        risk: 'destructive',
        typedTargetRequired: true,
      }),
      [ACTIONS.ACCOUNT_SESSION_REVOCATION]: controlledAction({
        adminRole,
        allowedAdminRoles: ['super_admin'],
        configurationName: 'ADMIN_ACCOUNT_SESSION_REVOCATION_ENABLED',
        deploymentEnabled: enabledUnlessFalse('ADMIN_ACCOUNT_SESSION_REVOCATION_ENABLED'),
        risk: 'security',
      }),
      [ACTIONS.ACCOUNT_ADMIN_ROLE]: controlledAction({
        adminRole,
        allowedAdminRoles: ['super_admin'],
        configurationName: 'ADMIN_ACCOUNT_ROLE_MANAGEMENT_ENABLED',
        deploymentEnabled: enabledUnlessFalse('ADMIN_ACCOUNT_ROLE_MANAGEMENT_ENABLED'),
        risk: 'privilege',
        typedTargetRequired: true,
      }),
      [ACTIONS.INCIDENT_MANAGEMENT]: controlledAction({
        adminRole,
        configurationName: 'ADMIN_INCIDENT_MANAGEMENT_ENABLED',
        deploymentEnabled: enabledUnlessFalse('ADMIN_INCIDENT_MANAGEMENT_ENABLED'),
      }),
      [ACTIONS.COMMUNITY_REPORT_MODERATION]: controlledAction({
        adminRole,
        configurationName: 'ADMIN_REPORT_MODERATION_ENABLED',
        deploymentEnabled: enabledUnlessFalse('ADMIN_REPORT_MODERATION_ENABLED'),
      }),
      [ACTIONS.COMMUNITY_REPORT_DELETION]: controlledAction({
        adminRole,
        configurationName: 'ADMIN_REPORT_DELETION_ENABLED',
        deploymentEnabled: enabledUnlessFalse('ADMIN_REPORT_DELETION_ENABLED'),
        risk: 'destructive',
        typedTargetRequired: true,
      }),
      [ACTIONS.EARTHQUAKE_EVENT_SUMMARY]: controlledAction({
        adminRole,
        configurationName: 'ADMIN_EVENT_SUMMARY_ENABLED',
        deploymentEnabled: enabledUnlessFalse('ADMIN_EVENT_SUMMARY_ENABLED'),
      }),
      [ACTIONS.EARTHQUAKE_EVENT_SUMMARY_REVIEW]: controlledAction({
        adminRole,
        configurationName: 'ADMIN_EVENT_SUMMARY_REVIEW_ENABLED',
        deploymentEnabled: enabledUnlessFalse('ADMIN_EVENT_SUMMARY_REVIEW_ENABLED'),
      }),
      [ACTIONS.EARTHQUAKE_EVENT_ENRICHMENT]: controlledAction({
        adminRole,
        configurationName: 'ADMIN_EVENT_ENRICHMENT_ENABLED',
        deploymentEnabled: enabledUnlessFalse('ADMIN_EVENT_ENRICHMENT_ENABLED'),
        risk: 'batch',
      }),
      [ACTIONS.EARTHQUAKE_EVENT_RECORDING_REFRESH]: controlledAction({
        adminRole,
        configurationName: 'ADMIN_EVENT_RECORDING_REFRESH_ENABLED',
        deploymentEnabled: enabledUnlessFalse('ADMIN_EVENT_RECORDING_REFRESH_ENABLED'),
        risk: 'batch',
      }),
      [ACTIONS.DEVICE_REMOTE_CONFIGURATION]: controlledAction({
        adminRole,
        configurationName: 'ADMIN_DEVICE_REMOTE_ACTIONS_ENABLED',
        deploymentEnabled: enabledUnlessFalse('ADMIN_DEVICE_REMOTE_ACTIONS_ENABLED'),
        risk: 'remote',
      }),
      [ACTIONS.DEVICE_TUNNEL_REVOCATION]: controlledAction({
        adminRole,
        configurationName: 'ADMIN_TUNNEL_REVOCATION_ENABLED',
        deploymentEnabled: enabledUnlessFalse('ADMIN_TUNNEL_REVOCATION_ENABLED'),
        risk: 'destructive',
        typedTargetRequired: true,
      }),
      [ACTIONS.INVENTORY_APPLY]: unavailableHostAction({
        title: 'Host integration required',
        unavailableReason: 'Inventory apply remains host-only until a separately authorized executor and rollback workflow are implemented.',
        prerequisites: [
          'Deploy a bounded, allowlisted inventory executor with a separate host identity.',
          'Require immutable plan approval, verified backup, post-apply checks, and rollback.',
          'Add backend authorization, progress reporting, and complete audit coverage.',
        ],
      }),
      [ACTIONS.SEISCOMP_SERVICE_CONTROL]: unavailableHostAction({
        title: 'Host integration required',
        unavailableReason: 'SeisComP service control remains host-only and is not exposed by the Admin API.',
        prerequisites: [
          'Deploy an allowlisted SeisComP operations identity and fixed operation set.',
          'Add verification, timeout, concurrency, rollback, and audit behavior.',
          'Validate module state directly on the deployment host before enabling controls.',
        ],
      }),
      [ACTIONS.DEPLOYMENT_SERVICE_CONTROL]: unavailableHostAction({
        kind: UNAVAILABILITY_KINDS.INTENTIONALLY_UNSUPPORTED,
        title: 'Host-only operation',
        unavailableReason: 'Container and deployment lifecycle control remains outside the Admin Console.',
        prerequisites: [
          'Use the authorized deployment-host workflow outside the Admin Console.',
          'Keep Docker and host-service credentials out of browser-facing services.',
        ],
        runbook: RUNBOOKS.HOST_BOOTSTRAP,
      }),
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
  RUNBOOKS,
  UNAVAILABILITY_KINDS,
  buildUnavailability,
  getCapabilities,
  getCapability,
  isCapabilityEnabled,
};
