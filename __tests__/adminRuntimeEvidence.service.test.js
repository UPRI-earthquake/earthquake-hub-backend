const { runtimeEvidence } = require('../src/services/adminRuntimeEvidence.service');
const now = Date.now();
const data = { schemaVersion: 1, source: 'seiscomp-pid-executable', observedAt: new Date(now).toISOString(), modules: [{ id: 'scmaster', enabled: true, state: 'running', kind: 'observed' }] };
test('missing configuration and API failures remain distinct', () => {
  expect(runtimeEvidence({ errorCode: 'not_configured' }).state).toBe('not_configured');
  expect(runtimeEvidence({ status: 'unavailable' }).state).toBe('unknown');
});
test('fresh runtime observations are projected without secrets', () => {
  const result = runtimeEvidence({ status: 'available', data: { ...data, privatePath: '/secret' } }, now);
  expect(result.state).toBe('observed');
  expect(result.modules[0].state).toBe('running');
  expect(result).not.toHaveProperty('privatePath');
});
test('stale process presence cannot establish current running state', () => {
  const result = runtimeEvidence({ status: 'available', data }, now + 120_000);
  expect(result.state).toBe('stale');
  expect(result.modules[0]).toMatchObject({ state: 'unknown', lastObservedState: 'running' });
});
test('invalid, future and partial runtime observations fail safely', () => {
  expect(runtimeEvidence({ status: 'available', data }, now - 1).state).toBe('unknown');
  expect(runtimeEvidence({ status: 'available', data: { ...data, modules: [{ ...data.modules[0], id: '../bad' }] } }, now).state).toBe('unknown');
  expect(runtimeEvidence({ status: 'available', data: { ...data, modules: [{ ...data.modules[0], state: 'unknown', kind: 'unknown' }] } }, now).state).toBe('partial');
});
