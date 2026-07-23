jest.mock('../src/services/adminAccounts.service', () => ({ listAccounts: jest.fn() }));
jest.mock('../src/services/adminDevicesStations.service', () => ({ listDevices: jest.fn() }));
jest.mock('../src/services/comments.service', () => ({ getAdminModerationQueue: jest.fn() }));
jest.mock('../src/services/EQevents.service', () => ({ getAdminEventQueue: jest.fn() }));

const AdminAccountsService = require('../src/services/adminAccounts.service');
const AdminDevicesStationsService = require('../src/services/adminDevicesStations.service');
const CommentsService = require('../src/services/comments.service');
const EQEventsService = require('../src/services/EQevents.service');
const AdminGlobalSearchService = require('../src/services/adminGlobalSearch.service');

describe('Admin global search service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    AdminDevicesStationsService.listDevices.mockResolvedValue({
      devices: [{ deviceId: 'AM_R1EFC', streamId: 'AM_R1EFC_00_EHZ/MSEED', activity: 'inactive', tunnel: null }],
      total: 1,
    });
    AdminAccountsService.listAccounts.mockResolvedValue({
      accounts: [{ accountId: 'account-1', username: 'admin', email: 'admin@example.test', roles: ['admin'], approvalStatus: 'not_required', linkedDeviceCount: 0 }],
      total: 1,
    });
    CommentsService.getAdminModerationQueue.mockResolvedValue({
      comments: [{ commentId: 'CR-1', content: 'Felt shaking', username: 'reporter', status: 'pending', issueCount: 0 }],
      total: 1,
    });
    EQEventsService.getAdminEventQueue.mockResolvedValue({
      events: [{ publicID: 'event-1', magnitude_value: 5.678, place: 'Mindanao, Philippines', recordingAvailabilityStatus: 'verified' }],
      total: 1,
    });
  });

  it('searches every supported category concurrently and returns normalized bounded results', async () => {
    const result = await AdminGlobalSearchService.search('AM_R1EFC', { limit: 3 });

    expect(AdminDevicesStationsService.listDevices).toHaveBeenCalledWith({ search: 'AM_R1EFC', limit: 3, offset: 0 });
    expect(AdminAccountsService.listAccounts).toHaveBeenCalledWith({ search: 'AM_R1EFC', limit: 3, offset: 0 });
    expect(CommentsService.getAdminModerationQueue).toHaveBeenCalledWith({ search: 'AM_R1EFC', limit: 3, offset: 0 });
    expect(EQEventsService.getAdminEventQueue).toHaveBeenCalledWith({ search: 'AM_R1EFC', limit: 3, offset: 0 });
    expect(result.returned).toBe(4);
    expect(result.partial).toBe(false);
    expect(result.groups[0].items[0]).toMatchObject({
      id: 'AM_R1EFC',
      destination: '/devices-stations?search=AM_R1EFC&focus=AM_R1EFC',
    });
    expect(result.groups[3].items[0].title).toBe('M5.7 · Mindanao, Philippines');
  });

  it('keeps available categories when one source fails', async () => {
    CommentsService.getAdminModerationQueue.mockRejectedValue(new Error('database unavailable'));

    const result = await AdminGlobalSearchService.search('Mindanao');

    expect(result.partial).toBe(true);
    expect(result.returned).toBe(3);
    expect(result.groups.find((group) => group.id === 'reports')).toEqual(expect.objectContaining({
      status: 'unavailable',
      items: [],
      message: 'Community Reports search is temporarily unavailable.',
    }));
  });
});
