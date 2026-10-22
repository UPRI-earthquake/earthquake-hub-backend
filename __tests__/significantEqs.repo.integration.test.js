// Behavior both significant-earthquakes repositories must have. The same tests run against MongoDB and
// PostgreSQL, so switching SIGNIFICANT_EQS_DB can't change what the API returns. PostgreSQL-only
// behavior (uuid ids, the table's validation rules) is tested at the end.
const mongoose = require('mongoose');
const mongoSignificantEqsRepo = require('../src/repositories/mongodb/significantEqs.repo');
const { createSignificantEqsRepo } = require('../src/repositories/postgres/significantEqs.repo');
const { startMongo, MONGO_STARTUP_TIMEOUT_MS } = require('./fixtures/mongo.fixture');
const { startPostgres, PG_STARTUP_TIMEOUT_MS } = require('./fixtures/postgres.fixture');

const oid = (n) => `67000000000000000000000${n}`;

// Records as stored in MongoDB (and as the API returns them, with _id as a string)
const OLDER = {
  _id: oid(2),
  title: 'Older earthquake',
  magnitude: 6.5,
  longitude: 121.1,
  latitude: 14.6,
  depth: 10,
  location: 'Somewhere, Luzon',
  eventTime: new Date('2019-01-01T00:00:00.000Z'),
  instrumentRecordings: ['R3B2D'],
  eventSummary: '<p>Summary</p>',
  references: ['https://example.org/a'],
};
const NEWER = {
  _id: oid(1),
  title: 'Newer earthquake',
  magnitude: 7,
  longitude: 125.2,
  latitude: 6.7,
  eventTime: new Date('2024-01-01T00:00:00.000Z'),
  instrumentRecordings: [],
  references: [],
};

const backends = [
  {
    name: 'mongodb',
    timeout: MONGO_STARTUP_TIMEOUT_MS,
    start: async () => {
      const mongo = await startMongo();
      return {
        repo: mongoSignificantEqsRepo,
        seed: (docs) => mongoose.connection.collection('significant-eqs').insertMany(
          docs.map((doc) => ({ ...doc, _id: new mongoose.Types.ObjectId(doc._id) })),
        ),
        clear: mongo.clear,
        stop: mongo.stop,
      };
    },
  },
  {
    name: 'postgres',
    timeout: PG_STARTUP_TIMEOUT_MS,
    start: async () => {
      const pg = await startPostgres();
      return {
        repo: createSignificantEqsRepo(pg.db),
        pg,
        // Rows as the copy script writes them (created_at from the ObjectId)
        seed: (docs) => pg.db('significant_eqs').insert(docs.map((doc) => ({
          legacy_mongo_id: doc._id,
          created_at: new mongoose.Types.ObjectId(doc._id).getTimestamp(),
          title: doc.title,
          magnitude: doc.magnitude,
          depth_km: doc.depth ?? null,
          latitude: doc.latitude,
          longitude: doc.longitude,
          location_text: doc.location ?? null,
          event_time: doc.eventTime,
          event_summary: doc.eventSummary ?? null,
          instrument_recordings: JSON.stringify(doc.instrumentRecordings),
          reference_links: JSON.stringify(doc.references),
        }))),
        clear: pg.clear,
        stop: pg.stop,
      };
    },
  },
];

// What the API sends: ids as strings, everything else as stored
const asApi = (doc) => ({ ...doc, _id: String(doc._id) });
const normalize = (eq) => eq && JSON.parse(JSON.stringify(eq));

describe.each(backends)('significantEqs.repo ($name)', ({ name, start, timeout }) => {
  let backend;
  let repo;

  beforeAll(async () => {
    backend = await start();
    ({ repo } = backend);
  }, timeout);

  afterEach(() => backend.clear());

  afterAll(async () => {
    if (backend) await backend.stop();
  });

  test('findAll returns an empty list when there are none', async () => {
    await expect(repo.findAll()).resolves.toEqual([]);
  });

  test('findAll returns every record in the order they were added, in the API shape', async () => {
    // NEWER was added first (lower ObjectId), so it comes first:
    // the list keeps the order records were added, not event time
    await backend.seed([NEWER, OLDER]);

    const all = await repo.findAll();

    expect(all.map(normalize)).toEqual([normalize(asApi(NEWER)), normalize(asApi(OLDER))]);
  });

  test('optional fields a record lacks are left out, not null', async () => {
    await backend.seed([NEWER]);

    const [eq] = await repo.findAll();

    expect(Object.keys(eq)).toEqual(
      ['_id', 'title', 'magnitude', 'longitude', 'latitude', 'eventTime', 'instrumentRecordings', 'references'],
    );
  });

  test('findById finds a record by its MongoDB id', async () => {
    await backend.seed([OLDER, NEWER]);

    expect(normalize(await repo.findById(oid(2)))).toEqual(normalize(asApi(OLDER)));
  });

  test('findById resolves to null for an unknown id', async () => {
    await backend.seed([OLDER]);

    await expect(repo.findById(oid(9))).resolves.toBeNull();
  });

  test('isValidId accepts MongoDB ids and rejects malformed ones', () => {
    expect(repo.isValidId(oid(2))).toBe(true);
    expect(repo.isValidId('not-an-id')).toBe(false);
    expect(repo.isValidId(undefined)).toBe(false);
  });

  if (name !== 'postgres') return;

  describe('PostgreSQL only', () => {
    const insert = (fields) => backend.pg.db('significant_eqs').insert({
      title: 'New earthquake',
      magnitude: 6,
      latitude: 10,
      longitude: 120,
      event_time: new Date('2025-01-01T00:00:00.000Z'),
      ...fields,
    }).returning('id');

    test('a row created in PostgreSQL has its uuid as _id, and findById accepts it', async () => {
      const [{ id }] = await insert({});

      expect(repo.isValidId(id)).toBe(true);
      expect(await repo.findById(id)).toMatchObject({ _id: id, title: 'New earthquake' });
      expect((await repo.findAll())[0]._id).toBe(id);
    });

    test('a copied row is also found by its uuid, and still answers with its MongoDB id', async () => {
      await backend.seed([OLDER]);
      const { id } = await backend.pg.db('significant_eqs').where({ legacy_mongo_id: oid(2) }).first('id');

      expect(await repo.findById(id)).toMatchObject({ _id: oid(2) });
    });

    test('location is computed from latitude and longitude', async () => {
      await backend.seed([OLDER]);

      const { rows: [row] } = await backend.pg.db.raw(
        'SELECT ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lon FROM significant_eqs',
      );
      expect(row).toEqual({ lat: 14.6, lon: 121.1 });
    });

    test.each([
      ['missing magnitude', { magnitude: null }, /null value in column "magnitude"/],
      ['missing title', { title: null }, /null value in column "title"/],
      ['blank title', { title: '  ' }, /significant_eqs_title_not_blank/],
      ['missing latitude', { latitude: null }, /null value in column "latitude"/],
      ['latitude 500', { latitude: 500 }, /significant_eqs_latitude_range/],
      ['longitude -181', { longitude: -181 }, /significant_eqs_longitude_range/],
      ['magnitude 12', { magnitude: 12 }, /significant_eqs_magnitude_range/],
      ['depth 5000 km', { depth_km: 5000 }, /significant_eqs_depth_range/],
      ['missing event time', { event_time: null }, /null value in column "event_time"/],
      ['recordings not a list', { instrument_recordings: '{"a":1}' }, /significant_eqs_recordings_is_array/],
      ['references not a list', { reference_links: '"https://example.org"' }, /significant_eqs_references_is_array/],
    ])('the database rejects a record with %s', async (_, fields, error) => {
      await expect(insert(fields)).rejects.toThrow(error);
    });
  });
});
