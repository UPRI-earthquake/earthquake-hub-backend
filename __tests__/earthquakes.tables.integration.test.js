// The rules the earthquake tables (events, event_stations, event_catalog_matches, event_catalog_status)
// enforce on every write, on a real PostgreSQL. In MongoDB nothing tied an event's station codes to
// real devices.
const { startPostgres, PG_STARTUP_TIMEOUT_MS } = require('./fixtures/postgres.fixture');

describe('earthquake tables', () => {
  let pg;

  beforeAll(async () => {
    pg = await startPostgres();
  }, PG_STARTUP_TIMEOUT_MS);

  afterEach(() => pg.clear());

  afterAll(async () => {
    if (pg) await pg.stop();
  });

  const insertEvent = async (fields = {}) => {
    const [row] = await pg.db('events').insert({
      public_id: 'upri2026jabc',
      origin_time: new Date('2026-05-01T08:00:00.000Z'),
      latitude: 14.67,
      longitude: 121.06,
      depth_km: 10,
      magnitude: 4.5,
      ...fields,
    }).returning('*');
    return row;
  };

  const insertDevice = async (fields = {}) => {
    const [row] = await pg.db('devices').insert({
      network: 'AM', station: 'R3B2D', latitude: 14.65, longitude: 121.07, elevation_m: 50, ...fields,
    }).returning('*');
    return row;
  };

  const location = async (id) => {
    const { rows: [point] } = await pg.db.raw(
      'SELECT ST_X(location::geometry) AS lon, ST_Y(location::geometry) AS lat FROM events WHERE id = ?', [id],
    );
    return point.lon === null ? null : [point.lon, point.lat];
  };

  const count = async (table) => Number((await pg.db(table).count({ n: '*' }).first()).n);

  describe('events', () => {
    test('a new event gets defaults: current catalog, not legacy, recording pending, no attempts', async () => {
      const event = await insertEvent();

      expect(event).toMatchObject({
        source_catalog: 'upri-current', is_legacy_record: false, recording_status: 'pending', recording_attempts: 0, legacy_mongo_id: null,
      });
      expect(event.id).toMatch(/^[0-9a-f-]{36}$/);
    });

    test('rejects a second event with the same public_id', async () => {
      await insertEvent();

      await expect(insertEvent({ magnitude: 4.8 })).rejects.toThrow(/events_public_id_unique/);
    });

    test('location follows the coordinates, and is null when they are missing or out of range', async () => {
      const valid = await insertEvent();
      const outOfRange = await insertEvent({ public_id: 'ev-out', latitude: 95 });
      const missing = await insertEvent({ public_id: 'ev-missing', latitude: null, longitude: null });

      expect(await location(valid.id)).toEqual([121.06, 14.67]);
      expect(await location(outOfRange.id)).toBeNull();
      expect(await location(missing.id)).toBeNull();
      expect((await pg.db('events').where({ id: outOfRange.id }).first()).latitude).toBe(95);

      await pg.db('events').where({ id: outOfRange.id }).update({ latitude: 14 });
      expect(await location(outOfRange.id)).toEqual([121.06, 14]);
    });

    test.each([
      ['a blank public_id', { public_id: '  ' }, /events_public_id_not_blank/],
      ['negative recording attempts', { recording_attempts: -1 }, /events_recording_attempts_not_negative/],
      ['an unknown recording status', { recording_status: 'maybe' }, /invalid input value for enum recording_status/],
      ['a summary edit time without text', { summary_override_edited_at: new Date() }, /events_summary_override_has_text/],
    ])('rejects %s', async (label, fields, error) => {
      await expect(insertEvent(fields)).rejects.toThrow(error);
    });

    test('updated_at moves on every update', async () => {
      const event = await insertEvent({ updated_at: new Date('2026-01-01T00:00:00.000Z') });

      await pg.db('events').where({ id: event.id }).update({ magnitude: 4.6 });

      expect((await pg.db('events').where({ id: event.id }).first()).updated_at.getTime()).toBeGreaterThan(Date.parse('2026-06-01'));
    });
  });

  describe('event_stations', () => {
    test('links an event to real devices, in order, as candidates or recording stations', async () => {
      const event = await insertEvent();
      const near = await insertDevice();
      const far = await insertDevice({ station: 'RE722', latitude: 16.4, longitude: 120.6 });

      await pg.db('event_stations').insert([
        { event_id: event.id, device_id: near.id, kind: 'candidate', position: 0 },
        { event_id: event.id, device_id: far.id, kind: 'candidate', position: 1 },
        { event_id: event.id, device_id: near.id, kind: 'recording', position: 0 },
      ]);

      const rows = await pg.db('event_stations AS s').join('devices AS d', 'd.id', 's.device_id')
        .where({ event_id: event.id }).orderBy(['kind', 'position']).select('s.kind', 'd.station');
      expect(rows).toEqual([
        { kind: 'candidate', station: 'R3B2D' },
        { kind: 'candidate', station: 'RE722' },
        { kind: 'recording', station: 'R3B2D' },
      ]);
    });

    test('rejects a station that is not a real device', async () => {
      const event = await insertEvent();

      await expect(pg.db('event_stations').insert({ event_id: event.id, device_id: '01890000-0000-7000-8000-000000000000', kind: 'candidate', position: 0 }))
        .rejects.toThrow(/event_stations_device_id_foreign/);
    });

    test('rejects the same station twice in one list, and two stations at one position', async () => {
      const event = await insertEvent();
      const near = await insertDevice();
      const far = await insertDevice({ station: 'RE722' });
      await pg.db('event_stations').insert({ event_id: event.id, device_id: near.id, kind: 'candidate', position: 0 });

      await expect(pg.db('event_stations').insert({ event_id: event.id, device_id: near.id, kind: 'candidate', position: 1 }))
        .rejects.toThrow(/event_stations_pkey/);
      await expect(pg.db('event_stations').insert({ event_id: event.id, device_id: far.id, kind: 'candidate', position: 0 }))
        .rejects.toThrow(/event_stations_event_id_kind_position_unique/);
    });

    test('a device listed on an earthquake cannot be deleted', async () => {
      const event = await insertEvent();
      const device = await insertDevice();
      await pg.db('event_stations').insert({ event_id: event.id, device_id: device.id, kind: 'recording', position: 0 });

      await expect(pg.db('devices').where({ id: device.id }).del()).rejects.toThrow(/event_stations_device_id_foreign/);
      expect(await count('devices')).toBe(1);
    });
  });

  describe('event_catalog_matches and event_catalog_status', () => {
    test('one match per catalog per event; unknown upstream keys kept in extra', async () => {
      const event = await insertEvent();
      const [match] = await pg.db('event_catalog_matches').insert({
        event_id: event.id, source: 'usgs', title: 'M 4.6 - 10 km NNE of Quezon City', depth_km: 12, match_quality: 'high', extra: { network: 'us' },
      }).returning('*');

      expect(match).toMatchObject({ source: 'usgs', depth_km: 12, extra: { network: 'us' }, raw: null });
      await expect(pg.db('event_catalog_matches').insert({ event_id: event.id, source: 'usgs' }))
        .rejects.toThrow(/event_catalog_matches_event_id_source_unique/);
      await expect(pg.db('event_catalog_matches').insert({ event_id: event.id, source: 'upri-legacy', title: 'old catalog' })).resolves.toBeDefined();
    });

    test('status rows only for the catalogs the job searches, one per catalog, pending by default', async () => {
      const event = await insertEvent();
      await pg.db('event_catalog_status').insert({ event_id: event.id, source: 'phivolcs' });

      expect(await pg.db('event_catalog_status').where({ event_id: event.id }).first()).toMatchObject({ status: 'pending', attempts: 0 });
      await expect(pg.db('event_catalog_status').insert({ event_id: event.id, source: 'phivolcs' })).rejects.toThrow(/event_catalog_status_pkey/);
      await expect(pg.db('event_catalog_status').insert({ event_id: event.id, source: 'upri-legacy' })).rejects.toThrow(/event_catalog_status_searched_source/);
      await expect(pg.db('event_catalog_status').insert({ event_id: event.id, source: 'usgs', status: 'maybe' })).rejects.toThrow(/enrichment_status/);
    });
  });

  test('deleting an event deletes its stations, matches and status, and unlinks its significant earthquake', async () => {
    const event = await insertEvent();
    const device = await insertDevice();
    await pg.db('event_stations').insert({ event_id: event.id, device_id: device.id, kind: 'candidate', position: 0 });
    await pg.db('event_catalog_matches').insert({ event_id: event.id, source: 'phivolcs' });
    await pg.db('event_catalog_status').insert([{ event_id: event.id, source: 'phivolcs', status: 'done' }, { event_id: event.id, source: 'usgs' }]);
    const [significant] = await pg.db('significant_eqs').insert({
      event_id: event.id, title: 'Magnitude 4.5, Quezon City', magnitude: 4.5, latitude: 14.67, longitude: 121.06, event_time: new Date('2026-05-01T08:00:00.000Z'),
    }).returning('*');

    await pg.db('events').where({ id: event.id }).del();

    expect([await count('event_stations'), await count('event_catalog_matches'), await count('event_catalog_status')]).toEqual([0, 0, 0]);
    expect(await count('devices')).toBe(1);
    expect((await pg.db('significant_eqs').where({ id: significant.id }).first()).event_id).toBeNull();
  });

  test('a significant earthquake can only link to an existing event', async () => {
    await expect(pg.db('significant_eqs').insert({
      event_id: '01890000-0000-7000-8000-000000000000', title: 'Unknown', magnitude: 5, latitude: 14, longitude: 121, event_time: new Date(),
    })).rejects.toThrow(/significant_eqs_event_id_foreign/);
  });
});
