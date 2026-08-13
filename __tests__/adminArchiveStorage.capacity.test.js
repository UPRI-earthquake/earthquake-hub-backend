const { archiveCapacity, formatCapacity } = require('../src/services/adminArchiveStorage.service');

describe('admin archive capacity normalization', () => {
  it('keeps only bounded numeric capacity data for the admin summary', () => {
    expect(archiveCapacity({
      totalBytes: 1024 * 1024 * 100,
      availableBytes: 1024 * 1024 * 24,
      usedBytes: 1024 * 1024 * 76,
      usedPercent: 76,
      path: '/private/archive',
      remoteSource: 'operator@storage-host:/data',
    })).toEqual({
      totalBytes: 104857600,
      availableBytes: 25165824,
      usedBytes: 79691776,
      usedPercent: 76,
    });
  });

  it('rejects incomplete or impossible capacity data', () => {
    expect(archiveCapacity({ totalBytes: 100, availableBytes: 101, usedBytes: 0, usedPercent: 0 }))
      .toEqual({ totalBytes: null, availableBytes: null, usedBytes: null, usedPercent: null });
    expect(archiveCapacity({ totalBytes: 100, availableBytes: 20, usedBytes: 80, usedPercent: 120 }))
      .toEqual({ totalBytes: null, availableBytes: null, usedBytes: null, usedPercent: null });
  });

  it('formats rounded capacity for an operator-facing observation', () => {
    expect(formatCapacity(329 * 1024 ** 3)).toBe('329 GiB');
    expect(formatCapacity(1.5 * 1024 ** 4)).toBe('1.5 TiB');
  });
});
