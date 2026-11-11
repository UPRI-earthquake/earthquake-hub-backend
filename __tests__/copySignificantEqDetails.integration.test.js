// scripts/copy-significant-eq-details-to-postgres.js: the old significant earthquakes' summaries,
// recordings and references carried over to their events, filling in only what's missing
const mongoose = require('mongoose');
const { startMongo, MONGO_STARTUP_TIMEOUT_MS } = require('./fixtures/mongo.fixture');
const { startPostgres, PG_STARTUP_TIMEOUT_MS } = require('./fixtures/postgres.fixture');
const { seedEvent } = require('./fixtures/significantEqs');
const { copySignificantEqDetails } = require('../scripts/copy-significant-eq-details-to-postgres');

const oid = (hex) => new mongoose.Types.ObjectId(hex);

// As the original src/significantEQs.json had them: lists as "[a, b]" strings, eventTime as MM-DD-YYYY
const ENTRIES = [
  { // matches the Manila event (1 day off, a few km away); one invalid code and one invalid link
    _id: oid('650000000000000000000001'),
    title: 'M7 Earthquake 003 km N of Quezon City',
    magnitude: 7,
    latitude: 14.63,
    longitude: 121.03,
    depth: 15,
    eventTime: '05-01-2026T08:00:00.000+00:00',
    instrumentRecordings: '[R3B2D,R1382, R-BAD]',
    references: '[https://earthquake.phivolcs.dost.gov.ph/report.html, not a link]',
    eventSummary: 'A magnitude 7.0 earthquake struck Metro Manila.',
  },
  { // matches the Cebu event, which already has an admin-written summary; lists as arrays, time as a Date
    _id: oid('650000000000000000000002'),
    title: 'M6.6 Earthquake near Cebu',
    magnitude: 6.6,
    latitude: 10.31,
    longitude: 123.91,
    depth: 20,
    eventTime: new Date('2026-04-01T00:00:00.000Z'),
    instrumentRecordings: ['RF8C0'],
    references: ['https://example.org/cebu'],
    eventSummary: 'Written in MongoDB.',
  },
  { // no event near it
    _id: oid('650000000000000000000003'), title: 'M6.4 Earthquake far away', magnitude: 6.4, latitude: 30, longitude: 140, eventTime: '01-01-2026T00:00:00.000+00:00',
  },
  { // the same event as the first entry
    _id: oid('650000000000000000000004'), title: 'M7 duplicate', magnitude: 7, latitude: 14.6, longitude: 121.0, eventTime: '2026-05-01T00:00:00.000Z', eventSummary: 'Duplicate.',
  },
  { // no latitude
    _id: oid('650000000000000000000005'), title: 'M6 no coordinates', magnitude: 6, longitude: 121.0, eventTime: '2026-05-01T00:00:00.000Z',
  },
  { // matches the Davao event; nothing to carry over
    _id: oid('650000000000000000000006'), title: 'M6.5 Davao', magnitude: 6.5, latitude: 7.07, longitude: 125.6, eventTime: '2026-03-01T00:00:00.000Z',
  },
];

describe('copy-significant-eq-details-to-postgres', () => {
  let mongo;
  let pg;
  let events;
  const quiet = (options = {}) => ({ db: pg.db, log: () => {}, ...options });
  const summaryOf = async (event) => (await pg.db('events').where({ id: event.id }).first('summary_override_text')).summary_override_text;

  beforeAll(async () => {
    [mongo, pg] = await Promise.all([startMongo(), startPostgres()]);
  }, Math.max(MONGO_STARTUP_TIMEOUT_MS, PG_STARTUP_TIMEOUT_MS));

  beforeEach(async () => {
    await Promise.all([mongo.clear(), pg.clear()]);
    await mongoose.connection.collection('significant-eqs').insertMany(ENTRIES);
    events = {
      manila: await seedEvent(pg.db, { n: 1, publicID: 'copy2026manila', magnitude: 7.1, at: 'manila', time: '2026-05-01T20:00:00.000Z' }),
      manilaSmaller: await seedEvent(pg.db, { n: 2, publicID: 'copy2026aftershock', magnitude: 5.0, at: 'manila', time: '2026-05-01T21:00:00.000Z' }),
      cebu: await seedEvent(pg.db, { n: 3, publicID: 'copy2026cebu', magnitude: 6.6, at: 'cebu', time: '2026-04-01T00:05:00.000Z', summary_override_text: 'Written by an admin.' }),
      davao: await seedEvent(pg.db, { n: 4, publicID: 'copy2026davao', magnitude: 6.5, at: 'davao', time: '2026-03-01T00:00:00.000Z' }),
    };
  });

  afterAll(async () => {
    await Promise.all([mongo && mongo.stop(), pg && pg.stop()]);
  });

  test('matches each entry to its event and fills in only what the event is missing', async () => {
    const result = await copySignificantEqDetails(quiet());

    expect(result.ok).toBe(true);
    expect(result.matched).toEqual([
      { id: '650000000000000000000001', publicID: 'copy2026manila' }, // the closest magnitude, not the aftershock
      { id: '650000000000000000000002', publicID: 'copy2026cebu' },
      { id: '650000000000000000000006', publicID: 'copy2026davao' },
    ]);
    expect(result.unmatched).toEqual([{ id: '650000000000000000000003', title: 'M6.4 Earthquake far away' }]);
    expect(result.sameEvent).toEqual([{ id: '650000000000000000000004', other: '650000000000000000000001' }]);
    expect(result.skipped).toEqual([{ id: '650000000000000000000005', reason: 'no usable latitude' }]);
    expect(result.summaries).toEqual({ set: 1, kept: 1, none: 1 });
    expect(result.details).toEqual({ inserted: 2, alreadyCopied: 0, kept: 0, none: 1 });
    expect(result.leftOut).toEqual([{ id: '650000000000000000000001', recordings: 1, references: 1 }]);

    expect(await summaryOf(events.manila)).toBe('A magnitude 7.0 earthquake struck Metro Manila.');
    expect(await summaryOf(events.cebu)).toBe('Written by an admin.'); // an admin's summary is kept
    const details = await pg.db('significant_eq_details').orderBy('legacy_mongo_id')
      .select('event_id', 'legacy_mongo_id', 'instrument_recordings', 'reference_urls');
    expect(details).toEqual([
      { event_id: events.manila.id, legacy_mongo_id: '650000000000000000000001', instrument_recordings: ['R3B2D', 'R1382'], reference_urls: ['https://earthquake.phivolcs.dost.gov.ph/report.html'] },
      { event_id: events.cebu.id, legacy_mongo_id: '650000000000000000000002', instrument_recordings: ['RF8C0'], reference_urls: ['https://example.org/cebu'] },
    ]);
  });

  test('a dry run writes nothing', async () => {
    const result = await copySignificantEqDetails(quiet({ dryRun: true }));

    expect(result.details.inserted).toBe(2);
    expect(result.summaries.set).toBe(1);
    expect(await pg.db('significant_eq_details').count({ n: '*' }).first()).toEqual({ n: '0' });
    expect(await summaryOf(events.manila)).toBeNull();
  });

  test('running it again changes nothing, and details an admin set are kept', async () => {
    await pg.db('significant_eq_details').insert({ event_id: events.cebu.id, instrument_recordings: ['RADMN'], edited_by: 'admin' });
    await copySignificantEqDetails(quiet());
    const before = await pg.db('significant_eq_details').orderBy('event_id').select('*');

    const again = await copySignificantEqDetails(quiet());

    expect(again.ok).toBe(true);
    expect(again.summaries).toEqual({ set: 0, kept: 2, none: 1 });
    expect(again.details).toEqual({ inserted: 0, alreadyCopied: 1, kept: 1, none: 1 });
    expect(await pg.db('significant_eq_details').orderBy('event_id').select('*')).toEqual(before);
    expect((await pg.db('significant_eq_details').where({ event_id: events.cebu.id }).first()).instrument_recordings).toEqual(['RADMN']);
  });
});
