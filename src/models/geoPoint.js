// GeoJSON Point shared by models that need location queries ($near, $geoWithin) on a 2dsphere index.
// The plain latitude/longitude fields stay the source of truth; `location` is derived from them.
const mongoose = require('mongoose');

const pointSchema = new mongoose.Schema({
  type: { type: String, enum: ['Point'], required: true },
  coordinates: { type: [Number], required: true }, // GeoJSON order: [longitude, latitude]
}, { _id: false });

// Returns a GeoJSON Point, or null when the coordinates are missing or out of range.
// A 2dsphere index rejects the whole write for an invalid point, so callers must
// leave `location` unset instead of storing a bad one.
function toGeoPoint(latitude, longitude) {
  const lat = Number(latitude);
  const lon = Number(longitude);
  if (latitude == null || longitude == null || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { type: 'Point', coordinates: [lon, lat] };
}

module.exports = { pointSchema, toGeoPoint };
