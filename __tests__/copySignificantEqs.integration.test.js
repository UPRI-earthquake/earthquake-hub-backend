const mongoose = require('mongoose');
const { copySignificantEqs } = require('../scripts/copy-significant-eqs-to-postgres');
const { startMongo, MONGO_STARTUP_TIMEOUT_MS } = require('./fixtures/mongo.fixture');
const { startPostgres, PG_STARTUP_TIMEOUT_MS } = require('./fixtures/postgres.fixture');

const id = (n) => new mongoose.Types.ObjectId(`68000000000000000000000${n}`);

const fullDoc = {
  _id: id(1),
  title: 'Magnitude 6.9 Earthquake, Davao del Sur',
  magnitude: 6.9,
  longitude: 125.18,
  latitude: 6.71,
  depth: 22,
  location: 'Matanao, Davao del Sur',
  eventTime: new Date('2019-12-15T06:11:51.000Z'),
  instrumentRecordings: ['R3B2D', 'RE722'],
  eventSummary: '<p>Strong shaking.</p>',
  references: ['https://example.org/report'],
};

const minimalDoc = {
  _id: id(2),
  title: 'Magnitude 7.0 Earthquake, Abra',
  magnitude: 7,
  longitude: 120.63,
  latitude: 17.53,
  eventTime: new Date('2022-07-27T00:43:24.000Z'),
};

describe('scripts/copy-significant-eqs-to-postgres', () => {
  let mongo;
  let pg;
  const collection = () => mongoose.connection.collection('significant-eqs');
  const pgRow = (legacyId) => pg.db('significant_eqs').where({ legacy_mongo_id: String(legacyId) }).first();
  const pgCount = async () => Number((await pg.db('significant_eqs').count({ n: '*' }).first()).n);
  const copy = (options = {}) => copySignificantEqs({ db: pg.db, log: () => {}, ...options });

  beforeAll(async () => {
    [mongo, pg] = await Promise.all([startMongo(), startPostgres()]);
  }, Math.max(MONGO_STARTUP_TIMEOUT_MS, PG_STARTUP_TIMEOUT_MS));

  afterEach(() => Promise.all([mongo.clear(), pg.clear()]));

  afterAll(async () => {
    await Promise.all([mongo && mongo.stop(), pg && pg.stop()]);
  });

  test('copies every field', async () => {
    await collection().insertOne(fullDoc);

    const result = await copy();

    expect(result).toMatchObject({ ok: true, mongoTotal: 1, inserted: 1, problems: [] });
    expect(await pgRow(id(1))).toMatchObject({
      title: fullDoc.title,
      magnitude: 6.9,
      depth_km: 22,
      latitude: 6.71,
      longitude: 125.18,
      location_text: 'Matanao, Davao del Sur',
      event_time: fullDoc.eventTime,
      event_summary: '<p>Strong shaking.</p>',
      instrument_recordings: ['R3B2D', 'RE722'],
      reference_links: ['https://example.org/report'],
      event_id: null,
      created_at: id(1).getTimestamp(),
    });
  });

  test('fills in defaults for optional fields', async () => {
    await collection().insertOne(minimalDoc);

    await copy();

    expect(await pgRow(id(2))).toMatchObject({
      depth_km: null,
      location_text: null,
      event_summary: null,
      instrument_recordings: [],
      reference_links: [],
    });
  });

  test('a dry run writes nothing', async () => {
    await collection().insertMany([fullDoc, minimalDoc]);

    const result = await copy({ dryRun: true });

    expect(result).toMatchObject({ ok: true, inserted: 2 });
    expect(await pgCount()).toBe(0);
  });

  test('re-running is safe: no duplicates, and MongoDB edits are picked up', async () => {
    await collection().insertMany([fullDoc, minimalDoc]);
    await copy();

    await collection().updateOne({ _id: id(1) }, { $set: { title: 'Corrected title' } });
    const result = await copy();

    expect(result).toMatchObject({ ok: true, inserted: 0, updated: 2, keptNewer: 0 });
    expect(await pgCount()).toBe(2);
    expect(await pgRow(id(1))).toMatchObject({ title: 'Corrected title' });
  });

  test('a MongoDB edit is still copied after an unchanged re-run', async () => {
    // These records have no timestamps, so updated_at stays the same on every run
    await collection().insertOne(fullDoc);
    await copy();
    await copy();

    await collection().updateOne({ _id: id(1) }, { $set: { title: 'Corrected title' } });
    const result = await copy();

    expect(result).toMatchObject({ ok: true, updated: 1, keptNewer: 0 });
    expect(await pgRow(id(1))).toMatchObject({ title: 'Corrected title' });
  });

  test('re-running never overwrites a row edited in PostgreSQL since it was copied', async () => {
    await collection().insertOne(fullDoc);
    await copy();
    await pg.db('significant_eqs').where({ legacy_mongo_id: String(id(1)) }).update({ title: 'Edited in PostgreSQL' });

    const result = await copy();

    expect(result).toMatchObject({ ok: true, updated: 0, keptNewer: 1 });
    expect(await pgRow(id(1))).toMatchObject({ title: 'Edited in PostgreSQL' });
  });

  test('reports every rule a record breaks, copies the rest, and still validates', async () => {
    await collection().insertMany([
      fullDoc,
      { _id: id(3), title: 'No magnitude', latitude: 10, longitude: 120, eventTime: new Date() },
      { _id: id(4), title: 'Bad coordinates', magnitude: 6, latitude: 500, longitude: 120, eventTime: new Date() },
      { _id: id(5), magnitude: 'big', latitude: 10, longitude: 120, references: 'https://example.org' },
    ]);

    const result = await copy();

    expect(result.ok).toBe(true);
    expect(result.inserted).toBe(1);
    expect(result.problems).toEqual([
      { id: String(id(3)), title: 'No magnitude', reasons: ['missing magnitude'] },
      { id: String(id(4)), title: 'Bad coordinates', reasons: ['latitude 500 not between -90 and 90'] },
      {
        id: String(id(5)),
        title: null,
        reasons: [
          'missing title',
          'magnitude "big" not between -2 and 10',
          'missing eventTime',
          'references is not a list',
        ],
      },
    ]);
    expect(await pgCount()).toBe(1);
  });

  test('accepts numbers stored as text, as Mongoose would have cast them', async () => {
    await collection().insertOne({ ...minimalDoc, magnitude: '7.0', latitude: '17.53' });

    const result = await copy();

    expect(result.problems).toEqual([]);
    expect(await pgRow(id(2))).toMatchObject({ magnitude: 7, latitude: 17.53 });
  });
});
