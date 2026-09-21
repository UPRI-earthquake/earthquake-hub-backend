jest.mock('../src/models/device.model', () => ({ findOne: jest.fn() }));
jest.mock('../src/models/senderTunnelObservation.model', () => ({ findOne: jest.fn(), findOneAndUpdate: jest.fn() }));
const Device = require('../src/models/device.model');
const Observation = require('../src/models/senderTunnelObservation.model');
const service = require('../src/services/senderTunnelObservation.service');
const lean = (value) => ({ lean: jest.fn().mockResolvedValue(value) });
beforeEach(() => jest.clearAllMocks());
test('records only a registered station’s validated sender tunnel state', async () => {
  Device.findOne.mockReturnValue(lean({ network: 'AM', station: 'ABC1' }));
  Observation.findOneAndUpdate.mockReturnValue(lean({ deviceId: 'AM_ABC1', connected: true, remotePort: 22501, receivedAt: new Date(), senderReportedAt: new Date(), senderStateUpdatedAt: new Date() }));
  const result = await service.record({ device: { network: 'AM', station: 'ABC1' }, occurredAt: '2026-09-18T00:00:00Z', details: { source: 'sender-remote-tunnel-state', connected: true, remotePort: 22501, stateUpdatedAt: '2026-09-18T00:00:00Z' } });
  expect(result.state).toBe('sender_reported_connected');
  expect(Observation.findOneAndUpdate).toHaveBeenCalledWith({ deviceId: 'AM_ABC1' }, expect.any(Object), expect.objectContaining({ upsert: true }));
});
test('rejects unbounded or untrusted tunnel report details', () => {
  expect(() => service.parseDetails({ source: 'sender-remote-tunnel-state', connected: true, wssUrl: 'wss://secret' })).toThrow('Invalid sender tunnel observation.');
  expect(() => service.parseDetails({ source: 'sender-remote-tunnel-state', connected: true, remotePort: 70000 })).toThrow('Invalid sender tunnel remote port.');
});
