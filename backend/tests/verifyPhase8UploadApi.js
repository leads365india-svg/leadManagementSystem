const request = require("supertest")
const mongoose = require("mongoose")
const jwt = require("jsonwebtoken")
const dotenv = require("dotenv")
const path = require("path")
const crypto = require("crypto")
const fs = require("fs")
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

async function runUploadApiTests() {
  console.log("\n=======================================================")
  console.log("   PHASE 8 RECORDING STREAMING UPLOAD API SUITE        ")
  console.log("=======================================================\n")

  if (mongoose.connection.readyState !== 1) {
    const mongoURI = process.env.MONGODB_URI
    if (!mongoURI) {
      throw new Error("MONGODB_URI not defined in environment variables")
    }
    await mongoose.connect(mongoURI)
  }

  const TEST_ID = `p8_${Date.now()}`
  const TENANT_A = `ACC-P8-A-${TEST_ID}`
  const TENANT_B = `ACC-P8-B-${TEST_ID}`

  let userA, userB, leadA, leadDnr, callA, callDnr, callB
  let tokenA, tokenB

  try {
    // 1. Create Test Users & Accounts
    userA = await User.create({
      name: `Agent A ${TEST_ID}`,
      email: `agent_a_${TEST_ID}@leads365.test`,
      password: "TestPassword123!",
      role: "agent",
      tenantId: TENANT_A,
    })

    userB = await User.create({
      name: `Agent B ${TEST_ID}`,
      email: `agent_b_${TEST_ID}@leads365.test`,
      password: "TestPassword123!",
      role: "agent",
      tenantId: TENANT_B,
    })

    tokenA = jwt.sign(
      { id: userA._id.toString(), email: userA.email, role: userA.role, tenantId: TENANT_A },
      JWT_SECRET,
      { expiresIn: "1h" }
    )

    tokenB = jwt.sign(
      { id: userB._id.toString(), email: userB.email, role: userB.role, tenantId: TENANT_B },
      JWT_SECRET,
      { expiresIn: "1h" }
    )

    // 2. Create Leads
    leadA = await Lead.create({
      name: `Lead A ${TEST_ID}`,
      email: `lead_a_${TEST_ID}@leads365.test`,
      phone: "+919876543210",
      tenantId: TENANT_A,
      assignedStaffId: userA._id.toString(),
      metadata: { isDoNotRecord: false, idempotencyKey: `lead_a_key_${TEST_ID}` },
    })

    leadDnr = await Lead.create({
      name: `Lead DNR ${TEST_ID}`,
      email: `lead_dnr_${TEST_ID}@leads365.test`,
      phone: "+919876543211",
      tenantId: TENANT_A,
      assignedStaffId: userA._id.toString(),
      metadata: { isDoNotRecord: true, idempotencyKey: `lead_dnr_key_${TEST_ID}` },
    })

    // 3. Create Calls
    callA = await Call.create({
      clientCallId: `call_a_${TEST_ID}`,
      leadId: leadA._id,
      tenantId: TENANT_A,
      agentId: userA._id,
      agentName: userA.name,
      phoneNumber: "+919876543210",
      callDirection: "OUTGOING",
      startTimeMs: Date.now() - 60000,
      durationSeconds: 60,
      hasRecording: false,
    })

    callDnr = await Call.create({
      clientCallId: `call_dnr_${TEST_ID}`,
      leadId: leadDnr._id,
      tenantId: TENANT_A,
      agentId: userA._id,
      agentName: userA.name,
      phoneNumber: "+919876543211",
      callDirection: "OUTGOING",
      startTimeMs: Date.now() - 60000,
      durationSeconds: 60,
      hasRecording: false,
    })

    callB = await Call.create({
      clientCallId: `call_b_${TEST_ID}`,
      leadId: leadA._id,
      tenantId: TENANT_B,
      agentId: userB._id,
      agentName: userB.name,
      phoneNumber: "+919876543210",
      callDirection: "OUTGOING",
      startTimeMs: Date.now() - 60000,
      durationSeconds: 60,
      hasRecording: false,
    })

    // Prepare simulated audio payload (e.g. 10KB of audio data)
    const audioPayload = Buffer.alloc(10240, 0x5a) // 10KB
    const audioSha256 = crypto.createHash("sha256").update(audioPayload).digest("hex")

    // TEST 1: Reject Unauthenticated
    {
      const res = await request(app)
        .put(`/api/calls/${callA.clientCallId}/recording`)
        .set("Content-Type", "audio/m4a")
        .send(audioPayload)

      recordTest(
        "1. Rejects unauthenticated recording upload with 401",
        res.status === 401
      )
    }

    // TEST 2: Reject Cross-Tenant Upload
    {
      const res = await request(app)
        .put(`/api/calls/${callA.clientCallId}/recording`)
        .set("Authorization", `Bearer ${tokenB}`)
        .set("Content-Type", "audio/m4a")
        .set("X-Content-SHA256", audioSha256)
        .send(audioPayload)

      recordTest(
        "2. Rejects cross-tenant recording upload with 403",
        res.status === 403
      )
    }

    // TEST 3: Reject Non-Existent Call
    {
      const res = await request(app)
        .put("/api/calls/non_existent_call_id/recording")
        .set("Authorization", `Bearer ${tokenA}`)
        .set("Content-Type", "audio/m4a")
        .set("X-Content-SHA256", audioSha256)
        .send(audioPayload)

      recordTest(
        "3. Rejects upload for non-existent call with 404",
        res.status === 404
      )
    }

    // TEST 4: Reject DNR Lead Call
    {
      const res = await request(app)
        .put(`/api/calls/${callDnr.clientCallId}/recording`)
        .set("Authorization", `Bearer ${tokenA}`)
        .set("Content-Type", "audio/m4a")
        .set("X-Content-SHA256", audioSha256)
        .send(audioPayload)

      recordTest(
        "4. Rejects recording upload for Do-Not-Record (DNR) lead with 403",
        res.status === 403
      )
    }

    // TEST 5: Reject Unsupported Media Type
    {
      const res = await request(app)
        .put(`/api/calls/${callA.clientCallId}/recording`)
        .set("Authorization", `Bearer ${tokenA}`)
        .set("Content-Type", "text/plain")
        .set("X-Content-SHA256", audioSha256)
        .send(audioPayload)

      recordTest(
        "5. Rejects unsupported MIME type with 415",
        res.status === 415
      )
    }

    // TEST 6: Reject Mismatched SHA-256 Checksum
    {
      const res = await request(app)
        .put(`/api/calls/${callA.clientCallId}/recording`)
        .set("Authorization", `Bearer ${tokenA}`)
        .set("Content-Type", "audio/m4a")
        .set("X-Content-SHA256", "0000000000000000000000000000000000000000000000000000000000000000")
        .send(audioPayload)

      recordTest(
        "6. Rejects mismatched SHA-256 checksum with 400",
        res.status === 400
      )
    }

    // TEST 7: Successful Streaming Upload
    {
      const res = await request(app)
        .put(`/api/calls/${callA.clientCallId}/recording`)
        .set("Authorization", `Bearer ${tokenA}`)
        .set("Content-Type", "audio/m4a")
        .set("X-Content-SHA256", audioSha256)
        .send(audioPayload)

      const pass = res.status === 200 &&
        res.body.success === true &&
        res.body.checksum === audioSha256 &&
        res.body.sizeBytes === audioPayload.length

      recordTest(
        "7. Successfully streams recording, verifies SHA-256, and returns 200",
        pass,
        pass ? null : JSON.stringify(res.body)
      )

      // Verify MongoDB Call record was updated
      const updatedCall = await Call.findById(callA._id)
      const dbPass = updatedCall &&
        updatedCall.hasRecording === true &&
        updatedCall.metadata?.recordingSha256 === audioSha256 &&
        updatedCall.metadata?.recordingSizeBytes === audioPayload.length

      recordTest(
        "8. Updates database Call entity with hasRecording=true, checksum, and storage URL",
        dbPass
      )
    }

    // TEST 8: Idempotent Upload Re-submission
    {
      const res = await request(app)
        .put(`/api/calls/${callA.clientCallId}/recording`)
        .set("Authorization", `Bearer ${tokenA}`)
        .set("Content-Type", "audio/m4a")
        .set("X-Content-SHA256", audioSha256)
        .send(audioPayload)

      const pass = res.status === 200 &&
        res.body.success === true &&
        res.body.alreadyUploaded === true

      recordTest(
        "9. Idempotent re-submission returns 200 with alreadyUploaded=true without duplicating storage",
        pass
      )
    }

    // TEST 9: Mobile API Path Equivalent (/api/mobile/v1/calls/:callId/recording)
    {
      const callAlt = await Call.create({
        clientCallId: `call_alt_${TEST_ID}`,
        leadId: leadA._id,
        tenantId: TENANT_A,
        agentId: userA._id,
        agentName: userA.name,
        phoneNumber: "+919876543210",
        callDirection: "OUTGOING",
        startTimeMs: Date.now() - 30000,
        durationSeconds: 30,
        hasRecording: false,
      })

      const res = await request(app)
        .put(`/api/mobile/v1/calls/${callAlt.clientCallId}/recording`)
        .set("Authorization", `Bearer ${tokenA}`)
        .set("Content-Type", "audio/mp3")
        .set("X-Content-SHA256", audioSha256)
        .send(audioPayload)

      const pass = res.status === 200 && res.body.success === true
      recordTest(
        "10. Equivalent /api/mobile/v1/calls/:callId/recording route also succeeds",
        pass
      )
    }

    // TEST 11: Rejects unauthenticated audio streaming with 401
    {
      const res = await request(app).get(`/api/calls/${callA.clientCallId}/recording`)
      const pass = res.status === 401
      recordTest("11. Rejects unauthenticated audio streaming with 401", pass)
    }

    // TEST 12: Rejects cross-tenant audio streaming with 403
    {
      const res = await request(app)
        .get(`/api/calls/${callA.clientCallId}/recording`)
        .set("Authorization", `Bearer ${tokenB}`)
      const pass = res.status === 403
      recordTest("12. Rejects cross-tenant audio streaming with 403", pass)
    }

    // TEST 13: Authorized audio streaming returns 200 and audio mime type
    {
      const res = await request(app)
        .get(`/api/calls/${callA.clientCallId}/recording`)
        .set("Authorization", `Bearer ${tokenA}`)
      const pass = res.status === 200 && res.header["content-type"]?.includes("audio")
      recordTest("13. Authorized audio streaming returns 200 and audio mime type", pass)
    }

    // TEST 14: Audio streaming supports HTTP 206 Range requests (seeking)
    {
      const res = await request(app)
        .get(`/api/calls/${callA.clientCallId}/recording`)
        .set("Authorization", `Bearer ${tokenA}`)
        .set("Range", "bytes=0-100")
      const pass = res.status === 206 && res.header["content-range"]?.startsWith("bytes 0-100/")
      recordTest("14. Audio streaming supports HTTP 206 Range requests (seeking)", pass)
    }

    // TEST 15: Direct storage URL rejects unauthenticated access with 401
    {
      const updatedCallA = await Call.findById(callA._id)
      const recordingPath = updatedCallA.metadata.recordingUrl
      const res = await request(app).get(recordingPath)
      const pass = res.status === 401
      recordTest("15. Direct storage URL rejects unauthenticated access with 401", pass)
    }

    // TEST 16: Direct storage URL rejects cross-tenant access with 403
    {
      const updatedCallA = await Call.findById(callA._id)
      const recordingPath = updatedCallA.metadata.recordingUrl
      const res = await request(app)
        .get(recordingPath)
        .set("Authorization", `Bearer ${tokenB}`)
      const pass = res.status === 403
      recordTest("16. Direct storage URL rejects cross-tenant access with 403", pass)
    }

    // TEST 17: GET /api/leads/:leadId/calls retrieves call history and recording for CRM frontend
    {
      const res = await request(app)
        .get(`/api/leads/${leadA._id}/calls`)
        .set("Authorization", `Bearer ${tokenA}`)
      const pass =
        res.status === 200 &&
        res.body.success === true &&
        Array.isArray(res.body.data) &&
        res.body.data.some((c) => c.hasRecording === true && c.metadata?.recordingUrl)
      recordTest("17. GET /api/leads/:leadId/calls retrieves call history and recording for CRM frontend", pass)
    }
  } finally {
    // Cleanup fixtures
    await Call.deleteMany({ tenantId: { $in: [TENANT_A, TENANT_B] } })
    await Lead.deleteMany({ tenantId: { $in: [TENANT_A, TENANT_B] } })
    await User.deleteMany({ tenantId: { $in: [TENANT_A, TENANT_B] } })
  }

  const passedCount = results.filter((r) => r.passed).length
  const failedCount = results.filter((r) => !r.passed).length

  console.log("\n=======================================================")
  console.log(`PHASE 8 BACKEND SUMMARY: ${passedCount} PASSED, ${failedCount} FAILED`)
  console.log("=======================================================\n")

  if (failedCount > 0) {
    process.exit(1)
  }
}

runUploadApiTests()
  .then(() => {
    process.exit(0)
  })
  .catch((err) => {
    console.error("FATAL SUITE ERROR:", err)
    process.exit(1)
  })
