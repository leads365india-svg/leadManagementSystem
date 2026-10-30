/**
 * Leads-365 — Phase 16: GridFS Recording Storage, Streaming Playback & 30-Day Purge
 * Comprehensive Verification Suite
 */

require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") })
const mongoose = require("mongoose")
const crypto = require("crypto")
const { Readable } = require("stream")
const jwt = require("jsonwebtoken")

const Call = require("../models/Call")
const Lead = require("../models/Lead")
const User = require("../models/User")
const Account = require("../models/Account")
const recordingStorage = require("../services/recordingStorage")
const { issueRecordingTicket } = require("../services/mobileSyncService")
const { authenticateRecordingUpload } = require("../middleware/recordingAuthMiddleware")
const { getJwtSecret } = require("../middleware/authMiddleware")

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

// Generate dummy audio buffer for streaming tests
function createDummyAudioStream(sizeBytes = 1024 * 10) {
  const buffer = crypto.randomBytes(sizeBytes)
  const hash = crypto.createHash("sha256").update(buffer).digest("hex")
  const stream = new Readable()
  stream.push(buffer)
  stream.push(null)
  return { stream, buffer, hash, sizeBytes }
}

async function runTests() {
  console.log("=".repeat(80))
  console.log("=== PHASE 16: GRIDFS RECORDING STORAGE & RETENTION SUITE ===")
  console.log("=".repeat(80))

  const mongoUri = process.env.MONGODB_URI
  if (!mongoUri) {
    console.error("Missing MONGODB_URI in environment")
    process.exit(1)
  }

  await mongoose.connect(mongoUri)
  console.log("Connected to MongoDB Atlas\n")

  const testTenantA = `test_tenant_a_${Date.now()}`
  const testTenantB = `test_tenant_b_${Date.now()}`
  const agentAId = new mongoose.Types.ObjectId()
  const agentBId = new mongoose.Types.ObjectId()

  let leadA = null
  let leadDnr = null
  let callA = null
  let callPersonal = null
  let callTenantB = null

  try {
    // Setup test users

    const userA = await User.create({
      _id: agentAId,
      name: "Agent Alice",
      email: `alice_${Date.now()}@example.com`,
      password: "HashedPassword123!",
      role: "agent",
      tenantId: testTenantA,
      status: "active",
    })

    const userB = await User.create({
      _id: agentBId,
      name: "Agent Bob",
      email: `bob_${Date.now()}@example.com`,
      password: "HashedPassword123!",
      role: "agent",
      tenantId: testTenantB,
      status: "active",
    })

    // Setup test leads
    const testTimestamp = Date.now()
    leadA = await Lead.create({
      tenantId: testTenantA,
      name: "Rohan Lead",
      email: `rohan_${testTimestamp}@example.com`,
      phone: "+919876543210",
      status: "Engaged",
      ownerId: agentAId,
    })

    leadDnr = await Lead.create({
      tenantId: testTenantA,
      name: "DNR Customer",
      email: `dnr_${testTimestamp}@example.com`,
      phone: "+919876500000",
      status: "Engaged",
      ownerId: agentAId,
      metadata: { doNotRecord: true },
    })

    // Setup test calls
    callA = await Call.create({
      tenantId: testTenantA,
      agentId: agentAId,
      leadId: leadA._id,
      clientCallId: `call_a_${testTimestamp}`,
      number: "+919876543210",
      direction: "outbound",
      duration: 120,
      status: "completed",
    })

    callPersonal = await Call.create({
      tenantId: testTenantA,
      agentId: agentAId,
      leadId: null, // Personal call, not linked to CRM lead
      clientCallId: `call_personal_${testTimestamp}`,
      number: "+919999911111",
      direction: "outbound",
      duration: 45,
      status: "completed",
    })

    callTenantB = await Call.create({
      tenantId: testTenantB,
      agentId: agentBId,
      clientCallId: `call_b_${testTimestamp}`,
      number: "+919111122222",
      direction: "inbound",
      duration: 30,
      status: "completed",
    })

    // =========================================================================
    // TEST GROUP 1: GRIDFS BUCKET & INDEX INITIALIZATION
    // =========================================================================
    console.log("--- TEST GROUP 1: GRIDFS BUCKET & INDEXES ---")
    const bucket = recordingStorage.getBucket()
    assert(Boolean(bucket), "GridFSBucket initialized successfully")
    await recordingStorage.ensureGridFSIndexes()
    const db = mongoose.connection.db
    const indexes = await db.collection("recordings.files").indexes()
    const hasTenantCallIndex = indexes.some((idx) => idx.key["metadata.tenantId"] && idx.key["metadata.callId"])
    const hasExpiresAtIndex = indexes.some((idx) => idx.key["metadata.expiresAt"])
    assert(hasTenantCallIndex, "GridFS recordings.files has { metadata.tenantId, metadata.callId } index")
    assert(hasExpiresAtIndex, "GridFS recordings.files has { metadata.expiresAt } index")

    // =========================================================================
    // TEST GROUP 2: AUTHORIZED LEAD RECORDING UPLOAD & STREAMING STORAGE
    // =========================================================================
    console.log("\n--- TEST GROUP 2: AUTHORIZED STREAMING UPLOAD ---")
    const audioData = createDummyAudioStream(1024 * 16) // 16 KB audio
    const uploadResult = await recordingStorage.streamUpload({
      callId: callA._id.toString(),
      tenantId: testTenantA,
      user: userA,
      readStream: audioData.stream,
      mimeType: "audio/mp4",
      filename: "test_call_recording.m4a",
      contentLength: audioData.sizeBytes,
      expectedSha256: audioData.hash,
      retentionDays: 30,
    })

    assert(uploadResult.success === true, "Upload returned success=true")
    assert(uploadResult.status === "stored", "Recording status is 'stored'")
    assert(uploadResult.sha256 === audioData.hash, "SHA-256 hash verified successfully")
    assert(uploadResult.sizeBytes === audioData.sizeBytes, `Byte size matches ${audioData.sizeBytes} bytes`)
    assert(Boolean(uploadResult.fileId), "GridFS fileId generated")

    // Check GridFS binary storage
    const gridFile = await bucket.find({ _id: uploadResult.fileId }).next()
    assert(gridFile && gridFile.length === audioData.sizeBytes, "GridFS file document created with correct length")
    const chunksCount = await db.collection("recordings.chunks").countDocuments({ files_id: uploadResult.fileId })
    assert(chunksCount > 0, "GridFS binary chunks created in recordings.chunks")

    // Check updated Call document
    const updatedCall = await Call.findById(callA._id)
    assert(updatedCall.recording.status === "stored", "Call.recording.status updated to 'stored'")
    assert(updatedCall.recording.fileId.toString() === uploadResult.fileId.toString(), "Call.recording.fileId linked")
    assert(updatedCall.recording.sizeBytes === audioData.sizeBytes, "Call.recording.sizeBytes updated")
    assert(Boolean(updatedCall.recording.expiresAt), "Call.recording.expiresAt timestamp set")

    // Idempotency check: Re-uploading same call returns existing record without duplicate file creation
    const dupStream = createDummyAudioStream(1024 * 16)
    const dupResult = await recordingStorage.streamUpload({
      callId: callA._id.toString(),
      tenantId: testTenantA,
      user: userA,
      readStream: dupStream.stream,
      mimeType: "audio/mp4",
    })
    assert(dupResult.isDuplicate === true, "Re-upload flagged as isDuplicate=true")
    assert(dupResult.fileId.toString() === uploadResult.fileId.toString(), "Idempotent re-upload preserved original fileId")

    // =========================================================================
    // TEST GROUP 3: SECURITY & PRIVACY REJECTIONS (NON-LEAD, DNR, TENANT, RBAC)
    // =========================================================================
    console.log("\n--- TEST GROUP 3: SECURITY & PRIVACY GUARDS ---")

    // 1. Cross-tenant upload rejection
    try {
      const crossStream = createDummyAudioStream(1024)
      await recordingStorage.streamUpload({
        callId: callA._id.toString(),
        tenantId: testTenantB, // Wrong tenant
        user: userB,
        readStream: crossStream.stream,
      })
      assert(false, "Cross-tenant upload should have failed")
    } catch (err) {
      assert(err.statusCode === 404, "Cross-tenant upload rejected with 404 Not Found")
    }

    // 2. Wrong agent upload rejection
    try {
      const wrongAgentStream = createDummyAudioStream(1024)
      await recordingStorage.streamUpload({
        callId: callA._id.toString(),
        tenantId: testTenantA,
        user: { _id: new mongoose.Types.ObjectId(), role: "agent" }, // Different agent in same tenant
        readStream: wrongAgentStream.stream,
      })
      assert(false, "Wrong agent upload should have failed")
    } catch (err) {
      assert(err.statusCode === 403, "Wrong agent upload rejected with 403 Forbidden")
    }

    // 3. Non-lead call rejection (Privacy Rule)
    try {
      const personalStream = createDummyAudioStream(1024)
      await recordingStorage.streamUpload({
        callId: callPersonal._id.toString(),
        tenantId: testTenantA,
        user: userA,
        readStream: personalStream.stream,
      })
      assert(false, "Non-lead personal call recording upload should have failed")
    } catch (err) {
      assert(err.statusCode === 403, "Non-lead personal call upload rejected with 403 Forbidden")
      assert(err.code === "NON_LEAD_RECORDING_REJECTED", "Error code is NON_LEAD_RECORDING_REJECTED")
    }

    // 4. Do-Not-Record (DNR) rejection
    const callDnr = await Call.create({
      tenantId: testTenantA,
      agentId: agentAId,
      leadId: leadDnr._id,
      clientCallId: `call_dnr_${testTimestamp}`,
      number: "+919876500000",
      direction: "outbound",
      duration: 60,
    })

    try {
      const dnrStream = createDummyAudioStream(1024)
      await recordingStorage.streamUpload({
        callId: callDnr._id.toString(),
        tenantId: testTenantA,
        user: userA,
        readStream: dnrStream.stream,
      })
      assert(false, "DNR lead recording upload should have failed")
    } catch (err) {
      assert(err.statusCode === 403, "DNR lead recording rejected with 403 Forbidden")
      assert(err.code === "RECORDING_FORBIDDEN_DNR", "Error code is RECORDING_FORBIDDEN_DNR")
    }

    // 5. Unsupported audio MIME type rejection
    try {
      const invalidMimeStream = createDummyAudioStream(1024)
      await recordingStorage.streamUpload({
        callId: callA._id.toString(),
        tenantId: testTenantA,
        user: userA,
        readStream: invalidMimeStream.stream,
        mimeType: "application/x-executable",
      })
      assert(false, "Unsupported MIME type should have failed")
    } catch (err) {
      assert(err.statusCode === 415, "Invalid MIME type rejected with 415 Unsupported Media Type")
    }

    // 6. SHA-256 integrity mismatch rejection
    try {
      const callCorrupt = await Call.create({
        tenantId: testTenantA,
        agentId: agentAId,
        leadId: leadA._id,
        clientCallId: `call_corrupt_${testTimestamp}`,
        number: "+919876543210",
        direction: "outbound",
        duration: 20,
      })
      const corruptedStream = createDummyAudioStream(1024)
      await recordingStorage.streamUpload({
        callId: callCorrupt._id.toString(),
        tenantId: testTenantA,
        user: userA,
        readStream: corruptedStream.stream,
        mimeType: "audio/mp4",
        expectedSha256: "0000000000000000000000000000000000000000000000000000000000000000",
      })
      assert(false, "Corrupted SHA-256 upload should have failed")
    } catch (err) {
      assert(err.statusCode === 400, "SHA-256 integrity mismatch rejected with 400 Bad Request")
    }

    // =========================================================================
    // TEST GROUP 4: SECURE STREAMING PLAYBACK & RANGE REQUESTS
    // =========================================================================
    console.log("\n--- TEST GROUP 4: STREAMING PLAYBACK & RANGE REQUESTS ---")

    // Mock Express Response object using stream.PassThrough
    const { PassThrough } = require("stream")
    function createMockResponse() {
      const res = new PassThrough()
      res.statusCode = 200
      res.headers = {}
      res.data = Buffer.alloc(0)
      res.setHeader = function (name, val) {
        this.headers[name.toLowerCase()] = val
      }
      res.writeHead = function (status, headers) {
        this.statusCode = status
        if (headers) {
          for (const [k, v] of Object.entries(headers)) {
            this.headers[k.toLowerCase()] = v
          }
        }
      }
      res.status = function (code) {
        this.statusCode = code
        return this
      }
      res.json = function (obj) {
        this.body = obj
        return this
      }
      res.send = function (val) {
        this.body = val
        return this
      }
      res.on("data", (chunk) => {
        res.data = Buffer.concat([res.data, chunk])
      })
      return res
    }

    // 1. Full playback stream
    const fullRes = createMockResponse()
    await recordingStorage.streamPlayback({
      callId: callA._id.toString(),
      tenantId: testTenantA,
      user: userA,
      rangeHeader: null,
      res: fullRes,
    })
    assert(fullRes.statusCode === 200, "Full playback returns HTTP 200")
    assert(fullRes.headers["accept-ranges"] === "bytes", "Header Accept-Ranges is 'bytes'")
    assert(fullRes.headers["content-type"] === "audio/mp4", "Header Content-Type is 'audio/mp4'")
    assert(fullRes.headers["content-length"] === audioData.sizeBytes, "Content-Length matches total file length")

    // 2. HTTP Range Request (seeking test: bytes 0-499)
    const rangeRes = createMockResponse()
    await recordingStorage.streamPlayback({
      callId: callA._id.toString(),
      tenantId: testTenantA,
      user: userA,
      rangeHeader: "bytes=0-499",
      res: rangeRes,
    })
    assert(rangeRes.statusCode === 206, "Range request returns HTTP 206 Partial Content")
    assert(rangeRes.headers["content-range"].startsWith("bytes 0-499/"), "Content-Range header contains range")
    assert(rangeRes.headers["content-length"] === 500, "Partial Content-Length is exactly 500 bytes")

    // 3. Cross-tenant playback rejection
    const crossRes = createMockResponse()
    crossRes.status = function (code) {
      this.statusCode = code
      return this
    }
    crossRes.json = function (obj) {
      this.body = obj
      return this
    }
    await recordingStorage.streamPlayback({
      callId: callA._id.toString(),
      tenantId: testTenantB, // Wrong tenant
      user: userB,
      res: crossRes,
    })
    assert(crossRes.statusCode === 404, "Cross-tenant playback rejected with 404")

    // =========================================================================
    // TEST GROUP 5: 30-DAY PURGE & CALL HISTORY PRESERVATION
    // =========================================================================
    console.log("\n--- TEST GROUP 5: 30-DAY RETENTION PURGE & CALL PRESERVATION ---")

    // Create an expired call with stored recording (expiresAt in the past)
    const expiredAudio = createDummyAudioStream(1024 * 8)
    const callExpired = await Call.create({
      tenantId: testTenantA,
      agentId: agentAId,
      leadId: leadA._id,
      clientCallId: `call_expired_${testTimestamp}`,
      number: "+919876543210",
      direction: "outbound",
      duration: 95,
      notes: "Customer confirmed contract terms. Follow up next month.",
      disposition: "won",
    })

    const expiredUpload = await recordingStorage.streamUpload({
      callId: callExpired._id.toString(),
      tenantId: testTenantA,
      user: userA,
      readStream: expiredAudio.stream,
      mimeType: "audio/mp4",
      retentionDays: 0, // Expire immediately
    })

    // Backdate expiresAt to past
    await Call.updateOne(
      { _id: callExpired._id },
      { $set: { "recording.expiresAt": new Date(Date.now() - 10000) } }
    )
    await db.collection("recordings.files").updateOne(
      { _id: expiredUpload.fileId },
      { $set: { "metadata.expiresAt": new Date(Date.now() - 10000) } }
    )

    const storedFileBefore = await bucket.find({ _id: expiredUpload.fileId }).next()
    assert(Boolean(storedFileBefore), "Expired test file exists in GridFS prior to purge")
    const chunksBefore = await db.collection("recordings.chunks").countDocuments({ files_id: expiredUpload.fileId })
    assert(chunksBefore > 0, "Chunks exist prior to purge")

    // Run purge job
    const purgeResult = await recordingStorage.purgeExpiredRecordings({
      tenantId: testTenantA,
      retentionDays: 30,
    })

    assert(purgeResult.purgedCount >= 1, `Purge deleted ${purgeResult.purgedCount} expired recording(s)`)

    // Verify file and chunks deleted from GridFS
    const storedFileAfter = await bucket.find({ _id: expiredUpload.fileId }).next()
    assert(storedFileAfter === null, "File document deleted from recordings.files")
    const chunksAfter = await db.collection("recordings.chunks").countDocuments({ files_id: expiredUpload.fileId })
    assert(chunksAfter === 0, "All chunks deleted from recordings.chunks")

    // Verify Call log history is completely preserved!
    const preservedCall = await Call.findById(callExpired._id)
    assert(preservedCall.recording.status === "expired", "Call.recording.status updated to 'expired'")
    assert(preservedCall.recording.fileId === null, "Call.recording.fileId reset to null")
    assert(preservedCall.duration === 95, "Call duration preserved (95s)")
    assert(preservedCall.notes === "Customer confirmed contract terms. Follow up next month.", "Call notes preserved intact")
    assert(preservedCall.disposition === "won", "Call disposition preserved intact")

    // Playback of expired recording returns 410 Gone
    const expiredPlayRes = createMockResponse()
    expiredPlayRes.status = function (code) {
      this.statusCode = code
      return this
    }
    expiredPlayRes.json = function (obj) {
      this.body = obj
      return this
    }
    await recordingStorage.streamPlayback({
      callId: callExpired._id.toString(),
      tenantId: testTenantA,
      user: userA,
      res: expiredPlayRes,
    })
    assert(expiredPlayRes.statusCode === 410, "Playback of purged recording returns HTTP 410 Gone")

    // =========================================================================
    // TEST GROUP 6: ANDROID RECORDING TICKET & UPLOAD AUTHENTICATION
    // =========================================================================
    console.log("\n--- TEST GROUP 6: ANDROID CLIENT INTEGRATION & TICKETS ---")

    // Generate pre-flight recording ticket
    const ticketResult = await issueRecordingTicket({
      tenantId: testTenantA,
      agentId: agentAId.toString(),
      callId: callA._id.toString(),
    })

    assert(ticketResult.eligible === true, "Pre-flight ticket is eligible")
    assert(ticketResult.uploadUrl === `/api/calls/${callA._id}/recording`, "uploadUrl matches canonical API route")
    assert(Boolean(ticketResult.ticket), "Upload ticket JWT issued")

    // Verify ticket authentication middleware
    let authPassed = false
    const mockReq = {
      params: { id: callA._id.toString() },
      headers: {
        "x-recording-ticket": ticketResult.ticket,
      },
    }
    const mockRes = {}
    await authenticateRecordingUpload(mockReq, mockRes, () => {
      authPassed = true
    })
    assert(authPassed === true, "authenticateRecordingUpload accepted valid recording ticket")
    assert(mockReq.user.tenantId === testTenantA, "Tenant context correctly established from ticket")
    assert(mockReq.user._id.toString() === agentAId.toString(), "Agent identity correctly bound from ticket")

  } finally {
    // Clean up test data
    try {
      await Account.deleteMany({ tenantId: { $in: [testTenantA, testTenantB] } })
      await User.deleteMany({ tenantId: { $in: [testTenantA, testTenantB] } })
      await Lead.deleteMany({ tenantId: { $in: [testTenantA, testTenantB] } })
      await Call.deleteMany({ tenantId: { $in: [testTenantA, testTenantB] } })
      const db = mongoose.connection.db
      if (db) {
        await db.collection("recordings.files").deleteMany({ "metadata.tenantId": { $in: [testTenantA, testTenantB] } })
      }
    } catch (_) {}

    await mongoose.disconnect()
    console.log("\nDisconnected from MongoDB Atlas")
  }

  console.log("\n" + "=".repeat(80))
  console.log(`=== PHASE 16 SUMMARY: Passed: ${passed} | Failed: ${failed} ===`)
  console.log("=".repeat(80))

  if (failed > 0) process.exit(1)
}

runTests().catch((err) => {
  console.error("Test execution failed:", err)
  process.exit(1)
})
