const { _test } = require('../src/services/EQevents.service');

describe('EQevents recording availability refinement', () => {
  test('keeps candidate stations visible when FDSN has no data during the grace period', () => {
    const now = Date.parse('2026-06-17T02:10:00.000Z');
    const event = {
      OT: new Date('2026-06-17T02:00:00.000Z'),
      onlineStations: ['R24FA', 'r47bc'],
      recordingAvailabilityAttempts: 0,
    };

    const availability = _test.buildRecordingAvailabilityUpdate(event, {
      onlineStations: [],
    }, now);

    expect(availability.recordingAvailabilityStatus).toBe('pending');
    expect(availability.candidateStations).toEqual(['R24FA', 'R47BC']);
    expect(availability.recordingStations).toEqual([]);
    expect(availability.onlineStations).toEqual(['R24FA', 'R47BC']);
    expect(availability.shouldRetry).toBe(true);
  });

  test('uses verified recording stations after the grace period when some are confirmed', () => {
    const now = Date.parse('2026-06-17T03:00:00.000Z');
    const event = {
      OT: new Date('2026-06-17T02:00:00.000Z'),
      candidateStations: ['R24FA', 'R47BC'],
      recordingAvailabilityAttempts: 1,
    };

    const availability = _test.buildRecordingAvailabilityUpdate(event, {
      onlineStations: ['r24fa'],
    }, now);

    expect(availability.recordingAvailabilityStatus).toBe('partial');
    expect(availability.recordingStations).toEqual(['R24FA']);
    expect(availability.onlineStations).toEqual(['R24FA']);
  });

  test('marks unavailable only after the grace period when no FDSN recordings are confirmed', () => {
    const now = Date.parse('2026-06-17T03:00:00.000Z');
    const event = {
      OT: new Date('2026-06-17T02:00:00.000Z'),
      candidateStations: ['R24FA'],
      recordingAvailabilityAttempts: 1,
    };

    const availability = _test.buildRecordingAvailabilityUpdate(event, {
      onlineStations: [],
    }, now);

    expect(availability.recordingAvailabilityStatus).toBe('unavailable');
    expect(availability.onlineStations).toEqual([]);
    expect(availability.shouldRetry).toBe(false);
  });
});
