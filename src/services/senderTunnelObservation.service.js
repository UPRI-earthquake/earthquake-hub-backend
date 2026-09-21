const Device = require('../models/device.model');
const SenderTunnelObservation = require('../models/senderTunnelObservation.model');

const MAX_AGE_MS = 5 * 60 * 1000;
function text(value, max) { const normalized = String(value || '').trim(); return normalized ? normalized.slice(0, max) : null; }
function validDate(value) { const date = new Date(value); return Number.isNaN(date.getTime()) ? null : date; }
function deviceId(device) { return `${String(device.network || '').toUpperCase()}_${String(device.station || '').toUpperCase()}`; }
function parseDetails(details = {}) {
  if (!details || typeof details !== 'object' || Array.isArray(details)
    || Object.keys(details).some((key) => !['source', 'connected', 'remotePort', 'stateUpdatedAt', 'lastConnectedAt', 'errorCode', 'errorMessage'].includes(key))
    || details.source !== 'sender-remote-tunnel-state'
    || typeof details.connected !== 'boolean') throw Object.assign(new Error('Invalid sender tunnel observation.'), { statusCode: 400 });
  const remotePort = details.remotePort === null || details.remotePort === undefined ? null : Number(details.remotePort);
  if (remotePort !== null && (!Number.isInteger(remotePort) || remotePort < 1 || remotePort > 65535)) throw Object.assign(new Error('Invalid sender tunnel remote port.'), { statusCode: 400 });
  const stateUpdatedAt = details.stateUpdatedAt ? validDate(details.stateUpdatedAt) : null;
  const lastConnectedAt = details.lastConnectedAt ? validDate(details.lastConnectedAt) : null;
  if ((details.stateUpdatedAt && !stateUpdatedAt) || (details.lastConnectedAt && !lastConnectedAt)) throw Object.assign(new Error('Invalid sender tunnel observation timestamp.'), { statusCode: 400 });
  return { connected: details.connected, remotePort, senderStateUpdatedAt: stateUpdatedAt, senderLastConnectedAt: lastConnectedAt, errorCode: text(details.errorCode, 64), errorMessage: text(details.errorMessage, 280) };
}
async function resolveDevice(identity = {}) {
  if (identity.network && identity.station) return Device.findOne({ network: String(identity.network).toUpperCase(), station: String(identity.station).toUpperCase() }).lean();
  if (identity.streamId) return Device.findOne({ streamId: String(identity.streamId) }).lean();
  if (identity.macAddress) return Device.findOne({ macAddress: String(identity.macAddress) }).lean();
  return null;
}
async function record({ device, occurredAt, details }) {
  const parsed = parseDetails(details);
  const resolved = await resolveDevice(device);
  if (!resolved) throw Object.assign(new Error('Sender tunnel observation device is not registered.'), { statusCode: 404 });
  const senderReportedAt = validDate(occurredAt);
  if (!senderReportedAt) throw Object.assign(new Error('Invalid sender report timestamp.'), { statusCode: 400 });
  const now = new Date();
  const updated = await SenderTunnelObservation.findOneAndUpdate({ deviceId: deviceId(resolved) }, { $set: { ...parsed, senderReportedAt, receivedAt: now } }, { upsert: true, new: true, runValidators: true }).lean();
  return serialize(updated, now);
}
function serialize(row, now = new Date()) {
  if (!row) return { state: 'not_reported', connected: null, receivedAt: null, message: 'No sender tunnel-state report has been received.' };
  const ageMs = now.getTime() - new Date(row.receivedAt).getTime();
  if (!Number.isFinite(ageMs) || ageMs > MAX_AGE_MS) return { state: 'stale', connected: null, receivedAt: row.receivedAt, message: 'The last sender tunnel-state report is stale.' };
  return { state: row.connected ? 'sender_reported_connected' : 'sender_reported_disconnected', connected: row.connected, remotePort: row.remotePort ?? null, receivedAt: row.receivedAt, senderStateUpdatedAt: row.senderStateUpdatedAt || null, senderLastConnectedAt: row.senderLastConnectedAt || null, errorCode: row.errorCode || null, errorMessage: row.errorMessage || null, message: row.connected ? 'The sender reported its local wstunnel process connected.' : 'The sender reported its local wstunnel process disconnected.' };
}
async function getForDevice(deviceIdValue, now = new Date()) { return serialize(await SenderTunnelObservation.findOne({ deviceId: String(deviceIdValue).toUpperCase() }).lean(), now); }
module.exports = { MAX_AGE_MS, getForDevice, parseDetails, record, serialize };
