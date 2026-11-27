// The significance score (src/services/significance.js): the worked examples from the ticket, its
// parts, the ranking, and the title and summary the significant earthquakes pages show
const {
  significanceScore, isSignificant, distanceWeight, depthWeight, reportBonus, rankSignificant,
  significantTitle, significantSummary, placeOf, MAX_SIGNIFICANT,
} = require('../src/services/significance');

const score = (fields) => Math.round(significanceScore(fields));

describe('significance score: worked examples', () => {
  test('M7.0, shallow, inside the Philippines = 754 (significant)', () => {
    expect(score({ magnitude: 7.0, distanceKm: 0, depthKm: 10 })).toBe(754);
    expect(isSignificant(significanceScore({ magnitude: 7.0, distanceKm: 0, depthKm: 10 }))).toBe(true);
  });

  test('M7.0 at 100 km depth = 603 (significant)', () => {
    expect(score({ magnitude: 7.0, distanceKm: 0, depthKm: 100 })).toBe(603);
    expect(isSignificant(significanceScore({ magnitude: 7.0, distanceKm: 0, depthKm: 100 }))).toBe(true);
  });

  test('M6.4 offshore (the old "388 km S 49° E of Sarangani Island" entry: 363 km from the outline, 130 km deep) = 441 (not significant)', () => {
    expect(score({ magnitude: 6.4, distanceKm: 363, depthKm: 130 })).toBe(441);
    expect(isSignificant(significanceScore({ magnitude: 6.4, distanceKm: 363, depthKm: 130 }))).toBe(false);
  });

  test('M5.5 inside, with 6 reporters = 615 (significant); with 5 = 590 (not)', () => {
    expect(score({ magnitude: 5.5, distanceKm: 0, depthKm: 10, reporters: 6 })).toBe(615);
    expect(score({ magnitude: 5.5, distanceKm: 0, depthKm: 10, reporters: 5 })).toBe(590);
    expect(isSignificant(significanceScore({ magnitude: 5.5, distanceKm: 0, depthKm: 10, reporters: 6 }))).toBe(true);
    expect(isSignificant(significanceScore({ magnitude: 5.5, distanceKm: 0, depthKm: 10, reporters: 5 }))).toBe(false);
  });

  test('an M7.7 3,000 km away = 0', () => {
    expect(score({ magnitude: 7.7, distanceKm: 3000, depthKm: 10 })).toBe(0);
  });
});

describe('significance score: its parts', () => {
  test('distance weight: 1 to 200 km, falling in a straight line to 0 at 1,500 km', () => {
    expect(distanceWeight(0)).toBe(1);
    expect(distanceWeight(200)).toBe(1);
    expect(distanceWeight(850)).toBeCloseTo(0.5);
    expect(distanceWeight(1500)).toBe(0);
    expect(distanceWeight(5000)).toBe(0);
  });

  test('depth weight: 1 to 70 km, 0.8 to 300 km, 0.5 deeper; an unknown depth counts as shallow', () => {
    expect(depthWeight(70)).toBe(1);
    expect(depthWeight(71)).toBe(0.8);
    expect(depthWeight(300)).toBe(0.8);
    expect(depthWeight(301)).toBe(0.5);
    expect(depthWeight(null)).toBe(1);
    expect(depthWeight(undefined)).toBe(1);
  });

  test('report bonus: 25 per reporter, up to 20 reporters', () => {
    expect(reportBonus(0)).toBe(0);
    expect(reportBonus(4)).toBe(100);
    expect(reportBonus(20)).toBe(500);
    expect(reportBonus(35)).toBe(500);
    expect(reportBonus(undefined)).toBe(0);
  });

  test('without reports, a shallow quake inside the Philippines qualifies from about M6.25', () => {
    expect(isSignificant(significanceScore({ magnitude: 6.25, distanceKm: 0, depthKm: 10 }))).toBe(true);
    expect(isSignificant(significanceScore({ magnitude: 6.24, distanceKm: 0, depthKm: 10 }))).toBe(false);
  });
});

const event = (publicID, magnitude, fields = {}) => ({
  _id: `id-${publicID}`, publicID, magnitude_value: magnitude, depth_value: 10, OT: '2026-01-01T00:00:00.000Z', ...fields,
});
const candidate = (e, distanceKm = 0, reporters = 0) => ({ event: e, distanceKm, reporters });

describe('ranking', () => {
  test('keeps the significant ones, highest score first', () => {
    const ranked = rankSignificant([
      candidate(event('small', 5.0)),
      candidate(event('m65', 6.5)),
      candidate(event('m78', 7.8)),
      candidate(event('far', 7.7), 3000),
      candidate(event('m70', 7.0)),
    ]);
    expect(ranked.map((r) => r.event.publicID)).toEqual(['m78', 'm70', 'm65']);
    expect(Math.round(ranked[0].score)).toBe(936);
  });

  test('ties: newest first, then by publicID', () => {
    const ranked = rankSignificant([
      candidate(event('b-old', 6.6, { OT: '2024-01-01T00:00:00.000Z' })),
      candidate(event('d-new', 6.6, { OT: '2026-01-01T00:00:00.000Z' })),
      candidate(event('c-new', 6.6, { OT: '2026-01-01T00:00:00.000Z' })),
    ]);
    expect(ranked.map((r) => r.event.publicID)).toEqual(['c-new', 'd-new', 'b-old']);
  });

  test(`at most ${MAX_SIGNIFICANT}`, () => {
    const many = Array.from({ length: 60 }, (_, i) => candidate(event(`e${String(i).padStart(2, '0')}`, 6.5 + i / 100)));
    const ranked = rankSignificant(many);
    expect(ranked).toHaveLength(MAX_SIGNIFICANT);
    expect(ranked[0].event.publicID).toBe('e59');
  });
});

describe('title and summary', () => {
  const quake = event('gfz2026lcqt', 7.8, {
    place: '24 km SW of Soccsksargen, Philippines', text: 'Mindanao, Philippines', OT: '2026-06-06T20:00:00.000Z', depth_value: 10.4,
  });

  test('title: magnitude to one decimal, then the place', () => {
    expect(significantTitle(quake)).toBe('M7.8 Earthquake, 24 km SW of Soccsksargen, Philippines');
    expect(significantTitle({ ...quake, magnitude_value: 7 })).toBe('M7.0 Earthquake, 24 km SW of Soccsksargen, Philippines');
  });

  test('the region when there is no usable place, and nothing when there is neither', () => {
    expect(placeOf({ ...quake, place: 'Unavailable' })).toBe('Mindanao, Philippines');
    expect(significantTitle({ ...quake, place: null })).toBe('M7.8 Earthquake, Mindanao, Philippines');
    expect(significantTitle({ ...quake, place: '', text: null })).toBe('M7.8 Earthquake');
  });

  test('summary built from the event, dated in Manila', () => {
    expect(significantSummary(quake))
      .toBe('A magnitude 7.8 earthquake struck 24 km SW of Soccsksargen, Philippines on June 7, 2026 at a depth of 10 km.');
    expect(significantSummary({ ...quake, place: null, text: null, depth_value: null }))
      .toBe('A magnitude 7.8 earthquake occurred on June 7, 2026.');
  });

  test("the event's admin-edited summary when it has one", () => {
    expect(significantSummary({ ...quake, summaryOverride: { text: '  Strong shaking in General Santos.  ' } }))
      .toBe('Strong shaking in General Santos.');
    expect(significantSummary({ ...quake, summaryOverride: { text: '   ' } })).toMatch(/^A magnitude 7.8 earthquake/);
  });
});
