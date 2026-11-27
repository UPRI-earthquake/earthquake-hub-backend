const axios = require('axios');
const EventsRepo = require('../src/repositories/events.repo');
const EQEventsService = require('../src/services/EQevents.service');

jest.mock('axios');
jest.mock('../src/repositories/events.repo', () => ({
  savePlace: jest.fn(),
}));

const GEONAMES = {
  data: {
    geonames: {
      features: [{
        geometry: { coordinates: [121.0, 14.6, 0] },
        properties: { admin1_name: 'Metro Manila', country_name: 'Philippines' },
      }],
    },
  },
};
const unplaced = (n) => Array.from({ length: n }, (_, i) => ({
  _id: `event-${i}`, publicID: `upri-event-${i}`, latitude_value: 14.6, longitude_value: 121.0, place: '',
}));

beforeEach(() => {
  jest.clearAllMocks();
  process.env.GEOSERVE_HOST = 'geoserve-ws';
  process.env.GEOSERVE_PORT = '80';
  EQEventsService._test.resetGeoserveLookups();
});

describe('GeoServe lookups: a few at a time, paused while GeoServe is unreachable', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('at most 2 requests run at once', async () => {
    let running = 0;
    let most = 0;
    axios.get.mockImplementation(async () => {
      running += 1;
      most = Math.max(most, running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running -= 1;
      return GEONAMES;
    });

    const events = await EQEventsService.addPlacesAttribute(unplaced(10));

    expect(axios.get).toHaveBeenCalledTimes(10);
    expect(most).toBe(2);
    expect(events.map((e) => e.place)).toEqual(Array(10).fill('0 km SW of Metro Manila, Philippines'));
  });

  test('after GeoServe is unreachable, the rest are not sent and show "Unavailable"', async () => {
    axios.get.mockRejectedValue(Object.assign(new Error('getaddrinfo EAI_AGAIN geoserve-ws'), { code: 'EAI_AGAIN' }));

    const events = await EQEventsService.addPlacesAttribute(unplaced(10));

    expect(axios.get).toHaveBeenCalledTimes(2); // the two already running
    expect(events.map((e) => e.place)).toEqual(Array(10).fill('Unavailable'));
    expect(EventsRepo.savePlace).not.toHaveBeenCalled();
  });

  test('GeoServe is tried again once the pause is over', async () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
    axios.get.mockRejectedValueOnce(new Error('timeout of 3000ms exceeded'));
    await EQEventsService.addPlacesAttribute(unplaced(1));

    axios.get.mockResolvedValue(GEONAMES);
    now.mockReturnValue(1_000_000 + 59_000);
    expect((await EQEventsService.addPlacesAttribute(unplaced(1)))[0].place).toBe('Unavailable');
    now.mockReturnValue(1_000_000 + 60_000);
    expect((await EQEventsService.addPlacesAttribute(unplaced(1)))[0].place).toBe('0 km SW of Metro Manila, Philippines');
    expect(axios.get).toHaveBeenCalledTimes(2);
  });

  test('an error response (GeoServe answered) does not pause the lookups', async () => {
    axios.get.mockRejectedValueOnce(Object.assign(new Error('Request failed with status code 400'), { response: { status: 400 } }));
    axios.get.mockResolvedValue(GEONAMES);

    const [first] = await EQEventsService.addPlacesAttribute(unplaced(1));
    const [second] = await EQEventsService.addPlacesAttribute(unplaced(1));

    expect(first.place).toBe('Unavailable');
    expect(second.place).toBe('0 km SW of Metro Manila, Philippines');
  });
});

describe('GeoServe place persistence', () => {

  test('persists computed GeoServe place for events with missing place', async () => {
    axios.get.mockResolvedValue({
      data: {
        geonames: {
          features: [
            {
              geometry: {
                coordinates: [121.0, 14.6, 0],
              },
              properties: {
                admin1_name: 'Metro Manila',
                country_name: 'Philippines',
              },
            },
          ],
        },
      },
    });

    const [event] = await EQEventsService.addPlacesAttribute([
      {
        _id: 'event-id',
        publicID: 'upri-event-001',
        latitude_value: 14.6,
        longitude_value: 121.0,
        place: '',
      },
    ]);

    expect(event.place).toBe('0 km SW of Metro Manila, Philippines');
    expect(EventsRepo.savePlace).toHaveBeenCalledWith(
      expect.objectContaining({ _id: 'event-id', publicID: 'upri-event-001' }),
      '0 km SW of Metro Manila, Philippines',
    );
  });

  test('does not call GeoServe or persist when event already has a place', async () => {
    const [event] = await EQEventsService.addPlacesAttribute([
      {
        _id: 'event-id',
        publicID: 'upri-event-001',
        latitude_value: 14.6,
        longitude_value: 121.0,
        place: 'Existing place',
      },
    ]);

    expect(event.place).toBe('Existing place');
    expect(axios.get).not.toHaveBeenCalled();
    expect(EventsRepo.savePlace).not.toHaveBeenCalled();
  });

  test('retries GeoServe and persists when place is a placeholder value', async () => {
    axios.get.mockResolvedValue({
      data: {
        geonames: {
          features: [
            {
              geometry: {
                coordinates: [121.0, 14.6, 0],
              },
              properties: {
                admin1_name: 'Metro Manila',
                country_name: 'Philippines',
              },
            },
          ],
        },
      },
    });

    const [event] = await EQEventsService.addPlacesAttribute([
      {
        _id: 'event-id',
        publicID: 'upri-event-001',
        latitude_value: 14.6,
        longitude_value: 121.0,
        place: 'Unavailable',
      },
    ]);

    expect(event.place).toBe('0 km SW of Metro Manila, Philippines');
    expect(axios.get).toHaveBeenCalledTimes(1);
    expect(EventsRepo.savePlace).toHaveBeenCalledWith(
      expect.objectContaining({ _id: 'event-id', publicID: 'upri-event-001' }),
      '0 km SW of Metro Manila, Philippines',
    );
  });
});

describe('GeoServe place cache invalidation', () => {
  test('keeps cached place when updated coordinates only move slightly', () => {
    const shouldRefresh = EQEventsService._test.hasMeaningfulCoordinateChange(
      {
        latitude_value: 14.6,
        longitude_value: 121.0,
        place: '0 km SW of Metro Manila, Philippines',
      },
      14.6001,
      121.0001,
    );

    expect(shouldRefresh).toBe(false);
  });

  test('refreshes cached place when updated coordinates move beyond the threshold', () => {
    const shouldRefresh = EQEventsService._test.hasMeaningfulCoordinateChange(
      {
        latitude_value: 14.6,
        longitude_value: 121.0,
        place: '0 km SW of Metro Manila, Philippines',
      },
      14.7,
      121.1,
    );

    expect(shouldRefresh).toBe(true);
  });

  test('does not refresh when existing place is already missing or unusable', () => {
    const shouldRefresh = EQEventsService._test.hasMeaningfulCoordinateChange(
      {
        latitude_value: 14.6,
        longitude_value: 121.0,
        place: '',
      },
      14.7,
      121.1,
    );

    expect(shouldRefresh).toBe(false);
  });
});
