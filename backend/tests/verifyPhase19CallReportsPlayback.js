const mongoose = require("mongoose")
const dotenv = require("dotenv")
const path = require("path")
const http = require("http")
const { Readable } = require("stream")

dotenv.config({ path: path.join(__dirname, "../.env") })

const Call = require("../models/Call")
const Lead = require("../models/Lead")
const User = require("../models/User")
const DnrRule = require("../models/DnrRule")
const callService = require("../services/callService")
const recordingStorage = require("../services/recordingStorage")
const privacyService = require("../services/privacyService")

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

async function runPhase19Tests() {
  console.log("================================================================================")
  console.log("=== PHASE 19: CALL REPORTS & IN-BROWSER RECORDING PLAYBACK SUITE ===")
  console.log("================================================================================")

  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI
  if (!mongoUri) {
    throw new Error("MONGODB_URI not defined in environment")
  }
  await mongoose.connect(mongoUri)
  console.log("Connected to MongoDB Atlas")

  const testSuffix = `P19-${Date.now()}`
  const tenantA = `TENANT-A-${testSuffix}`
  const tenantB = `TENANT-B-${testSuffix}`

  let adminUserA, agentUserA, otherAgentA, leadA1, leadA2, callStoredA, callMissingA, callDnrA, callTenantB
  let fileIdStored = null

  try {
    // Setup Users
    adminUserA = await User.create({
      tenantId: tenantA,
      name: "Admin User",
      email: `admin-${testSuffix}@example.com`,
      password: "Password123!",
      role: "account_admin",
      status: "active",
    })

    agentUserA = await User.create({
      tenantId: tenantA,
      name: "Agent Alice",
      email: `alice-${testSuffix}@example.com`,
      password: "Password123!",
      role: "agent",
      status: "active",
      permissions: ["calls.view.own", "calls.log"],
    })

    otherAgentA = await User.create({
      tenantId: tenantA,
      name: "Agent Bob",
      email: `bob-${testSuffix}@example.com`,
      password: "Password123!",
      role: "agent",
      status: "active",
      permissions: ["calls.view.own"],
    })

    // Setup Leads
    leadA1 = await Lead.create({
      tenantId: tenantA,
      ownerId: agentUserA._id,
      name: "Alice Lead",
      email: `alice-lead-${testSuffix}@example.com`,
      phone: "+919876543210",
      phoneNormalized: "+919876543210",
      status: "New",
    })

    leadA2 = await Lead.create({
      tenantId: tenantA,
      ownerId: otherAgentA._id,
      name: "Bob Lead",
      email: `bob-lead-${testSuffix}@example.com`,
      phone: "+919876543211",
      phoneNormalized: "+919876543211",
      status: "Engaged",
    })

    // Setup Calls
    // 1. Call with stored recording
    callStoredA = await Call.create({
      tenantId: tenantA,
      agentId: agentUserA._id,
      leadId: leadA1._id,
      clientCallId: `client-stored-${testSuffix}`,
      number: "+919876543210",
      phoneNormalized: "+919876543210",
      direction: "outbound",
      duration: 125,
      status: "completed",
      disposition: "Interested",
      startedAt: new Date(Date.now() - 3600 * 1000), // 1 hour ago
      recording: {
        status: "pending",
      },
    })

    // Upload an actual audio buffer into GridFS for callStoredA
    const audioBuffer = Buffer.alloc(1024 * 8, 0xaa) // 8KB dummy audio
    const readable = Readable.from(audioBuffer)
    const uploadRes = await recordingStorage.streamUpload({
      callId: callStoredA._id.toString(),
      tenantId: tenantA,
      user: agentUserA,
      readStream: readable,
      mimeType: "audio/mp4",
      contentLength: audioBuffer.length,
    })
    fileIdStored = uploadRes.fileId
    assert(uploadRes.success, "Test recording uploaded to GridFS")

    // Reload callStoredA to get updated recording status
    callStoredA = await Call.findById(callStoredA._id)

    // 2. Call missing recording
    callMissingA = await Call.create({
      tenantId: tenantA,
      agentId: otherAgentA._id,
      leadId: leadA2._id,
      clientCallId: `client-missing-${testSuffix}`,
      number: "+919876543211",
      phoneNormalized: "+919876543211",
      direction: "inbound",
      duration: 45,
      status: "completed",
      disposition: "Follow-up Required",
      startedAt: new Date(Date.now() - 7200 * 1000), // 2 hours ago
      recording: {
        status: "none",
        fileId: null,
      },
    })

    // 3. Call for DNR lead
    callDnrA = await Call.create({
      tenantId: tenantA,
      agentId: agentUserA._id,
      leadId: leadA1._id,
      clientCallId: `client-dnr-${testSuffix}`,
      number: "+919876543210",
      phoneNormalized: "+919876543210",
      direction: "outbound",
      duration: 30,
      status: "completed",
      disposition: "Not Interested",
      startedAt: new Date(Date.now() - 1800 * 1000),
      recording: {
        status: "skipped_dnr",
        fileId: null,
      },
    })

    // 4. Call in Tenant B
    callTenantB = await Call.create({
      tenantId: tenantB,
      agentId: new mongoose.Types.ObjectId(),
      clientCallId: `client-tenantb-${testSuffix}`,
      number: "+919999999999",
      phoneNormalized: "+919999999999",
      direction: "outbound",
      duration: 60,
      status: "completed",
      startedAt: new Date(),
    })

    // =========================================================================
    // 1. REPORT API ACCESS & TENANT ISOLATION
    // =========================================================================
    console.log("\n--- 1. REPORT API ACCESS & TENANT ISOLATION ---")
    const adminCallsRes = await callService.listCalls({}, adminUserA)
    const adminCalls = adminCallsRes.data.calls
    assert(Array.isArray(adminCalls), "List calls returns calls array")
    assert(adminCalls.length >= 3, `Admin retrieved all tenant calls (${adminCalls.length})`)
    const hasTenantB = adminCalls.some((c) => c.tenantId === tenantB)
    assert(!hasTenantB, "Cross-tenant calls are strictly excluded from report")

    // =========================================================================
    // 2. AGENT RBAC SCOPE ENFORCEMENT
    // =========================================================================
    console.log("\n--- 2. AGENT RBAC SCOPE ENFORCEMENT ---")
    const agentCallsRes = await callService.listCalls({}, agentUserA)
    const agentCalls = agentCallsRes.data.calls
    assert(
      agentCalls.every((c) => c.agentId?._id?.toString() === agentUserA._id.toString() || c.agentId?.toString() === agentUserA._id.toString()),
      "Agent with own scope only sees their assigned calls"
    )
    const seesBobCall = agentCalls.some((c) => c._id.toString() === callMissingA._id.toString())
    assert(!seesBobCall, "Agent cannot see other agents' calls without team/all permissions")

    // =========================================================================
    // 3. DATE-RANGE & RECORDING FILTERING
    // =========================================================================
    console.log("\n--- 3. DATE-RANGE & RECORDING FILTERING ---")
    // Filter hasRecording: true
    const storedFilterRes = await callService.listCalls({ hasRecording: "true" }, adminUserA)
    assert(
      storedFilterRes.data.calls.every((c) => c.recording?.status === "stored"),
      "Filter hasRecording=true returns only stored recordings"
    )

    // Filter missingRecording: true
    const missingFilterRes = await callService.listCalls({ missingRecording: "true" }, adminUserA)
    assert(
      missingFilterRes.data.calls.some((c) => c._id.toString() === callMissingA._id.toString()),
      "Filter missingRecording=true finds completed calls missing audio files"
    )
    assert(
      missingFilterRes.data.calls.every((c) => c.recording?.status !== "stored"),
      "Missing recording view excludes calls with stored audio"
    )

    // Date range filter
    const dateFilteredRes = await callService.listCalls(
      { startDate: new Date(Date.now() - 4000 * 1000).toISOString() },
      adminUserA
    )
    assert(dateFilteredRes.data.calls.length > 0, "Date-range filtering returns matching time slice")

    // =========================================================================
    // 4. CALL REPORT METRICS AGGREGATION
    // =========================================================================
    console.log("\n--- 4. CALL REPORT METRICS AGGREGATION ---")
    const metricsRes = await callService.getCallMetrics({ tenantId: tenantA })
    const m = metricsRes.data
    assert(m.totalCalls >= 3, `Aggregated totalCalls: ${m.totalCalls}`)
    assert(m.completedCalls >= 3, `Aggregated completedCalls: ${m.completedCalls}`)
    assert(m.withRecordingCount >= 1, `Computed withRecordingCount: ${m.withRecordingCount}`)
    assert(m.missingRecordingCount >= 1, `Computed missingRecordingCount: ${m.missingRecordingCount}`)
    assert(Array.isArray(m.byRecordingStatus), "Provides byRecordingStatus breakdown")

    // =========================================================================
    // 5. STREAMING RECORDING PLAYBACK & RANGE REQUESTS
    // =========================================================================
    console.log("\n--- 5. STREAMING RECORDING PLAYBACK & RANGE REQUESTS ---")
    // Test helper mock response
    const { PassThrough } = require("stream")
    function createMockRes() {
      const pass = new PassThrough()
      let statusCode = 200
      let headers = {}
      pass.writeHead = (code, hdrs) => {
        statusCode = code
        headers = Object.assign(headers, hdrs)
      }
      pass.setHeader = (k, v) => {
        headers[k] = v
      }
      pass.status = (code) => {
        statusCode = code
        return {
          json: (payload) => ({ statusCode, payload }),
          send: (payload) => ({ statusCode, payload }),
        }
      }
      pass.getStatusCode = () => statusCode
      pass.getHeaders = () => headers
      return pass
    }

    // Authorized playback
    const mockRes200 = createMockRes()
    await recordingStorage.streamPlayback({
      callId: callStoredA._id.toString(),
      tenantId: tenantA,
      user: adminUserA,
      res: mockRes200,
    })
    assert(mockRes200.getStatusCode() === 200, "Authorized playback returns HTTP 200")
    assert(mockRes200.getHeaders()["Accept-Ranges"] === "bytes", "Playback specifies Accept-Ranges: bytes")

    // Seeking with byte range
    const mockRes206 = createMockRes()
    await recordingStorage.streamPlayback({
      callId: callStoredA._id.toString(),
      tenantId: tenantA,
      user: agentUserA, // Agent playing own call
      rangeHeader: "bytes=100-500",
      res: mockRes206,
    })
    assert(mockRes206.getStatusCode() === 206, "Range seeking returns HTTP 206 Partial Content")
    assert(mockRes206.getHeaders()["Content-Range"]?.startsWith("bytes 100-500/"), "Content-Range header matches requested slice")

    // Unauthorized agent playback (Bob tries to play Alice's recording)
    const mockRes403 = createMockRes()
    await recordingStorage.streamPlayback({
      callId: callStoredA._id.toString(),
      tenantId: tenantA,
      user: otherAgentA,
      res: mockRes403,
    })
    assert(mockRes403.getStatusCode() === 403, "Unauthorized agent playback is rejected with HTTP 403 Forbidden")

    // Cross-tenant playback
    const mockRes404 = createMockRes()
    await recordingStorage.streamPlayback({
      callId: callStoredA._id.toString(),
      tenantId: tenantB,
      user: { _id: new mongoose.Types.ObjectId(), tenantId: tenantB, role: "account_admin" },
      res: mockRes404,
    })
    assert(mockRes404.getStatusCode() === 404, "Cross-tenant playback is rejected with HTTP 404")

    // =========================================================================
    // 6. DNR ENFORCEMENT DURING PLAYBACK
    // =========================================================================
    console.log("\n--- 6. DNR ENFORCEMENT DURING PLAYBACK ---")
    // Mark Alice Lead as DNR via PrivacyService
    await privacyService.updateLeadPrivacy({
      tenantId: tenantA,
      leadId: leadA1._id,
      doNotRecord: true,
      actor: adminUserA,
    })

    const mockResDnr = createMockRes()
    await recordingStorage.streamPlayback({
      callId: callStoredA._id.toString(),
      tenantId: tenantA,
      user: adminUserA,
      res: mockResDnr,
    })
    assert(mockResDnr.getStatusCode() === 403, "DNR contact playback is blocked with HTTP 403")

    // Reset lead DNR via PrivacyService
    await privacyService.updateLeadPrivacy({
      tenantId: tenantA,
      leadId: leadA1._id,
      doNotRecord: false,
      actor: adminUserA,
    })

    // =========================================================================
    // 7. EXPIRED / PURGED RECORDING PLAYBACK
    // =========================================================================
    console.log("\n--- 7. EXPIRED / PURGED RECORDING PLAYBACK ---")
    callStoredA.recording.status = "expired"
    await callStoredA.save()

    const mockResExpired = createMockRes()
    await recordingStorage.streamPlayback({
      callId: callStoredA._id.toString(),
      tenantId: tenantA,
      user: adminUserA,
      res: mockResExpired,
    })
    assert(mockResExpired.getStatusCode() === 410, "Playback of expired/purged recording returns HTTP 410 Gone")

  } finally {
    // Teardown
    console.log("\n--- CLEANING UP TEST ARTIFACTS ---")
    if (fileIdStored) {
      try {
        const bucket = recordingStorage.getBucket()
        await bucket.delete(fileIdStored)
      } catch (_) {}
    }
    await Call.deleteMany({ tenantId: { $in: [tenantA, tenantB] } })
    await Lead.deleteMany({ tenantId: { $in: [tenantA, tenantB] } })
    await User.deleteMany({ tenantId: { $in: [tenantA, tenantB] } })
    await DnrRule.deleteMany({ tenantId: { $in: [tenantA, tenantB] } })
    await mongoose.disconnect()
    console.log("Disconnected from MongoDB Atlas")
  }

  console.log("\n================================================================================")
  console.log(`=== PHASE 19 SUMMARY: Passed: ${passed} | Failed: ${failed} ===`)
  console.log("================================================================================")

  if (failed > 0) {
    process.exit(1)
  }
}

runPhase19Tests().catch((err) => {
  console.error("Fatal Test Suite Error:", err)
  process.exit(1)
})
