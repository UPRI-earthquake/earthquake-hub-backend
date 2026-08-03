const mongoose = require('mongoose');
const { GenericContainer, Wait } = require('testcontainers');

require('../src/models/device.model');
const Account = require('../src/models/account.model');
const EQEvent = require('../src/models/events.model');
const AdminIncident = require('../src/models/adminIncident.model');
const AdminIncidentEvent = require('../src/models/adminIncidentEvent.model');
const AdminJob = require('../src/models/adminJob.model');
const Comment = require('../src/models/comments.model');
const StationOperationalEvent = require('../src/models/stationOperationalEvent.model');
const StationTelemetrySample = require('../src/models/stationTelemetrySample.model');
const AdminJobService = require('../src/services/adminJob.service');
const AdminJobHandlers = require('../src/services/adminJobHandlers.service');
const EQEventsService = require('../src/services/EQevents.service');
const EventSummaryService = require('../src/services/eventSummary.service');
const StationOperationalHistoryService = require('../src/services/stationOperationalHistory.service');
const StationTelemetryService = require('../src/services/stationTelemetry.service');
const CommentsService = require('../src/services/comments.service');
const {
  synchronizeOverview,
} = require('../src/services/adminIncident.service');
const {
  revokeAccountSessions,
  setAccountLifecycle,
} = require('../src/services/adminAccounts.service');
const {
  validateAccountSession,
} = require('../src/services/adminSession.service');

const describeMongo = process.env.RUN_MONGO_INTEGRATION === '1' ? describe : describe.skip;

function stationSnapshot(observedAt, inactive = 2) {
  return {
    observedAt,
    summary: {},
    sources: [{
      id: 'stations',
      label: 'RShake Stations',
      route: '/devices-stations',
      status: 'available',
      metrics: {
        total: 10,
        active: 10 - inactive,
        inactive,
      },
    }],
  };
}

describeMongo('Admin control plane with MongoDB', () => {
  let mongo;

  beforeAll(async () => {
    process.env.ADMIN_INCIDENT_RESOLVED_RETENTION_DAYS = '30';
    process.env.ADMIN_INCIDENT_EVENT_RETENTION_DAYS = '60';
    mongo = await new GenericContainer('mongo:5.0')
      .withExposedPorts(27017)
      .withWaitStrategy(Wait.forLogMessage(/Waiting for connections/))
      .withStartupTimeout(120_000)
      .start();
    await mongoose.connect(
      `mongodb://${mongo.getHost()}:${mongo.getMappedPort(27017)}/ehub-admin-integration`,
    );
    await Promise.all([
      Account.syncIndexes(),
      EQEvent.syncIndexes(),
      AdminIncident.syncIndexes(),
      AdminIncidentEvent.syncIndexes(),
      AdminJob.syncIndexes(),
      Comment.syncIndexes(),
      StationOperationalEvent.syncIndexes(),
      StationTelemetrySample.syncIndexes(),
    ]);
  }, 150_000);

  afterEach(async () => {
    await Promise.all([
      Account.collection.deleteMany({}),
      EQEvent.collection.deleteMany({}),
      AdminIncident.collection.deleteMany({}),
      AdminIncidentEvent.collection.deleteMany({}),
      AdminJob.collection.deleteMany({}),
      Comment.collection.deleteMany({}),
      StationOperationalEvent.collection.deleteMany({}),
      StationTelemetrySample.collection.deleteMany({}),
    ]);
    delete process.env.ADMIN_STATION_TELEMETRY_SAMPLE_INTERVAL_SECONDS;
    delete process.env.ADMIN_STATION_TELEMETRY_RETENTION_DAYS;
    StationTelemetryService._test.resetSamplingState();
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await mongoose.disconnect();
    if (mongo) await mongo.stop();
  }, 30_000);

  it('deduplicates concurrent observations by incident fingerprint', async () => {
    const observedAt = new Date().toISOString();
    await Promise.all(
      Array.from({ length: 8 }, () => synchronizeOverview(stationSnapshot(observedAt))),
    );

    const [incidents, events] = await Promise.all([
      AdminIncident.find({}).lean(),
      AdminIncidentEvent.find({}).lean(),
    ]);
    expect(incidents).toHaveLength(1);
    expect(incidents[0]).toMatchObject({
      fingerprint: 'overview:stations:activity-attention',
      recurrenceCount: 1,
      status: 'open',
    });
    expect(events).toHaveLength(1);
    expect(events[0].eventType).toBe('detected');
  });

  it('deduplicates concurrent job submissions by idempotency key', async () => {
    const input = {
      correlationId: 'job-correlation',
      idempotencyKey: 'job-request-123',
      jobType: 'earthquake-event-enrichment',
      reason: 'Process pending catalog records.',
      requestedBy: { accountId: 'admin-1', username: 'ops-admin', adminRole: 'operator' },
      target: {
        type: 'earthquake_event_queue',
        id: 'pending-enrichment',
        label: 'Pending catalog enrichment',
      },
    };

    const results = await Promise.all(
      Array.from({ length: 6 }, () => AdminJobService.enqueue(input)),
    );
    const jobs = await AdminJob.find({}).lean();

    expect(jobs).toHaveLength(1);
    expect(new Set(results.map(({ job }) => String(job._id))).size).toBe(1);
    expect(results.filter(({ reused }) => reused)).toHaveLength(5);
    expect(jobs[0]).toMatchObject({
      activeKey: 'earthquake-event-enrichment',
      attempt: 1,
      status: 'queued',
    });
  });

  it('allows different allowlisted job types to queue while excluding duplicates per type', async () => {
    const common = {
      requestedBy: { accountId: 'admin-1', username: 'ops-admin', adminRole: 'operator' },
      reason: 'Run the reviewed bounded operation.',
      target: { type: 'earthquake_event_queue', id: 'events' },
    };
    await AdminJobService.enqueue({
      ...common,
      correlationId: 'enrichment-correlation',
      idempotencyKey: 'enrichment-request',
      jobType: 'earthquake-event-enrichment',
    });
    await AdminJobService.enqueue({
      ...common,
      correlationId: 'recording-correlation',
      idempotencyKey: 'recording-request',
      jobType: 'earthquake-recording-availability-refresh',
    });

    const jobs = await AdminJob.find({}).sort({ jobType: 1 }).lean();
    expect(jobs).toHaveLength(2);
    expect(jobs.map(({ jobType }) => jobType).sort()).toEqual([
      'earthquake-event-enrichment',
      'earthquake-recording-availability-refresh',
    ]);
    expect(jobs.every(({ status }) => status === 'queued')).toBe(true);
  });

  it('migrates a legacy custom summary through the atomic review lifecycle on write', async () => {
    await EQEvent.collection.insertOne({
      publicID: 'legacy-summary-event',
      OT: new Date('2026-07-01T00:00:00.000Z'),
      magnitude_value: 4.5,
      depth_value: 10,
      summaryOverride: {
        text: 'Legacy summary awaiting review.',
        editedAt: new Date('2026-07-01T00:00:00.000Z'),
        editedBy: 'legacy-admin',
      },
    });

    const legacy = await EQEvent.findOne({ publicID: 'legacy-summary-event' }).lean();
    const unpublished = EventSummaryService.serializePublicEvent(legacy, { allowUnapproved: false });
    expect(unpublished.summaryOverride).toBeUndefined();
    expect(unpublished.summaryPublication.source).toBe('generated');

    const submitted = await EQEventsService.transitionEventSummaryReview(
      'legacy-summary-event',
      'draft',
      'needs_review',
      'ops-admin',
    );
    expect(submitted.summaryOverride).toMatchObject({
      reviewStatus: 'needs_review',
      submittedBy: 'ops-admin',
    });

    const approved = await EQEventsService.transitionEventSummaryReview(
      'legacy-summary-event',
      'needs_review',
      'approved',
      'review-admin',
    );
    expect(approved.summaryOverride).toMatchObject({
      reviewStatus: 'approved',
      approvedBy: 'review-admin',
    });
    const published = EventSummaryService.serializePublicEvent(approved, { allowUnapproved: false });
    expect(published.effectiveSummary).toBe('Legacy summary awaiting review.');
    expect(published.summaryPublication.source).toBe('approved_custom');

    await expect(EQEventsService.transitionEventSummaryReview(
      'legacy-summary-event',
      'needs_review',
      'draft',
      'ops-admin',
    )).rejects.toMatchObject({
      code: 'SUMMARY_REVIEW_CONFLICT',
      status: 409,
    });
  });

  it('retains immutable activity and tunnel transitions with cursor pagination', async () => {
    process.env.ADMIN_STATION_HISTORY_RETENTION_DAYS = '365';
    await StationOperationalHistoryService.appendActivityTransition({
      deviceId: 'AM_R1382',
      fromActivity: 'active',
      toActivity: 'inactive',
      observedAt: '2026-08-01T00:01:00.000Z',
      latestPacketAt: '2026-08-01T00:00:20.000Z',
      packetAgeMs: 40_000,
      thresholdMs: 30_000,
      streamId: 'AM_R1382_.*/MSEED',
    });
    await StationOperationalHistoryService.appendTunnelTransition({
      actor: { accountId: 'admin-1', username: 'ops-admin', role: 'admin' },
      correlationId: 'station-correlation-1',
      deviceId: 'AM_R1382',
      eventType: 'tunnel_revoked',
      observedAt: '2026-08-02T00:00:00.000Z',
    });

    const firstPage = await StationOperationalHistoryService.listHistory({
      deviceId: 'AM_R1382',
      limit: 1,
    });
    expect(firstPage.events).toHaveLength(1);
    expect(firstPage.events[0]).toMatchObject({
      eventType: 'tunnel_revoked',
      correlationId: 'station-correlation-1',
      retentionDays: 365,
    });
    expect(firstPage.nextCursor).toEqual(expect.any(String));

    const secondPage = await StationOperationalHistoryService.listHistory({
      cursor: firstPage.nextCursor,
      deviceId: 'AM_R1382',
      limit: 1,
    });
    expect(secondPage.events).toHaveLength(1);
    expect(secondPage.events[0]).toMatchObject({
      eventType: 'activity_changed',
      evidence: { packetAgeMs: 40_000, inactivityThresholdMs: 30_000 },
    });

    const immutableEvent = await StationOperationalEvent.findById(secondPage.events[0]._id);
    immutableEvent.source = 'tunnel_registry_action';
    await expect(immutableEvent.save()).rejects.toThrow(/immutable/);
  });

  it('deduplicates immutable packet-freshness samples by station and interval', async () => {
    process.env.ADMIN_STATION_TELEMETRY_SAMPLE_INTERVAL_SECONDS = '900';
    process.env.ADMIN_STATION_TELEMETRY_RETENTION_DAYS = '90';
    StationTelemetryService._test.resetSamplingState();
    const sample = {
      activity: 'active',
      deviceId: 'AM_R1382',
      inactivityThresholdMs: 30_000,
      latestPacketAt: '2026-08-02T10:14:55.000Z',
      observedAt: '2026-08-02T10:15:00.000Z',
      packetAgeMs: 5_000,
      streamRowCount: 3,
    };

    await expect(StationTelemetryService.retainFreshnessSample(sample)).resolves.toMatchObject({ stored: true });
    StationTelemetryService._test.resetSamplingState();
    await expect(StationTelemetryService.retainFreshnessSample({
      ...sample,
      observedAt: '2026-08-02T10:20:00.000Z',
    })).resolves.toMatchObject({ reason: 'already_sampled', stored: false });

    const rows = await StationTelemetrySample.find({}).lean();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      bucketAt: new Date('2026-08-02T10:15:00.000Z'),
      deviceId: 'AM_R1382',
      packetAgeMs: 5_000,
      retentionDays: 90,
      sampleIntervalSeconds: 900,
      streamRowCount: 3,
    });

    const retained = await StationTelemetrySample.findById(rows[0]._id);
    retained.packetAgeMs = 1;
    await expect(retained.save()).rejects.toThrow(/immutable/);
  });

  it('persists an atomic, versioned moderation case lifecycle with bounded history', async () => {
    const event = await EQEvent.create({ publicID: 'moderation-case-event' });
    await Comment.create({
      commentId: 'CR-CASE-1',
      eventId: event._id,
      eventPublicID: event.publicID,
      content: 'Observed shaking near the event area.',
      status: 'pending',
    });

    const investigating = await CommentsService.transitionModerationCase('CR-CASE-1', {
      currentStatus: 'open',
      currentVersion: 0,
      reason: 'Validate the observation against available evidence.',
      status: 'investigating',
    }, { username: 'ops-admin', role: 'operator' }, 'case-transition-1');
    expect(investigating.moderationCase).toMatchObject({
      historyCount: 1,
      status: 'investigating',
      version: 1,
    });

    const noted = await CommentsService.addModerationCaseNote('CR-CASE-1', {
      currentStatus: 'investigating',
      currentVersion: 1,
      reason: 'Image and origin time are consistent with the event.',
    }, { username: 'ops-admin', role: 'operator' }, 'case-note-1');
    expect(noted.moderationCase).toMatchObject({ historyCount: 2, version: 2 });

    const rejected = await CommentsService.moderateAdminComment('CR-CASE-1', {
      currentCaseStatus: 'investigating',
      currentCaseVersion: 2,
      currentStatus: 'pending',
      reason: 'Location evidence does not match the reported event.',
      status: 'rejected',
    }, { username: 'review-admin', role: 'operator' }, 'case-decision-1');
    expect(rejected.report.status).toBe('rejected');
    expect(rejected.moderationCase).toMatchObject({
      historyCount: 3,
      status: 'resolved',
      version: 3,
    });
    expect(rejected.moderationCase.history.map(({ correlationId }) => correlationId)).toEqual([
      'case-decision-1',
      'case-note-1',
      'case-transition-1',
    ]);

    await expect(CommentsService.transitionModerationCase('CR-CASE-1', {
      currentStatus: 'investigating',
      currentVersion: 2,
      reason: 'Stale case transition must not overwrite the decision.',
      status: 'escalated',
    }, { username: 'stale-admin' })).resolves.toMatchObject({ error: 'conflict' });

    const eventQueue = await EQEventsService.getAdminEventQueue({ search: event.publicID });
    expect(eventQueue.events[0]).toMatchObject({
      publicID: event.publicID,
      communityReports: { pending: 0, total: 1 },
    });
  });

  it('creates bounded retry lineage and recovers an interrupted worker', async () => {
    const original = await AdminJob.create({
      jobType: 'earthquake-event-enrichment',
      status: 'running',
      activeKey: 'earthquake-event-enrichment',
      idempotencyKey: 'original-request',
      correlationId: 'original-correlation',
      requestedBy: { username: 'ops-admin', adminRole: 'operator' },
      reason: 'Initial enrichment attempt.',
      target: { type: 'earthquake_event_queue', id: 'pending-enrichment' },
      attempt: 1,
      progress: { current: 2, total: 5, percent: 40, message: 'Running' },
      timeoutAt: new Date(Date.now() + 60_000),
      lease: { owner: 'stopped-worker', expiresAt: new Date(Date.now() - 1_000) },
      startedAt: new Date(Date.now() - 10_000),
    });
    original.rootJobId = original._id;
    await original.save();

    await AdminJobService.recoverInterruptedJobs();
    const recovered = await AdminJob.findById(original._id).lean();
    expect(recovered).toMatchObject({
      status: 'failed',
      error: {
        code: 'ADMIN_JOB_WORKER_INTERRUPTED',
        retryable: true,
      },
    });
    expect(recovered.activeKey).toBeUndefined();
    expect(recovered.expiresAt).toBeInstanceOf(Date);

    const retried = await AdminJobService.retry(original._id, {
      correlationId: 'retry-correlation',
      idempotencyKey: 'retry-request',
      reason: 'Retry after worker recovery.',
      requestedBy: { username: 'ops-admin', adminRole: 'operator' },
    });
    expect(retried.job).toMatchObject({
      attempt: 2,
      status: 'queued',
    });
    expect(String(retried.job.retryOf)).toBe(String(original._id));
    expect(String(retried.job.rootJobId)).toBe(String(original._id));
  });

  it('claims an allowlisted job and persists progress and a bounded terminal result', async () => {
    jest.spyOn(AdminJobHandlers, 'getHandler').mockReturnValue(async ({ updateProgress }) => {
      await updateProgress({ current: 1, total: 2, message: 'Checked one event.' });
      await updateProgress({ current: 2, total: 2, message: 'Checked two events.' });
      return {
        totalProcessed: 2,
        completedCount: 1,
        noMatchCount: 1,
      };
    });
    const queued = await AdminJobService.enqueue({
      correlationId: 'worker-correlation',
      idempotencyKey: 'worker-request',
      jobType: 'earthquake-event-enrichment',
      reason: 'Exercise the durable worker.',
      requestedBy: { username: 'ops-admin', adminRole: 'operator' },
      target: { type: 'earthquake_event_queue', id: 'pending-enrichment' },
    });

    await expect(AdminJobService.runNext()).resolves.toBe(true);
    const completed = await AdminJob.findById(queued.job._id).lean();

    expect(completed).toMatchObject({
      status: 'succeeded',
      progress: {
        current: 2,
        total: 2,
        percent: 100,
        message: 'Job completed successfully.',
      },
      result: {
        totalProcessed: 2,
        completedCount: 1,
        noMatchCount: 1,
      },
    });
    expect(completed.activeKey).toBeUndefined();
    expect(completed.finishedAt).toBeInstanceOf(Date);
    expect(completed.expiresAt).toBeInstanceOf(Date);
  });

  it('expires only resolved incidents and clears retention when they reopen', async () => {
    const detectedAt = new Date();
    const resolvedAt = new Date(detectedAt.getTime() + 1_000);
    const reopenedAt = new Date(detectedAt.getTime() + 2_000);

    await synchronizeOverview(stationSnapshot(detectedAt.toISOString()));
    await synchronizeOverview({
      observedAt: resolvedAt.toISOString(),
      summary: {},
      sources: [],
    });

    let incident = await AdminIncident.findOne({}).lean();
    expect(incident).toMatchObject({
      status: 'resolved',
      retentionDays: 30,
      resolvedAt,
    });
    expect(incident.expiresAt.getTime()).toBe(
      resolvedAt.getTime() + 30 * 24 * 60 * 60 * 1000,
    );

    await synchronizeOverview(stationSnapshot(reopenedAt.toISOString()));
    incident = await AdminIncident.findOne({}).lean();
    expect(incident).toMatchObject({
      status: 'open',
      recurrenceCount: 2,
    });
    expect(incident.expiresAt).toBeUndefined();
    expect(incident.retentionDays).toBeUndefined();

    const events = await AdminIncidentEvent.find({}).sort({ createdAt: 1 }).lean();
    expect(events.map(({ eventType }) => eventType)).toEqual([
      'detected',
      'resolved',
      'reopened',
    ]);
    expect(events.every(({ retentionDays }) => retentionDays === 60)).toBe(true);
  });

  it('rejects a token after its account session generation is revoked', async () => {
    const account = await Account.create({
      email: 'citizen@example.test',
      username: 'citizen-user',
      roles: ['citizen'],
      isActive: true,
      sessionVersion: 0,
    });
    const tokenState = {
      accountId: String(account._id),
      role: 'citizen',
      sessionVersion: 0,
    };

    await expect(validateAccountSession(tokenState)).resolves.toMatchObject({
      valid: true,
      sessionVersion: 0,
    });
    await revokeAccountSessions(account._id);
    await expect(validateAccountSession(tokenState)).resolves.toEqual({
      valid: false,
      reason: 'session_revoked',
    });
  });

  it('prevents deactivation of the final active super-admin', async () => {
    const target = await Account.create({
      email: 'target@example.test',
      username: 'target-admin',
      roles: ['admin'],
      isActive: true,
    });
    const request = {
      accountId: new mongoose.Types.ObjectId(),
      username: 'security-admin',
      reason: 'Access is no longer required.',
    };

    await expect(setAccountLifecycle(target._id, false, request)).resolves.toEqual({
      lastSuperAdminBlocked: true,
    });

    await Account.create({
      email: 'remaining@example.test',
      username: 'remaining-admin',
      roles: ['admin'],
      adminRole: 'super_admin',
      isActive: true,
    });
    const result = await setAccountLifecycle(target._id, false, request);
    expect(result.account).toMatchObject({
      accountId: String(target._id),
      lifecycleStatus: 'inactive',
    });
  });

  it('creates the uniqueness and absolute-expiry indexes', async () => {
    const [incidentIndexes, eventIndexes, stationHistoryIndexes, stationTelemetryIndexes] = await Promise.all([
      AdminIncident.collection.indexes(),
      AdminIncidentEvent.collection.indexes(),
      StationOperationalEvent.collection.indexes(),
      StationTelemetrySample.collection.indexes(),
    ]);

    expect(incidentIndexes).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: { fingerprint: 1 }, unique: true }),
      expect.objectContaining({ key: { expiresAt: 1 }, expireAfterSeconds: 0 }),
    ]));
    expect(eventIndexes).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: { expiresAt: 1 }, expireAfterSeconds: 0 }),
    ]));
    expect(stationHistoryIndexes).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: { deviceId: 1, observedAt: -1, _id: -1 } }),
      expect.objectContaining({ key: { expiresAt: 1 }, expireAfterSeconds: 0 }),
    ]));
    expect(stationTelemetryIndexes).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: { deviceId: 1, bucketAt: 1 }, unique: true }),
      expect.objectContaining({ key: { expiresAt: 1 }, expireAfterSeconds: 0 }),
    ]));
  });
});
