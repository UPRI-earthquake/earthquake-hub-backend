const { archiveCoverageEvidence } = require('../src/services/adminArchiveCoverage.service');
const now = Date.parse('2026-09-18T00:00:00Z');
const at = (hour) => `2026-09-17T${String(hour).padStart(2, '0')}:00:00Z`;
const evidence = (intervals = [], overrides = {}) => ({ status: 'available', data: { schemaVersion: 1, source: 'fdsn-availability-index', observedAt: new Date(now).toISOString(), lastScanAt: null,
  window: { start: at(0), end: at(12) }, channels: [{ id: 'AM.R0001.00.EHZ', intervals }], ...overrides } });
test('complete indexed interval has no derived gap, without claiming archive health', () => {
  const result = archiveCoverageEvidence(evidence([[at(0), at(12)]]), now);
  expect(result.channels[0]).toMatchObject({ state: 'fully_indexed', gaps: [] });
  expect(result.lastScanAt).toBeNull();
});
test('partial intervals produce leading, interior and trailing gaps', () => {
  const result = archiveCoverageEvidence(evidence([[at(1), at(2)], [at(4), at(10)]]), now);
  expect(result.channels[0].gaps.map((gap) => gap.durationSeconds)).toEqual([3600, 7200, 7200]);
  expect(result.channels[0].state).toBe('partial_indexed');
});
test('no indexed data differs from unavailable source', () => {
  expect(archiveCoverageEvidence(evidence(), now).channels[0]).toMatchObject({ state: 'no_indexed_data', gaps: [{ durationSeconds: 43200 }] });
  expect(archiveCoverageEvidence({ status: 'unavailable' }, now)).toMatchObject({ state: 'unknown', channels: [] });
});
test('invalid, overlapping, out-of-window and future data fails closed; old evidence remains stale', () => {
  for (const input of [evidence([[at(1), at(3)], [at(2), at(4)]]), evidence([[at(0), at(13)]]), evidence([], { observedAt: new Date(now + 1).toISOString() }), evidence([], { lastScanAt: at(10) })]) {
    expect(archiveCoverageEvidence(input, now).state).toBe('unknown');
  }
  expect(archiveCoverageEvidence(evidence(), now + 900001).state).toBe('stale');
});
