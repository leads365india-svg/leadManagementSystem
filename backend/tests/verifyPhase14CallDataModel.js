const mongoose = require("mongoose")
const dotenv = require("dotenv")
const path = require("path")

dotenv.config({ path: path.join(__dirname, "../.env") })

const Call = require("../models/Call")
const Device = require("../models/Device")
const Lead = require("../models/Lead")
const User = require("../models/User")
const Team = require("../models/Team")
const Role = require("../models/Role")
const { Activity } = require("../models/Activity")
const callService = require("../services/callService")
const { runWithTenantContext } = require("../middleware/tenantContext")
const {
  createCallLog,
  getCallLogs,
  getCallReportMetrics,
  getCallById,
  updateCallLog,
  listDevices,
  registerDevice,
  updateDeviceStatus,
} = require("../controllers/callController")

async function runTests() {
  console.log("================================================================================")
  console.log("=== PHASE 14: CALL, DEVICE & RECORDING DATA MODEL - VERIFICATION SUITE       ===")
  console.log("================================================================================")

  const uri = process.env.MONGODB_URI
  if (!uri) {
    console.error("MONGODB_URI not found in environment!")
    process.exit(1)
  }

  await mongoose.connect(uri)
  console.log("Connected to MongoDB Atlas\n")

  let passed = 0
  let failed = 0

  function assert(condition, message) {
    if (condition) {
      console.log(`  [PASS] ${message}`)
      passed++
    } else {
      console.error(`  [FAIL] ${message}`)
      failed++
    }
  }

  const tenantA = "TEST-TENANT-P14-ALPHA"
  const tenantB = "TEST-TENANT-P14-BETA"

  try {
    // Clean previous test artifacts
    await Call.deleteMany({ tenantId: { $in: [tenantA, tenantB] } })
    await Device.deleteMany({ tenantId: { $in: [tenantA, tenantB] } })
    await Lead.deleteMany({ tenantId: { $in: [tenantA, tenantB] } })
    await User.deleteMany({ tenantId: { $in: [tenantA, tenantB] } })
    await Team.deleteMany({ tenantId: { $in: [tenantA, tenantB] } })
    await Role.deleteMany({ tenantId: { $in: [tenantA, tenantB] } })
    await Activity.deleteMany({ tenantId: { $in: [tenantA, tenantB] } })

    // 1. Create Roles for Tenant A
    const adminRoleA = await Role.create({
      tenantId: tenantA,
      name: "Tenant Admin",
      slug: "tenant_admin",
      description: "Full Admin",
      permissions: ["calls.view.all", "calls.manage", "calls.create", "devices.manage"],
      isSystem: true,
    })

    const agentRoleA = await Role.create({
      tenantId: tenantA,
      name: "Sales Agent",
      slug: "sales_agent",
      description: "Field Agent",
      permissions: ["calls.view.own", "calls.create"],
      isSystem: false,
    })

    // 2. Create Users for Tenant A
    const adminUserA = await User.create({
      tenantId: tenantA,
      name: "Admin User",
      email: "admin@tenant-alpha.test",
      password: "Password123!",
      role: "tenant_admin",
      roleId: adminRoleA._id,
      status: "active",
    })

    const agent1UserA = await User.create({
      tenantId: tenantA,
      name: "Agent Vikram",
      email: "vikram@tenant-alpha.test",
      password: "Password123!",
      role: "user",
      roleId: agentRoleA._id,
      status: "active",
    })

    const agent2UserA = await User.create({
      tenantId: tenantA,
      name: "Agent Priya",
      email: "priya@tenant-alpha.test",
      password: "Password123!",
      role: "user",
      roleId: agentRoleA._id,
      status: "active",
    })

    // Create User for Tenant B
    const userTenantB = await User.create({
      tenantId: tenantB,
      name: "Bob Beta",
      email: "bob@tenant-beta.test",
      password: "Password123!",
      role: "tenant_admin",
      status: "active",
    })

    console.log("--- TEST GROUP 1: SCHEMA VALIDATION & COMPOUND INDEXES ---")
    // Ensure indexes are built
    await Call.init()
    await Device.init()

    const callIndexes = await Call.collection.indexes()
    const callIndexKeyStrings = callIndexes.map((idx) => Object.keys(idx.key).sort().join("_"))

    const hasTenantLeadStartedIndex = callIndexes.some(
      (idx) => idx.key.tenantId === 1 && idx.key.leadId === 1 && idx.key.startedAt === -1
    )
    const hasTenantAgentStartedIndex = callIndexes.some(
      (idx) => idx.key.tenantId === 1 && idx.key.agentId === 1 && idx.key.startedAt === -1
    )
    const hasTenantRecStatusIndex = callIndexes.some(
      (idx) => idx.key.tenantId === 1 && idx.key["recording.status"] === 1
    )
    const hasTenantPhoneStartedIndex = callIndexes.some(
      (idx) => idx.key.tenantId === 1 && idx.key.phoneNormalized === 1 && idx.key.startedAt === -1
    )

    assert(hasTenantLeadStartedIndex, "Call schema has index { tenantId: 1, leadId: 1, startedAt: -1 }")
    assert(hasTenantAgentStartedIndex, "Call schema has index { tenantId: 1, agentId: 1, startedAt: -1 }")
    assert(hasTenantRecStatusIndex, "Call schema has index { tenantId: 1, 'recording.status': 1 }")
    assert(hasTenantPhoneStartedIndex, "Call schema has index { tenantId: 1, phoneNormalized: 1, startedAt: -1 }")

    const deviceIndexes = await Device.collection.indexes()
    const hasDeviceUserStatusIndex = deviceIndexes.some(
      (idx) => idx.key.tenantId === 1 && idx.key.userId === 1 && idx.key.status === 1
    )
    assert(hasDeviceUserStatusIndex, "Device schema has index { tenantId: 1, userId: 1, status: 1 }")

    console.log("\n--- TEST GROUP 2: CALL PRE-SAVE HOOK & PHONE NORMALIZATION ---")
    const callRawPhone = await runWithTenantContext(tenantA, async () => {
      return Call.create({
        agentId: agent1UserA._id,
        number: "09876543210",
        startedAt: new Date(Date.now() - 120000),
        endedAt: new Date(),
        duration: 120,
        direction: "outbound",
        status: "completed",
        disposition: "Interested",
      })
    })

    assert(callRawPhone.phoneNormalized === "+919876543210", "Pre-save hook normalized raw 10-digit number to +919876543210")
    assert(callRawPhone.recording && callRawPhone.recording.status === "pending", "Default recording subdocument initialized with status='pending'")
    assert(callRawPhone.tenantId === tenantA, "TenantIsolationPlugin applied tenantId automatically")

    console.log("\n--- TEST GROUP 3: PHONE MATCHING HELPER (findLeadByPhoneNumber) ---")
    // Create two leads in Tenant A with the same phone, but one owned by agent Vikram
    const lead1A = await runWithTenantContext(tenantA, async () => {
      return Lead.create({
        name: "Aakash Mehta",
        phone: "+919876543210",
        phoneNormalized: "+919876543210",
        ownerId: agent1UserA._id,
        status: "New",
      })
    })

    const lead2A = await runWithTenantContext(tenantA, async () => {
      return Lead.create({
        name: "Aakash Mehta (Duplicate Lead)",
        phone: "+919876543210",
        phoneNormalized: "+919876543210",
        ownerId: agent2UserA._id,
        status: "Engaged",
      })
    })

    // Lead in Tenant B with identical phone
    const leadB = await runWithTenantContext(tenantB, async () => {
      return Lead.create({
        name: "Cross-Tenant Lead",
        phone: "+919876543210",
        phoneNormalized: "+919876543210",
        ownerId: userTenantB._id,
        status: "New",
      })
    })

    // Agent 1 searches: should match lead1A (owned by Agent 1)
    const matchForAgent1 = await runWithTenantContext(tenantA, async () => {
      return callService.findLeadByPhoneNumber("09876543210", agent1UserA._id)
    })
    assert(matchForAgent1 && matchForAgent1._id.toString() === lead1A._id.toString(), "findLeadByPhoneNumber prioritizes lead owned by active agent")

    // Agent 2 searches: should match lead2A (owned by Agent 2)
    const matchForAgent2 = await runWithTenantContext(tenantA, async () => {
      return callService.findLeadByPhoneNumber("+919876543210", agent2UserA._id)
    })
    assert(matchForAgent2 && matchForAgent2._id.toString() === lead2A._id.toString(), "findLeadByPhoneNumber correctly prioritizes lead owned by Agent 2")

    // Admin without ownership searches: should match one of the Tenant A leads, never Tenant B
    const matchForAdmin = await runWithTenantContext(tenantA, async () => {
      return callService.findLeadByPhoneNumber("9876543210")
    })
    assert(
      matchForAdmin && [lead1A._id.toString(), lead2A._id.toString()].includes(matchForAdmin._id.toString()),
      "findLeadByPhoneNumber returns tenant lead when no agent match exists"
    )

    // Tenant B agent searches: should only find Tenant B lead
    const matchForTenantB = await runWithTenantContext(tenantB, async () => {
      return callService.findLeadByPhoneNumber("+91 98765 43210", userTenantB._id)
    })
    assert(matchForTenantB && matchForTenantB._id.toString() === leadB._id.toString(), "findLeadByPhoneNumber strictly isolates tenant searches")

    console.log("\n--- TEST GROUP 4: CALL LOGGING & TIMELINE ACTIVITY LINKING ---")
    const callLogResult = await runWithTenantContext(tenantA, async () => {
      return callService.logCall({
        agentId: agent1UserA._id,
        number: "+919876543210",
        direction: "outbound",
        duration: 95,
        status: "completed",
        disposition: "Interested",
        notes: "Client confirmed interest in product demo tomorrow at 3 PM",
        startedAt: new Date(Date.now() - 95000),
        endedAt: new Date(),
      })
    })

    assert(callLogResult.success === true, "callService.logCall succeeded")
    assert(callLogResult.data.leadId.toString() === lead1A._id.toString(), "Call automatically resolved and linked leadId via phone matching")

    // Verify timeline activity entry created
    const activityRecord = await Activity.findOne({
      tenantId: tenantA,
      leadId: lead1A._id,
      type: "call.logged",
    })
    assert(activityRecord !== null, "Activity collection has 'call.logged' entry")
    assert(activityRecord.payload.direction === "outbound", "Activity payload contains correct direction")
    assert(activityRecord.payload.duration === 95, "Activity payload contains call duration")
    assert(activityRecord.payload.callId.toString() === callLogResult.data._id.toString(), "Activity payload references callId")

    // Verify lead lastContactedAt updated
    const updatedLead = await Lead.findById(lead1A._id)
    assert(updatedLead.lastContactedAt !== null && updatedLead.lastContactedAt !== undefined, "Lead.lastContactedAt was updated on call logging")

    console.log("\n--- TEST GROUP 5: CALL MUTATION & DISPOSITION UPDATE ---")
    const updateResult = await runWithTenantContext(tenantA, async () => {
      return callService.updateCall(callLogResult.data._id, {
        disposition: "Follow-up Required",
        notes: "Updated note: Requested quotation on email",
      })
    })

    assert(updateResult.success === true, "callService.updateCall succeeded")
    assert(updateResult.data.disposition === "Follow-up Required", "Disposition updated to 'Follow-up Required'")
    assert(updateResult.data.notes === "Updated note: Requested quotation on email", "Notes successfully updated")

    console.log("\n--- TEST GROUP 6: CALL REPORT METRICS AGGREGATION ---")
    // Log additional test calls in Tenant A
    await runWithTenantContext(tenantA, async () => {
      // Inbound completed call (Agent 1)
      await callService.logCall({
        agentId: agent1UserA._id,
        leadId: lead1A._id,
        number: "+919876543210",
        direction: "inbound",
        duration: 180,
        status: "completed",
        disposition: "Interested",
      })

      // Outbound busy call (Agent 2)
      await callService.logCall({
        agentId: agent2UserA._id,
        leadId: lead2A._id,
        number: "+919876543210",
        direction: "outbound",
        duration: 0,
        status: "busy",
        disposition: "No Answer / Busy",
      })
    })

    const metricsResult = await runWithTenantContext(tenantA, async () => {
      return callService.getCallMetrics({})
    })

    assert(metricsResult.success === true, "getCallMetrics returned success")
    // We created: callRawPhone (120s, out), callLogResult (95s, out), inbound (180s, in), busy (0s, out) = 4 calls total
    assert(metricsResult.data.totalCalls === 4, `Total calls calculated correctly (expected 4, got ${metricsResult.data.totalCalls})`)
    assert(metricsResult.data.outboundCalls === 3, `Outbound calls counted correctly (expected 3, got ${metricsResult.data.outboundCalls})`)
    assert(metricsResult.data.inboundCalls === 1, `Inbound calls counted correctly (expected 1, got ${metricsResult.data.inboundCalls})`)
    assert(metricsResult.data.completedCalls === 3, `Completed calls counted correctly (expected 3, got ${metricsResult.data.completedCalls})`)
    assert(metricsResult.data.totalDurationSeconds === 395, `Total duration calculated correctly (expected 395s, got ${metricsResult.data.totalDurationSeconds}s)`)
    assert(metricsResult.data.connectRate === 75, `Connect rate calculated correctly (expected 75%, got ${metricsResult.data.connectRate}%)`)

    console.log("\n--- TEST GROUP 7: RBAC SCOPED CALL LISTING ---")
    // 1. Admin with "calls.view.all"
    const adminCallsList = await runWithTenantContext(tenantA, async () => {
      return callService.listCalls({}, adminUserA)
    })
    assert(adminCallsList.data.calls.length === 4, `Admin with 'all' scope sees all 4 calls (got ${adminCallsList.data.calls.length})`)

    // 2. Agent Vikram with "calls.view.own"
    const agent1CallsList = await runWithTenantContext(tenantA, async () => {
      return callService.listCalls({}, agent1UserA)
    })
    // Vikram logged 3 of the 4 calls (callRawPhone, callLogResult, inbound)
    assert(agent1CallsList.data.calls.length === 3, `Agent Vikram with 'own' scope only sees his 3 calls (got ${agent1CallsList.data.calls.length})`)
    const onlyOwnCalls = agent1CallsList.data.calls.every(
      (c) => (c.agentId._id || c.agentId).toString() === agent1UserA._id.toString()
    )
    assert(onlyOwnCalls, "All returned calls belong strictly to Vikram's agentId")

    console.log("\n--- TEST GROUP 8: MOBILE DEVICE REGISTRATION & MANAGEMENT ---")
    const deviceResult = await runWithTenantContext(tenantA, async () => {
      return callService.registerDevice({
        userId: agent1UserA._id,
        label: "Vikram's Galaxy S23",
        model: "SM-S911B",
        osVersion: "Android 14",
        appVersion: "1.4.2",
        pushToken: "fcm_token_sample_12345",
      })
    })

    assert(deviceResult.success === true, "registerDevice returned success")
    assert(deviceResult.data.status === "active", "Device registered as active")
    assert(deviceResult.data.tenantId === tenantA, "Device belongs to Tenant A")

    // Update status to revoked
    const revokeResult = await runWithTenantContext(tenantA, async () => {
      return callService.updateDeviceStatus(deviceResult.data._id, "revoked")
    })
    assert(revokeResult.success === true, "updateDeviceStatus returned success")
    assert(revokeResult.data.status === "revoked", "Device status changed to 'revoked'")

    // List devices in Tenant A
    const devicesList = await runWithTenantContext(tenantA, async () => {
      return callService.listDevices({})
    })
    assert(devicesList.data.devices.length === 1, "listDevices returned 1 device for Tenant A")

    console.log("\n--- TEST GROUP 9: CONTROLLER ENDPOINTS SIMULATION ---")
    // Mock req and res objects
    function createMockRes() {
      const res = {
        statusCode: 200,
        data: null,
        status: function (code) {
          this.statusCode = code
          return this
        },
        json: function (payload) {
          this.data = payload
          return this
        },
      }
      return res
    }

    // Test POST /api/calls
    const mockReqCreate = {
      tenantId: tenantA,
      user: agent1UserA,
      body: {
        number: "+919988776655",
        direction: "outbound",
        duration: 45,
        status: "completed",
        disposition: "Interested",
        notes: "API controller test call",
      },
    }
    const mockResCreate = createMockRes()
    await runWithTenantContext(tenantA, async () => {
      await createCallLog(mockReqCreate, mockResCreate)
    })
    assert(mockResCreate.statusCode === 201, `createCallLog returned HTTP 201 (got ${mockResCreate.statusCode})`)
    assert(mockResCreate.data.success === true, "createCallLog returned success: true")

    const createdCallId = mockResCreate.data.data._id

    // Test GET /api/calls/:id
    const mockReqGet = {
      tenantId: tenantA,
      user: adminUserA,
      params: { id: createdCallId },
    }
    const mockResGet = createMockRes()
    await runWithTenantContext(tenantA, async () => {
      await getCallById(mockReqGet, mockResGet)
    })
    assert(mockResGet.statusCode === 200, `getCallById returned HTTP 200 (got ${mockResGet.statusCode})`)
    assert(mockResGet.data.data.number === "+919988776655", "getCallById returned correct call data")

    // Test PATCH /api/calls/:id
    const mockReqUpdate = {
      tenantId: tenantA,
      user: adminUserA,
      params: { id: createdCallId },
      body: { disposition: "Closed-Won", notes: "Deal finalized" },
    }
    const mockResUpdate = createMockRes()
    await runWithTenantContext(tenantA, async () => {
      await updateCallLog(mockReqUpdate, mockResUpdate)
    })
    assert(mockResUpdate.statusCode === 200, `updateCallLog returned HTTP 200 (got ${mockResUpdate.statusCode})`)
    assert(mockResUpdate.data.data.disposition === "Closed-Won", "updateCallLog updated disposition")

    // Test GET /api/calls/metrics
    const mockReqMetrics = {
      tenantId: tenantA,
      user: adminUserA,
      query: {},
    }
    const mockResMetrics = createMockRes()
    await runWithTenantContext(tenantA, async () => {
      await getCallReportMetrics(mockReqMetrics, mockResMetrics)
    })
    assert(mockResMetrics.statusCode === 200, `getCallReportMetrics returned HTTP 200 (got ${mockResMetrics.statusCode})`)
    assert(mockResMetrics.data.data.totalCalls >= 5, "getCallReportMetrics aggregated call counts")

    console.log("\n--- TEST GROUP 10: MULTI-TENANT ISOLATION & SECURITY ---")
    // Cross-tenant Call access: Tenant B user attempts to fetch Tenant A's call
    const mockReqCrossGet = {
      tenantId: tenantB,
      user: userTenantB,
      params: { id: createdCallId },
    }
    const mockResCrossGet = createMockRes()
    await runWithTenantContext(tenantB, async () => {
      await getCallById(mockReqCrossGet, mockResCrossGet)
    })
    assert(mockResCrossGet.statusCode === 404, `Cross-tenant getCallById rejected with 404 (got ${mockResCrossGet.statusCode})`)

    // Cross-tenant Call update: Tenant B user attempts to update Tenant A's call
    const mockReqCrossUpdate = {
      tenantId: tenantB,
      user: userTenantB,
      params: { id: createdCallId },
      body: { disposition: "Hacked" },
    }
    const mockResCrossUpdate = createMockRes()
    await runWithTenantContext(tenantB, async () => {
      await updateCallLog(mockReqCrossUpdate, mockResCrossUpdate)
    })
    assert(mockResCrossUpdate.statusCode === 404, `Cross-tenant updateCallLog rejected with 404 (got ${mockResCrossUpdate.statusCode})`)

    // Cross-tenant Device listing: Tenant B listDevices should not return Tenant A's device
    const mockReqCrossDevices = {
      tenantId: tenantB,
      user: userTenantB,
      query: {},
    }
    const mockResCrossDevices = createMockRes()
    await runWithTenantContext(tenantB, async () => {
      await listDevices(mockReqCrossDevices, mockResCrossDevices)
    })
    assert(mockResCrossDevices.data.data.devices.length === 0, "Tenant B listDevices returns empty (0 devices from Tenant A)")

    // Clean up test data
    await Call.deleteMany({ tenantId: { $in: [tenantA, tenantB] } })
    await Device.deleteMany({ tenantId: { $in: [tenantA, tenantB] } })
    await Lead.deleteMany({ tenantId: { $in: [tenantA, tenantB] } })
    await User.deleteMany({ tenantId: { $in: [tenantA, tenantB] } })
    await Team.deleteMany({ tenantId: { $in: [tenantA, tenantB] } })
    await Role.deleteMany({ tenantId: { $in: [tenantA, tenantB] } })
    await Activity.deleteMany({ tenantId: { $in: [tenantA, tenantB] } })
  } catch (err) {
    console.error("Test execution failed with error:", err)
    failed++
  } finally {
    await mongoose.disconnect()
    console.log("\n================================================================================")
    console.log(`=== PHASE 14 VERIFICATION SUMMARY: ${passed} PASSED, ${failed} FAILED ===`)
    console.log("================================================================================")
    if (failed > 0) {
      process.exit(1)
    } else {
      process.exit(0)
    }
  }
}

runTests()
