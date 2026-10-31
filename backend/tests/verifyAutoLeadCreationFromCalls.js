const mongoose = require("mongoose")
const dotenv = require("dotenv")
const path = require("path")

dotenv.config({ path: path.join(__dirname, "../.env") })

const Call = require("../models/Call")
const Lead = require("../models/Lead")
const User = require("../models/User")
const Account = require("../models/Account")
const mobileController = require("../controllers/mobileController")
const mobileSyncService = require("../services/mobileSyncService")
const { runWithTenantContext } = require("../middleware/tenantContext")

async function invokeInTenant(tenantId, fn) {
  return runWithTenantContext({ tenantId, isSuperAdmin: false }, fn)
}

function createMockReqRes({ method = "POST", url = "/api/mobile/v1/calls", body = {}, user = null } = {}) {
  const req = {
    method,
    url,
    headers: {},
    body: { ...body },
    query: {},
    params: {},
    user,
    ip: "127.0.0.1",
    connection: { remoteAddress: "127.0.0.1" },
    get(headerName) {
      return this.headers[headerName.toLowerCase()] || this.headers[headerName]
    },
  }

  let statusCode = 200
  let responseData = null

  const res = {
    status(code) {
      statusCode = code
      return this
    },
    json(data) {
      responseData = data
      return this
    },
    send(data) {
      responseData = data
      return this
    },
    setHeader() {},
    getStatusCode: () => statusCode,
    getData: () => responseData,
  }

  return { req, res }
}

async function runTests() {
  console.log("================================================================================")
  console.log("=== VERIFY AUTOMATIC LEAD CREATION FROM ANSWERED INCOMING CALLS              ===")
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
      console.log(`  PASS: ${message}`)
      passed++
    } else {
      console.error(`  FAIL: ${message}`)
      failed++
    }
  }

  const testTenantA = "tenant_autolead_test_a_" + Date.now()
  const testTenantB = "tenant_autolead_test_b_" + Date.now()
  const agentUserA = {
    id: new mongoose.Types.ObjectId().toString(),
    _id: new mongoose.Types.ObjectId(),
    name: "Agent Priya",
    email: "priya@autolead.test",
    role: "agent",
    tenantId: testTenantA,
  }
  const agentUserB = {
    id: new mongoose.Types.ObjectId().toString(),
    _id: new mongoose.Types.ObjectId(),
    name: "Agent Vikram",
    email: "vikram@autolead.test",
    role: "agent",
    tenantId: testTenantB,
  }

  const phoneUnknown = "+919876500001"
  const phoneDnr = "+919876500002"
  const phoneAmbiguous = "+919876500003"

  try {
    // Initialize Tenant Accounts (Feature Default OFF)
    await Account.create({
      accountId: testTenantA,
      companyName: "Tenant A AutoLead Test Agency",
      displayName: "Tenant A AutoLead",
      adminUserId: agentUserA._id,
      adminName: "Admin A",
      adminEmail: "admin_a@test.com",
      status: "active",
      metadata: {
        autoLeadCaptureEnabled: false, // Default OFF
        autoLeadMinDurationSeconds: 10,
      },
    })

    await Account.create({
      accountId: testTenantB,
      companyName: "Tenant B AutoLead Test Agency",
      displayName: "Tenant B AutoLead",
      adminUserId: agentUserB._id,
      adminName: "Admin B",
      adminEmail: "admin_b@test.com",
      status: "active",
      metadata: {
        autoLeadCaptureEnabled: false, // Default OFF
        autoLeadMinDurationSeconds: 10,
      },
    })

    // -------------------------------------------------------------------------
    // TEST 0A: Server-controlled authorization: Default OFF rejects auto-creation
    // -------------------------------------------------------------------------
    console.log("\n[TEST 0A] Feature default OFF: Client requested auto-lead does NOT create a lead")
    const disabledClientCallId = `call_${testTenantA}_dev1_disabled_${Date.now()}`
    const { req: req0a, res: res0a } = createMockReqRes({
      body: {
        client_call_id: disabledClientCallId,
        lead_id: `lead_auto_disabled_${Date.now()}`,
        phone_number: "+919876500099",
        call_direction: "INCOMING",
        start_time_ms: Date.now() - 30000,
        duration_seconds: 25,
        call_outcome: "Connected",
        auto_create_lead: true,
      },
      user: agentUserA,
    })
    await invokeInTenant(agentUserA.tenantId, () => mobileController.reportMobileCall(req0a, res0a))
    const data0a = res0a.getData()
    assert(res0a.getStatusCode() === 201, `Status code is 201 (got ${res0a.getStatusCode()})`)
    assert(data0a.auto_lead_created === false, "auto_lead_created is false because feature is disabled on tenant")
    assert(data0a.lead_id === null, "lead_id is null; call saved as unlinked")

    const unlinkedLeadCheck = await Lead.findOne({ tenantId: testTenantA, phone: "+919876500099" }).setOptions({ skipTenantFilter: true })
    assert(unlinkedLeadCheck === null, "No Lead created in DB while tenant setting is disabled")

    // -------------------------------------------------------------------------
    // TEST 0B: Authenticated API enables auto-lead creation for Tenant A
    // -------------------------------------------------------------------------
    console.log("\n[TEST 0B] Authenticated API (setMobileAutoLeadPolicy) enables auto-lead creation for Tenant A")
    const { req: req0b, res: res0b } = createMockReqRes({
      body: {
        enabled: true,
        min_duration_seconds: 10,
      },
      user: agentUserA,
    })
    await mobileController.setMobileAutoLeadPolicy(req0b, res0b)
    const data0b = res0b.getData()
    assert(res0b.getStatusCode() === 200, `Status code is 200 (got ${res0b.getStatusCode()})`)
    assert(data0b.data.auto_lead_capture_enabled === true, "auto_lead_capture_enabled is now true on tenant")
    assert(data0b.data.auto_lead_min_duration_seconds === 10, "auto_lead_min_duration_seconds is 10")

    // Verify GET /policy returns updated settings
    const { req: reqPol, res: resPol } = createMockReqRes({ user: agentUserA })
    await mobileController.getMobilePolicy(reqPol, resPol)
    const polData = resPol.getData()
    assert(polData.data.auto_lead_capture_enabled === true, "getMobilePolicy returns auto_lead_capture_enabled = true")
    assert(polData.data.auto_lead_min_duration_seconds === 10, "getMobilePolicy returns auto_lead_min_duration_seconds = 10")

    // -------------------------------------------------------------------------
    // TEST 1: Auto-create lead from unknown answered incoming call
    // -------------------------------------------------------------------------
    console.log("\n[TEST 1] Incoming Call with auto_create_lead = true creates provisional Lead")
    const clientCallId1 = `call_${testTenantA}_dev1_9876500001_1001`
    const { req: req1, res: res1 } = createMockReqRes({
      body: {
        client_call_id: clientCallId1,
        lead_id: `lead_auto_9876500001_1001`,
        phone_number: phoneUnknown,
        call_direction: "INCOMING",
        start_time_ms: Date.now() - 30000,
        duration_seconds: 25,
        call_outcome: "Connected",
        notes: "Auto-captured from answered incoming call (25s)",
        auto_create_lead: true,
      },
      user: agentUserA,
    })

    await invokeInTenant(agentUserA.tenantId, () => mobileController.reportMobileCall(req1, res1))
    const data1 = res1.getData()
    const status1 = res1.getStatusCode()

    assert(status1 === 201, `Status code is 201 Created (got ${status1})`)
    assert(data1.success === true, "Response reports success = true")
    assert(data1?.auto_lead_created === true, "Response confirms auto_lead_created = true")
    assert(Boolean(data1?.lead_id), `Response returns canonical lead_id (${data1?.lead_id})`)

    let createdLead = null
    if (data1?.lead_id) {
      createdLead = await Lead.findById(data1.lead_id).setOptions({ skipTenantFilter: true })
    }
    assert(Boolean(createdLead), "Created Lead document exists in database")
    assert(Boolean(createdLead?.name?.includes("Unknown Caller")), `Lead name contains 'Unknown Caller' (${createdLead?.name})`)
    assert(createdLead?.source === "Incoming Call", `Lead source is 'Incoming Call' (${createdLead?.source})`)
    assert(createdLead?.metadata?.captureSource === "ANDROID_AUTO_CALL_CAPTURE", "Metadata has captureSource = ANDROID_AUTO_CALL_CAPTURE")
    assert(createdLead?.metadata?.autoCaptured === true, "Metadata has autoCaptured = true")

    const recordedCall1 = await Call.findOne({ clientCallId: clientCallId1 }).setOptions({ skipTenantFilter: true })
    assert(Boolean(recordedCall1), "Call document exists in database")
    assert(recordedCall1?.leadId?.toString() === data1?.lead_id, "Call is linked to the auto-created lead")
    assert(recordedCall1?.isUnlinked === false, "Call isUnlinked is false")

    // -------------------------------------------------------------------------
    // TEST 2: Second call from same number reuses existing lead (no duplicates)
    // -------------------------------------------------------------------------
    console.log("\n[TEST 2] Second incoming call from same number attaches to existing Lead without duplicate")
    const clientCallId2 = `call_${testTenantA}_dev1_9876500001_1002`
    const { req: req2, res: res2 } = createMockReqRes({
      body: {
        client_call_id: clientCallId2,
        lead_id: `lead_auto_9876500001_1002`,
        phone_number: phoneUnknown,
        call_direction: "INCOMING",
        start_time_ms: Date.now() - 5000,
        duration_seconds: 40,
        call_outcome: "Connected",
        auto_create_lead: true,
      },
      user: agentUserA,
    })

    await invokeInTenant(agentUserA.tenantId, () => mobileController.reportMobileCall(req2, res2))
    const data2 = res2.getData()
    const status2 = res2.getStatusCode()

    assert(status2 === 201, `Status code is 201 (got ${status2})`)
    assert(data2.auto_lead_created === false, "auto_lead_created is false (reused existing lead)")
    assert(data2.lead_id === data1.lead_id, `Call attached to original lead_id (${data2.lead_id} == ${data1.lead_id})`)

    const leadsForPhone = await Lead.find({ tenantId: testTenantA, phone: phoneUnknown }).setOptions({ skipTenantFilter: true })
    assert(leadsForPhone.length === 1, `Exactly 1 lead exists for this phone number in tenant (got ${leadsForPhone.length})`)

    // -------------------------------------------------------------------------
    // TEST 3: Lead name editing & preservation on subsequent calls
    // -------------------------------------------------------------------------
    console.log("\n[TEST 3] Agent renames Lead to 'Rahul Sharma' -> subsequent call attaches and preserves edited name")
    createdLead.name = "Rahul Sharma"
    createdLead.company = "Sharma Logistics"
    await createdLead.save()

    const clientCallId3 = `call_${testTenantA}_dev1_9876500001_1003`
    const { req: req3, res: res3 } = createMockReqRes({
      body: {
        client_call_id: clientCallId3,
        lead_id: `lead_auto_9876500001_1003`,
        phone_number: phoneUnknown,
        call_direction: "INCOMING",
        start_time_ms: Date.now(),
        duration_seconds: 15,
        call_outcome: "Connected",
        auto_create_lead: true,
      },
      user: agentUserA,
    })

    await invokeInTenant(agentUserA.tenantId, () => mobileController.reportMobileCall(req3, res3))
    const data3 = res3.getData()

    assert(data3.lead_id === data1.lead_id, "Call attached to Rahul Sharma lead")
    const refreshedLead = await Lead.findById(data1.lead_id).setOptions({ skipTenantFilter: true })
    assert(refreshedLead.name === "Rahul Sharma", `Lead name preserved as 'Rahul Sharma' (got '${refreshedLead.name}')`)
    assert(refreshedLead.company === "Sharma Logistics", "Company preserved as 'Sharma Logistics'")

    // -------------------------------------------------------------------------
    // TEST 4: DNR Policy Rejection
    // -------------------------------------------------------------------------
    console.log("\n[TEST 4] Incoming call from Do-Not-Record (DNR) number is rejected with 400")
    await invokeInTenant(testTenantA, () => Lead.create({
      tenantId: testTenantA,
      name: "DNR Contact",
      phone: phoneDnr,
      metadata: { isDoNotRecord: true },
    }))

    const clientCallId4 = `call_${testTenantA}_dev1_9876500002_1004`
    const { req: req4, res: res4 } = createMockReqRes({
      body: {
        client_call_id: clientCallId4,
        lead_id: `lead_auto_9876500002_1004`,
        phone_number: phoneDnr,
        call_direction: "INCOMING",
        start_time_ms: Date.now(),
        duration_seconds: 35,
        auto_create_lead: true,
      },
      user: agentUserA,
    })

    await invokeInTenant(agentUserA.tenantId, () => mobileController.reportMobileCall(req4, res4))
    const status4 = res4.getStatusCode()
    const data4 = res4.getData()

    assert(status4 === 400, `DNR call rejected with 400 (got ${status4})`)
    assert(data4.error.includes("Do-Not-Record"), `Error mentions Do-Not-Record (${data4.error})`)

    // -------------------------------------------------------------------------
    // TEST 5: Ambiguous multiple leads match leaves call unlinked (does not guess)
    // -------------------------------------------------------------------------
    console.log("\n[TEST 5] Multiple leads matching phone number flags call as ambiguous (does not guess)")
    await invokeInTenant(testTenantA, () => Lead.create({
      tenantId: testTenantA,
      name: "Contact Alpha",
      phone: phoneAmbiguous,
    }))
    await invokeInTenant(testTenantA, () => Lead.create({
      tenantId: testTenantA,
      name: "Contact Beta",
      phone: phoneAmbiguous,
    }))

    const clientCallId5 = `call_${testTenantA}_dev1_9876500003_1005`
    const { req: req5, res: res5 } = createMockReqRes({
      body: {
        client_call_id: clientCallId5,
        lead_id: `lead_auto_9876500003_1005`,
        phone_number: phoneAmbiguous,
        call_direction: "INCOMING",
        start_time_ms: Date.now(),
        duration_seconds: 22,
        auto_create_lead: true,
      },
      user: agentUserA,
    })

    await invokeInTenant(agentUserA.tenantId, () => mobileController.reportMobileCall(req5, res5))
    const data5 = res5.getData()
    const recordedCall5 = await Call.findOne({ clientCallId: clientCallId5 }).setOptions({ skipTenantFilter: true })

    assert(recordedCall5?.isUnlinked === true, "Ambiguous call is marked isUnlinked = true")
    assert(recordedCall5?.leadId == null, "Ambiguous call has null leadId")
    assert(data5?.lead_id == null, "Response returns null lead_id for ambiguous match")

    // -------------------------------------------------------------------------
    // TEST 6: Multi-tenant isolation
    // -------------------------------------------------------------------------
    console.log("\n[TEST 6] Multi-tenant isolation: call in Tenant B does not match or attach to Tenant A lead")
    // First enable feature for Tenant B
    const { req: req6Policy, res: res6Policy } = createMockReqRes({
      body: { enabled: true, min_duration_seconds: 10 },
      user: agentUserB,
    })
    await mobileController.setMobileAutoLeadPolicy(req6Policy, res6Policy)

    const clientCallId6 = `call_${testTenantB}_dev2_9876500001_1006`
    const { req: req6, res: res6 } = createMockReqRes({
      body: {
        client_call_id: clientCallId6,
        lead_id: `lead_auto_9876500001_1006`,
        phone_number: phoneUnknown, // Same phone number as Rahul Sharma in Tenant A
        call_direction: "INCOMING",
        start_time_ms: Date.now(),
        duration_seconds: 30,
        auto_create_lead: true,
      },
      user: agentUserB,
    })

    await invokeInTenant(agentUserB.tenantId, () => mobileController.reportMobileCall(req6, res6))
    const data6 = res6.getData()

    assert(data6?.auto_lead_created === true, "New lead created in Tenant B")
    assert(data6?.lead_id !== data1?.lead_id, `Tenant B lead (${data6?.lead_id}) is distinct from Tenant A lead (${data1?.lead_id})`)

    const leadTenantB = await Lead.findById(data6.lead_id).setOptions({ skipTenantFilter: true })
    assert(leadTenantB?.tenantId === testTenantB, `Lead belongs to Tenant B (${leadTenantB?.tenantId})`)
    assert(Boolean(leadTenantB?.name?.includes("Unknown Caller")), `Tenant B lead initialized with provisional name (${leadTenantB?.name})`)

    // -------------------------------------------------------------------------
    // TEST 7: Pre-flight recording upload ticket issued for auto-created lead call
    // -------------------------------------------------------------------------
    console.log("\n[TEST 7] Pre-flight recording ticket issued successfully for auto-created lead call")
    const ticketResult = await mobileSyncService.issueRecordingTicket({
      tenantId: testTenantA,
      agentId: agentUserA.id,
      callId: recordedCall1._id.toString(),
    })

    assert(ticketResult.eligible === true, "Recording ticket eligible = true")
    assert(Boolean(ticketResult.ticket), "Recording ticket token generated")
    assert(ticketResult.callId?.toString() === recordedCall1._id.toString(), "Ticket callId matches")

    // --------------------------------------------------------------------------
    // TEST 8: Server independently rejects auto_create_lead on OUTGOING call
    // --------------------------------------------------------------------------
    console.log("\n[TEST 8] Outgoing call with auto_create_lead = true is NOT auto-created as a lead")
    const outgoingClientCallId = `call_${testTenantA}_dev1_9876500008_${Date.now()}`
    const { req: req8, res: res8 } = createMockReqRes({
      user: agentUserA,
      body: {
        client_call_id: outgoingClientCallId,
        phone_number: "+919876500008",
        call_direction: "OUTGOING",
        start_time_ms: Date.now(),
        duration_seconds: 45,
        auto_create_lead: true, // Client attempts to auto-create on outgoing
      },
    })
    await invokeInTenant(agentUserA.tenantId, () => mobileController.reportMobileCall(req8, res8))
    const data8 = res8.getData()

    assert(res8.getStatusCode() === 201, `Status code is 201 (got ${res8.getStatusCode()})`)
    assert(data8.auto_lead_created === false, "auto_lead_created must be false for outgoing call")
    assert(data8.lead_id === null, "lead_id must be null (not linked)")
    const unlinkedOutgoingLead = await Lead.findOne({
      tenantId: testTenantA,
      phone: "+919876500008",
    }).setOptions({ skipTenantFilter: true })
    assert(unlinkedOutgoingLead === null, "No lead document created for outgoing call")

    // --------------------------------------------------------------------------
    // TEST 9: Server independently rejects auto_create_lead on unanswered call (0s)
    // --------------------------------------------------------------------------
    console.log("\n[TEST 9] Unanswered/zero-duration call with auto_create_lead = true does NOT create lead")
    const missedClientCallId = `call_${testTenantA}_dev1_9876500009_${Date.now()}`
    const { req: req9, res: res9 } = createMockReqRes({
      user: agentUserA,
      body: {
        client_call_id: missedClientCallId,
        phone_number: "+919876500009",
        call_direction: "INCOMING",
        start_time_ms: Date.now(),
        duration_seconds: 0, // Unanswered / missed
        auto_create_lead: true,
      },
    })
    await invokeInTenant(agentUserA.tenantId, () => mobileController.reportMobileCall(req9, res9))
    const data9 = res9.getData()

    assert(res9.getStatusCode() === 201, `Status code is 201 (got ${res9.getStatusCode()})`)
    assert(data9.auto_lead_created === false, "auto_lead_created must be false for unanswered call")
    assert(data9.lead_id === null, "lead_id must be null for unanswered call")
    const unlinkedMissedLead = await Lead.findOne({
      tenantId: testTenantA,
      phone: "+919876500009",
    }).setOptions({ skipTenantFilter: true })
    assert(unlinkedMissedLead === null, "No lead document created for unanswered call")

    // --------------------------------------------------------------------------
    // TEST 10: Server enforces configured duration threshold (15s); client cannot lower it
    // --------------------------------------------------------------------------
    console.log("\n[TEST 10] Server enforces configured duration threshold (15s); sub-threshold call rejected")
    const { req: req10Cfg, res: res10Cfg } = createMockReqRes({
      body: {
        enabled: true,
        min_duration_seconds: 15,
      },
      user: agentUserA,
    })
    await mobileController.setMobileAutoLeadPolicy(req10Cfg, res10Cfg)

    // Call 10a: duration 12s (< 15s threshold) -> Must NOT create lead
    const clientCallId10a = `call_${testTenantA}_dev1_9876500010_short_${Date.now()}`
    const { req: req10a, res: res10a } = createMockReqRes({
      user: agentUserA,
      body: {
        client_call_id: clientCallId10a,
        phone_number: "+919876500010",
        call_direction: "INCOMING",
        start_time_ms: Date.now() - 20000,
        duration_seconds: 12, // Below 15s threshold
        auto_create_lead: true,
      },
    })
    await invokeInTenant(agentUserA.tenantId, () => mobileController.reportMobileCall(req10a, res10a))
    const data10a = res10a.getData()
    assert(data10a.auto_lead_created === false, "Call below 15s threshold does NOT create lead")
    assert(data10a.lead_id === null, "lead_id is null for sub-threshold call")

    // Call 10b: duration 20s (>= 15s threshold) -> MUST create lead
    const clientCallId10b = `call_${testTenantA}_dev1_9876500010_long_${Date.now()}`
    const { req: req10b, res: res10b } = createMockReqRes({
      user: agentUserA,
      body: {
        client_call_id: clientCallId10b,
        phone_number: "+919876500010",
        call_direction: "INCOMING",
        start_time_ms: Date.now() - 25000,
        duration_seconds: 20, // Meets 15s threshold
        auto_create_lead: true,
      },
    })
    await invokeInTenant(agentUserA.tenantId, () => mobileController.reportMobileCall(req10b, res10b))
    const data10b = res10b.getData()
    assert(data10b.auto_lead_created === true, "Call meeting 15s threshold DOES create lead")
    assert(Boolean(data10b.lead_id), "lead_id is assigned for qualifying call")

    // --------------------------------------------------------------------------
    // TEST 11: Answered-call validation: native CallLog metadata MISSED (3) or REJECTED (5) never creates lead
    // --------------------------------------------------------------------------
    console.log("\n[TEST 11] Answered-call validation: native CallLog metadata MISSED/REJECTED calls never create lead")
    // Call 11a: OEM reported duration 25s, but native CallLog type is REJECTED (5)
    const clientCallId11a = `call_${testTenantA}_dev1_9876500011_rej_${Date.now()}`
    const { req: req11a, res: res11a } = createMockReqRes({
      user: agentUserA,
      body: {
        client_call_id: clientCallId11a,
        phone_number: "+919876500011",
        call_direction: "INCOMING",
        call_type: 5, // CallLog.Calls.REJECTED_TYPE
        call_outcome: "Rejected",
        start_time_ms: Date.now() - 30000,
        duration_seconds: 25, // OEM dialer recorded ring duration
        auto_create_lead: true,
      },
    })
    await invokeInTenant(agentUserA.tenantId, () => mobileController.reportMobileCall(req11a, res11a))
    const data11a = res11a.getData()
    assert(data11a.auto_lead_created === false, "Rejected call (call_type 5) with ring duration must NOT create lead")
    assert(data11a.lead_id === null, "Rejected call lead_id must be null")

    // Call 11b: OEM reported duration 30s, but call_direction is MISSED
    const clientCallId11b = `call_${testTenantA}_dev1_9876500012_mis_${Date.now()}`
    const { req: req11b, res: res11b } = createMockReqRes({
      user: agentUserA,
      body: {
        client_call_id: clientCallId11b,
        phone_number: "+919876500012",
        call_direction: "MISSED",
        call_type: 3, // CallLog.Calls.MISSED_TYPE
        call_outcome: "Missed",
        start_time_ms: Date.now() - 35000,
        duration_seconds: 30, // OEM dialer recorded ring duration
        auto_create_lead: true,
      },
    })
    await invokeInTenant(agentUserA.tenantId, () => mobileController.reportMobileCall(req11b, res11b))
    const data11b = res11b.getData()
    assert(data11b.auto_lead_created === false, "Missed call (call_type 3) with ring duration must NOT create lead")
    assert(data11b.lead_id === null, "Missed call lead_id must be null")

  } finally {
    // Clean up test data
    console.log("\nCleaning up test collections...")
    await Lead.deleteMany({ tenantId: { $in: [testTenantA, testTenantB] } }).setOptions({ skipTenantFilter: true })
    await Call.deleteMany({ tenantId: { $in: [testTenantA, testTenantB] } }).setOptions({ skipTenantFilter: true })
    await Account.deleteMany({ accountId: { $in: [testTenantA, testTenantB] } })
    await mongoose.disconnect()
    console.log("Disconnected from MongoDB.\n")
  }

  console.log("================================================================================")
  console.log(`=== SUMMARY: ${passed} PASSED, ${failed} FAILED`)
  console.log("================================================================================")

  if (failed > 0) {
    process.exit(1)
  }
}

runTests().catch((err) => {
  console.error("Test execution fatal error:", err)
  process.exit(1)
})
