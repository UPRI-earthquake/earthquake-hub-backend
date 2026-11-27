// Seeded events for the significant earthquakes tests, written straight to PostgreSQL. `location` is
// generated from latitude and longitude. Places and distances to the outline of the Philippines:
const PLACES = {
  manila: { latitude: 14.6, longitude: 121.0 }, // inside the outline: 0 km
  cebu: { latitude: 10.3, longitude: 123.9 }, // inside: 0 km
  davao: { latitude: 7.07, longitude: 125.6 }, // inside: 0 km
  // the old "M6.4 Earthquake 388 km S 49° E of Sarangani Island" entry: 363 km from the outline
  offshoreSouth: { latitude: 3.18, longitude: 128.13 },
  tonga: { latitude: -20.0, longitude: -175.0 }, // thousands of km away
};

// A MongoDB-style id from a number, e.g. 6a0000000000000000000001
const legacyId = (n) => `6a${String(n).padStart(22, '0')}`;

const seedEvent = async (db, {
  n, publicID, magnitude, depth = 10, at = 'manila', time = '2026-05-01T00:00:00.000Z', place = null, region = 'Luzon, Philippines', ...rest
}) => {
  const coordinates = at ? PLACES[at] : { latitude: null, longitude: null };
  const [row] = await db('events').insert({
    legacy_mongo_id: legacyId(n),
    public_id: publicID,
    origin_time: new Date(time),
    latitude: coordinates.latitude,
    longitude: coordinates.longitude,
    depth_km: depth,
    magnitude,
    seiscomp_type: 'NEW',
    region_text: region,
    place,
    created_at: new Date('2026-05-02T00:00:00.000Z'),
    updated_at: new Date('2026-05-02T00:00:00.000Z'),
    ...rest,
  }).returning(['id', 'legacy_mongo_id']);
  return { id: row.id, _id: row.legacy_mongo_id.trim() };
};

module.exports = { PLACES, legacyId, seedEvent };
