const axios = require('axios');
const EQEvents = require('../src/models/events.model');
const EQEventsService = require('../src/services/EQevents.service');

jest.mock('axios');
jest.mock('../src/models/events.model', () => ({
  updateOne: jest.fn(),
}));

describe('GeoServe place persistence', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.GEOSERVE_HOST = 'geoserve-ws';
    process.env.GEOSERVE_PORT = '80';
  });

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
    expect(EQEvents.updateOne).toHaveBeenCalledWith(
      {
        _id: 'event-id',
        $or: expect.any(Array),
      },
      {
        $set: {
          place: '0 km SW of Metro Manila, Philippines',
        },
      },
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
    expect(EQEvents.updateOne).not.toHaveBeenCalled();
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
    expect(EQEvents.updateOne).toHaveBeenCalledWith(
      {
        _id: 'event-id',
        $or: expect.any(Array),
      },
      {
        $set: {
          place: '0 km SW of Metro Manila, Philippines',
        },
      },
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
