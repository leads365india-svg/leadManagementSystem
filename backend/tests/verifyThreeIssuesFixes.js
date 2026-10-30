/**
 * Verification Suite for Leads365 Three Issues Fixes:
 * - ISSUE 1: Duplicate Follow-ups & Reminders
 * - ISSUE 2: Duplicate Call Records & Recording Association
 * 
 * Tests run against local test database fixtures.
 */

require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") })
const mongoose = require("mongoose")
const FollowUp = require("../models/FollowUp")
const Call = require("../models/Call")
const Lead = require("../models/Lead")
const User = require("../models/User")
const followUpController = require("../controllers/followUpController")
const mobileController = require("../controllers/mobileController")
const callController = require("../controllers/callController")
const { runWithTenantContext } = require("../middleware/tenantContext")

let passed = 0
let failed = 0

function assert(condition, message) {
  if (condition) {
    console.log(`  [PASS] ${message}`)
    passed++
  } else {
    console.error(`  [FAIL] ${message}`)
    failed++
    throw new Error(message)
  }
}

// Helper to mock express req/res
function mockReqRes(options = {}) {
  const user = options.user ? {
    ...options.user,
    role: "super_admin",
  } : null
  const req = {
    user,
    body: options.body || {},
    params: options.params || {},
    query: options.query || {},
    headers: options.headers || {},
  }
  const res = {
    statusCode: 200,
    headers: {},
    jsonData: null,
    status(code) {
      this.statusCode = code
      return this
    },
    json(data) {
      this.jsonData = data
      return this
    },
    setHeader(name, val) {
      this.headers[name] = val
      return this
    },
  }
  return { req, res }
}

async function invokeInTenant(tenantId, fn) {
  return runWithTenantContext({ tenantId, isSuperAdmin: false }, fn)
}

async function runTests() {
  console.log("================================================================================")
  console.log("=== VERIFICATION SUITE: ISSUES 1 & 2 FIXES ===")
  console.log("================================================================================")

  const mongoUri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/leads365_test"
  await mongoose.connect(mongoUri)
  await FollowUp.ensureUniqueIndexes()
  await Call.ensureUniqueIndexes()

  const testTenant = `test_tenant_issues_${Date.now()}`
  const otherTenant = `other_tenant_issues_${Date.now()}`

  try {
    // 0. Setup Agent User and Lead within ambient tenant context
    const agentUser = new User({
      tenantId: testTenant,
      name: "Test Agent",
      email: `agent_${Date.now()}@example.com`,
      password: "Password123!",
      role: "account_admin",
      permissions: ["leads.view:all", "leads.manage:all", "followups.view:all", "followups.manage:all"],
      status: "active",
    })
    await agentUser.save()

    const otherAgent = new User({
      tenantId: otherTenant,
      name: "Other Agent",
      email: `other_agent_${Date.now()}@example.com`,
      password: "Password123!",
      role: "account_admin",
      permissions: ["leads.view:all", "leads.manage:all", "followups.view:all", "followups.manage:all"],
      status: "active",
    })
    await otherAgent.save()

    const lead1 = await invokeInTenant(testTenant, async () => {
      const l = new Lead({
        tenantId: testTenant,
        name: "sumit",
        email: `sumit_${Date.now()}@example.com`,
        phone: "+919693687418",
        status: "Engaged",
        assignedTo: agentUser._id,
      })
      return l.save()
    })

    const lead2 = await invokeInTenant(testTenant, async () => {
      const l = new Lead({
        tenantId: testTenant,
        name: "rahul",
        email: `rahul_${Date.now()}@example.com`,
        phone: "+919693687418", // same phone, different lead
        status: "New",
        assignedTo: agentUser._id,
      })
      return l.save()
    })

    const scheduledDate = new Date(Date.now() + 86400000)
    const callTimeMs = Date.now() - 60000

    console.log("\n--- TEST GROUP 1: FOLLOW-UP DEDUPLICATION & IDEMPOTENCY ---")

    // Test 1.1: Same call-summary event submitted twice
    {
      const callEventId = `call_test_evt_${Date.now()}`
      const req1 = {
        user: { tenantId: testTenant, _id: agentUser._id, id: agentUser._id.toString(), name: agentUser.name, role: "agent" },
        body: {
          client_call_id: callEventId,
          lead_id: lead1._id.toString(),
          phone_number: "+919693687418",
          call_direction: "OUTGOING",
          start_time_ms: callTimeMs,
          duration_seconds: 25,
          call_outcome: "Interested",
          notes: "First mobile call summary",
          next_followup_at: scheduledDate.getTime(),
        },
      }
      const { req: r1, res: s1 } = mockReqRes(req1)
      await invokeInTenant(testTenant, () => mobileController.reportMobileCall(r1, s1))
      assert(s1.statusCode === 200 || s1.statusCode === 201, "First mobile call report succeeds")

      // Second identical submission (offline replay or retry)
      const { req: r2, res: s2 } = mockReqRes(req1)
      await invokeInTenant(testTenant, () => mobileController.reportMobileCall(r2, s2))
      assert(s2.statusCode === 200 || s2.statusCode === 201, "Second mobile call report succeeds (idempotent)")

      const followUps = await invokeInTenant(testTenant, () => FollowUp.find({ tenantId: testTenant, leadId: lead1._id }))
      assert(followUps.length === 1, `Expected exactly 1 follow-up for lead1 after repeated submission, found ${followUps.length}`)
      assert(followUps[0].sourceCallId === callEventId, "Follow-up sourceCallId correctly tracked")
    }

    // Test 1.2: Manual reminder followed by call-summary reminder for the same event
    {
      const leadForDualFlow = await invokeInTenant(testTenant, async () => {
        const l = new Lead({
          tenantId: testTenant,
          name: "Dual Flow Lead",
          email: `dual_${Date.now()}@example.com`,
          phone: "+919876543210",
          assignedTo: agentUser._id,
        })
        return l.save()
      })

      const scheduledTimeMs = Date.now() + 1000000
      const dualCallId = `dual_call_${Date.now()}`

      // Step A: Mobile LeadsViewModel dispatches manual createFollowUp
      const { req: rManual, res: sManual } = mockReqRes({
        user: { tenantId: testTenant, _id: agentUser._id, id: agentUser._id.toString(), name: agentUser.name, role: "agent" },
        body: {
          leadId: leadForDualFlow._id.toString(),
          title: "Follow-up (Interested)",
          type: "call",
          scheduledAt: new Date(scheduledTimeMs).toISOString(),
          notes: "Manual follow up created by UI",
          sourceCallId: dualCallId,
          idempotencyKey: `fu_idemp_${dualCallId}`,
        },
      })
      await invokeInTenant(testTenant, () => followUpController.createFollowUp(rManual, sManual))
      if (sManual.statusCode !== 200 && sManual.statusCode !== 201) {
        console.error("sManual failed with:", sManual.statusCode, sManual.jsonData)
      }
      assert(sManual.statusCode === 201 || sManual.statusCode === 200, "Manual follow-up creation succeeds")

      // Step B: Mobile call report dispatches with next_followup_at for same call
      const { req: rCall, res: sCall } = mockReqRes({
        user: { tenantId: testTenant, _id: agentUser._id, id: agentUser._id.toString(), name: agentUser.name, role: "agent" },
        body: {
          client_call_id: dualCallId,
          lead_id: leadForDualFlow._id.toString(),
          phone_number: "+919876543210",
          call_direction: "OUTGOING",
          start_time_ms: Date.now() - 30000,
          duration_seconds: 40,
          call_outcome: "Interested",
          notes: "Mobile summary notes",
          next_followup_at: scheduledTimeMs,
        },
      })
      await invokeInTenant(testTenant, () => mobileController.reportMobileCall(rCall, sCall))
      assert(sCall.statusCode === 200 || sCall.statusCode === 201, "Call report for dual-flow succeeds")

      const dualFollowUps = await invokeInTenant(testTenant, () => FollowUp.find({ tenantId: testTenant, leadId: leadForDualFlow._id }))
      assert(dualFollowUps.length === 1, `Expected exactly 1 follow-up for dual flow, found ${dualFollowUps.length}`)
    }

    // Test 1.3: Different scheduled times for the same lead must remain separate
    {
      const time1 = new Date(Date.now() + 2000000).toISOString()
      const time2 = new Date(Date.now() + 8000000).toISOString()

      const { req: rT1, res: sT1 } = mockReqRes({
        user: { tenantId: testTenant, _id: agentUser._id, id: agentUser._id.toString(), name: agentUser.name, role: "agent" },
        body: {
          leadId: lead1._id.toString(),
          title: "Morning Follow-up",
          scheduledAt: time1,
        },
      })
      await invokeInTenant(testTenant, () => followUpController.createFollowUp(rT1, sT1))

      const { req: rT2, res: sT2 } = mockReqRes({
        user: { tenantId: testTenant, _id: agentUser._id, id: agentUser._id.toString(), name: agentUser.name, role: "agent" },
        body: {
          leadId: lead1._id.toString(),
          title: "Evening Follow-up",
          scheduledAt: time2,
        },
      })
      await invokeInTenant(testTenant, () => followUpController.createFollowUp(rT2, sT2))

      const lead1FollowUps = await invokeInTenant(testTenant, () => FollowUp.find({ tenantId: testTenant, leadId: lead1._id }))
      assert(lead1FollowUps.length === 3, `Expected 3 separate follow-ups with distinct times for lead1, found ${lead1FollowUps.length}`)
    }

    // Test 1.4: Same contact phone but different leads must not be merged
    {
      const timeLead2 = new Date(Date.now() + 3000000).toISOString()
      const { req: rL2, res: sL2 } = mockReqRes({
        user: { tenantId: testTenant, _id: agentUser._id, id: agentUser._id.toString(), name: agentUser.name, role: "agent" },
        body: {
          leadId: lead2._id.toString(),
          title: "Follow-up for Rahul",
          scheduledAt: timeLead2,
        },
      })
      await invokeInTenant(testTenant, () => followUpController.createFollowUp(rL2, sL2))

      const lead2FollowUps = await invokeInTenant(testTenant, () => FollowUp.find({ tenantId: testTenant, leadId: lead2._id }))
      assert(lead2FollowUps.length === 1, "Lead2 has its own distinct follow-up even though phone is shared")
    }

    // Test 1.5: Completed reminder must not be recreated or reverted to pending on sync/report
    {
      const completedLead = await invokeInTenant(testTenant, async () => {
        const l = new Lead({
          tenantId: testTenant,
          name: "Completed Flow Lead",
          email: `completed_${Date.now()}@example.com`,
          phone: "+919111222333",
          assignedTo: agentUser._id,
        })
        return l.save()
      })

      const compTimeMs = Date.now() + 5000000
      const compCallId = `comp_call_${Date.now()}`

      await invokeInTenant(testTenant, async () => {
        const fu = new FollowUp({
          tenantId: testTenant,
          leadId: completedLead._id,
          title: "Initial Reminder",
          scheduledAt: new Date(compTimeMs),
          status: "completed", // already completed!
          sourceCallId: compCallId,
        })
        return fu.save()
      })

      // Re-report call with same callId and follow-up time
      const { req: rComp, res: sComp } = mockReqRes({
        user: { tenantId: testTenant, _id: agentUser._id, id: agentUser._id.toString(), name: agentUser.name, role: "agent" },
        body: {
          client_call_id: compCallId,
          lead_id: completedLead._id.toString(),
          phone_number: "+919111222333",
          call_direction: "OUTGOING",
          start_time_ms: Date.now() - 50000,
          duration_seconds: 30,
          call_outcome: "Interested",
          next_followup_at: compTimeMs,
        },
      })
      await invokeInTenant(testTenant, () => mobileController.reportMobileCall(rComp, sComp))

      const compFollowUps = await invokeInTenant(testTenant, () => FollowUp.find({ tenantId: testTenant, leadId: completedLead._id }))
      assert(compFollowUps.length === 1, "Completed follow-up was not duplicated")
      assert(compFollowUps[0].status === "completed", "Completed status was preserved and not reverted to pending")
    }

    console.log("\n--- TEST GROUP 2: CALL DEDUPLICATION & RECORDING ASSOCIATION ---")

    // Test 2.1: Native call metadata arrives before recording
    {
      const clientCallId1 = `canon_call_meta_first_${Date.now()}`
      const startMs = Date.now() - 100000

      // Step A: Call metadata arrives first
      const { req: rCallMeta, res: sCallMeta } = mockReqRes({
        user: { tenantId: testTenant, _id: agentUser._id, id: agentUser._id.toString(), name: agentUser.name, role: "agent" },
        body: {
          client_call_id: clientCallId1,
          lead_id: lead1._id.toString(),
          phone_number: "+919693687418",
          call_direction: "OUTGOING",
          start_time_ms: startMs,
          duration_seconds: 20,
          call_outcome: "Interested",
          notes: "Outcome recorded before recording upload",
        },
      })
      await invokeInTenant(testTenant, () => mobileController.reportMobileCall(rCallMeta, sCallMeta))
      assert(sCallMeta.statusCode === 200 || sCallMeta.statusCode === 201, "Call metadata report succeeds")

      const callAfterMeta = await invokeInTenant(testTenant, () => Call.findOne({ tenantId: testTenant, clientCallId: clientCallId1 }))
      assert(callAfterMeta !== null, "Canonical call record created")
      assert(callAfterMeta.callOutcome === "Interested", "Call outcome is Interested")

      // Step B: Recording attaches to canonical call
      callAfterMeta.recordingFileId = new mongoose.Types.ObjectId()
      callAfterMeta.hasRecording = true
      await invokeInTenant(testTenant, () => callAfterMeta.save())

      const callsCount = await invokeInTenant(testTenant, () => Call.countDocuments({ tenantId: testTenant, clientCallId: clientCallId1 }))
      assert(callsCount === 1, "Exactly one call record exists after recording attached")
      assert(callAfterMeta.recordingFileId !== null, "Recording is attached to canonical call")
      assert(callAfterMeta.callOutcome === "Interested", "Outcome remains Interested after recording attached")
    }

    // Test 2.2: Recording arrives before call outcome update
    {
      const clientCallId2 = `canon_call_rec_first_${Date.now()}`
      const startMs2 = Date.now() - 200000

      // Step A: Recording upload worker initiates call report with Pending outcome
      const { req: rEarlyReport, res: sEarlyReport } = mockReqRes({
        user: { tenantId: testTenant, _id: agentUser._id, id: agentUser._id.toString(), name: agentUser.name, role: "agent" },
        body: {
          client_call_id: clientCallId2,
          lead_id: lead1._id.toString(),
          phone_number: "+919693687418",
          call_direction: "OUTGOING",
          start_time_ms: startMs2,
          duration_seconds: 20,
          call_outcome: null, // Pending outcome
        },
      })
      await invokeInTenant(testTenant, () => mobileController.reportMobileCall(rEarlyReport, sEarlyReport))

      // Step B: Recording is attached
      const callRecord = await invokeInTenant(testTenant, () => Call.findOne({ tenantId: testTenant, clientCallId: clientCallId2 }))
      callRecord.recordingFileId = new mongoose.Types.ObjectId()
      callRecord.hasRecording = true
      await invokeInTenant(testTenant, () => callRecord.save())

      // Step C: User later submits PostCallDialog with Outcome: Interested
      const { req: rLateReport, res: sLateReport } = mockReqRes({
        user: { tenantId: testTenant, _id: agentUser._id, id: agentUser._id.toString(), name: agentUser.name, role: "agent" },
        body: {
          client_call_id: clientCallId2,
          lead_id: lead1._id.toString(),
          phone_number: "+919693687418",
          call_direction: "OUTGOING",
          start_time_ms: startMs2,
          duration_seconds: 20,
          call_outcome: "Interested",
          notes: "Updated from post call dialog",
        },
      })
      await invokeInTenant(testTenant, () => mobileController.reportMobileCall(rLateReport, sLateReport))
      assert(sLateReport.statusCode === 200, "Late outcome update succeeds idempotently")

      const finalCall = await invokeInTenant(testTenant, () => Call.findOne({ tenantId: testTenant, clientCallId: clientCallId2 }))
      assert(finalCall.callOutcome === "Interested", "Call outcome successfully updated to Interested")
      assert(finalCall.hasRecording === true && finalCall.recordingFileId !== null, "Recording remains attached to the same record")

      const totalMatchingCalls = await invokeInTenant(testTenant, () => Call.countDocuments({ tenantId: testTenant, clientCallId: clientCallId2 }))
      assert(totalMatchingCalls === 1, "Exactly one call record exists for this call")
    }

    // Test 2.3: Same call synced repeatedly (idempotent upsert)
    {
      const clientCallId3 = `canon_call_repeated_${Date.now()}`
      for (let i = 0; i < 3; i++) {
        const { req, res } = mockReqRes({
          user: { tenantId: testTenant, _id: agentUser._id, id: agentUser._id.toString(), name: agentUser.name, role: "agent" },
          body: {
            client_call_id: clientCallId3,
            lead_id: lead1._id.toString(),
            phone_number: "+919693687418",
            call_direction: "OUTGOING",
            start_time_ms: Date.now() - 300000,
            duration_seconds: 15,
            call_outcome: "Connected",
          },
        })
        await invokeInTenant(testTenant, () => mobileController.reportMobileCall(req, res))
      }
      const count = await invokeInTenant(testTenant, () => Call.countDocuments({ tenantId: testTenant, clientCallId: clientCallId3 }))
      assert(count === 1, `Repeated reporting produced exactly 1 call record, found ${count}`)
    }

    // Test 2.4: Fallback signature matching when clientCallId is missing/re-generated
    {
      const startExact = Date.now() - 400000
      await invokeInTenant(testTenant, async () => {
        const nativeCall1 = new Call({
          tenantId: testTenant,
          clientCallId: null,
          leadId: lead1._id,
          phoneNumber: "+919693687418",
          direction: "OUTGOING",
          callDirection: "OUTGOING",
          startTimeMs: startExact,
          durationSeconds: 35,
          callOutcome: "Connected",
          agentId: agentUser._id,
        })
        return nativeCall1.save()
      })

      // Subsequent sync arrives with timestamp jitter (+1500ms) and same duration/phone/agent
      const { req: rFback, res: sFback } = mockReqRes({
        user: { tenantId: testTenant, _id: agentUser._id, id: agentUser._id.toString(), name: agentUser.name, role: "agent" },
        body: {
          client_call_id: `reconciled_id_${Date.now()}`,
          lead_id: lead1._id.toString(),
          phone_number: "+919693687418",
          call_direction: "OUTGOING",
          start_time_ms: startExact + 1500,
          duration_seconds: 35,
          call_outcome: "Interested",
        },
      })
      await invokeInTenant(testTenant, () => mobileController.reportMobileCall(rFback, sFback))

      const callsForWindow = await invokeInTenant(testTenant, () =>
        Call.find({
          tenantId: testTenant,
          phoneNumber: "+919693687418",
          startTimeMs: { $gte: startExact - 5000, $lte: startExact + 5000 },
        })
      )
      assert(callsForWindow.length === 1, `Unambiguous signature match reconciled into 1 call, found ${callsForWindow.length}`)
      assert(callsForWindow[0].callOutcome === "Interested", "Reconciled call updated with Interested outcome")
    }

    // Test 2.5: Two genuine calls to the same phone number (different start times)
    {
      const callTimeA = Date.now() - 1000000 // 16 mins ago
      const callTimeB = Date.now() - 500000  // 8 mins ago

      const { req: rA, res: sA } = mockReqRes({
        user: { tenantId: testTenant, _id: agentUser._id, id: agentUser._id.toString(), name: agentUser.name, role: "agent" },
        body: {
          client_call_id: `legit_call_a_${Date.now()}`,
          lead_id: lead1._id.toString(),
          phone_number: "+919693687418",
          call_direction: "OUTGOING",
          start_time_ms: callTimeA,
          duration_seconds: 20,
          call_outcome: "Busy",
        },
      })
      await invokeInTenant(testTenant, () => mobileController.reportMobileCall(rA, sA))

      const { req: rB, res: sB } = mockReqRes({
        user: { tenantId: testTenant, _id: agentUser._id, id: agentUser._id.toString(), name: agentUser.name, role: "agent" },
        body: {
          client_call_id: `legit_call_b_${Date.now()}`,
          lead_id: lead1._id.toString(),
          phone_number: "+919693687418",
          call_direction: "OUTGOING",
          start_time_ms: callTimeB,
          duration_seconds: 20,
          call_outcome: "Interested",
        },
      })
      await invokeInTenant(testTenant, () => mobileController.reportMobileCall(rB, sB))

      const legitCalls = await invokeInTenant(testTenant, () =>
        Call.find({
          tenantId: testTenant,
          clientCallId: { $in: [rA.body.client_call_id, rB.body.client_call_id] },
        })
      )
      assert(legitCalls.length === 2, `Two genuine calls at different times preserved as 2 records, found ${legitCalls.length}`)
    }

    // Test 2.6: Cross-tenant isolation
    {
      const otherLead = await invokeInTenant(otherTenant, async () => {
        const l = new Lead({
          tenantId: otherTenant,
          name: "Other Tenant Lead",
          email: `othertenant_${Date.now()}@example.com`,
          phone: "+919693687418",
          status: "New",
          assignedTo: otherAgent._id,
        })
        return l.save()
      })

      const { req: rTenantB, res: sTenantB } = mockReqRes({
        user: { tenantId: otherTenant, _id: otherAgent._id, id: otherAgent._id.toString(), name: otherAgent.name, role: "agent" },
        body: {
          client_call_id: `call_tenant_b_${Date.now()}`,
          lead_id: otherLead._id.toString(),
          phone_number: "+919693687418",
          call_direction: "OUTGOING",
          start_time_ms: Date.now() - 60000,
          duration_seconds: 20,
          call_outcome: "Interested",
        },
      })
      await invokeInTenant(otherTenant, () => mobileController.reportMobileCall(rTenantB, sTenantB))

      const tenantACalls = await invokeInTenant(testTenant, () =>
        Call.find({ tenantId: testTenant, clientCallId: rTenantB.body.client_call_id })
      )
      assert(tenantACalls.length === 0, "Tenant A cannot see or share Tenant B calls")

      const tenantBCalls = await invokeInTenant(otherTenant, () =>
        Call.find({ tenantId: otherTenant, clientCallId: rTenantB.body.client_call_id })
      )
      assert(tenantBCalls.length === 1, "Tenant B call correctly isolated to Tenant B")
    }

    // --- TEST GROUP 3: CONCURRENCY & MULTI-DEVICE RIGOROUS CHECKS ---
    console.log("\n--- TEST GROUP 3: CONCURRENCY & MULTI-DEVICE RIGOROUS CHECKS ---")

    // Test 3.1: Simultaneous follow-up creation requests (Promise.all)
    {
      const simSourceCallId = `sim_call_${Date.now()}`
      const simDate = new Date(Date.now() + 86400000)

      const makeReq = () => mockReqRes({
        user: { tenantId: testTenant, _id: agentUser._id, role: "account_admin" },
        body: {
          leadId: lead1._id.toString(),
          title: "Simultaneous Follow-up",
          type: "call",
          scheduledAt: simDate.toISOString(),
          sourceCallId: simSourceCallId,
          idempotencyKey: `idemp_${simSourceCallId}`,
        },
      })

      const reqRes1 = makeReq()
      const reqRes2 = makeReq()

      // Execute simultaneously
      await Promise.all([
        invokeInTenant(testTenant, () => followUpController.createFollowUp(reqRes1.req, reqRes1.res)),
        invokeInTenant(testTenant, () => followUpController.createFollowUp(reqRes2.req, reqRes2.res)),
      ])

      assert(
        (reqRes1.res.statusCode === 201 || reqRes1.res.statusCode === 200) &&
        (reqRes2.res.statusCode === 201 || reqRes2.res.statusCode === 200),
        "Both simultaneous follow-up requests succeeded (HTTP 200/201)"
      )

      const simFollowUps = await invokeInTenant(testTenant, () =>
        FollowUp.find({ tenantId: testTenant, sourceCallId: simSourceCallId })
      )
      assert(simFollowUps.length === 1, `Exactly 1 database record created for simultaneous requests, found ${simFollowUps.length}`)
    }

    // Test 3.2: Simultaneous mobile call reports (Promise.all)
    {
      const simClientCallId = `sim_client_call_${Date.now()}`
      const simStartTime = Date.now() - 30000

      const makeCallReq = (outcome) => mockReqRes({
        user: { tenantId: testTenant, _id: agentUser._id, id: agentUser._id.toString(), name: agentUser.name, role: "agent" },
        body: {
          client_call_id: simClientCallId,
          lead_id: lead1._id.toString(),
          phone_number: "+919693687418",
          call_direction: "OUTGOING",
          start_time_ms: simStartTime,
          duration_seconds: 25,
          call_outcome: outcome,
        },
      })

      const callReqRes1 = makeCallReq("Connected")
      const callReqRes2 = makeCallReq("Interested")

      await Promise.all([
        invokeInTenant(testTenant, () => mobileController.reportMobileCall(callReqRes1.req, callReqRes1.res)),
        invokeInTenant(testTenant, () => mobileController.reportMobileCall(callReqRes2.req, callReqRes2.res)),
      ])

      assert(
        (callReqRes1.res.statusCode === 201 || callReqRes1.res.statusCode === 200) &&
        (callReqRes2.res.statusCode === 201 || callReqRes2.res.statusCode === 200),
        "Both simultaneous call report requests succeeded"
      )

      const simCalls = await invokeInTenant(testTenant, () =>
        Call.find({ tenantId: testTenant, clientCallId: simClientCallId })
      )
      assert(simCalls.length === 1, `Exactly 1 canonical call record exists after simultaneous reports, found ${simCalls.length}`)
    }

    // Test 3.3: Two separate devices with identical native CallLog IDs
    {
      const rawNativeId = "998811"
      const device1ClientCallId = `call_${testTenant}_device_vivo_v1_${rawNativeId}`
      const device2ClientCallId = `call_${testTenant}_device_samsung_s2_${rawNativeId}`
      const baseCallTime = Date.now() - 120000

      const { req: rDev1, res: sDev1 } = mockReqRes({
        user: { tenantId: testTenant, _id: agentUser._id, id: agentUser._id.toString(), name: agentUser.name, role: "agent" },
        body: {
          client_call_id: device1ClientCallId,
          lead_id: lead1._id.toString(),
          phone_number: "+919693687418",
          call_direction: "OUTGOING",
          start_time_ms: baseCallTime,
          duration_seconds: 30,
          call_outcome: "Interested",
        },
      })
      await invokeInTenant(testTenant, () => mobileController.reportMobileCall(rDev1, sDev1))

      const { req: rDev2, res: sDev2 } = mockReqRes({
        user: { tenantId: testTenant, _id: agentUser._id, id: agentUser._id.toString(), name: agentUser.name, role: "agent" },
        body: {
          client_call_id: device2ClientCallId,
          lead_id: lead1._id.toString(),
          phone_number: "+919693687418",
          call_direction: "OUTGOING",
          start_time_ms: baseCallTime + 1000,
          duration_seconds: 45,
          call_outcome: "Proposal Sent",
        },
      })
      await invokeInTenant(testTenant, () => mobileController.reportMobileCall(rDev2, sDev2))

      const devCalls = await invokeInTenant(testTenant, () =>
        Call.find({ tenantId: testTenant, clientCallId: { $in: [device1ClientCallId, device2ClientCallId] } })
      )
      assert(devCalls.length === 2, `Separate devices with same native CallLog ID produce 2 distinct records, found ${devCalls.length}`)
    }

    // Test 3.4: Independent manual follow-ups at the same time are NOT deduplicated
    {
      const manualScheduledTime = new Date(Date.now() + 172800000) // 2 days in future
      const { req: rManual1, res: sManual1 } = mockReqRes({
        user: { tenantId: testTenant, _id: agentUser._id, role: "account_admin" },
        body: {
          leadId: lead1._id.toString(),
          title: "Send pricing brochure",
          type: "email",
          scheduledAt: manualScheduledTime.toISOString(),
          priority: "medium",
          notes: "Task 1: email brochure",
        },
      })
      await invokeInTenant(testTenant, () => followUpController.createFollowUp(rManual1, sManual1))

      const { req: rManual2, res: sManual2 } = mockReqRes({
        user: { tenantId: testTenant, _id: agentUser._id, role: "account_admin" },
        body: {
          leadId: lead1._id.toString(),
          title: "Call decision maker",
          type: "call",
          scheduledAt: manualScheduledTime.toISOString(),
          priority: "high",
          notes: "Task 2: phone call",
        },
      })
      await invokeInTenant(testTenant, () => followUpController.createFollowUp(rManual2, sManual2))

      assert(sManual1.statusCode === 201, "First independent manual follow-up created (201)")
      assert(sManual2.statusCode === 201, "Second independent manual follow-up created (201)")

      const manualReminders = await invokeInTenant(testTenant, () =>
        FollowUp.find({
          tenantId: testTenant,
          leadId: lead1._id,
          scheduledAt: manualScheduledTime,
          sourceCallId: null,
        })
      )
      assert(
        manualReminders.length === 2,
        `Independent manual reminders at same time preserved as 2 separate records, found ${manualReminders.length}`
      )
    }

    // Test 3.5: callController.createCallLog idempotency with clientCallId
    {
      const crmClientCallId = `crm_call_log_${Date.now()}`
      const { req: rCrm1, res: sCrm1 } = mockReqRes({
        user: { tenantId: testTenant, _id: agentUser._id, role: "account_admin" },
        body: {
          clientCallId: crmClientCallId,
          leadId: lead1._id.toString(),
          number: "+919693687418",
          direction: "outbound",
          duration: 35,
          status: "completed",
          disposition: "Connected",
          notes: "First CRM log submission",
        },
      })
      await invokeInTenant(testTenant, () => callController.createCallLog(rCrm1, sCrm1))
      assert(sCrm1.statusCode === 201, "Initial createCallLog succeeded with 201")

      // Second submission for same call updates disposition
      const { req: rCrm2, res: sCrm2 } = mockReqRes({
        user: { tenantId: testTenant, _id: agentUser._id, role: "account_admin" },
        body: {
          clientCallId: crmClientCallId,
          leadId: lead1._id.toString(),
          number: "+919693687418",
          direction: "outbound",
          duration: 35,
          status: "completed",
          disposition: "Interested",
          notes: "Updated CRM log disposition",
        },
      })
      await invokeInTenant(testTenant, () => callController.createCallLog(rCrm2, sCrm2))
      assert(sCrm2.statusCode === 201 || sCrm2.statusCode === 200, "Second createCallLog succeeded idempotently")

      const crmCalls = await invokeInTenant(testTenant, () =>
        Call.find({ tenantId: testTenant, clientCallId: crmClientCallId })
      )
      assert(crmCalls.length === 1, `createCallLog produced exactly 1 call record, found ${crmCalls.length}`)
      assert(
        crmCalls[0].disposition === "Interested" || crmCalls[0].callOutcome === "Interested",
        `createCallLog updated disposition to Interested, found ${crmCalls[0].disposition}`
      )
    }

    console.log("\n================================================================================")
    console.log(`=== TEST SUMMARY: ${passed} PASSED, ${failed} FAILED ===`)
    console.log("================================================================================")
  } finally {
    // Cleanup test fixtures
    await runWithTenantContext({ isSuperAdmin: true }, async () => {
      await FollowUp.deleteMany({ tenantId: { $in: [testTenant, otherTenant] } })
      await Call.deleteMany({ tenantId: { $in: [testTenant, otherTenant] } })
      await Lead.deleteMany({ tenantId: { $in: [testTenant, otherTenant] } })
      await User.deleteMany({ tenantId: { $in: [testTenant, otherTenant] } })
    })
    await mongoose.disconnect()
  }
}

runTests().catch((err) => {
  console.error("Test execution failed:", err)
  process.exit(1)
})
