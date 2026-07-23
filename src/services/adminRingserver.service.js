const axios = require('axios');

class RingserverMonitoringError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'RingserverMonitoringError';
    this.cause = cause;
  }
}

function ringserverBaseUrl() {
  const host = String(process.env.RINGSERVER_HOST || '').trim();
  const port = String(process.env.RINGSERVER_PORT || '').trim();
  if (!host || !port) throw new RingserverMonitoringError('Ringserver monitoring is not configured.');
  return `http://${host}:${port}`;
}

function parseStatus(text) {
  const lines = String(text || '').split(/\r?\n/);
  const fields = {};
  const serverThreads = [];
  let inThreads = false;

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    if (trimmed === 'Server threads:') {
      inThreads = true;
      return;
    }
    if (inThreads) {
      serverThreads.push(trimmed);
      return;
    }
    if (index === 0 && !line.includes(':')) {
      fields.server = trimmed;
      return;
    }
    const separator = line.indexOf(':');
    if (separator > 0) fields[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  });

  return {
    server: fields.server || null,
    organization: fields.Organization || null,
    serverStartTime: fields['Server start time (UTC)'] || null,
    ringVersion: fields['Ring version'] || null,
    ringSizeBytes: fields['Ring size'] || null,
    packetSizeBytes: fields['Packet size'] || null,
    maxPackets: fields['Max packets'] || null,
    memoryMapped: fields['Memory mapped ring'] || null,
    volatileRing: fields['Volatile ring'] || null,
    totalConnections: Number(fields['Total connections']) || 0,
    totalStreams: Number(fields['Total streams']) || 0,
    txPacketRate: fields['TX packet rate'] || null,
    txByteRate: fields['TX byte rate'] || null,
    rxPacketRate: fields['RX packet rate'] || null,
    rxByteRate: fields['RX byte rate'] || null,
    earliestPacket: fields['Earliest packet'] || null,
    latestPacket: fields['Latest packet'] || null,
    serverThreads,
  };
}

function parseStreams(text, limit) {
  return String(text || '').split(/\r?\n/).filter(Boolean).slice(0, limit).map((line) => {
    const [streamId, earliestDataStart, latestDataEnd] = line.trim().split(/\s+/);
    return { streamId, earliestDataStart: earliestDataStart || null, latestDataEnd: latestDataEnd || null };
  });
}

function parseTransferLine(line, direction) {
  const match = String(line || '').match(new RegExp(`^${direction}\\s+(\\d+)\\s+packets,\\s+([\\d.]+)\\s+packets/sec\\s+(\\d+)\\s+bytes,\\s+([\\d.]+)\\s+bytes/sec$`, 'i'));
  if (!match) return {};
  return {
    [`${direction.toLowerCase()}Packets`]: Number(match[1]),
    [`${direction.toLowerCase()}PacketRate`]: Number(match[2]),
    [`${direction.toLowerCase()}Bytes`]: Number(match[3]),
    [`${direction.toLowerCase()}ByteRate`]: Number(match[4]),
  };
}

function parseConnections(text, limit) {
  const blocks = String(text || '').trim().split(/\r?\n\s*\r?\n/);
  return blocks.filter((block) => !/^\d+ of \d+ connections$/m.test(block)).slice(0, limit).map((block, index) => {
    const lines = block.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const first = lines[0] || '';
    const typeLine = lines.find((line) => /^\[.+\]/.test(line)) || '';
    const match = typeLine.match(/^\[([^\]]+)\]\s+(.+?)\s{2,}(.+)$/);
    const streamCount = lines.find((line) => line.startsWith('Stream count:'));
    const packet = lines.find((line) => line.startsWith('Packet '));
    const packetMatch = packet?.match(/^Packet\s+(\S+)\s+\(([^)]+)\)\s+Lag\s+([^,]+)/);
    const txLine = lines.find((line) => line.startsWith('TX '));
    const rxLine = lines.find((line) => line.startsWith('RX '));
    const matchExpression = lines.find((line) => line.startsWith('Match:'));
    const rejectExpression = lines.find((line) => line.startsWith('Reject:'));
    return {
      id: `${first || 'connection'}-${index}`,
      endpoint: first || 'Unknown endpoint',
      protocol: match?.[1] || 'Unknown',
      clientId: match?.[2] || null,
      connectedAt: match?.[3] || null,
      packet: packet?.replace(/^Packet\s+/, '') || null,
      packetId: packetMatch?.[1] || null,
      packetTime: packetMatch?.[2] || null,
      packetLag: packetMatch?.[3]?.trim() || null,
      streamCount: streamCount ? Number(streamCount.replace('Stream count:', '').trim()) || 0 : 0,
      match: matchExpression?.replace(/^Match:\s*/, '') || null,
      reject: rejectExpression?.replace(/^Reject:\s*/, '') || null,
      ...parseTransferLine(txLine, 'TX'),
      ...parseTransferLine(rxLine, 'RX'),
    };
  });
}

async function getSnapshot({ connectionLimit = 100, streamLimit = 200 } = {}) {
  const baseUrl = ringserverBaseUrl();
  try {
    const [statusResponse, connectionsResponse, streamsResponse] = await Promise.all([
      axios.get(`${baseUrl}/status`, { responseType: 'text', timeout: 5000 }),
      axios.get(`${baseUrl}/connections`, { responseType: 'text', timeout: 5000 }),
      axios.get(`${baseUrl}/streams`, { responseType: 'text', timeout: 5000 }),
    ]);
    const status = parseStatus(statusResponse.data);
    const connections = parseConnections(connectionsResponse.data, connectionLimit);
    const streams = parseStreams(streamsResponse.data, streamLimit);
    return {
      observedAt: new Date().toISOString(),
      status,
      summary: {
        activeConnections: status.totalConnections,
        activeStreams: status.totalStreams,
        dataLinkWriters: connections.filter((connection) => connection.protocol.includes('DataLink')).length,
        seedLinkReaders: connections.filter((connection) => connection.protocol.includes('SeedLink')).length,
      },
      connections,
      streams,
      pagination: { connectionLimit, streamLimit, returnedConnections: connections.length, returnedStreams: streams.length },
    };
  } catch (error) {
    throw new RingserverMonitoringError('Unable to retrieve the trusted Ringserver monitoring snapshot.', error);
  }
}

module.exports = { RingserverMonitoringError, getSnapshot, parseConnections, parseStatus, parseStreams };
