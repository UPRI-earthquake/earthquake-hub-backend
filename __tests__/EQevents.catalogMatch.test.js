const { _test } = require('../src/services/EQevents.service');

function candidate(overrides) {
  return {
    source: 'phivolcs',
    distanceKm: 25,
    timeDifferenceMinutes: 2,
    magnitudeDifference: 0.2,
    score: 1,
    ...overrides,
  };
}

describe('catalog event match selection', () => {
  test('rejects candidates outside the hard origin-time gate', () => {
    const match = _test.selectCatalogMatch([
      candidate({
        timeDifferenceMinutes: 10.01,
        distanceKm: 25,
        magnitudeDifference: 0.1,
      }),
    ]);

    expect(match).toBeNull();
  });

  test('rejects the closest candidate when offsets are clearly not the same event', () => {
    const match = _test.selectCatalogMatch([
      candidate({
        timeDifferenceMinutes: 74,
        distanceKm: 2343,
        magnitudeDifference: 3.64,
      }),
    ]);

    expect(match).toBeNull();
  });

  test('rejects candidates when distance and magnitude both exceed the low-quality limits', () => {
    const match = _test.selectCatalogMatch([
      candidate({
        timeDifferenceMinutes: 10,
        distanceKm: 700,
        magnitudeDifference: 2.1,
      }),
    ]);

    expect(match).toBeNull();
  });

  test('keeps plausible close-time matches and tags their quality', () => {
    const match = _test.selectCatalogMatch([
      candidate({
        timeDifferenceMinutes: 3,
        distanceKm: 40,
        magnitudeDifference: 0.2,
      }),
    ]);

    expect(match).toMatchObject({ matchQuality: 'medium' });
  });

  test('tags very close matches as high quality', () => {
    const match = _test.selectCatalogMatch([
      candidate({
        timeDifferenceMinutes: 1.5,
        distanceKm: 40,
        magnitudeDifference: 0.2,
      }),
    ]);

    expect(match).toMatchObject({ matchQuality: 'high' });
  });

  test('chooses the best-scored plausible candidate instead of the first candidate', () => {
    const match = _test.selectCatalogMatch([
      candidate({
        id: 'worse',
        timeDifferenceMinutes: 4,
        distanceKm: 90,
        magnitudeDifference: 0.4,
        score: 300,
      }),
      candidate({
        id: 'better',
        timeDifferenceMinutes: 4.5,
        distanceKm: 95,
        magnitudeDifference: 0.5,
        score: 100,
      }),
    ]);

    expect(match).toMatchObject({ id: 'better', matchQuality: 'medium' });
  });
});

describe('catalog source list helpers', () => {
  test('normalizes legacy object-shaped catalog data into a source list', () => {
    const sources = _test.normalizeCatalogSources({
      phivolcs: candidate({ source: 'phivolcs', id: 'ph' }),
      usgs: candidate({ source: 'usgs', id: 'us' }),
      empty: null,
    });

    expect(sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: 'phivolcs', id: 'ph' }),
        expect.objectContaining({ source: 'usgs', id: 'us' }),
      ]),
    );
    expect(sources).toHaveLength(2);
  });

  test('replaces a source match without touching other source matches', () => {
    const merged = _test.mergeCatalogSource(
      [
        candidate({ source: 'phivolcs', id: 'old-ph' }),
        candidate({ source: 'usgs', id: 'us' }),
      ],
      'phivolcs',
      candidate({ source: 'phivolcs', id: 'new-ph' }),
    );

    expect(merged).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: 'phivolcs', id: 'new-ph' }),
        expect.objectContaining({ source: 'usgs', id: 'us' }),
      ]),
    );
    expect(merged).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: 'old-ph' })]));
  });

  test('derives pending sources from source-level tracking before legacy global flags', () => {
    const pending = _test.getPendingCatalogSources({
      pendingCatalogSources: ['phivolcs'],
      catalogEnrichmentAttempts: { phivolcs: 0 },
      upForEnrichment: true,
      enrichmentAttempts: 0,
    });

    expect(pending).toEqual(['phivolcs']);
  });
});
