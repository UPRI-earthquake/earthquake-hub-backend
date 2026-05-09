const request = require('supertest');
const EQEventsService = require('../src/services/EQevents.service');
const app = require('../src/app');

jest.mock('../src/services/EQevents.service', () => ({
  addPlacesAttribute: jest.fn(),
  getEventByPublicID: jest.fn(),
  getEventsList: jest.fn(),
  updateOnlineStations: jest.fn(),
}));

describe('GET /eq-events/:publicID', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns one event by publicID', async () => {
    const event = {
      publicID: 'upri-event-001',
      OT: new Date('2026-04-02T00:48:00.000Z'),
      latitude_value: 0.85,
      longitude_value: 126.71,
      magnitude_value: 7.3,
    };
    const enrichedEvent = {
      ...event,
      place: '524 km S 16° E of Balut Island',
    };

    EQEventsService.getEventByPublicID.mockResolvedValue(event);
    EQEventsService.addPlacesAttribute.mockResolvedValue([enrichedEvent]);

    const res = await request(app).get('/eq-events/upri-event-001');

    expect(res.status).toBe(200);
    expect(res.body.payload).toMatchObject({
      publicID: 'upri-event-001',
      place: '524 km S 16° E of Balut Island',
    });
    expect(EQEventsService.getEventByPublicID).toHaveBeenCalledWith('upri-event-001');
    expect(EQEventsService.addPlacesAttribute).toHaveBeenCalledWith([event]);
  });

  test('returns 404 when publicID is not found', async () => {
    EQEventsService.getEventByPublicID.mockResolvedValue(null);

    const res = await request(app).get('/eq-events/missing-event');

    expect(res.status).toBe(404);
    expect(res.body.payload).toBeNull();
    expect(res.body.message).toContain('missing-event');
    expect(EQEventsService.addPlacesAttribute).not.toHaveBeenCalled();
  });

  test('returns 400 for invalid publicID', async () => {
    const tooLongPublicID = 'x'.repeat(257);

    const res = await request(app).get(`/eq-events/${tooLongPublicID}`);

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Public ID must be 256 characters or fewer/i);
    expect(EQEventsService.getEventByPublicID).not.toHaveBeenCalled();
  });
});

describe('POST /eq-events/restricted/update-online-stations', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('does not expose the old public maintenance route', async () => {
    const res = await request(app).post('/eq-events/update-online-stations');

    expect(res.status).toBe(404);
    expect(EQEventsService.updateOnlineStations).not.toHaveBeenCalled();
  });

  test('requires an admin session cookie', async () => {
    const res = await request(app).post('/eq-events/restricted/update-online-stations');

    expect(res.status).toBe(403);
    expect(EQEventsService.updateOnlineStations).not.toHaveBeenCalled();
  });
});
