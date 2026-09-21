jest.mock('../src/services/adminHostTelemetry.client', () => ({ getResource: jest.fn() }));
jest.mock('../src/services/adminSystem.service', () => ({ getSnapshot: jest.fn() }));
const Telemetry = require('../src/services/adminHostTelemetry.client');
const System = require('../src/services/adminSystem.service');
const Deployment = require('../src/services/adminDeploymentHealth.service');
test('successful hub probe does not establish nginx or declared container runtime state', async () => {
  Telemetry.getResource.mockResolvedValue({ status: 'available', observedAt: new Date().toISOString(), data: { reachable: true }, operational: { state: 'healthy' } });
  System.getSnapshot.mockResolvedValue({ status: 'available', scope: 'deployment-container', operational: { state: 'healthy' } });
  const result = await Deployment.getSnapshot({});
  expect(result.services.find((service) => service.id === 'nginx-proxy')).toMatchObject({ status: 'declared', observedAt: null, runtimeVisibility: 'not_observable' });
  expect(result.services.find((service) => service.id === 'ehub-backend')).toMatchObject({ status: 'observed', runtimeVisibility: 'observed' });
  expect(result.services.find((service) => service.id === 'seiscomp')).toMatchObject({ managedBy: 'host', logCommand: null });
  expect(result.systemResources.scope).toBe('deployment-container');
  const ids = new Set(result.services.map((service) => service.id));
  for (const edge of result.topology.edges) { expect(ids.has(edge.from)).toBe(true); expect(ids.has(edge.to)).toBe(true); }
});
