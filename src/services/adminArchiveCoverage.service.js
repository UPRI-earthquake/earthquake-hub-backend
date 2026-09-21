function invalid() { return Object.assign(new Error('invalid_coverage_observation'), { code: 'invalid_response' }); }
function validateCoverageSnapshot(input, now = Date.now()) {
  const observedAt = Date.parse(input?.observedAt);
  const start = Date.parse(input?.window?.start);
  const end = Date.parse(input?.window?.end);
  if (input?.schemaVersion !== 1 || input?.source !== 'fdsn-availability-index' || input?.lastScanAt !== null
    || !Number.isFinite(observedAt) || observedAt > now || !Number.isFinite(start) || !Number.isFinite(end)
    || start >= end || end > observedAt || end - start > 86400_000
    || !Array.isArray(input.channels) || input.channels.length < 1 || input.channels.length > 32) throw invalid();
  const ids = new Set();
  const channels = input.channels.map((row) => {
    if (!/^[A-Z0-9]{1,8}\.[A-Z0-9]{1,8}\.(?:[A-Z0-9]{1,8}|--)\.[A-Z0-9]{1,8}$/.test(row?.id || '')
      || ids.has(row.id) || !Array.isArray(row.intervals) || row.intervals.length > 256) throw invalid();
    ids.add(row.id);
    let previousEnd = null;
    const intervals = row.intervals.map((interval) => {
      if (!Array.isArray(interval) || interval.length !== 2) throw invalid();
      const left = Date.parse(interval[0]); const right = Date.parse(interval[1]);
      if (!Number.isFinite(left) || !Number.isFinite(right) || left < start || right > end || left >= right
        || (previousEnd !== null && left <= previousEnd)) throw invalid();
      previousEnd = right;
      return [new Date(left).toISOString(), new Date(right).toISOString()];
    });
    return { id: row.id, intervals };
  });
  return { schemaVersion: 1, source: input.source, observedAt: new Date(observedAt).toISOString(), lastScanAt: null,
    window: { start: new Date(start).toISOString(), end: new Date(end).toISOString() }, channels,
    stale: now - observedAt > 900_000, staleAfterMs: 900_000 };
}
function archiveCoverageEvidence(telemetry, now = Date.now()) {
  try {
    if (!['available', 'degraded'].includes(telemetry?.status)) throw invalid();
    const data = validateCoverageSnapshot(telemetry.data, now);
    const start = Date.parse(data.window.start);
    const end = Date.parse(data.window.end);
    return { ...data, state: data.stale ? 'stale' : 'observed', scope: 'Availability index only; last archive scan unknown',
      channels: data.channels.map((channel) => {
        let cursor = start;
        const gaps = [];
        for (const [leftText, rightText] of channel.intervals) {
          const left = Date.parse(leftText); const right = Date.parse(rightText);
          if (left > cursor) gaps.push({ start: new Date(cursor).toISOString(), end: leftText, durationSeconds: (left - cursor) / 1000 });
          cursor = right;
        }
        if (cursor < end) gaps.push({ start: new Date(cursor).toISOString(), end: data.window.end, durationSeconds: (end - cursor) / 1000 });
        return { ...channel, gaps, state: !channel.intervals.length ? 'no_indexed_data' : gaps.length ? 'partial_indexed' : 'fully_indexed' };
      }),
    };
  } catch {
    return { state: telemetry?.errorCode === 'not_configured' ? 'not_configured' : 'unknown', source: 'fdsn-availability-index', observedAt: null, lastScanAt: null, channels: [], stale: false };
  }
}
module.exports = { archiveCoverageEvidence };
