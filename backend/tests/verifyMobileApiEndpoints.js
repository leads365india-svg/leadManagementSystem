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
const Call = require("../models/Call")
const FollowUp = require("../models/FollowUp")
const Device = require("../models/Device")
const MobileSyncTombstone = require("../models/MobileSyncTombstone")
const RolePermission = require("../models/RolePermission")

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

async function runMobileApiTests() {
  console.log("\n=======================================================")
  console.log("   MOBILE API INTEGRATION (AUTH, SYNC, CALLS) SUITE    ")
  console.log("=======================================================\n")

  if (mongoose.connection.readyState !== 1) {
    const mongoURI = process.env.MONGODB_URI
    if (!mongoURI) {
      throw new Error("MONGODB_URI not defined in environment variables")
    }
    await mongoose.connect(mongoURI)
  }

  const TEST_ID = `mob_${Date.now()}`
  const TENANT_A = `ACC-MOB-A-${TEST_ID}`
  const TENANT_B = `ACC-MOB-B-${TEST_ID}`

  let agentA1User, agentA2User, agentBUser
  let leadA1, leadA2, leadB, leadDnr
  let loginTokenA1, loginRefreshTokenA1

  try {
    console.log("Setting up mobile test fixtures...")

    // 1. Create Agent Users
    agentA1User = await User.create({
      name: `Agent A1 ${TEST_ID}`,
      email: `agent_a1_${TEST_ID}@test.com`,
      password: "TestPassword123!",
      role: "agent",
      tenantId: TENANT_A,
      status: "active",
    })

    agentA2User = await User.create({
      name: `Agent A2 ${TEST_ID}`,
      email: `agent_a2_${TEST_ID}@test.com`,
      password: "TestPassword123!",
      role: "agent",
      tenantId: TENANT_A,
      status: "active",
    })

    agentBUser = await User.create({
      name: `Agent B ${TEST_ID}`,
      email: `agent_b_${TEST_ID}@test.com`,
      password: "TestPassword123!",
      role: "agent",
      tenantId: TENANT_B,
      status: "active",
    })

    // 2. Create Tenant Accounts
    await Account.create([
      {
        accountId: TENANT_A,
        companyName: `Tenant A Mobile ${TEST_ID}`,
        displayName: `Tenant A Mobile`,
        adminUserId: agentA1User._id,
        adminName: agentA1User.name,
        adminEmail: agentA1User.email,
        status: "active",
      },
      {
        accountId: TENANT_B,
        companyName: `Tenant B Mobile ${TEST_ID}`,
        displayName: `Tenant B Mobile`,
        adminUserId: agentBUser._id,
        adminName: agentBUser.name,
        adminEmail: agentBUser.email,
        status: "active",
      },
    ])

    // Ensure permissions for agent
    await RolePermission.findOneAndUpdate(
      { targetRole: "agent" },
      { targetRole: "agent", permissions: ["leads.view", "leads.edit", "leads.delete", "dashboard.view"] },
      { upsert: true, new: true }
    )

    // 3. Create Leads
    leadA1 = await Lead.create({
      name: "Alice Johnson",
      email: `alice_${TEST_ID}@example.com`,
      phone: "+12025550101",
      status: "New",
      tenantId: TENANT_A,
      assignedStaffId: agentA1User._id.toString(),
      assignedTo: agentA1User.name,
      metadata: { normalizedPhone: "+12025550101", notes: "Prefers morning calls" },
    })

    leadA2 = await Lead.create({
      name: "Bob Smith",
      email: `bob_${TEST_ID}@example.com`,
      phone: "+12025550102",
      status: "Engaged",
      tenantId: TENANT_A,
      assignedStaffId: agentA2User._id.toString(),
      assignedTo: agentA2User.name,
      metadata: { normalizedPhone: "+12025550102" },
    })

    leadB = await Lead.create({
      name: "Charlie Brown",
      email: `charlie_${TEST_ID}@example.com`,
      phone: "+12025550103",
      status: "New",
      tenantId: TENANT_B,
      assignedStaffId: agentBUser._id.toString(),
      assignedTo: agentBUser.name,
      metadata: { normalizedPhone: "+12025550103" },
    })

    leadDnr = await Lead.create({
      name: "Do Not Record Lead",
      email: `dnr_${TEST_ID}@example.com`,
      phone: "+12025550104",
      status: "New",
      tenantId: TENANT_A,
      assignedStaffId: agentA1User._id.toString(),
      assignedTo: agentA1User.name,
      metadata: { normalizedPhone: "+12025550104", isDoNotRecord: true },
    })

    console.log("Fixtures created. Executing tests...\n")

    // =========================================================================
    // SUITE 1: Mobile Authentication (Login, Refresh, Logout, Device Registration)
    // =========================================================================
    console.log("📋 Suite 1: Mobile Authentication, Token Management & Device Registration")

    // Test 1: Missing credentials returns 400 Bad Request
    const missingCredsRes = await request(app).post("/api/mobile/v1/auth/login").send({})
    recordTest("POST /auth/login rejects missing credentials with 400 Bad Request", missingCredsRes.status === 400)

    // Test 2: Invalid password returns 401 Unauthorized
    const invalidPassRes = await request(app).post("/api/mobile/v1/auth/login").send({
      email: agentA1User.email,
      password: "WrongPassword999!",
    })
    recordTest("POST /auth/login rejects invalid credentials with 401 Unauthorized", invalidPassRes.status === 401)

    // Test 3: Successful mobile login returns 200 with tokens and agency metadata matching Android AuthData
    const loginRes = await request(app).post("/api/mobile/v1/auth/login").send({
      email: agentA1User.email,
      password: "TestPassword123!",
      deviceId: "dev_initial_test",
    })

    const loginData = loginRes.body?.data
    const loginValid =
      loginRes.status === 200 &&
      loginRes.body.success === true &&
      typeof loginData?.accessToken === "string" &&
      typeof loginData?.refreshToken === "string" &&
      loginData?.user?.id === agentA1User._id.toString() &&
      loginData?.user?.email === agentA1User.email &&
      loginData?.agency?.accountId === TENANT_A &&
      loginData?.isRevoked === false

    loginTokenA1 = loginData?.accessToken
    loginRefreshTokenA1 = loginData?.refreshToken
    recordTest("POST /auth/login returns valid tokens, user DTO and agency matching Android contract", loginValid)

    // Test 4: Device registration creates device record in MongoDB
    const regDeviceRes = await request(app)
      .post("/api/mobile/v1/devices/register")
      .set("Authorization", `Bearer ${loginTokenA1}`)
      .send({
        deviceModel: "V2111",
        manufacturer: "vivo",
        osVersion: "12",
        sdkInt: 31,
        appVersionCode: 1,
        appVersionName: "1.0.0-phase2",
        fcmToken: "sample_fcm_token_123",
      })

    const registeredDeviceId = regDeviceRes.body?.data?.deviceId
    const deviceInDb = registeredDeviceId ? await Device.findOne({ deviceId: registeredDeviceId }) : null
    const regDeviceValid =
      regDeviceRes.status === 200 &&
      regDeviceRes.body.success === true &&
      regDeviceRes.body.data?.status === "ACTIVE" &&
      deviceInDb &&
      deviceInDb.deviceModel === "V2111" &&
      deviceInDb.tenantId === TENANT_A

    recordTest("POST /devices/register creates active device record with tenant isolation", Boolean(regDeviceValid))

    // Test 5: Token refresh generates new valid access and refresh tokens
    const refreshRes = await request(app).post("/api/mobile/v1/auth/refresh").send({
      refreshToken: loginRefreshTokenA1,
    })

    const refreshValid =
      refreshRes.status === 200 &&
      typeof refreshRes.body.accessToken === "string" &&
      typeof refreshRes.body.refreshToken === "string" &&
      refreshRes.body.expiresInSec > 0

    const refreshedAccessToken = refreshRes.body.accessToken
    recordTest("POST /auth/refresh successfully delivers fresh accessToken and refreshToken pair", refreshValid)

    // Test 6: Device Revocation marks status REVOKED and blocks authenticated access
    const revokeRes = await request(app)
      .post(`/api/mobile/v1/devices/${registeredDeviceId}/revoke`)
      .set("Authorization", `Bearer ${refreshedAccessToken}`)

    recordTest("Device revocation endpoint successfully marks device status as REVOKED", revokeRes.status === 200 && revokeRes.body.data?.status === "REVOKED")

    // Test 7: Middleware enforces revocation check when x-device-id header matches revoked device
    const revokedRequestRes = await request(app)
      .get("/api/mobile/v1/leads/sync")
      .set("Authorization", `Bearer ${refreshedAccessToken}`)
      .set("x-device-id", registeredDeviceId)

    recordTest("Requests from revoked devices are blocked by middleware with 403 Forbidden (DEVICE_REVOKED)", revokedRequestRes.status === 403 && revokedRequestRes.body.errorCode === "DEVICE_REVOKED")

    // Test 8: Login with revoked device flag returns isRevoked: true
    const revokedLoginRes = await request(app).post("/api/mobile/v1/auth/login").send({
      email: agentA1User.email,
      password: "TestPassword123!",
      deviceId: registeredDeviceId,
    })

    recordTest("Login with revoked device flag returns isRevoked: true to trigger client-side session cleanup", revokedLoginRes.status === 200 && revokedLoginRes.body.data?.isRevoked === true)

    // Test 9: Mobile logout returns 200 success
    const logoutRes = await request(app)
      .post("/api/mobile/v1/auth/logout")
      .set("Authorization", `Bearer ${refreshedAccessToken}`)

    recordTest("POST /auth/logout returns 200 OK", logoutRes.status === 200 && logoutRes.body.success === true)

    // =========================================================================
    // SUITE 2: Phase 5 Mobile Lead Delta Sync & Ownership
    // =========================================================================
    console.log("\n📋 Suite 2: Phase 5 Mobile Lead Delta Sync & Ownership Scoping")

    // Login Agent A2 to get real mobile session token
    const loginResA2 = await request(app).post("/api/mobile/v1/auth/login").send({
      email: agentA2User.email,
      password: "TestPassword123!",
    })
    const tokenA2 = loginResA2.body.data.accessToken

    // Test 10: Agent A1 sync returns only Lead A1 and DNR lead, NOT Lead A2 or Lead B
    const syncResA1 = await request(app)
      .get("/api/mobile/v1/leads/sync")
      .set("Authorization", `Bearer ${refreshedAccessToken}`)

    const a1LeadIds = (syncResA1.body.data?.leads || []).map((l) => l.id)
    const hasOnlyA1Leads =
      syncResA1.status === 200 &&
      syncResA1.body.success === true &&
      a1LeadIds.includes(leadA1._id.toString()) &&
      a1LeadIds.includes(leadDnr._id.toString()) &&
      !a1LeadIds.includes(leadA2._id.toString()) &&
      !a1LeadIds.includes(leadB._id.toString())

    recordTest("Initial sync using real mobile session returns only leads assigned to authenticated agent & tenant", hasOnlyA1Leads)

    // Test 11: Delta sync with watermark in future returns 0 leads
    const watermarkBeforeChanges = Date.now()
    await new Promise((resolve) => setTimeout(resolve, 50))

    const deltaSyncEmpty = await request(app)
      .get(`/api/mobile/v1/leads/sync?since=${watermarkBeforeChanges + 10000}`)
      .set("Authorization", `Bearer ${refreshedAccessToken}`)

    recordTest("Delta sync with future watermark returns empty leads list", deltaSyncEmpty.body.data?.leads?.length === 0)

    // Test 12: Updating lead metadata reflects in delta sync after timestamp
    await new Promise((resolve) => setTimeout(resolve, 50))
    const deltaSyncWatermark = Date.now()
    await new Promise((resolve) => setTimeout(resolve, 50))

    await Lead.findByIdAndUpdate(leadA1._id, { status: "Engaged", updatedAt: new Date() })

    const deltaSyncUpdated = await request(app)
      .get(`/api/mobile/v1/leads/sync?since=${deltaSyncWatermark}`)
      .set("Authorization", `Bearer ${refreshedAccessToken}`)

    const deltaLeads = deltaSyncUpdated.body.data?.leads || []
    const updatedLeadFound = deltaLeads.some((l) => l.id === leadA1._id.toString() && l.status === "Engaged")
    recordTest("Delta sync returns updated lead when modified after watermark", updatedLeadFound)

    // Test 13: Lead Reassignment generates Tombstone for Old Agent & Delivers to New Agent
    const reassignmentWatermark = Date.now()
    await new Promise((resolve) => setTimeout(resolve, 50))

    // Reassign leadA1 from Agent A1 to Agent A2 via CRM updateLead
    await request(app)
      .put(`/api/leads/${leadA1._id}`)
      .set("Authorization", `Bearer ${refreshedAccessToken}`)
      .send({
        assignedStaffId: agentA2User._id.toString(),
        assignedTo: agentA2User.name,
      })

    // Now Agent A1 does delta sync: leadA1 should appear in deleted_lead_ids
    const a1ReassignedSync = await request(app)
      .get(`/api/mobile/v1/leads/sync?since=${reassignmentWatermark}`)
      .set("Authorization", `Bearer ${refreshedAccessToken}`)

    const a1DeletedIds = a1ReassignedSync.body.data?.deleted_lead_ids || []
    recordTest("Reassigning lead creates tombstone and returns lead ID in deleted_lead_ids for previous agent", a1DeletedIds.includes(leadA1._id.toString()))

    // Agent A2 does delta sync: leadA1 should appear in leads list
    const a2ReassignedSync = await request(app)
      .get(`/api/mobile/v1/leads/sync?since=${reassignmentWatermark}`)
      .set("Authorization", `Bearer ${tokenA2}`)

    const a2LeadIds = (a2ReassignedSync.body.data?.leads || []).map((l) => l.id)
    recordTest("New assigned agent receives the reassigned lead in delta sync", a2LeadIds.includes(leadA1._id.toString()))

    // Test 14: Lead Deletion generates Tombstone and returns in deleted_lead_ids
    const deletionWatermark = Date.now()
    await new Promise((resolve) => setTimeout(resolve, 50))

    // Create a temporary lead for Agent A1 to delete
    const tempLead = await Lead.create({
      name: "Temporary Lead",
      email: `temp_${TEST_ID}@example.com`,
      phone: "+12025550199",
      status: "New",
      tenantId: TENANT_A,
      assignedStaffId: agentA1User._id.toString(),
      assignedTo: agentA1User.name,
    })

    // Delete the lead via CRM API
    await request(app)
      .delete(`/api/leads/${tempLead._id}`)
      .set("Authorization", `Bearer ${refreshedAccessToken}`)

    const a1DeleteSync = await request(app)
      .get(`/api/mobile/v1/leads/sync?since=${deletionWatermark}`)
      .set("Authorization", `Bearer ${refreshedAccessToken}`)

    const deletedIds = a1DeleteSync.body.data?.deleted_lead_ids || []
    recordTest("Lead deletion records tombstone and delta sync returns lead ID in deleted_lead_ids", deletedIds.includes(tempLead._id.toString()))

    // =========================================================================
    // SUITE 3: Phase 6 Call Reporting, Validation & Idempotency
    // =========================================================================
    console.log("\n📋 Suite 3: Phase 6 Mobile Call Reporting, Ownership & Idempotency")

    // Test 15: Validation error on missing required fields
    const missingFieldsRes = await request(app)
      .post("/api/mobile/v1/calls")
      .set("Authorization", `Bearer ${refreshedAccessToken}`)
      .send({ client_call_id: "call-1" })

    recordTest("Rejects call report missing lead_id or phone_number with 400 Bad Request", missingFieldsRes.status === 400)

    // Test 16: Cross-tenant call reporting rejected (Agent A1 tries to report call on Tenant B lead)
    const crossTenantRes = await request(app)
      .post("/api/mobile/v1/calls")
      .set("Authorization", `Bearer ${refreshedAccessToken}`)
      .send({
        client_call_id: `call-cross-${TEST_ID}`,
        lead_id: leadB._id.toString(),
        phone_number: leadB.phone,
        call_direction: "OUTGOING",
        start_time_ms: Date.now() - 60000,
        duration_seconds: 45,
      })

    recordTest("Rejects cross-tenant call reporting with 403 Forbidden", crossTenantRes.status === 403)

    // Test 17: Unassigned lead call reporting rejected (Agent A1 tries to report call on Lead A2 assigned to Agent A2)
    const unassignedAgentRes = await request(app)
      .post("/api/mobile/v1/calls")
      .set("Authorization", `Bearer ${refreshedAccessToken}`)
      .send({
        client_call_id: `call-unauth-${TEST_ID}`,
        lead_id: leadA2._id.toString(),
        phone_number: leadA2.phone,
        call_direction: "OUTGOING",
        start_time_ms: Date.now() - 60000,
        duration_seconds: 45,
      })

    recordTest("Rejects call report for lead assigned to a different agent with 403 Forbidden", unassignedAgentRes.status === 403)

    // Test 18: DNR (Do-Not-Record) call reporting rejected
    const dnrRes = await request(app)
      .post("/api/mobile/v1/calls")
      .set("Authorization", `Bearer ${refreshedAccessToken}`)
      .send({
        client_call_id: `call-dnr-${TEST_ID}`,
        lead_id: leadDnr._id.toString(),
        phone_number: leadDnr.phone,
        call_direction: "OUTGOING",
        start_time_ms: Date.now() - 60000,
        duration_seconds: 45,
      })

    recordTest("Rejects call report on Do-Not-Record (DNR) lead with 400 Bad Request", dnrRes.status === 400 && dnrRes.body.error.includes("Do-Not-Record"))

    // Test 19: Successful call report creation by assigned agent
    const callTimeMs = Date.now() - 120000
    const nextFollowUpMs = Date.now() + 86400000 // 1 day in future
    const clientCallId = `client-call-success-${TEST_ID}`

    const validCallRes = await request(app)
      .post("/api/mobile/v1/calls")
      .set("Authorization", `Bearer ${tokenA2}`)
      .send({
        client_call_id: clientCallId,
        lead_id: leadA2._id.toString(),
        phone_number: "+12025550102",
        call_direction: "OUTGOING",
        start_time_ms: callTimeMs,
        duration_seconds: 88,
        call_outcome: "Proposal Sent",
        notes: "Discussed enterprise pricing tier.",
        next_followup_at: nextFollowUpMs,
        sim_id: "SIM_1",
      })

    const callCreated = validCallRes.status === 201 && validCallRes.body.success === true && Boolean(validCallRes.body.call_id)
    recordTest("Valid call report succeeds with 201 Created and returns call_id", callCreated)

    const savedCallId = validCallRes.body.call_id

    // Test 20: Verify DB updates: Call record, Lead status, Lead metadata, FollowUp task
    const dbCall = await Call.findById(savedCallId)
    const dbLead = await Lead.findById(leadA2._id)
    const dbFollowUp = await FollowUp.findOne({ leadId: leadA2._id })

    const callRecordValid =
      dbCall &&
      dbCall.clientCallId === clientCallId &&
      dbCall.durationSeconds === 88 &&
      dbCall.callOutcome === "Proposal Sent" &&
      dbCall.agentId.toString() === agentA2User._id.toString()

    const leadUpdatedValid =
      dbLead &&
      dbLead.status === "Proposal Sent" &&
      dbLead.metadata?.lastCallOutcome === "Proposal Sent" &&
      dbLead.metadata?.lastCallNotes === "Discussed enterprise pricing tier." &&
      dbLead.metadata?.nextFollowUpAt === nextFollowUpMs

    const followUpCreated = dbFollowUp && dbFollowUp.assignedStaffId === agentA2User._id.toString()

    recordTest("Call record persisted in MongoDB with correct attributes", Boolean(callRecordValid))
    recordTest("CRM Lead status and metadata updated from call outcome & notes", Boolean(leadUpdatedValid))
    recordTest("Follow-up task scheduled automatically in CRM when next_followup_at provided", Boolean(followUpCreated))

    // Test 21: Idempotency guarantee: Resubmitting identical client_call_id returns 200 with same call_id without duplicating
    const idempotentRes = await request(app)
      .post("/api/mobile/v1/calls")
      .set("Authorization", `Bearer ${tokenA2}`)
      .send({
        client_call_id: clientCallId,
        lead_id: leadA2._id.toString(),
        phone_number: "+12025550102",
        call_direction: "OUTGOING",
        start_time_ms: callTimeMs,
        duration_seconds: 88,
        call_outcome: "Proposal Sent",
        notes: "Discussed enterprise pricing tier.",
      })

    const totalCallRecords = await Call.countDocuments({ clientCallId })
    const idempotentPass =
      idempotentRes.status === 200 &&
      idempotentRes.body.success === true &&
      idempotentRes.body.call_id === savedCallId &&
      totalCallRecords === 1

    recordTest("Idempotency verified: Duplicate client_call_id returns 200 with same call_id and 0 duplicate rows", idempotentPass)

    // Test 22: Agent call history GET /api/mobile/v1/calls
    const callsHistoryRes = await request(app)
      .get("/api/mobile/v1/calls")
      .set("Authorization", `Bearer ${tokenA2}`)

    const callsList = callsHistoryRes.body.data || []
    const foundCallInHistory = callsList.some((c) => c.clientCallId === clientCallId)
    recordTest("GET /api/mobile/v1/calls retrieves call history for authenticated agent", foundCallInHistory)

  } catch (err) {
    console.error("Test execution fatal error:", err)
    recordTest("Fatal test runner error", false, err.message)
  } finally {
    console.log("\nCleaning up mobile test fixtures...")
    try {
      await Account.deleteMany({ accountId: { $in: [TENANT_A, TENANT_B] } })
      await User.deleteMany({ email: { $regex: TEST_ID } })
      await Lead.deleteMany({ tenantId: { $in: [TENANT_A, TENANT_B] } })
      await Call.deleteMany({ tenantId: { $in: [TENANT_A, TENANT_B] } })
      await FollowUp.deleteMany({ tenantId: { $in: [TENANT_A, TENANT_B] } })
      await Device.deleteMany({ tenantId: { $in: [TENANT_A, TENANT_B] } })
      await MobileSyncTombstone.deleteMany({ tenantId: { $in: [TENANT_A, TENANT_B] } })
      await RolePermission.deleteMany({ targetRole: "agent" })
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
      console.log("🎉 ALL MOBILE INTEGRATION TESTS PASSED SUCCESSFULLY!\n")
    }
  }
}

if (require.main === module) {
  runMobileApiTests()
    .then(() => {
      process.exit(0)
    })
    .catch((err) => {
      console.error(err)
      process.exit(1)
    })
}

module.exports = runMobileApiTests
