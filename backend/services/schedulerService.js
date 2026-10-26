const queue = require("./queueService")
const Job = require("../models/Job")

/**
 * Scheduler Service - Phase 9: Background Jobs Infrastructure
 * 
 * Manages recurring / repeatable background jobs:
 * - Recording purge check (Phase 16)
 * - Audit retention cleanup (Phase 8 retention)
 * - Meta reconciliation (Phase 12 hook)
 * - Follow-up reminder dispatch
 * - Sample heartbeat recurring jobs
 */

const schedules = new Map()
let schedulerTimer = null
let isRunning = false

/**
 * Registers a repeatable job schedule.
 * 
 * @param {Object} options
 * @param {string} options.id - Schedule identifier (e.g. "audit-retention-daily")
 * @param {string} options.name - Job name in queue (e.g. "audit.retention_cleanup")
 * @param {number} options.intervalMs - Repeat interval in milliseconds
 * @param {Object} [options.payload] - Payload parameters for the job
 * @param {string} [options.tenantId] - Tagging tenant ID (defaults to "__system__")
 * @param {boolean} [options.runImmediately] - Whether to enqueue first run immediately on start
 */
function registerSchedule({
  id,
  name,
  intervalMs,
  payload = {},
  tenantId = "__system__",
  runImmediately = false,
}) {
  if (!id || !name || !intervalMs) {
    throw new Error("Schedule id, job name, and intervalMs are required")
  }

  schedules.set(id, {
    id,
    name,
    intervalMs: Math.max(1000, Number(intervalMs)),
    payload,
    tenantId,
    runImmediately,
    lastEnqueuedAt: null,
    runsCount: 0,
  })
}

/**
 * Checks all registered schedules and enqueues due recurring jobs.
 * Prevents queue flooding by verifying no pending or processing instance already exists.
 */
async function tick() {
  const now = Date.now()

  for (const [id, schedule] of schedules.entries()) {
    const isDue =
      !schedule.lastEnqueuedAt ||
      now - schedule.lastEnqueuedAt.getTime() >= schedule.intervalMs

    if (isDue) {
      try {
        // Prevent stacking duplicate pending instances of the same recurring job
        const existingActiveJob = await Job.findOne({
          name: schedule.name,
          tenantId: schedule.tenantId,
          status: { $in: ["pending", "processing"] },
        })

        if (!existingActiveJob) {
          const idempotencyKey = `recurring_${schedule.id}_${Math.floor(now / schedule.intervalMs)}`

          await queue.addJob({
            name: schedule.name,
            payload: schedule.payload,
            tenantId: schedule.tenantId,
            idempotencyKey,
            priority: 0,
            maxAttempts: 3,
          })

          schedule.lastEnqueuedAt = new Date(now)
          schedule.runsCount++
        }
      } catch (err) {
        console.error(`Error dispatching scheduled job '${schedule.id}':`, err.message)
      }
    }
  }
}

/**
 * Triggers an immediate execution of a registered schedule.
 */
async function triggerNow(scheduleId) {
  const schedule = schedules.get(scheduleId)
  if (!schedule) {
    throw new Error(`Schedule '${scheduleId}' not found`)
  }

  const result = await queue.addJob({
    name: schedule.name,
    payload: schedule.payload,
    tenantId: schedule.tenantId,
    idempotencyKey: `manual_trigger_${schedule.id}_${Date.now()}`,
    priority: 1, // High priority for manual triggers
  })

  schedule.lastEnqueuedAt = new Date()
  schedule.runsCount++

  return result
}

/**
 * Starts the background scheduler loop.
 */
function startScheduler(checkFrequencyMs = 5000) {
  if (isRunning) return
  isRunning = true

  // Initial check for runImmediately schedules
  for (const schedule of schedules.values()) {
    if (schedule.runImmediately && !schedule.lastEnqueuedAt) {
      triggerNow(schedule.id).catch((err) =>
        console.warn(`Initial trigger notice for ${schedule.id}:`, err.message),
      )
    }
  }

  schedulerTimer = setInterval(() => {
    tick().catch((err) => console.error("Scheduler tick error:", err.message))
  }, Math.max(1000, checkFrequencyMs))
}

/**
 * Stops the scheduler loop.
 */
function stopScheduler() {
  if (schedulerTimer) {
    clearInterval(schedulerTimer)
    schedulerTimer = null
  }
  isRunning = false
}

/**
 * Returns list of registered schedules and their current status.
 */
function getSchedules() {
  return Array.from(schedules.values()).map((s) => ({
    ...s,
    isRunning,
  }))
}

// Register standard default schedules
registerSchedule({
  id: "sample-heartbeat",
  name: "recurring.sample",
  intervalMs: 60000, // 1 minute heartbeat
  payload: { message: "System scheduler alive" },
  runImmediately: true,
})

registerSchedule({
  id: "recording-purge-daily",
  name: "recording.purge_check",
  intervalMs: 24 * 60 * 60 * 1000, // Daily
  payload: { retentionDays: 30 },
})

module.exports = {
  registerSchedule,
  startScheduler,
  stopScheduler,
  tick,
  triggerNow,
  getSchedules,
}
