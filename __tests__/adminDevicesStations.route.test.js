const jwt = require('jsonwebtoken');
const request = require('supertest');

process.env.NODE_ENV = 'test';
process.env.ACCESS_TOKEN_PRIVATE_KEY_WEB = 'test-web-secret';
process.env.REFRESH_TOKEN_PRIVATE_KEY_WEB = 'test-refresh-secret';

jest.mock('../src/services/adminDevicesStations.service', () => ({ getTunnelObservation: jest.fn(), listDevices: jest.fn() }));
jest.mock('../src/services/tunnelEnrollment.service', () => ({ revokeDeviceTunnel: jest.fn() }));
jest.mock('../src/services/stationOperationalHistory.service', () => ({
  appendTunnelTransition: jest.fn().mockResolvedValue(undefined),
  listHistory: jest.fn(),
}));
jest.mock('../src/services/stationTelemetry.service', () => ({
  ALLOWED_WINDOWS_HOURS: [6, 24, 72],
  listFreshness: jest.fn(),
}));
jest.mock('../src/services/remoteDeviceActions.service', () => ({
  RemoteDeviceActionError: class RemoteDeviceActionError extends Error { constructor(code, message, httpStatus) { super(message); this.name = 'RemoteDeviceActionError'; this.code = code; this.httpStatus = httpStatus; } },
  executeAdminRemoteDeviceAction: jest.fn(),
  listAdminRemoteDeviceServers: jest.fn(),
  listAllowedRingserverTargets: jest.fn(),
}));
jest.mock('../src/services/auditLog.service', () => ({
  execute: jest.fn(),
  record: jest.fn().mockResolvedValue(undefined),
}));

const AdminDevicesStationsService = require('../src/services/adminDevicesStations.service');
const TunnelEnrollmentService = require('../src/services/tunnelEnrollment.service');
const StationOperationalHistoryService = require('../src/services/stationOperationalHistory.service');
const StationTelemetryService = require('../src/services/stationTelemetry.service');
const RemoteDeviceActionsService = require('../src/services/remoteDeviceActions.service');
const AuditLogService = require('../src/services/auditLog.service');
const app = require('../src/app');
const csrfToken = 'test-admin-csrf-token';

function signAdminToken() {
  return jwt.sign({ accountId: 'account-1', username: 'admin-user', role: 'admin', csrfToken }, process.env.ACCESS_TOKEN_PRIVATE_KEY_WEB, { expiresIn: '1h' });
}

describe('Admin devices and stations routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    AuditLogService.execute.mockImplementation(async (_req, _event, operation) => operation());
  });

  it('requires an administrator session for station inventory', async () => {
    const response = await request(app).get('/admin/devices-stations');
    expect(response.statusCode).toBe(403);
    expect(AdminDevicesStationsService.listDevices).not.toHaveBeenCalled();
  });

  it('returns the read-only station inventory to administrators', async () => {
    AdminDevicesStationsService.listDevices.mockResolvedValue({ devices: [{ deviceId: 'AM_R1382', activity: 'active' }], total: 1, limit: 25, offset: 0, summary: { total: 1 } });
    const response = await request(app).get('/admin/devices-stations?hasTunnel=true&attention=true&network=AM').set('Cookie', [`accessToken=${signAdminToken()}`]);
    expect(response.statusCode).toBe(200);
    expect(AdminDevicesStationsService.listDevices).toHaveBeenCalledWith(expect.objectContaining({ hasTunnel: true, attention: true, includeSummary: true, network: 'AM', limit: 25, offset: 0 }));
    expect(response.body.summary).toEqual({ total: 1 });
  });

  it('returns cursor-paginated station operational history to administrators', async () => {
    StationOperationalHistoryService.listHistory.mockResolvedValue({
      events: [{ _id: '507f1f77bcf86cd799439011', eventType: 'activity_changed' }],
      limit: 20,
      nextCursor: 'next-history-page',
    });
    const response = await request(app)
      .get('/admin/devices-stations/AM_R1382/history?limit=20&eventType=activity_changed')
      .set('Cookie', [`accessToken=${signAdminToken()}`]);

    expect(response.statusCode).toBe(200);
    expect(StationOperationalHistoryService.listHistory).toHaveBeenCalledWith({
      deviceId: 'AM_R1382',
      eventType: 'activity_changed',
      limit: 20,
    });
    expect(response.body.pagination.nextCursor).toBe('next-history-page');
  });

  it('returns a fixed packet-freshness window without accepting arbitrary ranges', async () => {
    StationTelemetryService.listFreshness.mockResolvedValue({
      samples: [{ _id: 'sample-1', packetAgeMs: 5000 }],
      summary: { hours: 24, sampleCount: 1, source: 'ringserver_stream_status' },
    });
    const response = await request(app)
      .get('/admin/devices-stations/AM_R1382/freshness?hours=24')
      .set('Cookie', [`accessToken=${signAdminToken()}`]);

    expect(response.statusCode).toBe(200);
    expect(response.body.payload).toHaveLength(1);
    expect(response.body.summary).toMatchObject({ hours: 24, sampleCount: 1 });
    expect(StationTelemetryService.listFreshness).toHaveBeenCalledWith({ deviceId: 'AM_R1382', hours: 24 });

    const rejected = await request(app)
      .get('/admin/devices-stations/AM_R1382/freshness?hours=48')
      .set('Cookie', [`accessToken=${signAdminToken()}`]);
    expect(rejected.statusCode).toBe(400);
  });

  it('returns read-only WSTunnel listener evidence for a validated station ID', async () => {
    AdminDevicesStationsService.getTunnelObservation.mockResolvedValue({
      deviceId: 'AM_R1382',
      mapping: { remotePort: 22012 },
      observation: { state: 'listener_observed', listenerPresent: true },
    });
    const response = await request(app)
      .get('/admin/devices-stations/AM_R1382/tunnel-observation')
      .set('Cookie', [`accessToken=${signAdminToken()}`]);

    expect(response.statusCode).toBe(200);
    expect(response.body.payload.observation.state).toBe('listener_observed');
    expect(AdminDevicesStationsService.getTunnelObservation).toHaveBeenCalledWith(expect.objectContaining({
      deviceId: 'AM_R1382',
      req: expect.anything(),
    }));
  });

  it('audits approved remote ringserver changes', async () => {
    RemoteDeviceActionsService.executeAdminRemoteDeviceAction.mockResolvedValue({ action: 'ADD_SERVER', deviceId: 'AM_R1382' });
    const response = await request(app)
      .post('/admin/devices-stations/AM_R1382/remote-actions')
      .set('Cookie', [`accessToken=${signAdminToken()}`, `csrfToken=${csrfToken}`])
      .set('X-CSRF-Token', csrfToken)
      .send({ action: 'ADD_SERVER', payload: { institutionName: 'UP Diliman', url: 'earthquake.up.edu.ph:16000' }, reason: 'Restore the approved hub ringserver target.' });
    expect(response.statusCode).toBe(200);
    expect(AuditLogService.execute).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      eventType: 'device.remote_action.add_server', target: { type: 'device_station', id: 'AM_R1382', label: 'AM_R1382' },
    }), expect.any(Function));
    expect(RemoteDeviceActionsService.executeAdminRemoteDeviceAction).toHaveBeenCalledWith(expect.objectContaining({ deviceId: 'AM_R1382', action: 'ADD_SERVER' }));
  });

  it('audits tunnel revocation before executing it', async () => {
    TunnelEnrollmentService.revokeDeviceTunnel.mockResolvedValue({ deviceId: 'AM_R1382' });
    const response = await request(app)
      .post('/admin/devices-stations/AM_R1382/tunnel/revoke')
      .set('Cookie', [`accessToken=${signAdminToken()}`, `csrfToken=${csrfToken}`])
      .set('X-CSRF-Token', csrfToken)
      .send({
        confirmation: 'AM_R1382',
        reason: 'Retire the inactive station tunnel mapping.',
      });
    expect(response.statusCode).toBe(200);
    expect(AuditLogService.execute).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ eventType: 'device.tunnel.revoke' }), expect.any(Function));
    expect(TunnelEnrollmentService.revokeDeviceTunnel).toHaveBeenCalledWith('AM_R1382');
    expect(StationOperationalHistoryService.appendTunnelTransition).toHaveBeenCalledWith(expect.objectContaining({
      actor: expect.objectContaining({ role: 'super_admin' }),
      deviceId: 'AM_R1382',
      eventType: 'tunnel_revoked',
    }));
  });

  it('rejects tunnel revocation when the typed station ID does not match', async () => {
    const response = await request(app)
      .post('/admin/devices-stations/AM_R1382/tunnel/revoke')
      .set('Cookie', [`accessToken=${signAdminToken()}`, `csrfToken=${csrfToken}`])
      .set('X-CSRF-Token', csrfToken)
      .send({
        confirmation: 'AM_OTHER',
        reason: 'Retire the inactive station tunnel mapping.',
      });

    expect(response.statusCode).toBe(400);
    expect(response.body.errorCode).toBe('ADMIN_CONFIRMATION_MISMATCH');
    expect(AuditLogService.record).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      eventType: 'device.tunnel.revoke',
      outcome: 'rejected',
    }));
    expect(AuditLogService.execute).not.toHaveBeenCalled();
    expect(TunnelEnrollmentService.revokeDeviceTunnel).not.toHaveBeenCalled();
  });
});
