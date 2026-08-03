const AdminCapabilitiesService = require('../src/services/adminCapabilities.service');

const POLICY_ENV = [
  'ADMIN_ACCOUNT_APPROVAL_ENABLED',
  'ADMIN_ACCOUNT_LIFECYCLE_ENABLED',
  'ADMIN_ACCOUNT_SESSION_REVOCATION_ENABLED',
  'ADMIN_ACCOUNT_ROLE_MANAGEMENT_ENABLED',
  'ADMIN_INCIDENT_MANAGEMENT_ENABLED',
  'ADMIN_REPORT_MODERATION_ENABLED',
  'ADMIN_REPORT_DELETION_ENABLED',
  'ADMIN_EVENT_SUMMARY_ENABLED',
  'ADMIN_EVENT_SUMMARY_REVIEW_ENABLED',
  'ADMIN_EVENT_ENRICHMENT_ENABLED',
  'ADMIN_EVENT_RECORDING_REFRESH_ENABLED',
  'ADMIN_DEVICE_REMOTE_ACTIONS_ENABLED',
  'ADMIN_TUNNEL_REVOCATION_ENABLED',
];

describe('admin capability policy', () => {
  const originalEnvironment = Object.fromEntries(
    POLICY_ENV.map((name) => [name, process.env[name]]),
  );

  afterEach(() => {
    POLICY_ENV.forEach((name) => {
      if (originalEnvironment[name] === undefined) delete process.env[name];
      else process.env[name] = originalEnvironment[name];
    });
  });

  it('publishes the existing backend workflows as controlled admin actions', () => {
    POLICY_ENV.forEach((name) => delete process.env[name]);
    const capabilities = AdminCapabilitiesService.getCapabilities();

    expect(capabilities.schemaVersion).toBe('1.2');
    expect(capabilities.actions[AdminCapabilitiesService.ACTIONS.ACCOUNT_BRGY_APPROVAL])
      .toEqual(expect.objectContaining({
        enabled: true,
        authorization: 'admin',
        auditRequired: true,
      }));
    expect(capabilities.actions[AdminCapabilitiesService.ACTIONS.COMMUNITY_REPORT_DELETION]
      .confirmation.typedTargetRequired).toBe(true);
    expect(capabilities.actions[AdminCapabilitiesService.ACTIONS.DEVICE_TUNNEL_REVOCATION]
      .confirmation.typedTargetRequired).toBe(true);
    expect(capabilities.actions[AdminCapabilitiesService.ACTIONS.EARTHQUAKE_EVENT_SUMMARY_REVIEW])
      .toEqual(expect.objectContaining({ enabled: true, authorization: 'admin' }));
  });

  it('fails closed by admin privilege tier while preserving read capabilities elsewhere', () => {
    const viewer = AdminCapabilitiesService.getCapabilities('viewer');
    const operator = AdminCapabilitiesService.getCapabilities('operator');

    expect(viewer.actions[AdminCapabilitiesService.ACTIONS.INCIDENT_MANAGEMENT].enabled)
      .toBe(false);
    expect(operator.actions[AdminCapabilitiesService.ACTIONS.INCIDENT_MANAGEMENT].enabled)
      .toBe(true);
    expect(operator.actions[AdminCapabilitiesService.ACTIONS.ACCOUNT_LIFECYCLE].enabled)
      .toBe(false);
  });

  it('keeps host lifecycle and inventory apply actions unavailable', () => {
    const capabilities = AdminCapabilitiesService.getCapabilities();

    [
      AdminCapabilitiesService.ACTIONS.INVENTORY_APPLY,
      AdminCapabilitiesService.ACTIONS.SEISCOMP_SERVICE_CONTROL,
      AdminCapabilitiesService.ACTIONS.DEPLOYMENT_SERVICE_CONTROL,
    ].forEach((actionId) => {
      expect(capabilities.actions[actionId]).toEqual(expect.objectContaining({
        enabled: false,
        authorization: 'host',
        unavailableReason: expect.any(String),
      }));
    });
  });

  it('lets operators disable a supported mutation family without changing code', () => {
    process.env.ADMIN_EVENT_ENRICHMENT_ENABLED = 'false';

    expect(AdminCapabilitiesService.isCapabilityEnabled(
      AdminCapabilitiesService.ACTIONS.EARTHQUAKE_EVENT_ENRICHMENT,
    )).toBe(false);
  });
});
