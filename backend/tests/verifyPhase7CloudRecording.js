/**
 * Leads365 AI Receptionist — Phase 7 Verification Test Suite
 * 
 * Verifies Cloud Recording and Storage Ingestion:
 *  1. Ingests synthetic audio recording, computes SHA-256, stores in recording storage.
 *  2. Updates Call.recording state machine to 'ready'.
 *  3. Idempotent execution: duplicate recording events are skipped.
 *  4. Reject oversized audio (>50MB).
 *  5. Reject empty audio buffers.
 *  6. Cross-tenant recording access isolation.
 *  7. State machine transitions to 'failed' on unrecoverable download error.
 */

require("dotenv").config({ path: require("path").join(__dirname, "../.env") })
process.env.NODE_ENV = "test"

const assert = require("assert")
const crypto = require("crypto")
const { cloudRecordingIngestion } = require("../services/telephony/cloudRecordingIngestion.service")
const { inMemoryStore } = require("../services/telephony/receptionistCrmTools.service")

let passedCount = 0
let failedCount = 0

function test(name, fn) {
  try {
    fn()
    passedCount++
    console.log(`  ✅ [PASS] ${name}`)
  } catch (err) {
    failedCount++
    console.error(`  ❌ [FAIL] ${name}: ${err.message}`)
  }
}

async function testAsync(name, fn) {
  try {
    await fn()
    passedCount++
    console.log(`  ✅ [PASS] ${name}`)
  } catch (err) {
    failedCount++
    console.error(`  ❌ [FAIL] ${name}: ${err.message}`)
  }
}

async function runPhase7Tests() {
  console.log("\n==================================================================")
  console.log("   LEADS365 AI RECEPTIONIST — PHASE 7 CLOUD RECORDING SUITE      ")
  console.log("==================================================================\n")

  cloudRecordingIngestion.clear()
  inMemoryStore.clear()

  const TENANT_A = "ACC-TENANT-ALPHA"
  const TENANT_B = "ACC-TENANT-BETA"

  // Synthetic 16kHz PCM audio buffer (6400 bytes = 200ms)
  const syntheticAudio = Buffer.alloc(6400, 0x77)
  const expectedHash = crypto.createHash("sha256").update(syntheticAudio).digest("hex")

  // Test 1: Ingests recording and computes SHA-256
  await testAsync("1. Ingests recording, computes SHA-256, and marks ready", async () => {
    const result = await cloudRecordingIngestion.ingestRecording({
      tenantId: TENANT_A,
      callSid: "CA_rec_call_1",
      recordingSid: "RE_mock_1",
      recordingBuffer: syntheticAudio,
      durationSeconds: 15,
      provider: "mock",
    })

    assert.strictEqual(result.success, true)
    assert(result.fileId, "Should return fileId")
    assert.strictEqual(result.sha256, expectedHash, "SHA-256 hash must match")
    assert.strictEqual(result.call.recording.status, "ready")
    assert.strictEqual(result.call.recording.sizeBytes, 6400)
    assert.strictEqual(result.call.hasRecording, true)
  })

  // Test 2: Idempotent duplicate event handling
  await testAsync("2. Idempotent duplicate event: skips re-uploading and returns existing", async () => {
    const result2 = await cloudRecordingIngestion.ingestRecording({
      tenantId: TENANT_A,
      callSid: "CA_rec_call_1",
      recordingSid: "RE_mock_1_retry",
      recordingBuffer: syntheticAudio,
      durationSeconds: 15,
      provider: "mock",
    })

    assert.strictEqual(result2.success, true)
    assert.strictEqual(result2.alreadyIngested, true, "Should identify already ingested recording")
    assert.strictEqual(result2.sha256, expectedHash)
  })

  // Test 3: Rejects empty audio buffer
  await testAsync("3. Rejects empty audio buffer with INGESTION_ERROR", async () => {
    let emptyError = false
    try {
      await cloudRecordingIngestion.ingestRecording({
        tenantId: TENANT_A,
        callSid: "CA_rec_call_empty",
        recordingSid: "RE_mock_empty",
        recordingBuffer: Buffer.alloc(0),
      })
    } catch (err) {
      if (err.message.includes("Empty or invalid audio buffer")) emptyError = true
    }
    assert(emptyError, "Must reject empty audio buffer")
  })

  // Test 4: Rejects oversized audio buffer (>50MB)
  await testAsync("4. Rejects oversized audio buffer (>50MB)", async () => {
    let oversizedError = false
    try {
      // Mock buffer with size exceeding 50MB
      const hugeBuffer = { length: 55000000, isBuffer: true }
      // Mock Buffer.isBuffer check by using Buffer with slice simulation
      await cloudRecordingIngestion.ingestRecording({
        tenantId: TENANT_A,
        callSid: "CA_rec_call_huge",
        recordingSid: "RE_mock_huge",
        recordingBuffer: Buffer.alloc(53000000), // > 50MB
      })
    } catch (err) {
      if (err.message.includes("exceeds maximum allowed size")) oversizedError = true
    }
    assert(oversizedError, "Must reject audio exceeding 50MB")
  })

  // Test 5: Cross-tenant recording access isolation
  test("5. Cross-tenant recording access rejection", () => {
    const recA = cloudRecordingIngestion.getRecording(
      Array.from(cloudRecordingIngestion.inMemoryRecordings.keys())[0],
      TENANT_A
    )
    assert(recA, "Tenant A should access its own recording")

    let crossTenantBlocked = false
    try {
      cloudRecordingIngestion.getRecording(recA.fileId, TENANT_B)
    } catch (err) {
      if (err.message.includes("SECURITY_VIOLATION")) crossTenantBlocked = true
    }
    assert(crossTenantBlocked, "Tenant B must be rejected from Tenant A's recording")
  })

  // Test 6: Recording failure state handling
  await testAsync("6. Unrecoverable download failure transitions call recording to failed", async () => {
    let caughtErr = false
    try {
      await cloudRecordingIngestion.ingestRecording({
        tenantId: TENANT_A,
        callSid: "CA_rec_call_fail",
        recordingSid: "RE_mock_fail",
        recordingUrl: "https://invalid-provider.example.com/recording.wav",
        provider: "unconfigured_provider",
      })
    } catch (err) {
      caughtErr = true
    }

    assert(caughtErr)
    const failedCall = inMemoryStore.calls.get("CA_rec_call_fail")
    assert(failedCall, "Call record should exist")
    assert.strictEqual(failedCall.recording.status, "failed")
    assert(failedCall.recording.failureReason, "Failure reason should be stored")
  })

  console.log("\n==================================================================")
  console.log(`   PHASE 7 SUMMARY: ${passedCount} PASSED, ${failedCount} FAILED`)
  console.log("==================================================================\n")

  if (failedCount > 0) process.exit(1)
}

runPhase7Tests().catch((err) => {
  console.error("FATAL ERROR IN PHASE 7 TEST:", err)
  process.exit(1)
})

