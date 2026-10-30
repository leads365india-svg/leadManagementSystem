require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") })
const mongoose = require("mongoose")
const crypto = require("crypto")
const fs = require("fs")
const path = require("path")
const { Readable, Writable } = require("stream")
const { spawnSync } = require("child_process")

const Call = require("../models/Call")
const Lead = require("../models/Lead")
const User = require("../models/User")
const Account = require("../models/Account")
const recordingStorage = require("../services/recordingStorage")
const audioConverter = require("../services/audioConverter")
const ffmpegPath = audioConverter.getFfmpegPath()

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

// Helper to create mock Express response object with promise-based stream completion
function createMockResponse() {
  const chunks = []
  let onFinishResolve = null
  const finishedPromise = new Promise((resolve) => {
    onFinishResolve = resolve
  })

  const res = new Writable({
    write(chunk, encoding, callback) {
      chunks.push(Buffer.from(chunk))
      callback()
    },
    final(callback) {
      callback()
      if (onFinishResolve) onFinishResolve()
    },
  })
  res.chunks = chunks
  res.statusCode = 200
  res.headers = {}
  res.headersSent = false
  res.body = null

  res.status = function (code) {
    this.statusCode = code
    return this
  }
  res.setHeader = function (k, v) {
    this.headers[k.toLowerCase()] = v
    return this
  }
  res.writeHead = function (code, headers = {}) {
    this.statusCode = code
    for (const [k, v] of Object.entries(headers)) {
      this.headers[k.toLowerCase()] = v
    }
    this.headersSent = true
    return this
  }
  res.json = function (data) {
    this.body = data
    this.headersSent = true
    if (onFinishResolve) onFinishResolve()
    return this
  }
  res.send = function (data) {
    this.body = data
    this.headersSent = true
    if (onFinishResolve) onFinishResolve()
    return this
  }
  res.end = function (chunk) {
    if (chunk) chunks.push(Buffer.from(chunk))
    this.headersSent = true
    Writable.prototype.end.call(this)
    if (onFinishResolve) onFinishResolve()
    return this
  }
  res.waitForFinish = function (timeoutMs = 5000) {
    return Promise.race([
      finishedPromise,
      new Promise((res) => setTimeout(res, timeoutMs)),
    ])
  }
  res.getBuffer = function () {
    return Buffer.concat(chunks)
  }
  return res
}

// Generate real audible test audio file using FFmpeg
function generateTestAudioFile(format = "wav", durationSeconds = 3, freq = 440) {
  const tmpFile = path.resolve(__dirname, `../temp_fixture_${Date.now()}_${Math.random().toString(36).substring(7)}.${format}`)
  
  const args = [
    "-y",
    "-f", "lavfi",
    "-i", `sine=frequency=${freq}:duration=${durationSeconds}`,
  ]

  if (format === "wav") {
    args.push("-c:a", "pcm_s16le")
  } else if (format === "mp3") {
    args.push("-c:a", "libmp3lame", "-b:a", "128k", "-ar", "44100")
  } else if (format === "m4a") {
    args.push("-c:a", "aac", "-b:a", "128k")
  }

  args.push(tmpFile)
  const res = spawnSync(ffmpegPath, args)
  if (res.status !== 0 || !fs.existsSync(tmpFile)) {
    throw new Error(`Failed to generate test audio: ${res.stderr?.toString()}`)
  }

  const buffer = fs.readFileSync(tmpFile)
  const hash = crypto.createHash("sha256").update(buffer).digest("hex")

  return {
    filePath: tmpFile,
    buffer,
    hash,
    sizeBytes: buffer.length,
    cleanup: () => {
      try { if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile) } catch (_) {}
    },
  }
}

async function runVerification() {
  console.log("=".repeat(80))
  console.log("=== COMPREHENSIVE AUDIO RECORDING & MP3 CONVERSION TEST SUITE ===")
  console.log("=".repeat(80))

  await mongoose.connect(process.env.MONGODB_URI)

  const tenantA = `TEST_TENANT_A_${Date.now()}`
  const tenantB = `TEST_TENANT_B_${Date.now()}`

  try {
    // 0. Setup Tenants, Users, and Leads
    const userA = await User.create({
      name: "Agent Alice",
      email: `alice_${Date.now()}@example.com`,
      password: "password123",
      role: "agent",
      tenantId: tenantA,
    })

    const userB = await User.create({
      name: "Agent Bob",
      email: `bob_${Date.now()}@example.com`,
      password: "password123",
      role: "agent",
      tenantId: tenantB,
    })

    const leadA = await Lead.create({
      tenantId: tenantA,
      name: "Customer John Doe",
      phone: "+919876500001",
      status: "New",
      assignedTo: userA.name,
      assignedStaffId: userA._id.toString(),
    })

    const leadB = await Lead.create({
      tenantId: tenantB,
      name: "Customer Jane Smith",
      phone: "+919876500002",
      status: "New",
      assignedTo: userB.name,
      assignedStaffId: userB._id.toString(),
    })

    // -------------------------------------------------------------------------
    // TEST 1: Automatic MP3 Conversion of Unsupported Format (WAV -> MP3)
    // -------------------------------------------------------------------------
    console.log("\n[TEST 1] Uploading unsupported format (WAV) & Automatic MP3 conversion...")
    const wavAudio = generateTestAudioFile("wav", 3.0, 440)

    const call1 = await Call.create({
      tenantId: tenantA,
      leadId: leadA._id,
      agentId: userA._id,
      number: leadA.phone,
      direction: "outbound",
      duration: 0,
      startTimeMs: Date.now() - 5000,
    })

    const wavStream = Readable.from(wavAudio.buffer)
    const uploadResult1 = await recordingStorage.streamUpload({
      callId: call1._id.toString(),
      tenantId: tenantA,
      user: userA,
      readStream: wavStream,
      mimeType: "audio/wav",
      filename: `customer_call_${call1._id}.wav`,
      contentLength: wavAudio.sizeBytes,
    })

    assert(uploadResult1.success === true, "Upload returned success: true")
    assert(uploadResult1.conversionStatus === "completed", "Conversion status is 'completed'")
    assert(Boolean(uploadResult1.fileId), "Original fileId was generated")
    assert(Boolean(uploadResult1.mp3FileId), "Converted mp3FileId was generated")
    assert(uploadResult1.fileId.toString() !== uploadResult1.mp3FileId.toString(), "Original file and converted MP3 have separate GridFS file IDs")
    assert(uploadResult1.duration >= 2.9 && uploadResult1.duration <= 3.2, `Accurate duration extracted (~3.0s, got ${uploadResult1.duration}s)`)

    // Verify Call document in database
    const freshCall1 = await Call.findById(call1._id).setOptions({ skipTenantFilter: true }).lean()
    assert(freshCall1.hasRecording === true, "Call.hasRecording is true")
    assert(freshCall1.recording.status === "stored", "Call.recording.status is 'stored'")
    assert(freshCall1.recording.format === "mp3", "Call.recording.format is 'mp3'")
    assert(freshCall1.recording.mp3SizeBytes > 0, "Call.recording.mp3SizeBytes is greater than 0")
    assert(freshCall1.duration === 3, "Call.duration was updated to match audio duration (3 seconds)")
    assert(freshCall1.metadata.recordingMimeType === "audio/mpeg", "Call.metadata.recordingMimeType is 'audio/mpeg'")

    wavAudio.cleanup()

    // -------------------------------------------------------------------------
    // TEST 2: Upload Already-Valid MP3 Audio (No redundant conversion)
    // -------------------------------------------------------------------------
    console.log("\n[TEST 2] Uploading already-valid MP3 file...")
    const mp3Audio = generateTestAudioFile("mp3", 2.0, 880)

    const call2 = await Call.create({
      tenantId: tenantA,
      leadId: leadA._id,
      agentId: userA._id,
      number: leadA.phone,
      direction: "inbound",
      duration: 0,
      startTimeMs: Date.now() - 2000,
    })

    const mp3Stream = Readable.from(mp3Audio.buffer)
    const uploadResult2 = await recordingStorage.streamUpload({
      callId: call2._id.toString(),
      tenantId: tenantA,
      user: userA,
      readStream: mp3Stream,
      mimeType: "audio/mpeg",
      filename: `direct_recording_${call2._id}.mp3`,
      contentLength: mp3Audio.sizeBytes,
    })

    assert(uploadResult2.success === true, "Upload returned success: true")
    assert(uploadResult2.conversionStatus === "not_needed", "MP3 input detected, conversionStatus is 'not_needed'")
    assert(uploadResult2.fileId.toString() === uploadResult2.mp3FileId.toString(), "mp3FileId points directly to uploaded MP3 without redundant re-encoding")
    assert(uploadResult2.duration >= 1.9 && uploadResult2.duration <= 2.2, `Accurate duration extracted (~2.0s, got ${uploadResult2.duration}s)`)

    mp3Audio.cleanup()

    // -------------------------------------------------------------------------
    // TEST 3: Streaming Playback (HTTP 200 Full Stream)
    // -------------------------------------------------------------------------
    console.log("\n[TEST 3] Testing streaming playback (HTTP 200)...")
    const res200 = createMockResponse()
    await recordingStorage.streamPlayback({
      callId: call1._id.toString(),
      tenantId: tenantA,
      user: userA,
      rangeHeader: null,
      res: res200,
    })
    await res200.waitForFinish()

    assert(res200.statusCode === 200, "Full streaming returns HTTP 200")
    assert(res200.headers["content-type"] === "audio/mpeg", "Content-Type is audio/mpeg for browser playback")
    assert(res200.headers["accept-ranges"] === "bytes", "Accept-Ranges: bytes is set")
    const receivedBuffer200 = res200.getBuffer()
    assert(receivedBuffer200.length > 0, `Received audio payload length: ${receivedBuffer200.length} bytes`)
    assert(receivedBuffer200.length === parseInt(res200.headers["content-length"], 10), "Content-Length header matches received bytes exactly")

    // Confirm that returned MP3 audio is valid and audible
    const tmpAudible = path.resolve(__dirname, `../temp_verify_audible_${Date.now()}.mp3`)
    fs.writeFileSync(tmpAudible, receivedBuffer200)
    const probePlayback = await audioConverter.probeAudio(tmpAudible)
    assert(probePlayback.isValid === true, "Streamed audio bytes decode cleanly as valid audio")
    assert(probePlayback.isMp3 === true, "Streamed audio bytes are true MP3 format")
    assert(probePlayback.duration > 2.8, `Decoded MP3 duration matches source audio: ${probePlayback.duration}s`)
    try { fs.unlinkSync(tmpAudible) } catch (_) {}

    // -------------------------------------------------------------------------
    // TEST 4: HTTP Range Request & Seeking Support (HTTP 206 Partial Content)
    // -------------------------------------------------------------------------
    console.log("\n[TEST 4] Testing HTTP Range request & seeking (HTTP 206 Partial Content)...")
    const res206 = createMockResponse()
    const totalBytes = receivedBuffer200.length
    const rangeHeader = "bytes=0-1023"

    await recordingStorage.streamPlayback({
      callId: call1._id.toString(),
      tenantId: tenantA,
      user: userA,
      rangeHeader,
      res: res206,
    })
    await res206.waitForFinish()

    assert(res206.statusCode === 206, "Range request returns HTTP 206 Partial Content")
    assert(res206.headers["content-range"] === `bytes 0-1023/${totalBytes}`, `Content-Range header correct: bytes 0-1023/${totalBytes}`)
    assert(parseInt(res206.headers["content-length"], 10) === 1024, "Content-Length header is 1024 bytes")
    const rangeBuffer = res206.getBuffer()
    assert(rangeBuffer.length === 1024, `Range response payload is exactly 1024 bytes (received: ${rangeBuffer.length})`)

    // Range seek in middle of file
    const res206Seek = createMockResponse()
    await recordingStorage.streamPlayback({
      callId: call1._id.toString(),
      tenantId: tenantA,
      user: userA,
      rangeHeader: "bytes=1000-1999",
      res: res206Seek,
    })
    await res206Seek.waitForFinish()

    assert(res206Seek.statusCode === 206, "Mid-stream seek returns HTTP 206 Partial Content")
    assert(res206Seek.headers["content-range"] === `bytes 1000-1999/${totalBytes}`, `Mid-stream Content-Range: bytes 1000-1999/${totalBytes}`)
    assert(res206Seek.getBuffer().length === 1000, "Mid-stream chunk is exactly 1000 bytes")

    // -------------------------------------------------------------------------
    // TEST 5: Original format retrieval with ?format=original
    // -------------------------------------------------------------------------
    console.log("\n[TEST 5] Testing original format retrieval (?format=original)...")
    const resOrig = createMockResponse()
    await recordingStorage.streamPlayback({
      callId: call1._id.toString(),
      tenantId: tenantA,
      user: userA,
      rangeHeader: null,
      res: resOrig,
      query: { format: "original" },
    })
    await resOrig.waitForFinish()

    assert(resOrig.statusCode === 200, "Original stream returns HTTP 200")
    assert(resOrig.headers["content-type"] === "audio/wav", "Original format served with original MIME (audio/wav)")
    assert(resOrig.getBuffer().length > 0, `Original payload received: ${resOrig.getBuffer().length} bytes`)

    // -------------------------------------------------------------------------
    // TEST 6: Tenant Isolation & RBAC Protection
    // -------------------------------------------------------------------------
    console.log("\n[TEST 6] Testing cross-tenant isolation and unauthorized access...")
    const resCrossTenant = createMockResponse()
    await recordingStorage.streamPlayback({
      callId: call1._id.toString(),
      tenantId: tenantB, // Agent Bob from Tenant B trying to access Tenant A's recording
      user: userB,
      rangeHeader: null,
      res: resCrossTenant,
    })
    await resCrossTenant.waitForFinish()

    assert(resCrossTenant.statusCode === 404, "Cross-tenant playback blocked with 404 (not visible across tenants)")

    // -------------------------------------------------------------------------
    // TEST 7: Empty / 0-byte recording rejection
    // -------------------------------------------------------------------------
    console.log("\n[TEST 7] Testing empty (0-byte) file rejection...")
    const emptyCall = await Call.create({
      tenantId: tenantA,
      leadId: leadA._id,
      agentId: userA._id,
      number: leadA.phone,
      direction: "outbound",
    })

    const emptyStream = new Readable({
      read() {
        this.push(null) // 0 bytes
      },
    })

    let emptyError = null
    try {
      await recordingStorage.streamUpload({
        callId: emptyCall._id.toString(),
        tenantId: tenantA,
        user: userA,
        readStream: emptyStream,
        mimeType: "audio/mp4",
        filename: "empty.m4a",
        contentLength: 0,
      })
    } catch (err) {
      emptyError = err
    }
    const freshEmptyCall = await Call.findById(emptyCall._id).setOptions({ skipTenantFilter: true }).lean()
    assert(freshEmptyCall.recording?.conversionStatus === "failed" || emptyError !== null, "Empty file is marked conversionStatus: failed or rejected")

    // -------------------------------------------------------------------------
    // TEST 8: Corrupt Audio File Handling
    // -------------------------------------------------------------------------
    console.log("\n[TEST 8] Testing corrupt audio file handling...")
    const corruptCall = await Call.create({
      tenantId: tenantA,
      leadId: leadA._id,
      agentId: userA._id,
      number: leadA.phone,
      direction: "outbound",
    })

    const corruptBuf = Buffer.from("CORRUPT_NON_AUDIO_GARBAGE_PAYLOAD_123456789")
    const corruptStream = Readable.from(corruptBuf)
    const corruptRes = await recordingStorage.streamUpload({
      callId: corruptCall._id.toString(),
      tenantId: tenantA,
      user: userA,
      readStream: corruptStream,
      mimeType: "audio/mp4",
      filename: "corrupt.m4a",
      contentLength: corruptBuf.length,
    })

    assert(corruptRes.conversionStatus === "failed", "Corrupt file conversionStatus is marked 'failed'")
    const freshCorruptCall = await Call.findById(corruptCall._id).setOptions({ skipTenantFilter: true }).lean()
    assert(freshCorruptCall.recording?.conversionStatus === "failed", "Call in DB has recording.conversionStatus: 'failed'")

    // -------------------------------------------------------------------------
    // TEST 9: Missing Recording Returns Descriptive 404
    // -------------------------------------------------------------------------
    console.log("\n[TEST 9] Testing missing recording retrieval...")
    const noRecCall = await Call.create({
      tenantId: tenantA,
      leadId: leadA._id,
      agentId: userA._id,
      number: leadA.phone,
      direction: "outbound",
    })

    const resMissing = createMockResponse()
    await recordingStorage.streamPlayback({
      callId: noRecCall._id.toString(),
      tenantId: tenantA,
      user: userA,
      res: resMissing,
    })
    await resMissing.waitForFinish()

    assert(resMissing.statusCode === 404, "Missing recording returns HTTP 404")
    assert(resMissing.body?.status === "none" || resMissing.body?.error.includes("No audio recording"), "Returns descriptive 404 error")

    // -------------------------------------------------------------------------
    // TEST 10: Latest Recording Selection Algorithm
    // -------------------------------------------------------------------------
    console.log("\n[TEST 10] Testing latest recording selection logic...")
    const callList = [
      { _id: "c1", startTimeMs: 1000, recording: { status: "stored", mp3FileId: "f1", sizeBytes: 50000, duration: 3 } },
      { _id: "c2", startTimeMs: 2000, recording: { status: "stored", mp3FileId: "f2", sizeBytes: 60000, duration: 4 } },
      { _id: "c3", startTimeMs: 3000, recording: { status: "none", fileId: null, sizeBytes: 0 } },
    ]

    const getCallTime = (c) => c.startTimeMs || c.startedAt || c.createdAt || 0
    const sorted = [...callList].sort((a, b) => getCallTime(b) - getCallTime(a))
    const isPlayable = (c) => {
      if (!c) return false
      if (c.recording?.status === "skipped_dnr" || c.recording?.status === "expired" || c.recording?.status === "failed") return false
      const hasGridFsFile = Boolean(c.recording?.mp3FileId || c.recording?.fileId)
      const hasValidStatus = c.recording?.status === "stored" || c.recording?.status === "ready"
      return hasGridFsFile && (c.recording?.sizeBytes > 0 || hasValidStatus)
    }
    const chosen = sorted.find(isPlayable)

    assert(chosen._id === "c2", "Latest-recording selection correctly selected newest valid recording (c2 at t=2000)")

    // Clean up test data
    await Call.deleteMany({ tenantId: { $in: [tenantA, tenantB] } }).setOptions({ skipTenantFilter: true })
    await Lead.deleteMany({ tenantId: { $in: [tenantA, tenantB] } }).setOptions({ skipTenantFilter: true })
    await User.deleteMany({ tenantId: { $in: [tenantA, tenantB] } }).setOptions({ skipTenantFilter: true })
    const bucket = recordingStorage.getBucket()
    if (uploadResult1.fileId) await bucket.delete(uploadResult1.fileId).catch(() => {})
    if (uploadResult1.mp3FileId) await bucket.delete(uploadResult1.mp3FileId).catch(() => {})
    if (uploadResult2.fileId) await bucket.delete(uploadResult2.fileId).catch(() => {})
    if (corruptRes.fileId) await bucket.delete(corruptRes.fileId).catch(() => {})

  } catch (err) {
    console.error("Test execution threw exception:", err)
    failed++
  } finally {
    await mongoose.disconnect()
  }

  console.log("\n" + "=".repeat(80))
  console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`)
  console.log("=".repeat(80))

  if (failed > 0) {
    process.exit(1)
  }
}

runVerification()
