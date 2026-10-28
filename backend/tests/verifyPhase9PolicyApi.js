const request = require("supertest")
const mongoose = require("mongoose")
const jwt = require("jsonwebtoken")
const dotenv = require("dotenv")
const path = require("path")
const dns = require("dns")

try {
  dns.setServers(["8.8.8.8", "1.1.1.1"])
} catch (_) {}

process.env.NODE_ENV = "test"
dotenv.config({ path: path.join(__dirname, "../.env") })

const app = require("../start")
const User = require("../models/User")
const Account = require("../models/Account")
const Lead = require("../models/Lead")
const MobileSyncTombstone = require("../models/MobileSyncTombstone")

const JWT_SECRET = process.env.JWT_SECRET || "leadflow-dev-secret-key-min32-chars-for-local-only"

const results = []

const recordTest = (name, passed, error) => {
  results.push({ name, passed, error })
  const icon = passed ? "  ✅ PASS:" : "  ❌ FAIL:"
  console.log(`${icon} ${name}`)
  if (error) {
    console.log(`     Error: ${error}`)
  }
}

async function runPhase9PolicyApiTests() {
  console.log("\n=======================================================")
  console.log("   PHASE 9 PRIVACY CONTROLS & DNR API SUITE            ")
  console.log("=======================================================\n")

  if (mongoose.connection.readyState !== 1) {
    const mongoURI = process.env.MONGODB_URI
    if (!mongoURI) {
      throw new Error("MONGODB_URI not defined in environment variables")
    }
    await mongoose.connect(mongoURI)
  }

  const TEST_ID = `p9_${Date.now()}`
  const TENANT_ID = `ACC-P9-${TEST_ID}`

  let user, account, leadDnr, leadNormal
  let token

  try {
    // 1. Create User
    user = await User.create({
      name: `Agent ${TEST_ID}`,
      email: `agent_${TEST_ID}@leads365.test`,
      password: "HashedPassword123!",
      role: "agent",
      tenantId: TENANT_ID,
      status: "active",
    })

    // 2. Create Test Account with Privacy Policy Metadata
    account = await Account.create({
      accountId: TENANT_ID,
      companyName: "Acme Insurance Agency",
      displayName: "Acme Insurance Agency",
      plan: "pro",
      status: "active",
      adminUserId: user._id,
      adminName: user.name,
      adminEmail: user.email,
      metadata: {
        requireConsentReminder: true,
        consentNoticeText: "Notice: Calls are recorded for compliance.",
        recordingSyncPaused: false,
      },
    })

    token = jwt.sign(
      {
        id: user._id.toString(),
        name: user.name,
        email: user.email,
        role: user.role,
        tenantId: user.tenantId,
      },
      JWT_SECRET,
      { expiresIn: "1h" }
    )

    // 3. Create normal lead and DNR lead
    leadNormal = await Lead.create({
      tenantId: TENANT_ID,
      assignedStaffId: user._id.toString(),
      name: "Normal Lead",
      phone: "+12025550190",
      status: "New",
      metadata: {
        isDoNotRecord: false,
      },
    })

    leadDnr = await Lead.create({
      tenantId: TENANT_ID,
      assignedStaffId: user._id.toString(),
      name: "DNR Protected Lead",
      phone: "+12025550191",
      status: "New",
      metadata: {
        isDoNotRecord: true,
      },
    })

    // Test 1: Unauthenticated GET /api/mobile/v1/policy returns 401
    const unauthRes = await request(app).get("/api/mobile/v1/policy")
    recordTest("GET /api/mobile/v1/policy returns 401 unauthenticated", unauthRes.status === 401)

    // Test 2: Authenticated GET /api/mobile/v1/policy returns agency policy
    const policyRes = await request(app)
      .get("/api/mobile/v1/policy")
      .set("Authorization", `Bearer ${token}`)

    const pData = policyRes.body.data
    const policyPass =
      policyRes.status === 200 &&
      policyRes.body.success === true &&
      pData.agency_name === "Acme Insurance Agency" &&
      pData.require_consent_reminder === true &&
      pData.consent_notice_text === "Notice: Calls are recorded for compliance." &&
      pData.allow_recording_pause === true &&
      pData.recording_sync_paused === false &&
      pData.enforce_strict_dnr === true

    recordTest("GET /api/mobile/v1/policy returns complete agency policy metadata", policyPass)

    // Test 3: Unauthenticated POST /api/mobile/v1/policy/pause returns 401
    const unauthPauseRes = await request(app)
      .post("/api/mobile/v1/policy/pause")
      .send({ paused: true })
    recordTest("POST /api/mobile/v1/policy/pause returns 401 unauthenticated", unauthPauseRes.status === 401)

    // Test 4: Invalid body POST /api/mobile/v1/policy/pause returns 400
    const invalidPauseRes = await request(app)
      .post("/api/mobile/v1/policy/pause")
      .set("Authorization", `Bearer ${token}`)
      .send({ paused: "not_a_boolean" })
    recordTest("POST /api/mobile/v1/policy/pause returns 400 for non-boolean payload", invalidPauseRes.status === 400)

    // Test 5: Pause recording sync via POST /api/mobile/v1/policy/pause
    const pauseRes = await request(app)
      .post("/api/mobile/v1/policy/pause")
      .set("Authorization", `Bearer ${token}`)
      .send({ paused: true })

    const pausePass =
      pauseRes.status === 200 &&
      pauseRes.body.success === true &&
      pauseRes.body.recording_sync_paused === true

    recordTest("POST /api/mobile/v1/policy/pause pauses recording sync", pausePass)

    // Test 6: Policy endpoint reflects paused state
    const policyAfterPause = await request(app)
      .get("/api/mobile/v1/policy")
      .set("Authorization", `Bearer ${token}`)

    recordTest(
      "GET /api/mobile/v1/policy reflects updated paused state",
      policyAfterPause.status === 200 && policyAfterPause.body.data.recording_sync_paused === true
    )

    // Test 7: Resume recording sync via POST /api/mobile/v1/policy/pause
    const resumeRes = await request(app)
      .post("/api/mobile/v1/policy/pause")
      .set("Authorization", `Bearer ${token}`)
      .send({ paused: false })

    const resumePass =
      resumeRes.status === 200 &&
      resumeRes.body.success === true &&
      resumeRes.body.recording_sync_paused === false

    recordTest("POST /api/mobile/v1/policy/pause resumes recording sync", resumePass)

    // Test 8: Lead sync delivers is_do_not_record flag per-lead
    const syncRes = await request(app)
      .get("/api/mobile/v1/leads/sync")
      .set("Authorization", `Bearer ${token}`)

    const leads = syncRes.body.data?.leads || []
    const normalLeadSynced = leads.find((l) => l.id === leadNormal._id.toString())
    const dnrLeadSynced = leads.find((l) => l.id === leadDnr._id.toString())

    const dnrSyncPass =
      syncRes.status === 200 &&
      normalLeadSynced &&
      normalLeadSynced.is_do_not_record === false &&
      dnrLeadSynced &&
      dnrLeadSynced.is_do_not_record === true

    recordTest("GET /api/mobile/v1/leads/sync accurately delivers per-lead DNR flags", dnrSyncPass)

    // Test 9: Lead tombstone delivered on delta sync for local data cleanup
    const tombstoneTimestamp = new Date(Date.now() - 1000)
    await MobileSyncTombstone.create({
      tenantId: TENANT_ID,
      assignedStaffId: user._id.toString(),
      leadId: leadNormal._id.toString(),
      timestamp: tombstoneTimestamp,
    })

    const deltaSyncRes = await request(app)
      .get(`/api/mobile/v1/leads/sync?since=${Date.now() - 5000}`)
      .set("Authorization", `Bearer ${token}`)

    const deletedIds = deltaSyncRes.body.data?.deleted_lead_ids || []
    const tombstonePass =
      deltaSyncRes.status === 200 &&
      deletedIds.includes(leadNormal._id.toString())

    recordTest("Delta sync delivers deleted_lead_ids for local lead data removal", tombstonePass)

  } catch (err) {
    console.error("Test execution fatal error:", err)
    recordTest("Fatal test runner error", false, err.message)
  } finally {
    console.log("\nCleaning up test fixtures...")
    try {
      await Account.deleteMany({ accountId: TENANT_ID })
      await User.deleteMany({ email: { $regex: TEST_ID } })
      await Lead.deleteMany({ tenantId: TENANT_ID })
      await MobileSyncTombstone.deleteMany({ tenantId: TENANT_ID })
      console.log("Cleanup completed.")
    } catch (cleanErr) {
      console.warn("Cleanup warning:", cleanErr.message)
    }

    const total = results.length
    const passed = results.filter((r) => r.passed).length
    const failed = results.filter((r) => !r.passed).length

    console.log("\n=======================================================")
    console.log("             TEST EXECUTION SUMMARY                    ")
    console.log("=======================================================")
    console.log(`Total Tests Run: ${total}`)
    console.log(`Passed:          ${passed}`)
    console.log(`Failed:          ${failed}`)
    console.log("=======================================================\n")

    if (failed > 0) {
      process.exit(1)
    } else {
      console.log("🎉 ALL PHASE 9 POLICY & DNR API TESTS PASSED!\n")
    }
  }
}

if (require.main === module) {
  runPhase9PolicyApiTests()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err)
      process.exit(1)
    })
}

module.exports = runPhase9PolicyApiTests
