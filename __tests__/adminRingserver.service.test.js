const AdminRingserverService = require('../src/services/adminRingserver.service');

describe('Admin Ringserver monitoring parser', () => {
  it('keeps the connection evidence exposed by Ringserver', () => {
    const input = `station.example [203.0.113.9:16000]
  [DataLink] AM_R1382  2026-07-22 08:25:49.623192
  Packet 42 (2026-07-22 08:30:00.000000)  Lag 2.5, 2.5
  TX 10 packets, 1.5 packets/sec  5120 bytes, 768.0 bytes/sec
  RX 20 packets, 2.5 packets/sec  10240 bytes, 1280.0 bytes/sec
  Stream count: 3
  Match: AM_R1382_.*
  Reject: LOG_.*

1 of 1 connections`;

    expect(AdminRingserverService.parseConnections(input, 10)).toEqual([expect.objectContaining({
      endpoint: 'station.example [203.0.113.9:16000]',
      protocol: 'DataLink',
      clientId: 'AM_R1382',
      connectedAt: '2026-07-22 08:25:49.623192',
      packetId: '42',
      packetTime: '2026-07-22 08:30:00.000000',
      packetLag: '2.5',
      streamCount: 3,
      txPackets: 10,
      txPacketRate: 1.5,
      txBytes: 5120,
      txByteRate: 768,
      rxPackets: 20,
      rxPacketRate: 2.5,
      rxBytes: 10240,
      rxByteRate: 1280,
      match: 'AM_R1382_.*',
      reject: 'LOG_.*',
    })]);
  });

  it('parses stream time bounds without inventing channel metadata', () => {
    expect(AdminRingserverService.parseStreams('AM_R1382_00_EHZ/MSEED 2026-07-22T08:00:00 2026-07-22T08:30:00', 10)).toEqual([{
      streamId: 'AM_R1382_00_EHZ/MSEED',
      earliestDataStart: '2026-07-22T08:00:00',
      latestDataEnd: '2026-07-22T08:30:00',
    }]);
  });
});
