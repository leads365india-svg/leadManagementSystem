const dotenv = require("dotenv")
const mongoose = require("mongoose")
const connectDB = require("./db/connection")
const queue = require("./services/queueService")
const scheduler = require("./services/schedulerService")
const { registerAllHandlers } = require("./jobs")

dotenv.config()

/**
 * Worker Process - Phase 9: Background Jobs Infrastructure
 * 
 * Standalone worker process that polls the distributed MongoDB queue,
 * claims jobs atomically, runs handlers with error boundaries, manages retries,
 * and executes scheduled recurring tasks.
 */

const WORKER_ID = `worker_${process.pid}_${Date.now().toString(36)}`
let isShuttingDown = false
let activeJob = null
let pollTimer = null

const POLL_INTERVAL_ACTIVE = 200 // 200ms when jobs are present
const POLL_INTERVAL_IDLE = 1000 // 1s when queue is empty

async function processNext() {
  if (isShuttingDown) return

  try {
    const job = await queue.claimNextJob(WORKER_ID)

    if (job) {
      activeJob = job
      await queue.processJob(job, WORKER_ID)
      activeJob = null

      // Continue immediately while jobs exist
      if (!isShuttingDown) {
        pollTimer = setTimeout(processNext, POLL_INTERVAL_ACTIVE)
      }
    } else {
      // Idle backoff when queue is empty
      if (!isShuttingDown) {
        pollTimer = setTimeout(processNext, POLL_INTERVAL_IDLE)
      }
    }
  } catch (err) {
    console.error(`[Worker ${WORKER_ID}] Polling loop error:`, err.message)
    activeJob = null
    if (!isShuttingDown) {
      pollTimer = setTimeout(processNext, POLL_INTERVAL_IDLE)
    }
  }
}

async function startWorker() {
  console.log(`🚀 [Worker] Starting background worker process: ${WORKER_ID}...`)

  try {
    await connectDB()
    console.log(`✅ [Worker] Database connected successfully.`)

    // Register all job handlers
    registerAllHandlers()
    console.log(`✅ [Worker] Job handlers registered.`)

    // Start recurring job scheduler
    scheduler.startScheduler()
    console.log(`✅ [Worker] Recurring job scheduler initialized.`)

    // Start polling loop
    processNext()
    console.log(`✅ [Worker] Polling queue for jobs...`)
  } catch (err) {
    console.error(`❌ [Worker] Failed to start worker:`, err.message)
    process.exit(1)
  }
}

async function shutdown(signal) {
  if (isShuttingDown) return
  isShuttingDown = true
  console.log(`\n🛑 [Worker] Received ${signal}. Shutting down worker gracefully...`)

  if (pollTimer) {
    clearTimeout(pollTimer)
    pollTimer = null
  }

  scheduler.stopScheduler()

  if (activeJob) {
    console.log(`⏳ [Worker] Waiting for in-flight job '${activeJob.name}' (${activeJob.jobId}) to finish...`)
    const maxWait = 10000
    const start = Date.now()
    while (activeJob && Date.now() - start < maxWait) {
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
  }

  try {
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.close(false)
      console.log(`✅ [Worker] Database connection closed cleanly.`)
    }
  } catch (err) {
    console.error(`⚠️ [Worker] Error closing database connection:`, err.message)
  }

  console.log(`👋 [Worker] Shutdown complete. Process exiting.`)
  process.exit(0)
}

process.on("SIGINT", () => shutdown("SIGINT"))
process.on("SIGTERM", () => shutdown("SIGTERM"))

if (require.main === module) {
  startWorker()
}

module.exports = {
  startWorker,
  shutdown,
  processNext,
  WORKER_ID,
}
