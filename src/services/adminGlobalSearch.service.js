const AdminAccountsService = require('./adminAccounts.service');
const AdminDevicesStationsService = require('./adminDevicesStations.service');
const CommentsService = require('./comments.service');
const EQEventsService = require('./EQevents.service');

function compact(values) {
  return values.filter((value) => value !== undefined && value !== null && value !== '');
}

function formatMagnitude(value) {
  const magnitude = Number(value);
  return Number.isFinite(magnitude) ? `M${magnitude.toFixed(1)}` : 'Magnitude unavailable';
}

function stationResult(device) {
  const identifier = device.deviceId || compact([device.network, device.station]).join('_');
  return {
    id: identifier,
    title: identifier,
    description: device.description || device.streamId || 'Registered station',
    context: compact([
      device.streamId && device.streamId !== 'TO_BE_LINKED' ? device.streamId : 'Stream not linked',
      device.activity,
      device.tunnel ? 'WSTunnel mapped' : 'WSTunnel not mapped',
    ]),
    status: String(device.activity || 'unknown').toLowerCase(),
    destination: `/devices-stations?search=${encodeURIComponent(identifier)}&focus=${encodeURIComponent(identifier)}`,
  };
}

function accountResult(account) {
  const identifier = account.accountId;
  const searchValue = account.username || account.email || identifier;
  return {
    id: identifier,
    title: account.username || account.email || 'Unnamed account',
    description: account.email || 'No email address',
    context: compact([
      Array.isArray(account.roles) ? account.roles.join(', ') : '',
      account.approvalStatus,
      `${account.linkedDeviceCount || 0} linked ${account.linkedDeviceCount === 1 ? 'device' : 'devices'}`,
    ]),
    status: account.approvalStatus || 'unknown',
    destination: `/accounts?search=${encodeURIComponent(searchValue)}&focus=${encodeURIComponent(identifier)}`,
  };
}

function reportResult(report) {
  const identifier = report.commentId;
  return {
    id: identifier,
    title: identifier,
    description: report.content || 'No report text supplied',
    context: compact([
      report.username || 'Anonymous',
      report.eventPublicID,
      report.status,
      report.issueCount ? `${report.issueCount} ${report.issueCount === 1 ? 'issue' : 'issues'}` : '',
    ]),
    status: report.status || 'unknown',
    destination: `/community-reports?search=${encodeURIComponent(identifier)}&focus=${encodeURIComponent(identifier)}`,
  };
}

function eventResult(event) {
  const identifier = event.publicID;
  const place = event.place || event.text || 'Location unavailable';
  return {
    id: identifier,
    title: `${formatMagnitude(event.magnitude_value)} · ${place}`,
    description: identifier,
    context: compact([
      event.type,
      event.sourceCatalog,
      event.OT,
      event.recordingAvailabilityStatus,
    ]),
    status: event.recordingAvailabilityStatus || 'unknown',
    destination: `/earthquake-events?search=${encodeURIComponent(identifier)}&focus=${encodeURIComponent(identifier)}`,
  };
}

const categories = [
  {
    id: 'stations',
    label: 'Stations',
    route: '/devices-stations',
    search: async (query, limit) => {
      const result = await AdminDevicesStationsService.listDevices({ search: query, limit, offset: 0 });
      return { items: result.devices.map(stationResult), total: result.total };
    },
  },
  {
    id: 'accounts',
    label: 'Accounts',
    route: '/accounts',
    search: async (query, limit) => {
      const result = await AdminAccountsService.listAccounts({ search: query, limit, offset: 0 });
      return { items: result.accounts.map(accountResult), total: result.total };
    },
  },
  {
    id: 'reports',
    label: 'Community Reports',
    route: '/community-reports',
    search: async (query, limit) => {
      const result = await CommentsService.getAdminModerationQueue({ search: query, limit, offset: 0 });
      return { items: result.comments.map(reportResult), total: result.total };
    },
  },
  {
    id: 'events',
    label: 'Earthquake Events',
    route: '/earthquake-events',
    search: async (query, limit) => {
      const result = await EQEventsService.getAdminEventQueue({ search: query, limit, offset: 0 });
      return { items: result.events.map(eventResult), total: result.total };
    },
  },
];

async function search(query, { limit = 4 } = {}) {
  const settled = await Promise.allSettled(categories.map((category) => category.search(query, limit)));
  const groups = settled.map((result, index) => {
    const category = categories[index];
    if (result.status === 'rejected') {
      return {
        id: category.id,
        label: category.label,
        route: category.route,
        status: 'unavailable',
        total: null,
        items: [],
        message: `${category.label} search is temporarily unavailable.`,
      };
    }
    return {
      id: category.id,
      label: category.label,
      route: category.route,
      status: 'available',
      total: result.value.total,
      items: result.value.items,
    };
  });

  return {
    query,
    groups,
    partial: groups.some((group) => group.status === 'unavailable'),
    returned: groups.reduce((total, group) => total + group.items.length, 0),
  };
}

module.exports = {
  accountResult,
  eventResult,
  reportResult,
  search,
  stationResult,
};
