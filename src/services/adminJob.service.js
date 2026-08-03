const crypto = require('crypto');
const os = require('os');
const process = require('process');
const AdminJob = require('../models/adminJob.model');
const { boundedMetadata } = require('./auditLog.service');
const { getAdminJobConfig, resolveAdminJobRetention } = require('../config/adminJob.config');
const AdminJobHandlers = require('./adminJobHandlers.service');

const LEASE_MS = 60_000;
const POLL_MS = 2_000;
const TERMINAL_STATUSES = ['succeeded', 'failed', 'timed_out'];
const workerOwner = `${os.hostname()}:${process.pid}:${crypto.randomUUID()}`;
let pollTimer = null;
let drainPromise = null;

function plainJob(job) {
  if (!job) return null;
  return typeof job.toObject === 'function' ? job.toObject() : job;
}

function retryableError(error) {
  if (typeof error?.retryable === 'boolean') return error.retryable;
  return ['ENRICHMENT_ALREADY_RUNNING', 'ADMIN_JOB_WORKER_INTERRUPTED'].includes(error?.code);
}

function terminalUpdate(status, now, fields = {}) {
  const retention = resolveAdminJobRetention(now);
  return {
    $set: {
      status,
      finishedAt: now,
      retentionDays: retention.retentionDays,
      ...(retention.expiresAt ? { expiresAt: retention.expiresAt } : {}),
      ...fields,
    },
    $unset: {
      activeKey: 1,
      lease: 1,
      ...(!retention.expiresAt ? { expiresAt: 1 } : {}),
    },
  };
}

async function enqueue({
  correlationId,
  idempotencyKey,
  jobType,
  reason,
  requestedBy,
  target,
  attempt = 1,
  retryOf,
  rootJobId,
}) {
  const config = getAdminJobConfig();
  if (!AdminJob.ADMIN_JOB_TYPES.includes(jobType)) {
    throw Object.assign(new Error(`Unsupported admin job type: ${jobType}`), {
      code: 'ADMIN_JOB_TYPE_UNSUPPORTED',
      statusCode: 400,
    });
  }

  const existing = await AdminJob.findOne({ jobType, idempotencyKey }).lean();
  if (existing) return { job: existing, reused: true };

  const now = new Date();
  const document = new AdminJob({
    jobType,
    status: 'queued',
    activeKey: jobType,
    idempotencyKey,
    correlationId,
    requestedBy,
    reason,
    target,
    attempt,
    retryOf,
    rootJobId,
    progress: {
      current: 0,
      percent: 0,
      message: 'Waiting for an available worker.',
      updatedAt: now,
    },
    timeoutAt: new Date(now.getTime() + config.timeoutMs),
  });
  if (!document.rootJobId) document.rootJobId = document._id;

  try {
    await document.save();
    return { job: plainJob(document), reused: false };
  } catch (error) {
    if (error?.code !== 11000) throw error;

    const [sameRequest, activeJob] = await Promise.all([
      AdminJob.findOne({ jobType, idempotencyKey }).lean(),
      AdminJob.findOne({ activeKey: jobType }).lean(),
    ]);
    if (sameRequest) return { job: sameRequest, reused: true };

    throw Object.assign(new Error('A job of this type is already queued or running.'), {
      code: 'ADMIN_JOB_ALREADY_ACTIVE',
      statusCode: 409,
      activeJob,
    });
  }
}

async function list(filters, { limit = 20, offset = 0 } = {}) {
  const query = AdminJob.find(filters).sort({ createdAt: -1, _id: -1 }).skip(offset).limit(limit).lean();
  const [jobs, total] = await Promise.all([query, AdminJob.countDocuments(filters)]);
  return { jobs, total, limit, offset };
}

async function getById(jobId) {
  return AdminJob.findById(jobId).lean();
}

async function updateProgress(jobId, progress) {
  const current = Math.max(0, Number(progress.current) || 0);
  const total = Number.isFinite(Number(progress.total)) ? Math.max(0, Number(progress.total)) : undefined;
  const percent = total > 0
    ? Math.min(100, Math.round((current / total) * 100))
    : Math.min(100, Math.max(0, Number(progress.percent) || 0));

  await AdminJob.updateOne(
    { _id: jobId, status: 'running', 'lease.owner': workerOwner },
    {
      $set: {
        progress: {
          current,
          ...(total !== undefined ? { total } : {}),
          percent,
          message: String(progress.message || 'Job is running.').slice(0, 512),
          updatedAt: new Date(),
        },
      },
    },
  );
}

async function expireQueuedJobs(now = new Date()) {
  const retention = resolveAdminJobRetention(now);
  return AdminJob.updateMany(
    { status: 'queued', timeoutAt: { $lte: now } },
    {
      $set: {
        status: 'timed_out',
        finishedAt: now,
        error: {
          code: 'ADMIN_JOB_QUEUE_TIMEOUT',
          message: 'The job timed out before a worker claimed it.',
          retryable: true,
        },
        retentionDays: retention.retentionDays,
        ...(retention.expiresAt ? { expiresAt: retention.expiresAt } : {}),
      },
      $unset: {
        activeKey: 1,
        ...(!retention.expiresAt ? { expiresAt: 1 } : {}),
      },
    },
  );
}

async function claimNext() {
  const now = new Date();
  await expireQueuedJobs(now);
  return AdminJob.findOneAndUpdate(
    { status: 'queued', timeoutAt: { $gt: now } },
    {
      $set: {
        status: 'running',
        startedAt: now,
        lease: {
          owner: workerOwner,
          expiresAt: new Date(now.getTime() + LEASE_MS),
        },
        'progress.message': 'Worker started the job.',
        'progress.updatedAt': now,
      },
    },
    { new: true, sort: { createdAt: 1, _id: 1 } },
  );
}

async function runClaimedJob(jobDocument) {
  const job = plainJob(jobDocument);
  const handler = AdminJobHandlers.getHandler(job.jobType);
  if (!handler) {
    await AdminJob.updateOne(
      { _id: job._id, status: 'running', 'lease.owner': workerOwner },
      terminalUpdate('failed', new Date(), {
        error: {
          code: 'ADMIN_JOB_HANDLER_MISSING',
          message: 'No allowlisted handler is registered for this job type.',
          retryable: false,
        },
      }),
    );
    return;
  }

  const controller = new AbortController();
  const remainingMs = Math.max(0, new Date(job.timeoutAt).getTime() - Date.now());
  const timeout = setTimeout(() => controller.abort(), remainingMs);
  const heartbeat = setInterval(() => {
    AdminJob.updateOne(
      { _id: job._id, status: 'running', 'lease.owner': workerOwner },
      { $set: { 'lease.expiresAt': new Date(Date.now() + LEASE_MS) } },
    ).catch((error) => console.error('Admin job heartbeat failed:', error?.message || error));
  }, Math.floor(LEASE_MS / 2));

  try {
    const result = await handler({
      job,
      signal: controller.signal,
      updateProgress: (progress) => updateProgress(job._id, progress),
    });
    const finishedAt = new Date();
    const timedOut = controller.signal.aborted || finishedAt >= new Date(job.timeoutAt);
    await AdminJob.updateOne(
      { _id: job._id, status: 'running', 'lease.owner': workerOwner },
      timedOut
        ? terminalUpdate('timed_out', finishedAt, {
          error: {
            code: 'ADMIN_JOB_EXECUTION_TIMEOUT',
            message: 'The job exceeded its configured execution deadline.',
            retryable: true,
          },
        })
        : terminalUpdate('succeeded', finishedAt, {
          progress: {
            current: Number(result?.totalProcessed ?? job.progress?.total ?? job.progress?.current ?? 0),
            ...(result?.totalProcessed !== undefined
              ? { total: Number(result.totalProcessed) }
              : job.progress?.total !== undefined
                ? { total: job.progress.total }
                : {}),
            percent: 100,
            message: 'Job completed successfully.',
            updatedAt: finishedAt,
          },
          result: boundedMetadata(result || {}),
        }),
    );
  } catch (error) {
    const finishedAt = new Date();
    const timedOut = controller.signal.aborted || error?.name === 'AbortError';
    await AdminJob.updateOne(
      { _id: job._id, status: 'running', 'lease.owner': workerOwner },
      terminalUpdate(timedOut ? 'timed_out' : 'failed', finishedAt, {
        error: {
          code: timedOut ? 'ADMIN_JOB_EXECUTION_TIMEOUT' : (error.code || error.name || 'ADMIN_JOB_FAILED'),
          message: String(timedOut
            ? 'The job exceeded its configured execution deadline.'
            : error.message || 'The job failed.').slice(0, 1024),
          retryable: timedOut || retryableError(error),
        },
      }),
    );
  } finally {
    clearTimeout(timeout);
    clearInterval(heartbeat);
  }
}

async function runNext() {
  const claimed = await claimNext();
  if (!claimed) return false;
  await runClaimedJob(claimed);
  return true;
}

async function drain() {
  if (drainPromise) return drainPromise;
  drainPromise = (async () => {
    try {
      while (await runNext()) {
        // Process allowlisted jobs serially to avoid competing batch pressure.
      }
    } finally {
      drainPromise = null;
    }
  })();
  return drainPromise;
}

function wake() {
  setImmediate(() => {
    drain().catch((error) => console.error('Admin job worker failed:', error?.message || error));
  });
}

async function recoverInterruptedJobs(now = new Date()) {
  const retention = resolveAdminJobRetention(now);
  return AdminJob.updateMany(
    {
      status: 'running',
      'lease.expiresAt': { $lte: now },
    },
    {
      $set: {
        status: 'failed',
        finishedAt: now,
        error: {
          code: 'ADMIN_JOB_WORKER_INTERRUPTED',
          message: 'The worker stopped before recording a terminal result.',
          retryable: true,
        },
        retentionDays: retention.retentionDays,
        ...(retention.expiresAt ? { expiresAt: retention.expiresAt } : {}),
      },
      $unset: {
        activeKey: 1,
        lease: 1,
        ...(!retention.expiresAt ? { expiresAt: 1 } : {}),
      },
    },
  );
}

async function retry(jobId, { correlationId, idempotencyKey, reason, requestedBy }) {
  const original = await AdminJob.findById(jobId).lean();
  if (!original) {
    throw Object.assign(new Error('Admin job not found.'), {
      code: 'ADMIN_JOB_NOT_FOUND',
      statusCode: 404,
    });
  }
  if (!TERMINAL_STATUSES.includes(original.status) || original.status === 'succeeded') {
    throw Object.assign(new Error('Only failed or timed-out jobs can be retried.'), {
      code: 'ADMIN_JOB_NOT_RETRYABLE',
      statusCode: 409,
    });
  }
  if (original.error?.retryable !== true) {
    throw Object.assign(new Error('This job failed permanently and cannot be retried.'), {
      code: 'ADMIN_JOB_NOT_RETRYABLE',
      statusCode: 409,
    });
  }

  const nextAttempt = Number(original.attempt || 1) + 1;
  if (nextAttempt > getAdminJobConfig().maxAttempts) {
    throw Object.assign(new Error('This job has reached its retry limit.'), {
      code: 'ADMIN_JOB_RETRY_LIMIT_REACHED',
      statusCode: 409,
    });
  }

  return enqueue({
    correlationId,
    idempotencyKey,
    jobType: original.jobType,
    reason,
    requestedBy,
    target: original.target,
    attempt: nextAttempt,
    retryOf: original._id,
    rootJobId: original.rootJobId || original._id,
  });
}

async function start() {
  if (pollTimer) return;
  await recoverInterruptedJobs();
  pollTimer = setInterval(wake, POLL_MS);
  pollTimer.unref?.();
  wake();
  console.log('admin-job-worker: started (allowlisted jobs only)');
}

function stop() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

module.exports = {
  drain,
  enqueue,
  expireQueuedJobs,
  getById,
  list,
  recoverInterruptedJobs,
  retry,
  runNext,
  start,
  stop,
  updateProgress,
  wake,
};
