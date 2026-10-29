// Stand-ins for the external services the earthquake code calls, so the golden recordings never depend
// on the network: GeoServe (place names) and FDSN (which stations recorded an event) through axios,
// PHIVOLCS through puppeteer-core (a headless browser), and USGS through fetch.
//
// The test file wires them in (jest.mock factories can only reach them through require):
//   jest.mock('axios', () => ({ get: (...args) => require('./fixtures/earthquakesExternal').axiosGet(...args) }));
//   jest.mock('puppeteer-core', () => ({ launch: async () => require('./fixtures/earthquakesExternal').launchBrowser() }));
// and the fixture replaces global.fetch with usgsFetch.

const ENV = {
  GEOSERVE_HOST: 'geoserve.test',
  GEOSERVE_PORT: '8080',
  FDSNWS_DATASELECT_URL: 'https://fdsn.test/fdsnws/dataselect/1/query',
  FDSNWS_NETWORK: 'AM',
  FDSNWS_LOCATION: '00',
  FDSNWS_CHANNEL: 'EHZ',
  FDSNWS_WINDOW_SECONDS: '30',
};

let geoserveDown = false;
const setGeoserveDown = (down) => { geoserveDown = down; };

// --- GeoServe: the nearest of a few known places ---

const PLACES = [
  { latitude: 14.676, longitude: 121.044, admin1_name: 'Metro Manila', country_name: 'Philippines' },
  { latitude: 7.073, longitude: 125.613, admin1_name: 'Davao Region', country_name: 'Philippines' },
  { latitude: 16.412, longitude: 120.593, admin1_name: 'Cordillera', country_name: 'Philippines' },
];

const geoserve = (url) => {
  const params = new URL(url).searchParams;
  const latitude = Number(params.get('latitude'));
  const longitude = Number(params.get('longitude'));
  if (geoserveDown || !params.get('latitude') || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return Promise.reject(new Error('GeoServe unavailable'));
  }
  const nearest = [...PLACES].sort((a, b) => (
    Math.hypot(a.latitude - latitude, a.longitude - longitude) - Math.hypot(b.latitude - latitude, b.longitude - longitude)
  ))[0];
  return Promise.resolve({
    data: {
      geonames: {
        features: [{
          geometry: { coordinates: [nearest.longitude, nearest.latitude, 0] },
          properties: { admin1_name: nearest.admin1_name, country_name: nearest.country_name },
        }],
      },
    },
  });
};

// --- FDSN dataselect: whether a station has waveform data for an event ---
//   R3B2D always has data, RE722 never does (404), and R0001 can't be reached (network error).
//   For events on 2026-05-09 every lookup fails, as when the FDSN server is down.

const fdsn = (url) => {
  const params = new URL(url).searchParams;
  if (params.get('starttime').startsWith('2026-05-09')) return Promise.reject(new Error('FDSN unreachable'));
  const station = params.get('station');
  if (station === 'R3B2D') return Promise.resolve({ status: 200, data: 'miniseed' });
  if (station === 'R0001') return Promise.reject(new Error('connect ECONNREFUSED'));
  return Promise.resolve({ status: 404, data: '' });
};

const axiosGet = (url) => {
  if (url.includes('/ws/geoserve/')) return geoserve(url);
  if (url.startsWith(ENV.FDSNWS_DATASELECT_URL)) return fdsn(url);
  return Promise.reject(new Error(`Unexpected request in tests: ${url}`));
};

// --- PHIVOLCS: the rows its monthly page lists (only May 2026 has any) ---

const PHIVOLCS_MAY_2026 = [
  {
    dateTime: '01 May 2026 - 04:00 PM',
    detailUrl: 'https://earthquake.phivolcs.dost.gov.ph/2026_Earthquake_Information/May/2026_0501_0800_B1.html',
    hasFeltIntensity: true,
    latitude: 14.68,
    longitude: 121.05,
    depthKm: 10,
    magnitude: 4.4,
    location: '010 km N 45° E of Quezon City (Metro Manila)',
  },
  {
    dateTime: '10 May 2026 - 09:30 AM',
    detailUrl: 'https://earthquake.phivolcs.dost.gov.ph/2026_Earthquake_Information/May/2026_0510_0130_B1.html',
    hasFeltIntensity: false,
    latitude: 6.9,
    longitude: 126.4,
    depthKm: 25,
    magnitude: 5.9,
    location: '045 km S 80° E of Governor Generoso (Davao Oriental)',
  },
];

const launchBrowser = () => {
  let current = '';
  return {
    newPage: async () => ({
      goto: async (url) => { current = url; },
      evaluate: async () => (current.endsWith('/2026/2026_May.html') ? PHIVOLCS_MAY_2026 : []),
    }),
    close: async () => {},
  };
};

// --- USGS event search: by the event the query is centered on ---

const USGS_FEATURES = {
  // Matches the 2026-05-01 Quezon City event
  '2026-05-01T08:00:00.000Z': [{
    id: 'us7000golden',
    geometry: { coordinates: [121.06, 14.66, 12] },
    properties: {
      mag: 4.6,
      time: Date.parse('2026-05-01T08:00:05.000Z'),
      title: 'M 4.6 - 10 km NNE of Quezon City, Philippines',
      place: '10 km NNE of Quezon City, Philippines',
      url: 'https://earthquake.usgs.gov/earthquakes/eventpage/us7000golden',
      detail: 'https://earthquake.usgs.gov/fdsnws/event/1/query?eventid=us7000golden&format=geojson',
    },
  }],
  // Nothing close enough to the 2026-05-03 Davao event
  '2026-05-03T02:00:00.000Z': [{
    id: 'us7000far',
    geometry: { coordinates: [128.9, 2.1, 35] },
    properties: {
      mag: 3.9,
      time: Date.parse('2026-05-03T09:40:00.000Z'),
      title: 'M 3.9 - Talaud Islands, Indonesia',
      place: 'Talaud Islands, Indonesia',
      url: 'https://earthquake.usgs.gov/earthquakes/eventpage/us7000far',
      detail: 'https://earthquake.usgs.gov/fdsnws/event/1/query?eventid=us7000far&format=geojson',
    },
  }],
};
// The 2026-05-09 event's search fails, as when USGS is unreachable
const USGS_DOWN_FOR = '2026-05-09T00:00:00.000Z';

const usgsFetch = async (url) => {
  const params = new URL(String(url)).searchParams;
  const center = new Date(Date.parse(params.get('starttime')) + 12 * 60 * 60 * 1000).toISOString();
  if (center === USGS_DOWN_FOR) throw new Error('fetch failed');
  const features = USGS_FEATURES[center] || [];
  return { ok: true, status: 200, json: async () => ({ type: 'FeatureCollection', features }) };
};

module.exports = {
  ENV,
  axiosGet,
  launchBrowser,
  usgsFetch,
  setGeoserveDown,
};
