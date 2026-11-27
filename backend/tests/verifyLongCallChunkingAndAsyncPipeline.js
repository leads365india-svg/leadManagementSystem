require("dotenv").config({ path: require("path").join(__dirname, "../.env") })
process.env.NODE_ENV = "test"

const fs = require("fs")
const os = require("os")
const path = require("path")
const mongoose = require("mongoose")
const request = require("supertest")
const jwt = require("jsonwebtoken")
const dns = require("dns")

try {
  dns.setServers(["8.8.8.8", "1.1.1.1"])
} catch (_) {}

const app = require("../start")
const connectDB = require("../db/connection")
const Account = require("../models/Account")
const User = require("../models/User")
const Call = require("../models/Call")
const Job = require("../models/Job")
const { AITranscript } = require("../models/AITranscript")
const { AICallAnalysis } = require("../models/AICallAnalysis")
const { AIUsageLedger } = require("../models/AIUsageLedger")
const { getJwtSecret } = require("../middleware/authMiddleware")
const queue = require("../services/queueService")
const audioConverter = require("../services/audioConverter")
const {
  transcribeAudioWithGemini,
  processSpeechToText,
  mergeChunkTranscripts,
} = require("../services/aiSpeechToText.service")
const { analyzeCallWithGemini } = require("../services/aiCallAnalysis.service")
const {
  enqueueCallIntelligenceJob,
  processCallIntelligenceJob,
  recoverStaleAiJobs,
  JOB_NAME,
} = require("../services/aiCallProcessingPipeline")

let passed = 0
let failed = 0

function assert(cond, label, detail = "") {
  if (cond) {
    console.log(`  ✅ PASS: ${label}`)
    passed++
  } else {
    console.error(`  ❌ FAIL: ${label}${detail ? ` (${detail})` : ""}`)
    failed++
  }
}

/**
 * Generates a valid PCM WAV audio file of given duration in seconds (for real FFmpeg splitting verification).
 */
function createSyntheticWavFile(filePath, durationSec = 25, sampleRate = 8000) {
  const numSamples = Math.floor(durationSec * sampleRate)
  const dataSize = numSamples * 2 // 16-bit mono
  const buffer = Buffer.alloc(44 + dataSize)
  buffer.write("RIFF", 0)
  buffer.writeUInt32LE(36 + dataSize, 4)
  buffer.write("WAVE", 8)
  buffer.write("fmt ", 12)
  buffer.writeUInt32LE(16, 16) // PCM chunk size
  buffer.writeUInt16LE(1, 20) // AudioFormat = PCM
  buffer.writeUInt16LE(1, 22) // NumChannels = 1
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * 2, 28) // ByteRate
  buffer.writeUInt16LE(2, 32) // BlockAlign
  buffer.writeUInt16LE(16, 34) // BitsPerSample
  buffer.write("data", 36)
  buffer.writeUInt32LE(dataSize, 40)
  // Write audible 440Hz tone so codec & duration probes recognize real stream
  for (let i = 0; i < numSamples; i++) {
    const val = Math.round(Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 8000)
    buffer.writeInt16LE(val, 44 + i * 2)
  }
  fs.writeFileSync(filePath, buffer)
}

async function runTests() {
  console.log("================================================================================")
  console.log("=== VERIFY LONG CALL CHUNKING, FILES API, ASYNC TRIGGER & STALE RECOVERY     ===")
  console.log("================================================================================")

  await connectDB()

  const suffix = Date.now()
  const TENANT_ID = `ACC-LONG-${suffix}`
  const adminId = new mongoose.Types.ObjectId()

  const cleanup = async () => {
    await Call.deleteMany({ tenantId: TENANT_ID }).setOptions({ skipTenantFilter: true })
    await AITranscript.deleteMany({ tenantId: TENANT_ID }).setOptions({ skipTenantFilter: true })
    await AICallAnalysis.deleteMany({ tenantId: TENANT_ID }).setOptions({ skipTenantFilter: true })
    await AIUsageLedger.deleteMany({ tenantId: TENANT_ID }).setOptions({ skipTenantFilter: true })
    await Job.deleteMany({ tenantId: TENANT_ID })
    await User.deleteMany({ tenantId: TENANT_ID }).setOptions({ skipTenantFilter: true })
    await Account.deleteMany({ accountId: TENANT_ID })
  }

  try {
    await cleanup()

    // -------------------------------------------------------------------------
    // 1. Chunking Plan & Real FFmpeg Split + Temp Cleanup
    // -------------------------------------------------------------------------
    console.log("\n[1] Audio chunk plan (29:32 = 1772s) & real FFmpeg-static chunking + cleanup")
    const plan29m = audioConverter.computeAudioChunkPlan({
      totalDurationSec: 1772,
      chunkDurationSec: 600,
      overlapSec: 5,
    })
    assert(plan29m.length === 3, `1772s splits into 3 chunks (got ${plan29m.length})`)
    assert(
      plan29m[0].startSec === 0 &&
        plan29m[0].extractDurationSec === 605 &&
        plan29m[1].startSec === 600 &&
        plan29m[1].extractDurationSec === 605 &&
        plan29m[2].startSec === 1200 &&
        plan29m[2].extractDurationSec === 572,
      "Chunk offsets & 5s overlap match 0..605, 600..1205, 1200..1772"
    )

    const wavPath = path.join(os.tmpdir(), `synthetic_long_${suffix}.wav`)
    let splitDirPath = null
    try {
      createSyntheticWavFile(wavPath, 24, 8000)
      const splitRes = await audioConverter.splitAudioIntoChunks({
        inputPath: wavPath,
        totalDurationSec: 24,
        chunkDurationSec: 10,
        overlapSec: 2,
      })
      splitDirPath = splitRes.tempDir
      assert(splitRes.chunks.length === 3, `Real FFmpeg split 24s into 3 chunks (got ${splitRes.chunks.length})`)
      assert(splitRes.chunks.every((c) => fs.existsSync(c.filePath) && c.sizeBytes > 0), "All real FFmpeg chunk MP3 files exist on disk")
      splitRes.cleanup()
      assert(!fs.existsSync(splitDirPath), "splitAudioIntoChunks cleanup removed temp chunk directory")
    } finally {
      try { if (fs.existsSync(wavPath)) fs.unlinkSync(wavPath) } catch (_) {}
      if (splitDirPath && fs.existsSync(splitDirPath)) {
        try { fs.rmSync(splitDirPath, { recursive: true, force: true }) } catch (_) {}
      }
    }

    // -------------------------------------------------------------------------
    // 2. Gemini Files API (>5 MB threshold), Polling to ACTIVE, maxOutputTokens, Cleanup
    // -------------------------------------------------------------------------
    console.log("\n[2] Gemini Files API for >5 MB audio (upload -> poll ACTIVE -> generate -> delete)")
    const sixMbBuffer = Buffer.alloc(6 * 1024 * 1024, 65)
    let uploadCalled = 0
    let pollCalls = 0
    let deleteCalledWith = null
    let capturedGenPayload = null
    let capturedGenTimeout = null

    const mockFilesClient = {
      async uploadFile({ sizeBytes }) {
        uploadCalled++
        assert(sizeBytes === sixMbBuffer.length, "Files API received full 6 MB byte length without truncation")
        return { name: "files/mock-audio-123", uri: "https://generativelanguage.googleapis.com/v1beta/files/mock-audio-123", state: "PROCESSING", mimeType: "audio/mp3" }
      },
      async getFile({ fileName }) {
        pollCalls++
        return { name: fileName, uri: "https://generativelanguage.googleapis.com/v1beta/files/mock-audio-123", state: "ACTIVE", mimeType: "audio/mp3" }
      },
      async deleteFile({ fileName }) {
        deleteCalledWith = fileName
      },
    }

    const mockFilesSttHttpClient = async (url, body, headers, opts) => {
      capturedGenPayload = body
      capturedGenTimeout = opts?.timeoutMs
      return {
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    language: "hi-en",
                    duration: 30,
                    segments: [{ speaker: "Customer", startTime: 0, endTime: 5, text: "Hello sir pricing chahiye" }],
                  }),
                },
              ],
            },
          },
        ],
        usageMetadata: { promptTokenCount: 500, candidatesTokenCount: 120 },
      }
    }

    const filesSttRes = await transcribeAudioWithGemini({
      audioBuffer: sixMbBuffer,
      mimeType: "audio/mp3",
      duration: 30,
      apiKey: "test-key",
      httpClient: mockFilesSttHttpClient,
      filesApiClient: mockFilesClient,
      pollIntervalMs: 10,
    })

    assert(uploadCalled === 1 && pollCalls >= 1, "Files API uploaded audio and polled until ACTIVE")
    assert(deleteCalledWith === "files/mock-audio-123", "Uploaded Gemini file deleted in finally after transcription")
    assert(Boolean(capturedGenPayload?.contents?.[0]?.parts?.[0]?.fileData?.fileUri), "Request used fileData.fileUri instead of base64 inlineData")
    assert(!capturedGenPayload?.contents?.[0]?.parts?.[0]?.inlineData, "No inlineData base64 included for >5MB file")
    assert(capturedGenPayload?.generationConfig?.maxOutputTokens >= 16384, `STT maxOutputTokens >= 16384 (got ${capturedGenPayload?.generationConfig?.maxOutputTokens})`)
    assert(capturedGenTimeout === 300000, `STT chunk timeout is 5 min (300000ms, got ${capturedGenTimeout})`)
    assert(filesSttRes.usedFilesApi === true, "Result reports usedFilesApi = true")

    // Verify Gemini file is still deleted on failure
    deleteCalledWith = null
    let failedOnFiles = false
    try {
      await transcribeAudioWithGemini({
        audioBuffer: sixMbBuffer,
        mimeType: "audio/mp3",
        duration: 30,
        apiKey: "test-key",
        httpClient: async () => { throw new Error("HTTP 500: upstream failure") },
        filesApiClient: mockFilesClient,
        pollIntervalMs: 10,
      })
    } catch (_) {
      failedOnFiles = true
    }
    assert(failedOnFiles && deleteCalledWith === "files/mock-audio-123", "Uploaded Gemini file deleted even when generation throws")

    // -------------------------------------------------------------------------
    // 3. Long Audio Chunked STT + Transient Retry + Overlap Merging
    // -------------------------------------------------------------------------
    console.log("\n[3] processSpeechToText splits long audio, retries transient chunk errors, merges overlaps")
    let cleanedTempChunkDir = false
    const fakeChunkFiles = [0, 1, 2].map((i) => ({
      index: i,
      startSec: i * 600,
      offsetSeconds: i * 600,
      durationSec: i === 2 ? 572 : 605,
      filePath: path.join(os.tmpdir(), `mock_chunk_${suffix}_${i}.mp3`),
      sizeBytes: 6 * 1024 * 1024, // Force Files API > 5MB per chunk
      mimeType: "audio/mp3",
    }))
    fakeChunkFiles.forEach((c) => fs.writeFileSync(c.filePath, "FAKE_MP3"))

    const mockAudioTools = {
      async downloadRecordingToTempFile() {
        const tmpIn = path.join(os.tmpdir(), `mock_in_${suffix}.mp3`)
        fs.writeFileSync(tmpIn, "FAKE_LONG_MP3")
        return {
          filePath: tmpIn,
          sizeBytes: 18 * 1024 * 1024,
          mimeType: "audio/mp3",
          cleanup: () => { try { if (fs.existsSync(tmpIn)) fs.unlinkSync(tmpIn) } catch (_) {} },
        }
      },
      async splitAudioIntoChunks() {
        return {
          tempDir: os.tmpdir(),
          totalDurationSec: 1772,
          chunks: fakeChunkFiles,
          cleanup: () => {
            cleanedTempChunkDir = true
            fakeChunkFiles.forEach((c) => { try { if (fs.existsSync(c.filePath)) fs.unlinkSync(c.filePath) } catch (_) {} })
          },
        }
      },
    }

    let chunkAttemptCounts = 0
    let uploadCallsInChunks = 0
    const mockChunkFilesApi = {
      async uploadFile({ displayName }) {
        uploadCallsInChunks++
        return { name: `files/${uploadCallsInChunks}`, uri: `https://files/${uploadCallsInChunks}`, state: "ACTIVE", mimeType: "audio/mp3" }
      },
      async getFile({ fileName }) {
        return { name: fileName, uri: `https://${fileName}`, state: "ACTIVE" }
      },
      async deleteFile() {},
    }

    const mockChunkHttp = async (url, body) => {
      chunkAttemptCounts++
      const uri = body?.contents?.[0]?.parts?.[0]?.fileData?.fileUri || ""
      // Simulate 1 transient timeout on chunk 2 first try
      if (uri === "https://files/2" && chunkAttemptCounts === 2) {
        throw new Error("AI Provider request timed out after 300 seconds")
      }
      if (uri === "https://files/1") {
        return {
          candidates: [{
            content: {
              parts: [{
                text: JSON.stringify({
                  language: "hi-en",
                  segments: [
                    { speaker: "Customer", startTime: 2, endTime: 10, text: "Hume hospital CRM chahiye" },
                    { speaker: "Agent", startTime: 598, endTime: 603, text: "Overlap boundary sentence repeated here" },
                  ],
                }),
              }],
            },
          }],
        }
      }
      if (uri === "https://files/2" || uri === "https://files/3") {
        // Chunk 2 (retries after failure on attempt 2 -> creates file/3)
        if (uri === "https://files/3") {
          return {
            candidates: [{
              content: {
                parts: [{
                  text: JSON.stringify({
                    language: "hi-en",
                    segments: [
                      { speaker: "Agent", startTime: 0, endTime: 3, text: "Overlap boundary sentence repeated here" },
                      { speaker: "Customer", startTime: 120, endTime: 135, text: "Pricing detail WhatsApp bhej dijiye" },
                    ],
                  }),
                }],
              },
            }],
          }
        }
      }
      return {
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                language: "hi-en",
                segments: [{ speaker: "Agent", startTime: 50, endTime: 70, text: "Bilkul sir kal demo schedule karte hain" }],
              }),
            }],
          },
        }],
      }
    }

    const chunkedStt = await processSpeechToText({
      call: { _id: new mongoose.Types.ObjectId(), recording: { status: "stored", duration: 1772, sizeBytes: 18 * 1024 * 1024 } },
      apiKey: "test-key",
      httpClient: mockChunkHttp,
      filesApiClient: mockChunkFilesApi,
      audioTools: mockAudioTools,
      concurrency: 1,
      retryDelayMs: 0,
    })

    assert(cleanedTempChunkDir === true, "Temp chunk files cleaned up in finally block")
    assert(chunkedStt.chunkCount === 3, `Merged all 3 chunks (got ${chunkedStt.chunkCount})`)
    assert(chunkAttemptCounts === 4, `Transient timeout triggered 1 automatic retry (total calls=${chunkAttemptCounts})`)
    assert(chunkedStt.segments.length === 4, `Overlap duplicate segment removed cleanly (${chunkedStt.segments.length} unique segments)`)
    assert(chunkedStt.segments[2].startTime === 720 && chunkedStt.segments[3].startTime === 1250, "Segment timestamps offset by 600s and 1200s cleanly")

    // -------------------------------------------------------------------------
    // 4. Stage 2 Analysis (Text-Only, 5-min timeout, maxOutputTokens = 16384)
    // -------------------------------------------------------------------------
    console.log("\n[4] Stage 2 analyzeCallWithGemini uses text-only transcript with 16384 tokens and 300s timeout")
    let stage2Body = null
    let stage2Timeout = null
    const stage2Res = await analyzeCallWithGemini({
      transcript: { transcriptText: chunkedStt.transcriptText, duration: 1772 },
      apiKey: "test-key",
      httpClient: async (url, body, headers, opts) => {
        stage2Body = body
        stage2Timeout = opts?.timeoutMs
        return {
          candidates: [{
            content: {
              parts: [{
                text: JSON.stringify({
                  summary: "Customer wants Hospital CRM and demo.",
                  customerIntent: "Requesting demo & pricing",
                  sentiment: "POSITIVE",
                  sentimentScore: 0.9,
                  callOutcome: "INTERESTED",
                }),
              }],
            },
          }],
        }
      },
    })
    assert(!stage2Body?.contents?.[0]?.parts?.some((p) => p.inlineData || p.fileData), "Stage 2 analysis sends ZERO audio data")
    assert(stage2Body?.generationConfig?.maxOutputTokens === 16384, `Stage 2 maxOutputTokens === 16384 (got ${stage2Body?.generationConfig?.maxOutputTokens})`)
    assert(stage2Timeout === 300000, `Stage 2 analysis timeout === 300000ms (got ${stage2Timeout})`)
    assert(stage2Res.callOutcome === "INTERESTED", "Stage 2 returned valid structured outcome")

    // -------------------------------------------------------------------------
    // 5. Async API Trigger (202 Accepted for Pending & Failed), Saved Transcript + Failed Transition, Stale Recovery
    // -------------------------------------------------------------------------
    console.log("\n[5] Async endpoints (202 Accepted), Stage 1 DB persistence before Stage 2 failure & Stale Job Recovery")
    await Account.create({
      accountId: TENANT_ID,
      companyName: "Long Call Agency",
      displayName: "Long Call Agency",
      adminUserId: adminId,
      adminName: "Admin",
      adminEmail: `admin_${suffix}@test.com`,
      status: "active",
    })
    const adminUser = await User.create({
      _id: adminId,
      tenantId: TENANT_ID,
      name: "Admin",
      email: `admin_${suffix}@test.com`,
      password: "Password123!",
      role: "account_admin",
      status: "active",
    })
    const token = jwt.sign(
      { id: adminId.toString(), email: adminUser.email, role: "account_admin", tenantId: TENANT_ID, tokenVersion: 1 },
      getJwtSecret(),
      { expiresIn: "1h" }
    )

    // Seed call modeled after stuck 29:32 call in Pending + old dead job with same checksum
    const longCall = await Call.create({
      tenantId: TENANT_ID,
      agentId: adminId,
      customerNumber: "+919800000001",
      duration: 1772,
      hasRecording: true,
      recording: { status: "stored", fileId: new mongoose.Types.ObjectId(), sizeBytes: 18 * 1024 * 1024, duration: 1772, sha256: `chk_${suffix}` },
      metadata: { aiAnalysisStatus: "PENDING" },
    })

    // Old dead job with identical checksum must NOT block manual trigger on Pending/Failed call
    await Job.create({
      jobId: `job_old_dead_${suffix}`,
      name: JOB_NAME,
      tenantId: TENANT_ID,
      idempotencyKey: `ai_call_${longCall._id}_chk_${suffix}`,
      payload: { callId: longCall._id.toString(), tenantId: TENANT_ID },
      status: "dead_letter",
    })

    const triggerRes = await request(app)
      .post(`/api/ai-calls/${longCall._id}/analyze`)
      .set("Authorization", `Bearer ${token}`)
      .send({})
    assert(triggerRes.status === 202 && triggerRes.body.status === "PROCESSING", `Analyze Pending call returns 202 PROCESSING (got ${triggerRes.status}, ${triggerRes.body.status})`)
    assert(triggerRes.body.data?.duplicate === false, "Dead previous job did not falsely block fresh enqueue")

    // Active job lock timeout verified at 25m and claimNextJob won't prematurely steal a 2m running job
    const queuedJob = await Job.findOne({ jobId: triggerRes.body.data.jobId })
    assert(queuedJob?.lockTimeoutMs === 25 * 60 * 1000, `Job lockTimeoutMs === 25m (got ${queuedJob?.lockTimeoutMs})`)
    const claimed = await queue.claimNextJob("test_worker", { jobId: queuedJob.jobId })
    assert(Boolean(claimed), "Worker claimed newly enqueued AI job")
    // Backdate lockedAt by 2 mins (< 25 min lockTimeout) and ensure claimNextJob does NOT steal it
    await Job.updateOne({ jobId: queuedJob.jobId }, { $set: { lockedAt: new Date(Date.now() - 2 * 60 * 1000) } })
    const prematureSteal = await queue.claimNextJob("test_worker_2", { jobId: queuedJob.jobId })
    assert(prematureSteal === null, "claimNextJob respects per-job lockTimeoutMs (2m job not stolen before 25m)")

    // Run pipeline where Stage 1 succeeds (single small buffer) and Stage 2 throws -> Stage 1 transcript MUST be saved & status MUST become FAILED
    const stage2FailCall = await Call.create({
      tenantId: TENANT_ID,
      agentId: adminId,
      customerNumber: "+919800000003",
      duration: 120,
      hasRecording: true,
      recording: { status: "stored", fileId: new mongoose.Types.ObjectId(), sizeBytes: 120000, duration: 120, sha256: `chk_s2_${suffix}` },
      metadata: { aiAnalysisStatus: "PROCESSING" },
    })
    const stage2FailJob = await enqueueCallIntelligenceJob({
      callId: stage2FailCall._id.toString(),
      tenantId: TENANT_ID,
      forceNewTranscript: true,
    })

    let stage2Threw = false
    const stage1OnlyHttp = async (url, body) => {
      const txt = body?.contents?.[0]?.parts?.map((p) => p.text || "").join(" ") || ""
      if (txt.includes("Speech-to-Text Transcriber")) {
        return {
          candidates: [{
            content: {
              parts: [{
                text: JSON.stringify({
                  language: "en",
                  duration: 120,
                  segments: [
                    { speaker: "Customer", startTime: 0, endTime: 10, text: "Customer asking for CRM demo and pricing quote" },
                    { speaker: "Agent", startTime: 12, endTime: 25, text: "Agent shared pricing details cleanly" },
                  ],
                }),
              }],
            },
          }],
        }
      }
      throw new Error("Simulated Stage 2 analysis failure")
    }

    try {
      await processCallIntelligenceJob({
        jobId: stage2FailJob.jobId,
        payload: {
          callId: stage2FailCall._id.toString(),
          tenantId: TENANT_ID,
          forceNewTranscript: true,
          audioBuffer: Buffer.from("FAKE_SMALL_AUDIO"),
          httpClient: stage1OnlyHttp,
          apiKey: "test-key",
        },
      })
    } catch (_) {
      stage2Threw = true
    }

    const callAfterFail = await Call.findById(stage2FailCall._id).setOptions({ skipTenantFilter: true })
    const savedMergedTranscript = await AITranscript.findOne({ tenantId: TENANT_ID, callId: stage2FailCall._id }).sort({ version: -1 }).setOptions({ skipTenantFilter: true })
    const failedAnalysisDoc = await AICallAnalysis.findOne({ tenantId: TENANT_ID, callId: stage2FailCall._id }).sort({ analysisVersion: -1 }).setOptions({ skipTenantFilter: true })
    assert(stage2Threw, "Pipeline propagated error after recording FAILED state")
    assert(savedMergedTranscript?.status === "COMPLETED", "Merged transcript saved as COMPLETED immediately before Stage 2")
    assert(failedAnalysisDoc?.status === "FAILED", "Failed analysis marked FAILED in DB")
    assert(callAfterFail?.metadata?.aiAnalysisStatus === "FAILED" && Boolean(callAfterFail?.metadata?.aiErrorMessage), "Call status updated to FAILED with clear aiErrorMessage (never stuck Pending/Processing)")

    // Retry FAILED call via POST /analyze -> reuses completed transcript cleanly when forceNewTranscript not passed!
    const retryRes = await request(app)
      .post(`/api/ai-calls/${stage2FailCall._id}/analyze`)
      .set("Authorization", `Bearer ${token}`)
      .send({})
    assert(retryRes.status === 202 && retryRes.body.data?.duplicate === false, "Retry on FAILED call returns 202 ACCEPTED & enqueues fresh job")
    const retryJobDoc = await Job.findOne({ jobId: retryRes.body.data.jobId }).lean()
    assert(retryJobDoc?.payload?.forceNewTranscript === false, "Retry after Stage 2 failure reuses saved completed transcript")

    // Stale job recovery (>20 min) marks stuck PROCESSING transcript/analysis/call/job as FAILED
    const staleCall = await Call.create({
      tenantId: TENANT_ID,
      agentId: adminId,
      customerNumber: "+919800000002",
      duration: 1800,
      hasRecording: true,
      recording: { status: "stored", fileId: new mongoose.Types.ObjectId(), sizeBytes: 12000000, duration: 1800 },
      metadata: { aiAnalysisStatus: "PROCESSING", aiQueuedAt: Date.now() - 30 * 60 * 1000 },
    })
    await Call.collection.updateOne({ _id: staleCall._id }, { $set: { updatedAt: new Date(Date.now() - 30 * 60 * 1000) } })
    const staleTx = await AITranscript.create({
      tenantId: TENANT_ID,
      callId: staleCall._id,
      status: "PROCESSING",
      duration: 1800,
      version: 1,
    })
    await AITranscript.collection.updateOne({ _id: staleTx._id }, { $set: { updatedAt: new Date(Date.now() - 30 * 60 * 1000) } })
    const staleJob = await Job.create({
      jobId: `job_stale_${suffix}`,
      name: JOB_NAME,
      tenantId: TENANT_ID,
      payload: { callId: staleCall._id.toString(), tenantId: TENANT_ID },
      status: "processing",
      lockedAt: new Date(Date.now() - 30 * 60 * 1000),
      lockTimeoutMs: 25 * 60 * 1000,
    })

    const recoveryRes = await recoverStaleAiJobs({ maxAgeMs: 20 * 60 * 1000 })
    const recoveredTx = await AITranscript.findById(staleTx._id).setOptions({ skipTenantFilter: true })
    const recoveredCall = await Call.findById(staleCall._id).setOptions({ skipTenantFilter: true })
    const recoveredJob = await Job.findById(staleJob._id)
    assert(recoveryRes.staleJobsRecovered >= 1 && recoveryRes.staleTranscriptsRecovered >= 1, "recoverStaleAiJobs detected stale job and transcript")
    assert(recoveredTx?.status === "FAILED" && recoveredCall?.metadata?.aiAnalysisStatus === "FAILED" && recoveredJob?.status === "failed", "Stale job, transcript, and call all transitioned to FAILED for retry")
  } finally {
    await cleanup()
    await mongoose.disconnect()
  }

  console.log("\n================================================================================")
  console.log(`=== LONG CALL PIPELINE VERIFICATION SUMMARY: ${passed} PASSED, ${failed} FAILED ===`)
  console.log("================================================================================")
  if (failed > 0) process.exit(1)
}

runTests().catch((err) => {
  console.error("Fatal error:", err)
  process.exit(1)
})
