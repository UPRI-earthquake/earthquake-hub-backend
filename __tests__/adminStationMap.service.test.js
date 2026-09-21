jest.mock('../src/models/device.model', () => ({ find: jest.fn() }));
const Device = require('../src/models/device.model');
const { getSnapshot, coordinate, MAX_STATIONS } = require('../src/services/adminStationMap.service');

test('map snapshot is bounded, projects safe registry evidence and flags missing coordinates', async () => {
  const chain = { sort: jest.fn().mockReturnThis(), limit: jest.fn().mockReturnThis(), select: jest.fn().mockReturnThis(), lean: jest.fn().mockResolvedValue([
    { network: 'AM', station: 'ONE', latitude: '14.6', longitude: '121', activity: 'active', macAddress: 'must-not-leak' },
    { network: 'AM', station: 'TWO', latitude: '', longitude: null },
  ]) };
  Device.find.mockReturnValue(chain);
  const result = await getSnapshot();
  expect(chain.limit).toHaveBeenCalledWith(MAX_STATIONS + 1);
  expect(result.stations[0]).toMatchObject({ deviceId: 'AM_ONE', latitude: 14.6, longitude: 121, activity: 'active' });
  expect(result.stations[0]).not.toHaveProperty('macAddress');
  expect(result.missingCoordinates).toBe(1);
  expect(result.scope).toContain('not current connectivity');
  expect(result.truncated).toBe(false);
});
test('coordinates retain zero and reject missing/out-of-range values', () => {
  expect(coordinate(0, 90)).toBe(0);
  for (const value of [null, undefined, '', 'garbage', 91, Infinity]) expect(coordinate(value, 90)).toBeNull();
});

test('map truncation is explicit and response remains bounded', async () => {
  const chain = { sort: jest.fn().mockReturnThis(), limit: jest.fn().mockReturnThis(), select: jest.fn().mockReturnThis(), lean: jest.fn().mockResolvedValue(Array.from({ length: MAX_STATIONS + 1 }, (_, index) => ({ network: 'XX', station: String(index), latitude: 0, longitude: 0 }))) };
  Device.find.mockReturnValue(chain);
  const result = await getSnapshot();
  expect(result.stations).toHaveLength(MAX_STATIONS);
  expect(result.truncated).toBe(true);
});
