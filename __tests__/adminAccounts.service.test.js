jest.mock('../src/models/account.model', () => ({
  countDocuments: jest.fn(),
  find: jest.fn(),
  findById: jest.fn(),
}));

const Account = require('../src/models/account.model');
const { listAccounts } = require('../src/services/adminAccounts.service');

function mockFindResult(accounts = []) {
  const query = {
    lean: jest.fn().mockResolvedValue(accounts),
    limit: jest.fn(),
    select: jest.fn(),
    skip: jest.fn(),
    sort: jest.fn(),
  };
  query.sort.mockReturnValue(query);
  query.skip.mockReturnValue(query);
  query.limit.mockReturnValue(query);
  query.select.mockReturnValue(query);
  Account.find.mockReturnValue(query);
  return query;
}

describe('AdminAccountsService', () => {
  beforeEach(() => jest.clearAllMocks());

  it('filters linked accounts and returns an unfiltered operational summary', async () => {
    mockFindResult([]);
    Account.countDocuments
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(12)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(4)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(6);

    const result = await listAccounts({ includeSummary: true, linkedDevice: 'linked', limit: 10, offset: 0 });

    expect(Account.find).toHaveBeenCalledWith({ 'devices.0': { $exists: true } });
    expect(result.total).toBe(3);
    expect(result.summary).toEqual({ total: 12, pendingBrgy: 2, approvedBrgy: 4, admins: 1, linked: 6 });
  });

  it('filters accounts without linked devices without loading summary counts', async () => {
    mockFindResult([]);
    Account.countDocuments.mockResolvedValueOnce(5);

    const result = await listAccounts({ linkedDevice: 'unlinked' });

    expect(Account.find).toHaveBeenCalledWith({ 'devices.0': { $exists: false } });
    expect(result.summary).toBeUndefined();
    expect(Account.countDocuments).toHaveBeenCalledTimes(1);
  });
});
