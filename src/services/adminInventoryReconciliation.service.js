const SOURCE = 'fdsn-served-station-metadata';
const LIMITS = { latitude: [-90, 90, 0.00001], longitude: [-180, 180, 0.00001], elevation: [-12000, 10000, 0.1] };
function validCoordinates(row) {
  return Object.entries(LIMITS).every(([field, [min, max]]) => Number.isFinite(row?.[field]) && row[field] >= min && row[field] <= max);
}
function reconcileInventory(devices, telemetry, now = Date.now()) {
  const data = telemetry?.data;
  const timestamp = Date.parse(data?.observedAt);
  const ids = new Set();
  const valid = ['available', 'degraded'].includes(telemetry?.status) && data?.schemaVersion === 1
    && data?.source === SOURCE && data?.complete === true && Number.isFinite(timestamp) && timestamp <= now
    && Array.isArray(data.stations) && data.stations.length <= 256 && data.stations.every((row) => {
      const key = `${row?.network}.${row?.station}`;
      if (!/^[A-Z0-9]{1,8}$/.test(row?.network || '') || !/^[A-Z0-9]{1,8}$/.test(row?.station || '')
        || ids.has(key) || typeof row.ambiguous !== 'boolean' || !validCoordinates(row)) return false;
      ids.add(key); return true;
    });
  const stale = Boolean(valid && now - timestamp > 900_000);
  const usable = valid && !stale;
  const inventory = new Map(usable ? data.stations.map((row) => [`${row.network}.${row.station}`, row]) : []);
  return {
    state: valid ? stale ? 'stale' : 'observed' : telemetry?.errorCode === 'not_configured' ? 'not_configured' : 'unknown',
    observedAt: valid ? new Date(timestamp).toISOString() : null, source: SOURCE, stale,
    comparedAt: new Date(now).toISOString(),
    scope: 'Current FDSN-served station identity and coordinates versus hub registration; excludes responses and bindings',
    stations: devices.map((device) => {
      const network = String(device.network || '').toUpperCase();
      const station = String(device.station || '').toUpperCase();
      const row = inventory.get(`${network}.${station}`);
      const identityValid = /^[A-Z0-9]{1,8}$/.test(network) && /^[A-Z0-9]{1,8}$/.test(station);
      const differences = row && !row.ambiguous && validCoordinates(device)
        ? Object.entries(LIMITS).filter(([field, [, , tolerance]]) => Math.abs(device[field] - row[field]) > tolerance + Number.EPSILON * 1024).map(([field]) => field) : [];
      const state = !usable || !identityValid ? 'unknown' : !row ? 'missing'
        : row.ambiguous || !validCoordinates(device) ? 'unknown' : differences.length ? 'different' : 'synced';
      return { id: `${network}_${station}`, state, inventoryState: !usable || !identityValid ? 'unknown' : row ? 'present' : 'missing',
        differences, reason: !usable ? stale ? 'stale_evidence' : 'source_unavailable' : !identityValid ? 'invalid_identity'
          : row?.ambiguous ? 'ambiguous_epochs' : row && !validCoordinates(device) ? 'incomplete_hub_metadata' : 'compared_fields',
        observedAt: valid ? new Date(timestamp).toISOString() : null };
    }),
  };
}
module.exports = { reconcileInventory };
