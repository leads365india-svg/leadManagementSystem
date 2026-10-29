/**
 * End-to-End Verification Suite for Recording Storage and Playback
 * Tests:
 * 1. Mobile upload writes persistently to MongoDB GridFS.
 * 2. Upload persists canonical Call.recording reference (fileId, sizeBytes, sha256, status, expiresAt).
 * 3. Incomplete/corrupted upload cleans up GridFS and does NOT mark call as stored.
 * 4. Idempotent repeated uploads return existing stored file without duplication.
 * 5. Authenticated playback retrieves audio bytes from GridFS with HTTP 200.
 * 6. HTTP Range requests return HTTP 206 Partial Content with correct byte ranges.
 * 7. Legacy local-disk file fallback works safely with path traversal protection.
 * 8. Cross-tenant and unauthorized playback attempts are strictly rejected.
 */

require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") })
const mongoose = require("mongoose")
const crypto = require("crypto")
const path = require("path")
const fs = require("fs")
const { Readable } = require("stream")

const Call = require("../models/Call")
const Lead = require("../models/Lead")
const User = require("../models/User")
const recordingStorage = require("../services/recordingStorage")
const { uploadMobileRecording, streamCallRecording } = require("../controllers/mobileController")

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

function createDummyAudioStream(sizeBytes = 1024 * 32) {
  const buffer = crypto.randomBytes(sizeBytes)
  const hash = crypto.createHash("sha256").update(buffer).digest("hex")
  const stream = new Readable()
  stream.push(buffer)
  stream.push(null)
  return { stream, buffer, hash, sizeBytes }
}

const { Writable } = require("stream")

// Mock Express response object for testing controller streaming
function createMockResponse() {
  const res = new Writable({
    write(chunk, encoding, callback) {
      if (!this.chunks) this.chunks = []
      this.chunks.push(chunk)
      callback()
    }
  })
  res.statusCode = 200
  res.headers = {}
  res.body = null
  res.headersSent = false
  res.status = function(code) {
    this.statusCode = code
    return this
  }
  res.json = function(data) {
    this.body = data
    this.headersSent = true
    return this
  }
  res.setHeader = function(key, val) {
    this.headers[key.toLowerCase()] = val
    return this
  }
  res.writeHead = function(code, headers = {}) {
    this.statusCode = code
    for (const [k, v] of Object.entries(headers)) {
      this.headers[k.toLowerCase()] = v
    }
    this.headersSent = true
    return this
  }
  res.send = function(data) {
    this.body = data
    this.headersSent = true
    return this
  }
  return res
}

async function runTests() {
  console.log("=".repeat(80))
  console.log("=== RECORDING STORAGE & PLAYBACK END-TO-END VERIFICATION SUITE ===")
  console.log("=".repeat(80))

  const mongoUri = process.env.MONGODB_URI
  if (!mongoUri) {
    console.error("Missing MONGODB_URI in environment")
    process.exit(1)
  }

  await mongoose.connect(mongoUri)
  console.log("Connected to MongoDB Atlas\n")

  const timestamp = Date.now()
  const testTenantA = `test_tenant_a_${timestamp}`
  const testTenantB = `test_tenant_b_${timestamp}`
  const agentAId = new mongoose.Types.ObjectId()
  const agentBId = new mongoose.Types.ObjectId()

  let userA = null
  let userB = null
  let leadA = null
  let callA = null
  let legacyCall = null
  let legacyFilePath = null
  const createdFileIds = []

  try {
    // 1. Create test users and lead
    userA = await User.create({
      _id: agentAId,
      name: "Agent Alice",
      email: `alice_${timestamp}@example.com`,
      password: "HashedPassword123!",
      role: "agent",
      tenantId: testTenantA,
      status: "active",
    })

    userB = await User.create({
      _id: agentBId,
      name: "Agent Bob",
      email: `bob_${timestamp}@example.com`,
      password: "HashedPassword123!",
      role: "agent",
      tenantId: testTenantB,
      status: "active",
    })

    leadA = await Lead.create({
      tenantId: testTenantA,
      name: "Verified Lead",
      email: `lead_${timestamp}@example.com`,
      phone: "+919876543210",
      status: "Engaged",
      ownerId: agentAId,
    })

    const clientCallId = `client_call_uuid_${timestamp}`
    callA = await Call.create({
      tenantId: testTenantA,
      agentId: agentAId,
      leadId: leadA._id,
      clientCallId,
      number: "+919876543210",
      direction: "outbound",
      duration: 30,
      durationSeconds: 30,
      status: "completed",
    })

    console.log("Test Case 1: Streamed upload persists to MongoDB GridFS via clientCallId")
    const audioData = createDummyAudioStream(1024 * 20)
    const uploadResult = await recordingStorage.streamUpload({
      callId: clientCallId,
      tenantId: testTenantA,
      user: userA,
      readStream: audioData.stream,
      mimeType: "audio/m4a",
      filename: `test_${timestamp}.m4a`,
      contentLength: audioData.sizeBytes,
      expectedSha256: audioData.hash,
      retentionDays: 30,
    })

    assert(uploadResult.success === true, "Upload returned success=true")
    assert(Boolean(uploadResult.fileId), "Upload returned valid GridFS fileId")
    assert(uploadResult.status === "stored", "Upload status is 'stored'")
    assert(uploadResult.sha256 === audioData.hash, "Computed SHA-256 matches audio stream")
    createdFileIds.push(uploadResult.fileId)

    // Check database document
    const updatedCall = await Call.findById(callA._id)
    assert(updatedCall.hasRecording === true, "Call.hasRecording is true")
    assert(updatedCall.recording.status === "stored", "Call.recording.status is 'stored'")
    assert(updatedCall.recording.fileId.toString() === uploadResult.fileId.toString(), "Call.recording.fileId matches GridFS fileId")
    assert(updatedCall.recording.sizeBytes === audioData.sizeBytes, "Call.recording.sizeBytes is exact")
    assert(updatedCall.recording.expiresAt instanceof Date, "Call.recording.expiresAt is populated with Date")
    assert(Boolean(updatedCall.metadata.recordingUrl), "Call.metadata.recordingUrl is populated")

    console.log("\nTest Case 2: Idempotent re-upload returns existing file without duplication")
    const duplicateAudio = createDummyAudioStream(1024 * 20)
    const duplicateResult = await recordingStorage.streamUpload({
      callId: callA._id.toString(),
      tenantId: testTenantA,
      user: userA,
      readStream: duplicateAudio.stream,
      mimeType: "audio/m4a",
      filename: `test_${timestamp}.m4a`,
      contentLength: duplicateAudio.sizeBytes,
      expectedSha256: audioData.hash,
      retentionDays: 30,
    })
    assert(duplicateResult.success === true, "Duplicate upload returned success=true")
    assert(duplicateResult.isDuplicate === true, "Duplicate detected (isDuplicate=true)")
    assert(duplicateResult.fileId.toString() === uploadResult.fileId.toString(), "Same GridFS fileId returned")

    console.log("\nTest Case 3: Incomplete / corrupted upload fails and does not store file")
    const corruptCall = await Call.create({
      tenantId: testTenantA,
      agentId: agentAId,
      leadId: leadA._id,
      number: "+919876543210",
      direction: "outbound",
      duration: 15,
      status: "completed",
    })

    const corruptAudio = createDummyAudioStream(1024 * 10)
    let corruptFailed = false
    try {
      await recordingStorage.streamUpload({
        callId: corruptCall._id.toString(),
        tenantId: testTenantA,
        user: userA,
        readStream: corruptAudio.stream,
        mimeType: "audio/m4a",
        filename: `corrupt_${timestamp}.m4a`,
        contentLength: corruptAudio.sizeBytes,
        expectedSha256: "0000000000000000000000000000000000000000000000000000000000000000", // Mismatched SHA
        retentionDays: 30,
      })
    } catch (err) {
      corruptFailed = true
      assert(err.statusCode === 400, "Corrupt stream rejected with HTTP 400")
    }
    assert(corruptFailed, "Upload with corrupted checksum threw an error")

    const unmodifiedCall = await Call.findById(corruptCall._id)
    assert(unmodifiedCall.recording?.status !== "stored", "Corrupted call recording status is NOT stored")
    assert(!unmodifiedCall.recording?.fileId, "Corrupted call has null fileId")
    await Call.deleteOne({ _id: corruptCall._id })

    console.log("\nTest Case 4: Authenticated playback from GridFS with Full Content (HTTP 200)")
    const res200 = createMockResponse()
    await recordingStorage.streamPlayback({
      callId: clientCallId,
      tenantId: testTenantA,
      user: userA,
      rangeHeader: null,
      res: res200,
    })
    assert(res200.statusCode === 200, "Playback returned HTTP 200")
    assert(res200.headers["content-type"] === "audio/m4a", "Content-Type is audio/m4a")
    assert(res200.headers["content-length"] === audioData.sizeBytes, "Content-Length matches stored size")
    assert(res200.headers["cross-origin-resource-policy"] === "cross-origin", "Cross-Origin-Resource-Policy is cross-origin")
    assert(res200.headers["cache-control"].includes("no-cache"), "Cache-Control is set properly")

    console.log("\nTest Case 5: Authenticated playback with HTTP Range request (HTTP 206 Partial Content)")
    const res206 = createMockResponse()
    await recordingStorage.streamPlayback({
      callId: callA._id.toString(),
      tenantId: testTenantA,
      user: userA,
      rangeHeader: "bytes=0-1023",
      res: res206,
    })
    assert(res206.statusCode === 206, "Range request returned HTTP 206")
    assert(res206.headers["content-range"] === `bytes 0-1023/${audioData.sizeBytes}`, "Content-Range header is correct")
    assert(res206.headers["content-length"] === 1024, "Partial Content-Length is 1024")
    assert(res206.headers["cross-origin-resource-policy"] === "cross-origin", "Cross-Origin-Resource-Policy is cross-origin on 206")

    console.log("\nTest Case 6: Cross-tenant unauthorized playback is blocked")
    const resTenantB = createMockResponse()
    await recordingStorage.streamPlayback({
      callId: callA._id.toString(),
      tenantId: testTenantB, // Tenant B attempting to access Tenant A's call
      user: userB,
      rangeHeader: null,
      res: resTenantB,
    })
    assert(resTenantB.statusCode === 404, "Cross-tenant call lookup correctly returned 404 not found")

    console.log("\nTest Case 7: Backward compatible legacy local-file fallback")
    const safeTenantDir = path.join(__dirname, "../uploads/recordings", testTenantA)
    if (!fs.existsSync(safeTenantDir)) {
      fs.mkdirSync(safeTenantDir, { recursive: true })
    }
    const legacyFileName = `legacy_call_${timestamp}.m4a`
    legacyFilePath = path.join(safeTenantDir, legacyFileName)
    fs.writeFileSync(legacyFilePath, audioData.buffer)

    legacyCall = await Call.create({
      tenantId: testTenantA,
      agentId: agentAId,
      leadId: leadA._id,
      clientCallId: `legacy_uuid_${timestamp}`,
      number: "+919876543210",
      direction: "outbound",
      duration: 25,
      status: "completed",
      hasRecording: true,
      metadata: {
        recordingUrl: `/uploads/recordings/${testTenantA}/${legacyFileName}`,
        recordingMimeType: "audio/m4a",
      },
      recording: {
        fileId: null,
        status: "ready",
      },
    })

    const resLegacy = createMockResponse()
    await recordingStorage.streamPlayback({
      callId: legacyCall._id.toString(),
      tenantId: testTenantA,
      user: userA,
      rangeHeader: null,
      res: resLegacy,
    })
    assert(resLegacy.statusCode === 200, "Legacy local-file fallback returned HTTP 200")
    assert(resLegacy.headers["content-length"] === audioData.sizeBytes, "Legacy file content-length matches")
    assert(resLegacy.headers["cross-origin-resource-policy"] === "cross-origin", "Legacy file sets Cross-Origin-Resource-Policy: cross-origin")

    console.log("\nTest Case 8: Path traversal prevention on legacy fallback")
    const maliciousCall = await Call.create({
      tenantId: testTenantA,
      agentId: agentAId,
      leadId: leadA._id,
      clientCallId: `malicious_uuid_${timestamp}`,
      number: "+919876543210",
      direction: "outbound",
      duration: 25,
      status: "completed",
      hasRecording: true,
      metadata: {
        recordingUrl: `../../../../etc/passwd`,
        recordingMimeType: "audio/m4a",
      },
    })
    const resTraversal = createMockResponse()
    await recordingStorage.streamPlayback({
      callId: maliciousCall._id.toString(),
      tenantId: testTenantA,
      user: userA,
      rangeHeader: null,
      res: resTraversal,
    })
    assert(resTraversal.statusCode === 404, "Path traversal attempt safely returned 404")
    await Call.deleteOne({ _id: maliciousCall._id })

    console.log("\nTest Case 9: Mobile controller uploadMobileRecording endpoint integration")
    const mobileReq = createDummyAudioStream(1024 * 16)
    mobileReq.stream.headers = {
      "content-type": "audio/m4a",
      "x-content-sha256": mobileReq.hash,
      "content-length": mobileReq.sizeBytes,
    }
    mobileReq.stream.params = { callId: callA._id.toString() }
    mobileReq.stream.user = userA

    const mobileRes = createMockResponse()
    await uploadMobileRecording(mobileReq.stream, mobileRes)
    assert(mobileRes.statusCode === 200 || mobileRes.statusCode === 201, "uploadMobileRecording returned 200/201")
    assert(mobileRes.body?.success === true, "uploadMobileRecording body.success is true")
    assert(mobileRes.body?.recordingUrl.startsWith("/api/calls/"), "uploadMobileRecording returned canonical /api/calls/ URL")

    console.log("\nTest Case 10: Mobile controller streamCallRecording endpoint integration")
    const streamReq = {
      params: { callId: callA._id.toString() },
      headers: { range: "bytes=0-500" },
      user: userA,
    }
    const streamRes = createMockResponse()
    await streamCallRecording(streamReq, streamRes)
    assert(streamRes.statusCode === 206, "streamCallRecording delegated to streamPlayback and returned 206")
    assert(streamRes.headers["content-range"].startsWith("bytes 0-500/"), "streamCallRecording sent valid Content-Range header")

    console.log("\nTest Case 11: Non-existent call ID returns 404 with code CALL_NOT_FOUND")
    const nonExistentRes = createMockResponse()
    await recordingStorage.streamPlayback({
      callId: new mongoose.Types.ObjectId().toString(),
      tenantId: testTenantA,
      user: userA,
      rangeHeader: null,
      res: nonExistentRes,
    })
    assert(nonExistentRes.statusCode === 404, "Non-existent call returned HTTP 404")
    assert(nonExistentRes.body?.code === "CALL_NOT_FOUND", "Returned code CALL_NOT_FOUND")

    console.log("\nTest Case 12: Legacy recording with missing ephemeral file returns 404 with code LEGACY_FILE_EXPIRED")
    const missingLegacyCall = await Call.create({
      tenantId: testTenantA,
      agentId: agentAId,
      leadId: leadA._id,
      clientCallId: `missing_ephemeral_uuid_${timestamp}`,
      number: "+919876543210",
      direction: "outbound",
      duration: 15,
      status: "completed",
      hasRecording: true,
      metadata: {
        recordingUrl: `/uploads/recordings/${testTenantA}/deleted_or_lost_file_${timestamp}.m4a`,
        recordingMimeType: "audio/m4a",
      },
      recording: {
        fileId: null,
        status: "ready",
      },
    })
    const missingLegacyRes = createMockResponse()
    await recordingStorage.streamPlayback({
      callId: missingLegacyCall._id.toString(),
      tenantId: testTenantA,
      user: userA,
      rangeHeader: null,
      res: missingLegacyRes,
    })
    assert(missingLegacyRes.statusCode === 404, "Missing legacy file returned HTTP 404")
    assert(missingLegacyRes.body?.code === "LEGACY_FILE_EXPIRED", "Returned code LEGACY_FILE_EXPIRED")
    assert(missingLegacyRes.body?.error.includes("legacy storage expired"), "Informative error message on expired ephemeral storage")
    await Call.deleteOne({ _id: missingLegacyCall._id })

    console.log("\nTest Case 13: Stored status with missing GridFS chunks returns 404 with code GRIDFS_FILE_MISSING")
    const missingGridFSCall = await Call.create({
      tenantId: testTenantA,
      agentId: agentAId,
      leadId: leadA._id,
      clientCallId: `missing_gridfs_uuid_${timestamp}`,
      number: "+919876543210",
      direction: "outbound",
      duration: 20,
      status: "completed",
      hasRecording: true,
      recording: {
        fileId: new mongoose.Types.ObjectId(),
        status: "stored",
      },
    })
    const missingGridFSRes = createMockResponse()
    await recordingStorage.streamPlayback({
      callId: missingGridFSCall._id.toString(),
      tenantId: testTenantA,
      user: userA,
      rangeHeader: null,
      res: missingGridFSRes,
    })
    assert(missingGridFSRes.statusCode === 404, "Missing GridFS file returned HTTP 404")
    assert(missingGridFSRes.body?.code === "GRIDFS_FILE_MISSING", "Returned code GRIDFS_FILE_MISSING")
    await Call.deleteOne({ _id: missingGridFSCall._id })

    console.log("\nTest Case 14: checkLegacyRecordingAvailability diagnostics without database mutation")
    const availCheck = await recordingStorage.checkLegacyRecordingAvailability({
      callId: legacyCall._id.toString(),
      tenantId: testTenantA,
    })
    assert(availCheck.available === true, "checkLegacyRecordingAvailability detects existing legacy file")
    assert(availCheck.sizeBytes === audioData.sizeBytes, "Detected file size matches")

    const missingAvailCheck = await recordingStorage.checkLegacyRecordingAvailability({
      callId: new mongoose.Types.ObjectId().toString(),
      tenantId: testTenantA,
    })
    assert(missingAvailCheck.available === false, "checkLegacyRecordingAvailability returns available=false for missing call")
    assert(missingAvailCheck.code === "CALL_NOT_FOUND", "Returned CALL_NOT_FOUND")

    console.log("\nTest Case 15: migrateLegacyFileToGridFS requires explicit authorization & validates presence")
    let unauthError = null
    try {
      await recordingStorage.migrateLegacyFileToGridFS({
        callId: legacyCall._id.toString(),
        tenantId: testTenantA,
        user: userA,
        authorized: false,
      })
    } catch (e) {
      unauthError = e
    }
    assert(unauthError !== null && unauthError.statusCode === 403, "Refuses migration without explicit authorized=true")

    let missingFileMigrationError = null
    try {
      await recordingStorage.migrateLegacyFileToGridFS({
        callId: new mongoose.Types.ObjectId().toString(),
        tenantId: testTenantA,
        user: userA,
        authorized: true,
      })
    } catch (e) {
      missingFileMigrationError = e
    }
    assert(missingFileMigrationError !== null && missingFileMigrationError.statusCode === 404, "Refuses migration when legacy file is missing")

    // Allow streaming pipe to finish flushing before deleting files
    await new Promise((r) => setTimeout(r, 250))
  } finally {
    console.log("\nCleaning up test artifacts...")
    try {
      const bucket = recordingStorage.getBucket()
      for (const fId of createdFileIds) {
        await bucket.delete(new mongoose.Types.ObjectId(fId)).catch(() => {})
      }
      if (callA) await Call.deleteOne({ _id: callA._id }).catch(() => {})
      if (legacyCall) await Call.deleteOne({ _id: legacyCall._id }).catch(() => {})
      if (leadA) await Lead.deleteOne({ _id: leadA._id }).catch(() => {})
      if (userA) await User.deleteOne({ _id: userA._id }).catch(() => {})
      if (userB) await User.deleteOne({ _id: userB._id }).catch(() => {})
      if (legacyFilePath && fs.existsSync(legacyFilePath)) {
        fs.unlinkSync(legacyFilePath)
      }
      const safeTenantDir = path.join(__dirname, "../uploads/recordings", testTenantA)
      if (fs.existsSync(safeTenantDir)) {
        fs.rmdirSync(safeTenantDir)
      }
    } catch (cleanupErr) {
      console.warn("Cleanup warning:", cleanupErr.message)
    }

    await mongoose.disconnect()
  }

  console.log("\n" + "=".repeat(80))
  console.log(`RESULTS: ${passed} passed, ${failed} failed`)
  console.log("=".repeat(80))

  if (failed > 0) {
    process.exit(1)
  }
}

runTests().catch((err) => {
  console.error("Test execution failed:", err)
  process.exit(1)
})
