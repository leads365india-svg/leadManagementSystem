const crypto = require("crypto")
const Job = require("../models/Job")
const DeadLetterJob = require("../models/DeadLetterJob")

/**
 * Queue Service - Phase 9: Background Jobs Infrastructure
 * 
 * Provides distributed job enqueueing, atomic worker claiming with lock timeouts,
 * retries with exponential backoff, dead-letter storage, idempotency deduplication,
 * and tenant-isolated queue operations.
 */

const handlers = new Map()

/**
 * Register an execution handler for a specific job name.
 * @param {string} name - Job identifier name (e.g. "webhook.process", "lead.assign")
 * @param {Function} handler - Async function(job, workerContext) => Promise<any>
 */
function registerHandler(name, handler) {
  if (typeof handler !== "function") {
    throw new Error(`Handler for job '${name}' must be a function`)
  }
  handlers.set(name, handler)
}

/**
 * Retrieve registered handler.
 */
function getHandler(name) {
  return handlers.get(name) || null
}

/**
 * Enqueue a job for background execution.
 * 
 * @param {Object} options
 * @param {string} options.name - Job name identifier
 * @param {Object} [options.payload] - Serialized data payload
 * @param {string} [options.tenantId] - Tagging tenant ID (defaults to "__system__")
 * @param {string} [options.idempotencyKey] - Optional deduplication key
 * @param {number} [options.delayMs] - Optional execution delay in milliseconds
 * @param {number} [options.maxAttempts] - Maximum retry attempts (default 3)
 * @param {number} [options.priority] - Priority score (higher executed first, default 0)
 * @param {string} [options.backoffType] - "exponential" or "fixed"
 * @param {number} [options.backoffDelayMs] - Base backoff delay in ms (default 1000)
 * @returns {Promise<{ job: Object, duplicate: boolean }>}
 */
async function addJob({
  name,
  payload = {},
  tenantId = "__system__",
  idempotencyKey = null,
  delayMs = 0,
  maxAttempts = 3,
  priority = 0,
  backoffType = "exponential",
  backoffDelayMs = 1000,
  lockTimeoutMs = 60000,
} = {}) {
  if (!name || typeof name !== "string" || !name.trim()) {
    throw new Error("Job name is required")
  }

  const cleanName = name.trim()
  const cleanTenantId = tenantId && typeof tenantId === "string" ? tenantId.trim() : "__system__"
  const cleanIdempotencyKey = idempotencyKey && typeof idempotencyKey === "string" ? idempotencyKey.trim() : null

  // Idempotency check: if key already exists for this tenant, return existing job
  if (cleanIdempotencyKey) {
    const existing = await Job.findOne({
      tenantId: cleanTenantId,
      idempotencyKey: cleanIdempotencyKey,
    })
    if (existing) {
      return { job: existing, duplicate: true }
    }
  }

  const jobId = `job_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`
  const nextRunAt = new Date(Date.now() + Math.max(0, Number(delayMs) || 0))

  try {
    const job = new Job({
      jobId,
      name: cleanName,
      tenantId: cleanTenantId,
      idempotencyKey: cleanIdempotencyKey,
      payload,
      status: "pending",
      priority: Number(priority) || 0,
      attempts: 0,
      maxAttempts: Math.max(1, Number(maxAttempts) || 3),
      backoff: {
        type: backoffType === "fixed" ? "fixed" : "exponential",
        delayMs: Math.max(100, Number(backoffDelayMs) || 1000),
      },
      nextRunAt,
      lockTimeoutMs: Math.max(5000, Number(lockTimeoutMs) || 60000),
    })

    await job.save()
    return { job, duplicate: false }
  } catch (err) {
    // If concurrent insert collided on unique idempotencyKey, retrieve and return existing
    if (err.code === 11000 && cleanIdempotencyKey) {
      const existing = await Job.findOne({
        tenantId: cleanTenantId,
        idempotencyKey: cleanIdempotencyKey,
      })
      if (existing) {
        return { job: existing, duplicate: true }
      }
    }
    throw err
  }
}

/**
 * Atomically claims the next ready job for a worker.
 * Supports:
 * - Ready pending jobs where nextRunAt <= now (sorted by priority DESC, createdAt ASC)
 * - Abandoned processing jobs whose lockTimeoutMs has expired (reclaims crashed worker jobs)
 * 
 * @param {string} workerId - Identifier of worker acquiring the claim
 * @returns {Promise<Job|null>}
 */
async function claimNextJob(workerId = "worker_default", options = {}) {
  const { name, tenantId, jobId } = options
  const now = new Date()

  const query = {
    $or: [
      {
        status: "pending",
        nextRunAt: { $lte: now },
      },
      {
        status: "processing",
        lockedAt: { $lt: new Date(now.getTime() - 60000) }, // Default fallback threshold
      },
    ],
  }

  if (name) query.name = name
  if (tenantId) query.tenantId = tenantId
  if (jobId) query.jobId = jobId

  const job = await Job.findOneAndUpdate(
    query,
    {
      $set: {
        status: "processing",
        lockedAt: now,
        lockedBy: workerId,
      },
      $inc: {
        attempts: 1,
      },
    },
    {
      sort: { priority: -1, nextRunAt: 1, createdAt: 1 },
      new: true,
    },
  )

  return job
}

/**
 * Marks a job successfully completed with optional result payload.
 */
async function completeJob(jobId, result = null, durationMs = 0) {
  const completedAt = new Date()
  const historyEntry = {
    attempt: 0,
    startedAt: new Date(completedAt.getTime() - durationMs),
    completedAt,
    durationMs,
    error: null,
    status: "completed",
  }

  const job = await Job.findOneAndUpdate(
    { jobId },
    {
      $set: {
        status: "completed",
        result,
        lockedAt: null,
        lockedBy: null,
      },
      $push: { history: historyEntry },
    },
    { new: true },
  )

  return job
}

/**
 * Handles job failure with exponential backoff retries and dead-letter queue routing.
 */
async function failJob(jobId, error, durationMs = 0) {
  const job = await Job.findOne({ jobId })
  if (!job) return null

  const failedAt = new Date()
  const errorMsg = error?.message || String(error || "Unknown execution error")
  const errorStack = error?.stack || null

  const historyEntry = {
    attempt: job.attempts,
    startedAt: new Date(failedAt.getTime() - durationMs),
    completedAt: failedAt,
    durationMs,
    error: errorMsg,
    status: "failed",
  }

  const hasExhaustedRetries = job.attempts >= job.maxAttempts

  if (hasExhaustedRetries) {
    // Route to DeadLetterJob collection
    await DeadLetterJob.create({
      originalJobId: job.jobId,
      name: job.name,
      tenantId: job.tenantId,
      idempotencyKey: job.idempotencyKey,
      payload: job.payload,
      totalAttempts: job.attempts,
      failedAt,
      failedReason: errorMsg,
      stack: errorStack,
      history: [...(job.history || []), historyEntry],
    })

    job.status = "dead_letter"
    job.lockedAt = null
    job.lockedBy = null
    job.failedReason = errorMsg
    job.history.push(historyEntry)
    await job.save()

    return job
  }

  // Calculate exponential backoff delay
  let delay = job.backoff?.delayMs || 1000
  if (job.backoff?.type === "exponential") {
    // e.g., attempt 1 failed: delay * 2^0 = 1000ms; attempt 2: delay * 2^1 = 2000ms
    const power = Math.max(0, job.attempts - 1)
    delay = Math.min(3600000, delay * Math.pow(2, power)) // Cap at 1 hour
  }

  job.status = "pending"
  job.nextRunAt = new Date(failedAt.getTime() + delay)
  job.lockedAt = null
  job.lockedBy = null
  job.failedReason = errorMsg
  job.history.push(historyEntry)
  await job.save()

  return job
}

/**
 * Re-queues a failed job from the dead-letter list back into the active queue.
 */
async function retryDeadLetterJob(deadLetterId, requeuedBy = "admin") {
  const dlRecord = await DeadLetterJob.findById(deadLetterId)
  if (!dlRecord) {
    throw new Error("Dead-letter record not found")
  }

  // Re-enqueue as a fresh pending job
  const newJobResult = await addJob({
    name: dlRecord.name,
    payload: dlRecord.payload,
    tenantId: dlRecord.tenantId,
    // Note: append timestamp to prevent idempotency collision on retry
    idempotencyKey: dlRecord.idempotencyKey ? `${dlRecord.idempotencyKey}_retry_${Date.now()}` : null,
    priority: 1, // Prioritize retried dead-letter jobs
  })

  dlRecord.requeuedAt = new Date()
  dlRecord.requeuedBy = requeuedBy
  await dlRecord.save()

  return {
    requeuedJob: newJobResult.job,
    deadLetterRecord: dlRecord,
  }
}

/**
 * Execute a claimed job with its registered handler, handling success and failure.
 */
async function processJob(job, workerId = "worker_default") {
  if (!job) return null

  const handler = getHandler(job.name)
  if (!handler) {
    const error = new Error(`No registered handler found for job '${job.name}'`)
    return failJob(job.jobId, error, 0)
  }

  const startTime = Date.now()
  try {
    const result = await handler(job, { workerId })
    const durationMs = Date.now() - startTime
    return completeJob(job.jobId, result, durationMs)
  } catch (err) {
    const durationMs = Date.now() - startTime
    return failJob(job.jobId, err, durationMs)
  }
}

/**
 * Get aggregate queue metrics for monitoring (optionally scoped to a tenant).
 */
async function getQueueMetrics(tenantId = null) {
  const query = {}
  if (tenantId && tenantId !== "__all__") {
    query.tenantId = tenantId.trim()
  }

  const [statusCounts, deadLetterCount] = await Promise.all([
    Job.aggregate([
      { $match: query },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]),
    DeadLetterJob.countDocuments(query),
  ])

  const metrics = {
    pending: 0,
    processing: 0,
    completed: 0,
    failed: 0,
    dead_letter: deadLetterCount,
    cancelled: 0,
    total: 0,
  }

  statusCounts.forEach((sc) => {
    if (sc._id && metrics[sc._id] !== undefined) {
      metrics[sc._id] = sc.count
    }
  })

  metrics.total = Object.values(metrics).reduce((sum, val) => sum + val, 0)

  return metrics
}

module.exports = {
  registerHandler,
  getHandler,
  addJob,
  enqueue: addJob,
  claimNextJob,
  completeJob,
  failJob,
  retryDeadLetterJob,
  processJob,
  getQueueMetrics,
}
