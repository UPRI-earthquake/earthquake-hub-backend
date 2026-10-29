// Behavior both versions of the earthquake events repository must have, run against MongoDB and
// PostgreSQL alike, so switching events to PostgreSQL can't change what services see. Behavior only
// PostgreSQL has (stations as device links, onlineStations worked out on read, transactions) is
// tested separately.
const mongoose = require('mongoose');
const mongoEventsRepo = require('../src/repositories/mongodb/events.repo');
const { createEventsRepo } = require('../src/repositories/postgres/events.repo');
const { copyEarthquakes } = require('../scripts/copy-earthquakes-to-postgres');
const { startMongo, MONGO_STARTUP_TIMEOUT_MS } = require('./fixtures/mongo.fixture');
const { startPostgres, PG_STARTUP_TIMEOUT_MS } = require('./fixtures/postgres.fixture');

const SOURCES = ['phivolcs', 'usgs'];
const at = (iso) => new Date(iso);

// An event as SeisComP ingest saves it
const seiscomp = (fields = {}) => ({
  OT: at('2026-05-01T08:00:00.000Z'),
  latitude_value: 14.6,
  longitude_value: 121.05,
  depth_value: 10,
  magnitude_value: 4.5,
  type: 'NEW',
  text: 'Luzon, Philippines',
  sourceCatalog: 'upri-current',
  sourceServer: 'earthquake.up.edu.ph',
  candidateStations: ['R3B2D', 'R0001'],
  onlineStations: ['R3B2D', 'R0001'],
  recordingAvailabilityStatus: 'pending',
  last_modification: at('2026-05-01T08:05:00.000Z'),
  ...fields,
});

// Each backend: the repository, and helpers to store or look at records directly
const backends = [
  {
    name: 'mongodb',
    timeout: MONGO_STARTUP_TIMEOUT_MS,
    start: async () => {
      const mongo = await startMongo();
      const events = () => mongoose.connection.collection('events');
      return {
        Events: mongoEventsRepo,
        unknownId: () => new mongoose.Types.ObjectId().toString(),
        // A record as an older version of the app (or a legacy import) left it: no defaults applied
        insertRaw: async (doc) => String((await events().insertOne({ ...doc })).insertedId),
        stored: (publicID) => events().findOne({ publicID }),
        clear: mongo.clear,
        stop: mongo.stop,
      };
    },
  },
  {
    name: 'postgres',
    timeout: Math.max(MONGO_STARTUP_TIMEOUT_MS, PG_STARTUP_TIMEOUT_MS),
    start: async () => {
      // MongoDB too: an older record arrives in PostgreSQL the way it really would, through the copy script
      const [mongo, pg] = await Promise.all([startMongo(), startPostgres()]);
      // The devices the station codes in these tests belong to
      const seedDevices = () => pg.db('devices').insert(['R3B2D', 'R0001', 'RE722'].map((station, i) => ({
        network: 'AM', station, latitude: 14.6, longitude: 121 + i, elevation_m: 50,
      })));
      await seedDevices();
      return {
        Events: createEventsRepo(pg.db),
        unknownId: () => new mongoose.Types.ObjectId().toString(),
        insertRaw: async (doc) => {
          const { insertedId } = await mongoose.connection.collection('events').insertOne({ ...doc });
          const copied = await copyEarthquakes({ db: pg.db, log: () => {} });
          if (!copied.ok) throw new Error('Copying the record to PostgreSQL failed');
          return String(insertedId);
        },
        stored: async (publicID) => {
          const row = await pg.db('events').where({ public_id: publicID }).first();
          return { place: row.place ?? undefined, location: row.location ?? undefined, summaryOverride: row.summary_override_text ?? undefined };
        },
        pg,
        clear: async () => {
          await Promise.all([mongo.clear(), pg.clear()]);
          await seedDevices();
        },
        stop: () => Promise.all([mongo.stop(), pg.stop()]),
      };
    },
  },
];

describe.each(backends)('events repository ($name)', ({ name, start, timeout }) => {
  let backend;
  let Events;

  const ingest = (publicID, fields = {}, options = {}) => Events.saveFromSeiscomp(publicID, seiscomp(fields), { catalogSources: SOURCES, ...options });

  beforeAll(async () => {
    backend = await start();
    ({ Events } = backend);
  }, timeout);

  afterEach(() => backend.clear());

  afterAll(async () => {
    if (backend) await backend.stop();
  });

  describe('reads', () => {
    test('listByOriginTime returns events in the range, bounds included, newest first, in the shape the API sends', async () => {
      await ingest('ev-before', { OT: at('2026-04-30T23:59:59.999Z') });
      await ingest('ev-start', { OT: at('2026-05-01T00:00:00.000Z') });
      await ingest('ev-end', { OT: at('2026-05-02T00:00:00.000Z') });
      await ingest('ev-after', { OT: at('2026-05-02T00:00:00.001Z') });

      const events = await Events.listByOriginTime(at('2026-05-01T00:00:00.000Z'), at('2026-05-02T00:00:00.000Z'));

      expect(events.map((e) => e.publicID)).toEqual(['ev-end', 'ev-start']); // newest first
      expect(events[0]).toMatchObject({
        _id: expect.anything(),
        OT: expect.any(Date),
        latitude_value: 14.6,
        longitude_value: 121.05,
        depth_value: 10,
        magnitude_value: 4.5,
        type: 'NEW',
        text: 'Luzon, Philippines',
        onlineStations: ['R3B2D', 'R0001'],
      });
    });

    test('an old record missing fields comes back with the defaults the API always showed', async () => {
      await backend.insertRaw({ publicID: 'ev-old', OT: at('2026-05-01T08:00:00.000Z') });

      const [event] = await Events.listByOriginTime(at('2026-05-01T00:00:00.000Z'), at('2026-05-02T00:00:00.000Z'));

      expect(event).toMatchObject({
        publicID: 'ev-old',
        sourceCatalog: 'upri-current',
        isLegacyRecord: false,
        onlineStations: [],
        candidateStations: [],
        recordingStations: [],
        recordingAvailabilityStatus: 'pending',
        additionalInformation: [],
        pendingCatalogSources: SOURCES,
      });
    });

    test('findByPublicID finds the event, or resolves to null', async () => {
      await ingest('ev-1');

      expect(await Events.findByPublicID('ev-1')).toMatchObject({ publicID: 'ev-1', magnitude_value: 4.5 });
      expect(await Events.findByPublicID('ev-unknown')).toBeNull();
    });

    test('findRefById gives the _id and publicID for comments, or null for an unknown or malformed id', async () => {
      await ingest('ev-1');
      const { _id } = await Events.findByPublicID('ev-1');

      expect(await Events.findRefById(String(_id))).toEqual({ _id, publicID: 'ev-1' });
      expect(await Events.findRefById(backend.unknownId())).toBeNull();
      expect(await Events.findRefById('not-an-id')).toBeNull();
    });
  });

  describe('SeisComP ingest', () => {
    test('a new event is stored with its location, and every catalog starts pending', async () => {
      await expect(ingest('ev-1')).resolves.toBe(true);

      expect(await Events.findByPublicID('ev-1')).toMatchObject({
        publicID: 'ev-1',
        location: { type: 'Point', coordinates: [121.05, 14.6] },
        candidateStations: ['R3B2D', 'R0001'],
        recordingStations: [],
        recordingAvailabilityAttempts: 0,
        isLegacyRecord: false,
        pendingCatalogSources: SOURCES,
        catalogEnrichmentAttempts: {},
        catalogEnrichmentStatus: { phivolcs: 'pending', usgs: 'pending' },
      });
    });

    test('a newer update, or one with the same last_modification, replaces the details', async () => {
      await ingest('ev-1');

      await expect(ingest('ev-1', { magnitude_value: 4.8, type: 'UPDATE', last_modification: at('2026-05-01T08:10:00.000Z') })).resolves.toBe(true);
      expect(await Events.findByPublicID('ev-1')).toMatchObject({ magnitude_value: 4.8, type: 'UPDATE' });

      await expect(ingest('ev-1', { magnitude_value: 4.9, last_modification: at('2026-05-01T08:10:00.000Z') })).resolves.toBe(true);
      expect(await Events.findByPublicID('ev-1')).toMatchObject({ magnitude_value: 4.9 });
    });

    test('an older update (arrived out of order) is dropped', async () => {
      await ingest('ev-1', { last_modification: at('2026-05-01T08:10:00.000Z') });

      await expect(ingest('ev-1', { magnitude_value: 3.1, last_modification: at('2026-05-01T08:05:00.000Z') })).resolves.toBe(false);

      expect(await Events.findByPublicID('ev-1')).toMatchObject({ magnitude_value: 4.5, last_modification: at('2026-05-01T08:10:00.000Z') });
    });

    test('an update without last_modification is applied', async () => {
      await ingest('ev-1');

      await expect(ingest('ev-1', { magnitude_value: 5.0, last_modification: undefined })).resolves.toBe(true);

      expect(await Events.findByPublicID('ev-1')).toMatchObject({ magnitude_value: 5.0 });
    });

    test('an update keeps what other jobs stored: recording stations and the enrichment state', async () => {
      await ingest('ev-1');
      const { _id } = await Events.findByPublicID('ev-1');
      await Events.saveStationChecks([{ _id, recordingStations: ['R3B2D'], recordingAvailabilityAttempts: 2 }]);
      await Events.saveEnrichment(_id, {
        additionalInformation: [], pendingCatalogSources: ['usgs'], catalogEnrichmentAttempts: { phivolcs: 1 }, catalogEnrichmentStatus: { phivolcs: 'no_match' },
      });

      await ingest('ev-1', { last_modification: at('2026-05-01T08:10:00.000Z') }, { catalogSources: SOURCES });

      expect(await Events.findByPublicID('ev-1')).toMatchObject({
        recordingStations: ['R3B2D'],
        recordingAvailabilityAttempts: 2,
        pendingCatalogSources: ['usgs'],
        catalogEnrichmentStatus: { phivolcs: 'no_match' },
      });
    });

    test('invalid coordinates remove the location; clearPlace removes the place name', async () => {
      await ingest('ev-1');
      await Events.savePlace({ publicID: 'ev-1' }, '10 km N of Manila, Philippines');

      await ingest('ev-1', { latitude_value: 95, last_modification: at('2026-05-01T08:10:00.000Z') }, { clearPlace: true });

      const stored = await backend.stored('ev-1');
      expect(stored.location).toBeUndefined();
      expect(stored.place).toBeUndefined();
    });

    test('a legacy import that SeisComP sends again becomes a current record', async () => {
      await backend.insertRaw({ publicID: 'ev-1', isLegacyRecord: true, legacyImportedAt: at('2025-01-01T00:00:00.000Z'), legacySourcePublicID: 'old-1' });

      await ingest('ev-1');

      expect(await Events.findByPublicID('ev-1')).toMatchObject({ isLegacyRecord: false, legacyImportedAt: null, legacySourcePublicID: null });
    });

    test('findIngestState gives what ingest compares with, or null for a new event', async () => {
      await ingest('ev-1');
      await Events.savePlace({ publicID: 'ev-1' }, '10 km N of Manila, Philippines');

      expect(await Events.findIngestState('ev-1')).toMatchObject({
        latitude_value: 14.6,
        longitude_value: 121.05,
        depth_value: 10,
        place: '10 km N of Manila, Philippines',
        last_modification: at('2026-05-01T08:05:00.000Z'),
        recordingStations: [],
        recordingAvailabilityStatus: 'pending',
      });
      expect(await Events.findIngestState('ev-unknown')).toBeNull();
    });
  });

  describe('place names', () => {
    test.each([
      ['missing', {}],
      ['empty', { place: '' }],
      ['"Unavailable"', { place: 'Unavailable' }],
      ['"Unable to geocode"', { place: 'Unable to geocode' }],
    ])('replaces a %s place, found by publicID or by _id', async (label, fields) => {
      const _id = await backend.insertRaw({ publicID: 'ev-1', ...fields });

      await Events.savePlace({ publicID: 'ev-1' }, '10 km N of Manila, Philippines');
      expect((await backend.stored('ev-1')).place).toBe('10 km N of Manila, Philippines');

      await backend.clear();
      await backend.insertRaw({ _id: new mongoose.Types.ObjectId(_id), publicID: 'ev-1', ...fields });
      await Events.savePlace({ _id }, '12 km S of Manila, Philippines');
      expect((await backend.stored('ev-1')).place).toBe('12 km S of Manila, Philippines');
    });

    test('keeps a place name the event already has', async () => {
      await backend.insertRaw({ publicID: 'ev-1', place: '10 km N of Manila, Philippines' });

      await Events.savePlace({ publicID: 'ev-1' }, '99 km E of Somewhere');

      expect((await backend.stored('ev-1')).place).toBe('10 km N of Manila, Philippines');
    });
  });

  describe('summary override', () => {
    test('setSummary stores the text, the time and the editor; clearSummary removes it (the API then shows null)', async () => {
      await ingest('ev-1');

      const updated = await Events.setSummary('ev-1', 'A felt earthquake near Manila.', 'juan');
      expect(updated.summaryOverride).toEqual({ text: 'A felt earthquake near Manila.', editedAt: expect.any(Date), editedBy: 'juan' });
      expect(Math.abs(updated.summaryOverride.editedAt - Date.now())).toBeLessThan(60_000);

      expect((await Events.setSummary('ev-1', 'Edited.')).summaryOverride).toEqual({ text: 'Edited.', editedAt: expect.any(Date) });

      const cleared = await Events.clearSummary('ev-1');
      expect(cleared.summaryOverride).toBeNull();
      expect((await Events.findByPublicID('ev-1')).summaryOverride).toBeNull();
      expect((await backend.stored('ev-1')).summaryOverride).toBeUndefined();
    });

    test('both resolve to null for an unknown event', async () => {
      await expect(Events.setSummary('ev-unknown', 'text')).resolves.toBeNull();
      await expect(Events.clearSummary('ev-unknown')).resolves.toBeNull();
    });
  });

  describe('station check', () => {
    test('findForStationCheck gives the fields the check reads, or null', async () => {
      await ingest('ev-1');

      const event = await Events.findForStationCheck('ev-1');
      expect(event).toEqual({
        _id: expect.anything(),
        OT: at('2026-05-01T08:00:00.000Z'),
        latitude_value: 14.6,
        longitude_value: 121.05,
        candidateStations: ['R3B2D', 'R0001'],
        onlineStations: ['R3B2D', 'R0001'],
        recordingAvailabilityAttempts: 0,
        recordingAvailabilityStatus: 'pending',
      });
      expect(await Events.findForStationCheck('ev-unknown')).toBeNull();
    });

    test('listForStationCheck pages through events with coordinates, in a fixed order', async () => {
      await ingest('ev-1');
      await ingest('ev-2');
      await backend.insertRaw({ publicID: 'ev-no-coordinates', OT: at('2026-05-01T08:00:00.000Z') });
      await ingest('ev-3');

      const first = await Events.listForStationCheck({ limit: 2 });
      const second = await Events.listForStationCheck({ after: first[first.length - 1]._id, limit: 2 });
      const third = await Events.listForStationCheck({ after: second[second.length - 1]._id, limit: 2 });

      const ids = [...first, ...second].map((e) => String(e._id));
      expect(first).toHaveLength(2);
      expect(second).toHaveLength(1);
      expect(third).toEqual([]);
      expect(new Set(ids).size).toBe(3);
      expect([...ids].sort()).toEqual(ids);
    });

    test('saveStationChecks saves each event\'s results together; every found event counts as modified', async () => {
      await ingest('ev-1');
      await ingest('ev-2');
      const [one, two] = await Promise.all(['ev-1', 'ev-2'].map((id) => Events.findForStationCheck(id)));
      const checkedAt = at('2026-05-01T08:30:00.000Z');
      const results = {
        candidateStations: ['R3B2D', 'R0001'],
        recordingStations: ['R3B2D'],
        recordingAvailabilityStatus: 'partial',
        recordingAvailabilityCheckedAt: checkedAt,
        recordingAvailabilityAttempts: 1,
        onlineStations: ['R3B2D'],
      };

      await expect(Events.saveStationChecks([{ _id: one._id, ...results, notAResult: 'ignored' }, { _id: two._id, ...results }]))
        .resolves.toEqual({ matchedCount: 2, modifiedCount: 2 });
      expect(await Events.findByPublicID('ev-1')).toMatchObject(results);
      expect((await backend.stored('ev-1')).notAResult).toBeUndefined();

      // Saving the same results again still sets updatedAt, so the API's modifiedCount equals matchedCount
      await expect(Events.saveStationChecks([{ _id: one._id, ...results }])).resolves.toEqual({ matchedCount: 1, modifiedCount: 1 });
      await expect(Events.saveStationChecks([{ _id: backend.unknownId(), ...results }])).resolves.toEqual({ matchedCount: 0, modifiedCount: 0 });
      await expect(Events.saveStationChecks([])).resolves.toEqual({ matchedCount: 0, modifiedCount: 0 });
    });

    test('a check where every station lookup failed saves only the attempt', async () => {
      await ingest('ev-1');
      const { _id } = await Events.findForStationCheck('ev-1');

      await Events.saveStationChecks([{ _id, recordingAvailabilityCheckedAt: at('2026-05-01T08:30:00.000Z'), recordingAvailabilityAttempts: 1, recordingAvailabilityStatus: 'pending' }]);

      expect(await Events.findByPublicID('ev-1')).toMatchObject({
        recordingAvailabilityAttempts: 1, candidateStations: ['R3B2D', 'R0001'], onlineStations: ['R3B2D', 'R0001'],
      });
    });

    test('sampleOnlineStations gives the first event\'s onlineStations, or null when there are no events', async () => {
      await expect(Events.sampleOnlineStations()).resolves.toBeNull();

      await ingest('ev-1');

      await expect(Events.sampleOnlineStations()).resolves.toEqual(['R3B2D', 'R0001']);
    });
  });

  describe('catalog enrichment', () => {
    const cutoff = at('2026-05-02T00:00:00.000Z');
    const options = { cutoff, maxAttempts: 3 };

    const seedEligibility = async () => {
      await ingest('ev-new-pending', { OT: at('2026-05-01T12:00:00.000Z') });
      await ingest('ev-old-pending', { OT: at('2026-04-01T12:00:00.000Z') });
      await ingest('ev-too-recent', { OT: at('2026-05-03T12:00:00.000Z') });
      await backend.insertRaw({ publicID: 'ev-done', OT: at('2026-04-02T00:00:00.000Z'), pendingCatalogSources: [], upForEnrichment: false });
      await backend.insertRaw({ publicID: 'ev-legacy', OT: at('2026-04-03T00:00:00.000Z'), upForEnrichment: true, enrichmentAttempts: 1 });
      await backend.insertRaw({ publicID: 'ev-legacy-exhausted', OT: at('2026-04-04T00:00:00.000Z'), upForEnrichment: true, enrichmentAttempts: 3 });
    };

    test('eligible events: old enough, with a catalog pending or legacy attempts left; oldest first', async () => {
      await seedEligibility();

      await expect(Events.countEnrichmentEligible(options)).resolves.toBe(3);
      const listed = await Events.listEnrichmentEligible({ ...options, limit: 2 });
      expect(listed.map((e) => e.publicID)).toEqual(['ev-old-pending', 'ev-legacy']);
      expect(listed[0]).toMatchObject({
        OT: at('2026-04-01T12:00:00.000Z'), magnitude_value: 4.5, pendingCatalogSources: SOURCES, catalogEnrichmentStatus: { phivolcs: 'pending', usgs: 'pending' },
      });
    });

    test('saveEnrichment saves the matches, pending catalogs and per-catalog state together', async () => {
      await ingest('ev-1', { OT: at('2026-04-01T12:00:00.000Z') });
      const [{ _id }] = await Events.listEnrichmentEligible({ ...options, limit: 1 });
      const match = { source: 'phivolcs', sourceLabel: 'PHIVOLCS', title: 'M4.4 - 10 km N of Manila', magnitude: 4.4, score: 1.2, matchQuality: 'high', raw: { id: 'x' } };

      await Events.saveEnrichment(_id, {
        additionalInformation: [match], pendingCatalogSources: ['usgs'], catalogEnrichmentAttempts: { phivolcs: 1, usgs: 1 }, catalogEnrichmentStatus: { phivolcs: 'done', usgs: 'pending' },
      });
      expect(await Events.findByPublicID('ev-1')).toMatchObject({
        additionalInformation: [match],
        pendingCatalogSources: ['usgs'],
        catalogEnrichmentAttempts: { phivolcs: 1, usgs: 1 },
        catalogEnrichmentStatus: { phivolcs: 'done', usgs: 'pending' },
        upForEnrichment: true,
        enrichmentAttempts: 1,
      });

      await Events.saveEnrichment(_id, {
        additionalInformation: [match], pendingCatalogSources: [], catalogEnrichmentAttempts: { phivolcs: 1, usgs: 2 }, catalogEnrichmentStatus: { phivolcs: 'done', usgs: 'no_match' },
      });
      expect(await Events.findByPublicID('ev-1')).toMatchObject({ pendingCatalogSources: [], upForEnrichment: false, enrichmentAttempts: 2 });
      await expect(Events.countEnrichmentEligible(options)).resolves.toBe(0);
    });
  });

  test('matches come back in the order they were saved (the frontend shows them in it), null values kept', async () => {
    await ingest('ev-1');
    const { _id } = await Events.findForStationCheck('ev-1');
    const usgs = { source: 'usgs', title: 'M 4.6', depth: 12, network: 'us' };
    const phivolcs = { source: 'phivolcs', location: '010 km N of Quezon City', depthKm: null, time: null };

    await Events.saveEnrichment(_id, {
      additionalInformation: [usgs, phivolcs], pendingCatalogSources: [], catalogEnrichmentAttempts: { phivolcs: 1, usgs: 1 }, catalogEnrichmentStatus: { phivolcs: 'done', usgs: 'done' },
    });

    expect((await Events.findByPublicID('ev-1')).additionalInformation).toEqual([usgs, phivolcs]);
  });

  if (name === 'postgres') {
    describe('PostgreSQL only', () => {
      const db = () => backend.pg.db;
      const results = (fields) => ({
        recordingAvailabilityCheckedAt: new Date(), recordingAvailabilityAttempts: 1, onlineStations: ['IGNORED'], ...fields,
      });
      // Adds a rule the next write breaks, to check that the write leaves nothing half-done
      const withFailingRule = async (table, check, fn) => {
        await db().raw(`ALTER TABLE ${table} ADD CONSTRAINT test_failing_rule CHECK (${check})`);
        try {
          await fn();
        } finally {
          await db().raw(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS test_failing_rule`);
        }
      };

      test('a new event gets a MongoDB-style _id; stations are linked to devices, unknown codes left out', async () => {
        await ingest('ev-1', { candidateStations: ['r3b2d', 'RNONE', 'RE722'] });

        const event = await Events.findByPublicID('ev-1');
        expect(event._id).toMatch(/^[0-9a-f]{24}$/);
        expect(event.candidateStations).toEqual(['R3B2D', 'RE722']);
        expect(await db()('event_stations').where({ kind: 'candidate' }).orderBy('position').pluck('position')).toEqual([0, 2]);
      });

      test('onlineStations is worked out from the lists and the recording status, as the station check stored it', async () => {
        await ingest('ev-recent', { OT: new Date(), candidateStations: ['R3B2D', 'R0001'] });
        await ingest('ev-old', { candidateStations: ['R3B2D', 'R0001'] });
        const [recent, old] = await Promise.all(['ev-recent', 'ev-old'].map((id) => Events.findForStationCheck(id)));
        const shown = async (publicID) => (await Events.findByPublicID(publicID)).onlineStations;

        expect(await shown('ev-recent')).toEqual(['R3B2D', 'R0001']); // pending: the candidates
        await Events.saveStationChecks([
          { _id: recent._id, ...results({ recordingStations: ['R0001'], recordingAvailabilityStatus: 'partial' }) },
          { _id: old._id, ...results({ recordingStations: ['R0001'], recordingAvailabilityStatus: 'partial' }) },
        ]);
        expect(await shown('ev-recent')).toEqual(['R0001', 'R3B2D']); // partial within the grace period
        expect(await shown('ev-old')).toEqual(['R0001']); // partial after it
        await Events.saveStationChecks([{ _id: old._id, recordingStations: [], recordingAvailabilityStatus: 'unavailable' }]);
        expect(await shown('ev-old')).toEqual([]);
      });

      test('every write to an event or its rows moves its updated_at (the copy treats them as one unit)', async () => {
        await ingest('ev-1');
        const updatedAt = async () => (await db()('events').where({ public_id: 'ev-1' }).first()).updated_at.getTime();
        const settle = () => new Promise((resolve) => { setTimeout(resolve, 20); });
        const { _id } = await Events.findForStationCheck('ev-1');
        const writes = [
          () => Events.saveStationChecks([{ _id, recordingStations: ['R3B2D'] }]),
          () => Events.saveEnrichment(_id, {
            additionalInformation: [], pendingCatalogSources: [], catalogEnrichmentAttempts: { usgs: 1 }, catalogEnrichmentStatus: { usgs: 'no_match' },
          }),
          () => Events.savePlace({ _id }, '10 km N of Manila, Philippines'),
          () => Events.setSummary('ev-1', 'Felt in Manila.'),
        ];

        for (const write of writes) {
          const before = await updatedAt();
          await settle();
          await write();
          expect(await updatedAt()).toBeGreaterThan(before);
        }
      });

      test('ingest: a failed step leaves no event behind', async () => {
        await withFailingRule('event_stations', 'position < 1', async () => {
          await expect(ingest('ev-1', { candidateStations: ['R3B2D', 'R0001'] })).rejects.toThrow(/test_failing_rule/);
        });

        expect(await Events.findByPublicID('ev-1')).toBeNull();
        expect(Number((await db()('event_catalog_status').count({ n: '*' }).first()).n)).toBe(0);
      });

      test('station check: a failed step leaves the event as it was', async () => {
        await ingest('ev-1');
        const { _id } = await Events.findForStationCheck('ev-1');

        await withFailingRule('event_stations', "kind <> 'recording' OR position < 1", async () => {
          await expect(Events.saveStationChecks([{ _id, ...results({ recordingStations: ['R3B2D', 'R0001'], recordingAvailabilityStatus: 'verified' }) }]))
            .rejects.toThrow(/test_failing_rule/);
        });

        expect(await Events.findByPublicID('ev-1')).toMatchObject({ recordingStations: [], recordingAvailabilityStatus: 'pending', recordingAvailabilityAttempts: 0 });
      });

      test('enrichment: a failed step leaves the matches and status as they were', async () => {
        await ingest('ev-1');
        const { _id } = await Events.findForStationCheck('ev-1');

        await withFailingRule('event_catalog_status', 'attempts < 5', async () => {
          await expect(Events.saveEnrichment(_id, {
            additionalInformation: [{ source: 'usgs', title: 'M 4.6' }],
            pendingCatalogSources: [],
            catalogEnrichmentAttempts: { phivolcs: 9, usgs: 9 },
            catalogEnrichmentStatus: { phivolcs: 'failed', usgs: 'done' },
          })).rejects.toThrow(/test_failing_rule/);
        });

        expect(await Events.findByPublicID('ev-1')).toMatchObject({
          additionalInformation: [], catalogEnrichmentStatus: { phivolcs: 'pending', usgs: 'pending' }, catalogEnrichmentAttempts: {},
        });
      });

      test('eligibility comes from the status rows: a catalog without one shows as pending but is not searched', async () => {
        await ingest('ev-1', { OT: at('2026-04-01T00:00:00.000Z') });
        const options = { cutoff: at('2026-05-02T00:00:00.000Z'), maxAttempts: 3 };
        await expect(Events.countEnrichmentEligible(options)).resolves.toBe(1);

        await db()('event_catalog_status').del();

        expect(await Events.findByPublicID('ev-1')).toMatchObject({ pendingCatalogSources: SOURCES, catalogEnrichmentStatus: {} });
        await expect(Events.countEnrichmentEligible(options)).resolves.toBe(0);
      });

      test('a copied event keeps its MongoDB _id, which comments use', async () => {
        const id = await backend.insertRaw({ publicID: 'ev-copied', OT: at('2026-05-01T08:00:00.000Z'), latitude_value: 14.6, longitude_value: 121 });

        expect(await Events.findRefById(id)).toEqual({ _id: id, publicID: 'ev-copied' });
        expect((await Events.findByPublicID('ev-copied'))._id).toBe(id);
      });
    });
  }
});
