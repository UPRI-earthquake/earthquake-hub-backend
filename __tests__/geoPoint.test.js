const { toGeoPoint } = require('../src/models/geoPoint');

describe('toGeoPoint', () => {
  it('builds a GeoJSON point in [longitude, latitude] order', () => {
    expect(toGeoPoint(14.6, 121.0)).toEqual({ type: 'Point', coordinates: [121.0, 14.6] });
  });

  it('accepts numeric strings and the range boundaries', () => {
    expect(toGeoPoint('-90', '180')).toEqual({ type: 'Point', coordinates: [180, -90] });
  });

  it.each([
    ['missing latitude', null, 121],
    ['missing longitude', 14.6, undefined],
    ['latitude out of range', 95, 121],
    ['longitude out of range', 14.6, -181],
    ['not a number', 'abc', 121],
  ])('returns null for %s', (_label, lat, lon) => {
    expect(toGeoPoint(lat, lon)).toBeNull();
  });
});
