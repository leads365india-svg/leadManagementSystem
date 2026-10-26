const assert = require("assert")
const path = require("path")
const mongoose = require("mongoose")
const dotenv = require("dotenv")
const request = require("supertest")

dotenv.config({ path: path.join(__dirname, "../.env") })
process.env.NODE_ENV = "test"

const connectDB = require("../db/connection")
const User = require("../models/User")
const Account = require("../models/Account")
const Role = require("../models/Role")
const Lead = require("../models/Lead")
const LeadFeedConfig = require("../models/LeadFeedConfig")
const Job = require("../models/Job")
const DeadLetterJob = require("../models/DeadLetterJob")
const queue = require("../services/queueService")
const scheduler = require("../services/schedulerService")
const { registerAllHandlers } = require("../jobs")
const app = require("../start")

/**
 * Automated Verification Suite for Roadmap Phase 9: Background Jobs Infrastructure
 */

const TEST_TAG = `p9_${Date.now()}`
const TENANT_A = `tenant_p9_a_${Date.now()}`
const TENANT_B = `tenant_p9_b_${Date.now()}`

let superAdminToken = null
let accountAdminAToken = null
let agentAToken = null
let testLead1 = null
let testLead2 = null

let totalPassed = 0
let totalFailed = 0

async function runTest(testName, testFn) {
  process.stdout.write(`  ⏳ ${testName} ... `)
  try {
    await testFn()
    console.log("✅ PASSED")
    totalPassed++
  } catch (err) {
    console.log(`❌ FAILED: ${err.message}`)
    console.error(err)
    totalFailed++
  }
}

const getClientCookie = (res) => {
  const setCookies = res.headers["set-cookie"]
  if (!setCookies) return ""
  const tokenCookie = setCookies.find((c) => c.startsWith("client_token="))
  return tokenCookie ? tokenCookie.split(";")[0] : ""
}

const getSuperAdminCookie = (res) => {
  const setCookies = res.headers["set-cookie"]
  if (!setCookies) return ""
  const tokenCookie = setCookies.find((c) => c.startsWith("superadmin_token="))
  return tokenCookie ? tokenCookie.split(";")[0] : ""
}

async function setupFixtures() {
  await connectDB()
  registerAllHandlers()

  // 1. Super Admin Authentication
  const superAdminEmail = (process.env.SUPERADMIN_EMAIL || "superadmin@leadflow.io").toLowerCase()
  const superAdminPassword = process.env.SUPERADMIN_PASSWORD || "SuperAdmin@2026!"

  const saLoginRes = await request(app)
    .post("/api/auth/login")
    .send({ email: superAdminEmail, password: superAdminPassword })

  assert.strictEqual(saLoginRes.status, 200, "Super Admin login failed")
  superAdminToken = getSuperAdminCookie(saLoginRes)

  // 2. Tenants Setup
  const adminAUserId = new mongoose.Types.ObjectId()
  await Account.create({
    accountId: TENANT_A,
    companyName: `Tenant A Jobs Corp ${TEST_TAG}`,
    displayName: "Tenant A Jobs",
    adminName: "Admin A",
    adminEmail: `admin.a.${TEST_TAG}@test.com`,
    adminUserId: adminAUserId,
    status: "active",
  })

  await Role.ensureTenantRoles(TENANT_A)
  const roleAdminA = await Role.findOne({ tenantId: TENANT_A, slug: "account_admin" }).lean()
  const roleAgentA = await Role.findOne({ tenantId: TENANT_A, slug: "agent" }).lean()

  const adminA = await User.create({
    _id: adminAUserId,
    name: "Admin A User",
    email: `admin.a.${TEST_TAG}@test.com`,
    password: "Password123!",
    role: "account_admin",
    roleId: roleAdminA?._id,
    tenantId: TENANT_A,
    isActive: true,
    status: "active",
  })

  const agentA = await User.create({
    name: "Agent A User",
    email: `agent.a.${TEST_TAG}@test.com`,
    password: "Password123!",
    role: "agent",
    roleId: roleAgentA?._id,
    tenantId: TENANT_A,
    isActive: true,
    status: "active",
  })

  const adminALoginRes = await request(app)
    .post("/api/auth/login")
    .send({ email: adminA.email, password: "Password123!" })
  accountAdminAToken = getClientCookie(adminALoginRes)

  const agentALoginRes = await request(app)
    .post("/api/auth/login")
    .send({ email: agentA.email, password: "Password123!" })
  agentAToken = getClientCookie(agentALoginRes)

  // Test leads for bulk assignment
  testLead1 = await Lead.create({
    tenantId: TENANT_A,
    name: "Job Test Lead 1",
    email: `lead1_${TEST_TAG}@test.com`,
    phone: "+919876543210",
    status: "New",
    assignedTo: "Unassigned",
  })

  testLead2 = await Lead.create({
    tenantId: TENANT_A,
    name: "Job Test Lead 2",
    email: `lead2_${TEST_TAG}@test.com`,
    phone: "+919876543211",
    status: "New",
    assignedTo: "Unassigned",
  })
}

async function runPhase9Verification() {
  console.log("\n========================================================")
  console.log("   PHASE 9: BACKGROUND JOBS INFRASTRUCTURE VERIFICATION")
  console.log("========================================================\n")

  try {
    await setupFixtures()
    console.log("✅ Fixtures and authentication established.\n")

    // ----------------------------------------------------
    // SUITE 1: Enqueueing, Idempotency & Tenant Tagging
    // ----------------------------------------------------
    console.log("▶ SUITE 1: Enqueueing, Idempotency & Tenant Tagging")

    await runTest("addJob enqueues job with status: 'pending' and correct tenantId", async () => {
      const { job, duplicate } = await queue.addJob({
        name: "test.standard",
        payload: { item: "alpha" },
        tenantId: TENANT_A,
        priority: 5,
      })

      assert(job, "Job must be returned")
      assert.strictEqual(duplicate, false)
      assert.strictEqual(job.status, "pending")
      assert.strictEqual(job.tenantId, TENANT_A)
      assert.strictEqual(job.priority, 5)
      assert(job.jobId.startsWith("job_"))
    })

    await runTest("Idempotency key prevents duplicate enqueueing within same tenant", async () => {
      const idempotencyKey = `idem_${Date.now()}`

      const first = await queue.addJob({
        name: "test.idempotent",
        payload: { attempt: 1 },
        tenantId: TENANT_A,
        idempotencyKey,
      })

      assert.strictEqual(first.duplicate, false)

      const second = await queue.addJob({
        name: "test.idempotent",
        payload: { attempt: 2 },
        tenantId: TENANT_A,
        idempotencyKey,
      })

      assert.strictEqual(second.duplicate, true)
      assert.strictEqual(second.job.jobId, first.job.jobId, "Duplicate submission must return original job")
    })

    // ----------------------------------------------------
    // SUITE 2: Atomic Claiming & Normal Worker Execution
    // ----------------------------------------------------
    console.log("\n▶ SUITE 2: Atomic Claiming & Normal Worker Execution")

    await runTest("Worker claims pending job atomically with lockedAt timestamp", async () => {
      const { job: addedJob } = await queue.addJob({
        name: "test.claimable",
        payload: { step: 1 },
        tenantId: TENANT_A,
      })

      const claimed = await queue.claimNextJob("worker_unit_test", { jobId: addedJob.jobId })

      assert(claimed, "Worker must claim the pending job")
      assert.strictEqual(claimed.status, "processing")
      assert.strictEqual(claimed.lockedBy, "worker_unit_test")
      assert(claimed.lockedAt instanceof Date)
      assert.strictEqual(claimed.attempts, 1)
    })

    await runTest("processJob executes registered handler and marks job completed with result", async () => {
      queue.registerHandler("test.executable", async (job) => {
        return { processed: true, echo: job.payload.data }
      })

      const { job: added } = await queue.addJob({
        name: "test.executable",
        payload: { data: "success_payload" },
        tenantId: TENANT_A,
      })

      const claimed = await queue.claimNextJob("worker_unit_test", { jobId: added.jobId })
      assert.strictEqual(claimed.jobId, added.jobId)

      const processed = await queue.processJob(claimed, "worker_unit_test")

      assert.strictEqual(processed.status, "completed")
      assert.strictEqual(processed.result.processed, true)
      assert.strictEqual(processed.result.echo, "success_payload")
      assert.strictEqual(processed.lockedAt, null)
      assert(processed.history.length > 0)
      assert.strictEqual(processed.history[0].status, "completed")
    })

    // ----------------------------------------------------
    // SUITE 3: Worker Restart & Crashed Lock Recovery (Survives worker restart)
    // ----------------------------------------------------
    console.log("\n▶ SUITE 3: Worker Restart & Lock Recovery (Survives worker restart)")

    await runTest("A job abandoned by a crashed worker is reclaimed after lock expiration", async () => {
      // Simulate a crashed worker: job is 'processing' with a stale lockedAt timestamp
      const crashedJobId = `job_crashed_${Date.now()}`
      const staleTimestamp = new Date(Date.now() - 120000) // 2 minutes ago (> 60s timeout)

      await Job.create({
        jobId: crashedJobId,
        name: "test.crashed_recovery",
        tenantId: TENANT_A,
        payload: { recovering: true },
        status: "processing",
        lockedAt: staleTimestamp,
        lockedBy: "worker_dead_pid_9999",
        lockTimeoutMs: 60000,
        attempts: 1,
      })

      queue.registerHandler("test.crashed_recovery", async (job) => {
        return { recovered: true }
      })

      // Restarted worker claims the crashed job
      const recoveredJob = await queue.claimNextJob("worker_restarted_pid_1000", { jobId: crashedJobId })

      assert(recoveredJob, "Restarted worker must recover crashed job")
      assert.strictEqual(recoveredJob.jobId, crashedJobId)
      assert.strictEqual(recoveredJob.lockedBy, "worker_restarted_pid_1000")
      assert.strictEqual(recoveredJob.attempts, 2)

      // Execute to completion
      const completed = await queue.processJob(recoveredJob, "worker_restarted_pid_1000")
      assert.strictEqual(completed.status, "completed")
      assert.strictEqual(completed.result.recovered, true)
    })

    // ----------------------------------------------------
    // SUITE 4: Exponential Backoff Retries & Dead-Letter List
    // ----------------------------------------------------
    console.log("\n▶ SUITE 4: Retries with Exponential Backoff & Dead-Letter List")

    await runTest("Failing job retries with exponential backoff before exhausting attempts", async () => {
      let callCount = 0
      queue.registerHandler("test.failing_with_retry", async () => {
        callCount++
        throw new Error(`Intentional transient failure #${callCount}`)
      })

      const { job: added } = await queue.addJob({
        name: "test.failing_with_retry",
        tenantId: TENANT_A,
        maxAttempts: 3,
        backoffType: "exponential",
        backoffDelayMs: 200,
      })

      // First attempt
      const claimed1 = await queue.claimNextJob("worker_retry_test", { jobId: added.jobId })
      assert.strictEqual(claimed1.jobId, added.jobId)
      const afterFail1 = await queue.processJob(claimed1, "worker_retry_test")

      assert.strictEqual(afterFail1.status, "pending")
      assert.strictEqual(afterFail1.attempts, 1)
      assert(afterFail1.nextRunAt.getTime() > Date.now(), "nextRunAt must be scheduled in the future")
      assert.strictEqual(afterFail1.failedReason, "Intentional transient failure #1")
    })

    await runTest("Exhausted failing job transfers to DeadLetterJob collection and sets status: 'dead_letter'", async () => {
      queue.registerHandler("test.exhaust_to_dlq", async () => {
        throw new Error("Permanent fatal error that exhausts retries")
      })

      const { job: added } = await queue.addJob({
        name: "test.exhaust_to_dlq",
        tenantId: TENANT_A,
        maxAttempts: 2,
        backoffDelayMs: 50,
      })

      // Attempt 1
      const claim1 = await queue.claimNextJob("worker_dlq_test", { jobId: added.jobId })
      await queue.processJob(claim1, "worker_dlq_test")

      // Fast-forward nextRunAt to make it immediately eligible for attempt 2
      await Job.updateOne({ jobId: added.jobId }, { nextRunAt: new Date(Date.now() - 1000) })

      // Attempt 2 (exhausts maxAttempts=2)
      const claim2 = await queue.claimNextJob("worker_dlq_test", { jobId: added.jobId })
      assert(claim2, "Should claim second attempt")
      const finalJob = await queue.processJob(claim2, "worker_dlq_test")

      assert.strictEqual(finalJob.status, "dead_letter")
      assert.strictEqual(finalJob.attempts, 2)

      // Verify DeadLetterJob document was created
      const dlqRecord = await DeadLetterJob.findOne({ originalJobId: added.jobId })
      assert(dlqRecord, "DeadLetterJob entry must exist")
      assert.strictEqual(dlqRecord.totalAttempts, 2)
      assert.strictEqual(dlqRecord.name, "test.exhaust_to_dlq")
      assert.strictEqual(dlqRecord.tenantId, TENANT_A)
      assert(dlqRecord.failedReason.includes("Permanent fatal error"))
    })

    // ----------------------------------------------------
    // SUITE 5: Dead-Letter Recovery & Re-queueing
    // ----------------------------------------------------
    console.log("\n▶ SUITE 5: Dead-Letter Recovery & Re-queueing")

    await runTest("retryDeadLetterJob creates fresh active job and marks dead-letter record as requeued", async () => {
      const dlRecord = await DeadLetterJob.findOne({ name: "test.exhaust_to_dlq", tenantId: TENANT_A }).sort({ failedAt: -1 })
      assert(dlRecord, "Dead letter record should exist from previous suite")

      const { requeuedJob, deadLetterRecord } = await queue.retryDeadLetterJob(dlRecord._id, "admin@test.com")

      assert(requeuedJob, "Requeued job must be created")
      assert.strictEqual(requeuedJob.status, "pending")
      assert.strictEqual(requeuedJob.name, "test.exhaust_to_dlq")
      assert.strictEqual(requeuedJob.tenantId, TENANT_A)
      assert.strictEqual(requeuedJob.priority, 1, "Retried job should have higher priority")

      assert(deadLetterRecord.requeuedAt instanceof Date)
      assert.strictEqual(deadLetterRecord.requeuedBy, "admin@test.com")
    })

    // ----------------------------------------------------
    // SUITE 6: Recurring Scheduler Service
    // ----------------------------------------------------
    console.log("\n▶ SUITE 6: Recurring Scheduler Service (Sample recurring job runs)")

    await runTest("Sample recurring job triggers and processes successfully", async () => {
      // Trigger manual run of the registered 'sample-heartbeat' schedule
      const { job } = await scheduler.triggerNow("sample-heartbeat")
      assert(job, "Scheduled job must be enqueued")
      assert.strictEqual(job.name, "recurring.sample")

      const claimed = await queue.claimNextJob("worker_scheduler_test", { jobId: job.jobId })
      assert(claimed, "Worker must claim recurring job")

      const completed = await queue.processJob(claimed, "worker_scheduler_test")
      assert.strictEqual(completed.status, "completed")
      assert.strictEqual(completed.result.status, "success")
      assert(completed.result.sampleMessage)
    })

    // ----------------------------------------------------
    // SUITE 7: Admin-Only Queue Monitor API (Kept off public routes)
    // ----------------------------------------------------
    console.log("\n▶ SUITE 7: Admin-Only Queue Monitor API (Protected & Off Public Routes)")

    await runTest("GET /api/admin/queues/metrics rejects unauthenticated requests with 401", async () => {
      const res = await request(app).get("/api/admin/queues/metrics")
      assert.strictEqual(res.status, 401)
    })

    await runTest("GET /api/admin/queues/metrics rejects non-Super-Admin (Agent) with 403", async () => {
      const res = await request(app)
        .get("/api/admin/queues/metrics")
        .set("Cookie", agentAToken)
      assert.strictEqual(res.status, 403)
      assert(res.body.error.includes("Super Admin"))
    })

    await runTest("GET /api/admin/queues/metrics rejects Account Admin with 403", async () => {
      const res = await request(app)
        .get("/api/admin/queues/metrics")
        .set("Cookie", accountAdminAToken)
      assert.strictEqual(res.status, 403)
    })

    await runTest("GET /api/admin/queues/metrics succeeds for Super Admin with 200 and metrics breakdown", async () => {
      const res = await request(app)
        .get("/api/admin/queues/metrics")
        .set("Cookie", superAdminToken)

      assert.strictEqual(res.status, 200)
      assert.strictEqual(res.body.success, true)
      assert(typeof res.body.data.metrics.pending === "number")
      assert(typeof res.body.data.metrics.completed === "number")
      assert(typeof res.body.data.metrics.dead_letter === "number")
      assert(Array.isArray(res.body.data.schedules))
    })

    await runTest("GET /api/admin/queues/jobs returns paginated job listing for Super Admin", async () => {
      const res = await request(app)
        .get("/api/admin/queues/jobs?limit=5")
        .set("Cookie", superAdminToken)

      assert.strictEqual(res.status, 200)
      assert(Array.isArray(res.body.data))
      assert(res.body.pagination.total >= 1)
    })

    await runTest("GET /api/admin/queues/dead-letter lists dead letter jobs for Super Admin", async () => {
      const res = await request(app)
        .get("/api/admin/queues/dead-letter")
        .set("Cookie", superAdminToken)

      assert.strictEqual(res.status, 200)
      assert(Array.isArray(res.body.data))
      assert(res.body.data.length >= 1)
    })

    // ----------------------------------------------------
    // SUITE 8: Request Handler Heavy Work Offloading
    // ----------------------------------------------------
    console.log("\n▶ SUITE 8: Request Handler Heavy Work Offloading")

    await runTest("POST /api/leads/bulk-assign?async=true returns 202 Accepted with queued: true", async () => {
      const res = await request(app)
        .post("/api/leads/bulk-assign?async=true")
        .set("Cookie", accountAdminAToken)
        .send({
          leadIds: [testLead1._id.toString(), testLead2._id.toString()],
          targetOwnerId: null, // Send to pool
          reason: "Async queue test",
        })

      assert.strictEqual(res.status, 202)
      assert.strictEqual(res.body.success, true)
      assert.strictEqual(res.body.queued, true)
      assert(res.body.jobId.startsWith("job_"))

      // Verify the queued job was added to MongoDB
      const jobInDb = await Job.findOne({ jobId: res.body.jobId })
      assert(jobInDb, "Job document must exist in database")
      assert.strictEqual(jobInDb.name, "lead.bulk_assign")
      assert.strictEqual(jobInDb.tenantId, TENANT_A)
    })

    await runTest("POST /api/integrations/leads/website with x-queue-async: true returns 202 with queued: true", async () => {
      // Create active feed config for Tenant A
      const rawApiKey = `lf_live_test_${Date.now()}`
      const keyHash = require("crypto").createHash("sha256").update(rawApiKey).digest("hex")

      await LeadFeedConfig.create({
        tenantId: TENANT_A,
        websiteSource: {
          enabled: true,
          apiKeyHash: keyHash,
          apiKeyMasked: "lf_live_••••••••1234",
          allowedOrigins: ["*"],
          emailVerification: { allowPhoneOnly: true },
        },
      })

      const res = await request(app)
        .post("/api/integrations/leads/website")
        .set("x-api-key", rawApiKey)
        .set("x-queue-async", "true")
        .send({
          name: "Async Webhook Lead",
          email: `async.webhook.${TEST_TAG}@test.com`,
          phone: "+919999888877",
          message: "Enqueued from website",
        })

      assert.strictEqual(res.status, 202)
      assert.strictEqual(res.body.success, true)
      assert.strictEqual(res.body.queued, true)
      assert(res.body.jobId.startsWith("job_"))

      // Verify job was stored in Job collection
      const jobInDb = await Job.findOne({ jobId: res.body.jobId })
      assert(jobInDb, "Job document must exist in database")
      assert.strictEqual(jobInDb.name, "webhook.process")
      assert.strictEqual(jobInDb.tenantId, TENANT_A)
    })
  } finally {
    console.log("\n========================================================")
    console.log(`  PHASE 9 TESTS COMPLETED: ${totalPassed} PASSED, ${totalFailed} FAILED`)
    console.log("========================================================\n")
  }
}

if (require.main === module) {
  runPhase9Verification()
    .then(() => {
      process.exit(totalFailed > 0 ? 1 : 0)
    })
    .catch((err) => {
      console.error("Fatal test runner error:", err)
      process.exit(1)
    })
}

module.exports = { runPhase9Verification }
