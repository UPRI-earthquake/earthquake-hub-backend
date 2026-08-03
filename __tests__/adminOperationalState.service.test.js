const {
  buildOperationalState,
  freshness,
} = require('../src/services/adminOperationalState.service');

describe('admin operational state contract', () => {
  it('separates current availability from evidence freshness', () => {
    const state = buildOperationalState({
      availability: 'available',
      generatedAt: '2026-07-31T00:02:00.000Z',
      now: '2026-07-31T00:02:00.000Z',
      observedAt: '2026-07-31T00:00:00.000Z',
      staleAfter: 60_000,
    });

    expect(state).toEqual(expect.objectContaining({
      contractVersion: '1.0',
      availability: 'available',
      state: 'stale',
      freshness: expect.objectContaining({
        status: 'stale',
        ageMs: 120_000,
        staleAfterMs: 60_000,
      }),
    }));
  });

  it('prioritizes an unavailable source over a fresh observation timestamp', () => {
    const state = buildOperationalState({
      availability: 'unavailable',
      generatedAt: '2026-07-31T00:00:10.000Z',
      now: '2026-07-31T00:00:10.000Z',
      observedAt: '2026-07-31T00:00:10.000Z',
    });

    expect(state.state).toBe('unavailable');
    expect(state.freshness.status).toBe('fresh');
  });

  it('returns unknown freshness for missing or invalid source timestamps', () => {
    expect(freshness({ observedAt: null })).toEqual(expect.objectContaining({
      status: 'unknown',
      observedAt: null,
      ageMs: null,
    }));
    expect(freshness({ observedAt: 'not-a-date' }).status).toBe('unknown');
  });
});
