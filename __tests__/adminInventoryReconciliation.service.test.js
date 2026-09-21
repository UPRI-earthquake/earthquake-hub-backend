const { reconcileInventory } = require('../src/services/adminInventoryReconciliation.service');
const now = Date.parse('2026-09-18T00:00:00Z');
const device = { network: 'AM', station: 'R0001', latitude: 14.6, longitude: 121.1, elevation: 42.5 };
const telemetry = (stations = [{ ...device, ambiguous: false }], overrides = {}) => ({ status: 'available', data: {
  schemaVersion: 1, source: 'fdsn-served-station-metadata', complete: true, observedAt: new Date(now).toISOString(), stations, ...overrides,
} });
test('compares only station metadata with explicit rounding tolerances', () => {
  expect(reconcileInventory([device], telemetry(), now).stations[0].state).toBe('synced');
  const nearby = { ...device, latitude: device.latitude + 0.000005, elevation: device.elevation + 0.05 };
  expect(reconcileInventory([nearby], telemetry(), now).stations[0].state).toBe('synced');
  const result = reconcileInventory([{ ...device, elevation: 50 }], telemetry(), now);
  expect(result.stations[0]).toMatchObject({ state: 'different', differences: ['elevation'], inventoryState: 'present' });
});
test('only a complete fresh inventory can establish missing', () => {
  expect(reconcileInventory([device], telemetry([]), now).stations[0].state).toBe('missing');
  for (const evidence of [telemetry([], { complete: false }), telemetry([], { observedAt: new Date(now - 900001).toISOString() }), { status: 'unavailable' }]) {
    expect(reconcileInventory([device], evidence, now).stations[0].state).toBe('unknown');
  }
});
test('ambiguous epochs and missing hub coordinates do not imply synchronized', () => {
  expect(reconcileInventory([device], telemetry([{ ...device, ambiguous: true }]), now).stations[0].reason).toBe('ambiguous_epochs');
  expect(reconcileInventory([{ ...device, latitude: null }], telemetry(), now).stations[0].state).toBe('unknown');
});
test('invalid, duplicate, future and oversized snapshots fail closed', () => {
  for (const evidence of [telemetry([{ ...device, ambiguous: false, longitude: 400 }]), telemetry(Array(257).fill({ ...device, ambiguous: false })),
    telemetry(Array(2).fill({ ...device, ambiguous: false })), telemetry([], { observedAt: new Date(now + 1).toISOString() })]) {
    expect(reconcileInventory([device], evidence, now).state).toBe('unknown');
  }
  expect(reconcileInventory([device], { status: 'unavailable', errorCode: 'not_configured' }, now).state).toBe('not_configured');
});
