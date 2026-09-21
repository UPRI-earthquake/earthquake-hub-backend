function runtimeEvidence(telemetry, now = Date.now()) {
  const unavailable = { state: telemetry?.errorCode === 'not_configured' ? 'not_configured' : 'unknown', observedAt: null, source: 'seiscomp-pid-executable', modules: [], stale: false };
  const data = telemetry?.data;
  const observedAt = Date.parse(data?.observedAt);
  if (!['available', 'degraded'].includes(telemetry?.status) || data?.schemaVersion !== 1
    || data?.source !== 'seiscomp-pid-executable' || !Number.isFinite(observedAt) || observedAt > now
    || !Array.isArray(data.modules) || data.modules.length > 64) return unavailable;
  const ids = new Set();
  const valid = data.modules.every((module) => {
    if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(module?.id || '') || ids.has(module.id)
      || typeof module.enabled !== 'boolean' || !['running', 'not_running', 'unknown'].includes(module.state)
      || !['observed', 'derived', 'unknown'].includes(module.kind)
      || (module.state === 'running' && module.kind !== 'observed')) return false;
    ids.add(module.id);
    return true;
  });
  if (!valid) return unavailable;
  const stale = now - observedAt > 90_000;
  return { state: stale ? 'stale' : data.modules.some((module) => module.state === 'unknown') ? 'partial' : 'observed',
    observedAt: new Date(observedAt).toISOString(), source: data.source, stale,
    modules: data.modules.map((module) => ({ id: module.id, enabled: module.enabled, state: stale ? 'unknown' : module.state, lastObservedState: module.state, kind: stale ? 'unknown' : module.kind })),
  };
}
module.exports = { runtimeEvidence };
