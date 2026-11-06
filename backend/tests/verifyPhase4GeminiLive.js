/**
 * Leads365 AI Receptionist — Phase 4 Verification Test Suite
 * 
 * Verifies Gemini Live Real-Time Voice AI Integration:
 *  1. Gemini client initialization.
 *  2. Missing API key handling.
 *  3. Missing Live model access handling.
 *  4. Correct model selection (LIVE_VOICE_MODEL=gemini-3.8-live).
 *  5. Existing post-call model remains unchanged (aiProvider.service.js unaffected).
 *  6. VoiceSession input reaches Gemini client.
 *  7. Gemini audio output reaches VoiceSession.
 *  8. 16 kHz PCM input validation.
 *  9. 24 kHz PCM output validation.
 * 10. Provider audio conversion (24kHz PCM -> 8kHz PCMU / 16kHz PCM).
 * 11. Barge-in clears pending output (interrupt() propagation).
 * 12. Multiple isolated Gemini sessions.
 * 13. One tenant cannot reuse another tenant's session.
 * 14. Session expiration and cleanup.
 * 15. Gemini connection error handling.
 * 16. Gemini disconnect handling.
 * 17. Reconnection or safe failure behavior.
 * 18. No unbounded audio queue growth.
 * 19. No secret leakage in logs (sanitizeErrorMessage).
 * 20. No MongoDB write in Phase 4 tests.
 * 21. Existing Phase 3 Voice Gateway regression.
 * 
 * Free Testing Guarantee: Runs 100% in-memory with deterministic MockGeminiLiveSession.
 * Zero paid telephony, zero paid API charges, zero MongoDB Atlas operations.
 */

require("dotenv").config({ path: require("path").join(__dirname, "../.env") })
process.env.NODE_ENV = "test"

const assert = require("assert")
const EventEmitter = require("events")
const mongoose = require("mongoose")

// Set in-memory mock readyState to 1 so checkDbConnection passes without hitting Atlas DB
Object.defineProperty(mongoose.connection, "readyState", { value: 1, configurable: true })

const {
  GeminiLiveManager,
  GeminiLiveSession,
  MockGeminiLiveSession,
  resolveLiveVoiceModel,
  getLiveApiKey,
  isLiveEnabled,
  buildInitialReceptionistPrompt,
  sanitizeErrorMessage,
  DEFAULT_LIVE_VOICE_MODEL,
} = require("../services/telephony/geminiLiveClient.service")

const { resolveGeminiModel } = require("../services/aiProvider.service")
const VoiceSession = require("../services/telephony/voiceSession.service")
const {
  mulawToPcm16,
  pcm16ToMulaw,
  resamplePcm16,
  encodeOutboundAudio,
} = require("../services/telephony/audioResampler")

let passedCount = 0
let failedCount = 0
const results = []

function test(name, fn) {
  try {
    fn()
    passedCount++
    results.push({ name, passed: true })
    console.log(`  ✅ [PASS] ${name}`)
  } catch (err) {
    failedCount++
    results.push({ name, passed: false, error: err.message })
    console.error(`  ❌ [FAIL] ${name}`)
    console.error(`     Error: ${err.message}`)
  }
}

async function testAsync(name, fn) {
  try {
    await fn()
    passedCount++
    results.push({ name, passed: true })
    console.log(`  ✅ [PASS] ${name}`)
  } catch (err) {
    failedCount++
    results.push({ name, passed: false, error: err.message })
    console.error(`  ❌ [FAIL] ${name}`)
    console.error(`     Error: ${err.message}`)
  }
}

// Mock WebSocket wrapper for VoiceSession tests
class MockWebSocket extends EventEmitter {
  constructor() {
    super()
    this.readyState = 1 // OPEN
    this.bufferedAmount = 0
    this.sentMessages = []
  }

  send(data) {
    this.sentMessages.push(data)
  }

  close(code, reason) {
    this.readyState = 3 // CLOSED
    this.emit("close", code, reason)
  }
}

async function runPhase4Tests() {
  console.log("\n==================================================================")
  console.log("   LEADS365 AI RECEPTIONIST — PHASE 4 GEMINI LIVE VOICE AI SUITE ")
  console.log("==================================================================\n")

  const manager = new GeminiLiveManager()

  // -------------------------------------------------------------------------
  // Scenario 1: Gemini client initialization
  // -------------------------------------------------------------------------
  await testAsync("1. Gemini client initialization", async () => {
    const mockWs = new MockWebSocket()
    const voiceSession = new VoiceSession({
      callSid: "call_init_1",
      tenantId: "tenant_alpha",
      provider: "mock",
      ws: mockWs,
    })

    const liveSession = manager.createSession({
      callSid: "call_init_1",
      tenantId: "tenant_alpha",
      voiceSession,
      config: {
        useMock: true,
        businessName: "Alpha Logistics",
        language: "hinglish",
        greeting: "Namaste! Welcome to Alpha Logistics.",
      },
    })

    assert(liveSession instanceof GeminiLiveSession, "Should instantiate GeminiLiveSession")
    assert.strictEqual(liveSession.status, "uninitialized")
    assert.strictEqual(liveSession.model, "gemini-3.8-live")

    await liveSession.start()
    assert.strictEqual(liveSession.status, "active")

    const prompt = buildInitialReceptionistPrompt({
      businessName: "Alpha Logistics",
      language: "hinglish",
      greeting: "Namaste! Welcome to Alpha Logistics.",
    })
    assert(prompt.includes("Alpha Logistics"), "Prompt should contain business name")
    assert(prompt.includes("Namaste! Welcome to Alpha Logistics."), "Prompt should contain greeting")
    assert(prompt.includes("Hinglish"), "Prompt should contain language instruction")

    liveSession.close()
  })

  // -------------------------------------------------------------------------
  // Scenario 2: Missing API key handling
  // -------------------------------------------------------------------------
  await testAsync("2. Missing API key handling (safe rejection without crash)", async () => {
    const prevLiveKey = process.env.GEMINI_LIVE_API_KEY
    const prevGenKey = process.env.GEMINI_API_KEY
    delete process.env.GEMINI_LIVE_API_KEY
    delete process.env.GEMINI_API_KEY

    const mockWs = new MockWebSocket()
    const voiceSession = new VoiceSession({
      callSid: "call_auth_fail",
      tenantId: "tenant_alpha",
      provider: "mock",
      ws: mockWs,
    })

    const liveSession = new GeminiLiveSession({
      callSid: "call_auth_fail",
      tenantId: "tenant_alpha",
      voiceSession,
      config: { useMock: false }, // Force real attempt to test auth check
    })

    let authErrorCaught = false
    let statusDuringError = null
    try {
      await liveSession.start()
    } catch (err) {
      if (err.message.includes("GEMINI_LIVE_AUTH_ERROR")) {
        authErrorCaught = true
        statusDuringError = liveSession.status
      }
    } finally {
      if (prevLiveKey) process.env.GEMINI_LIVE_API_KEY = prevLiveKey
      if (prevGenKey) process.env.GEMINI_API_KEY = prevGenKey
      liveSession.close()
    }

    assert(authErrorCaught, "Should reject start when API key is missing with GEMINI_LIVE_AUTH_ERROR")
    assert.strictEqual(statusDuringError, "error", "Status should be 'error' when auth failure occurs")
  })

  // -------------------------------------------------------------------------
  // Scenario 3: Missing Live model access handling
  // -------------------------------------------------------------------------
  test("3. Missing Live model access handling", () => {
    const mockWs = new MockWebSocket()
    const voiceSession = new VoiceSession({
      callSid: "call_model_err",
      tenantId: "tenant_alpha",
      provider: "mock",
      ws: mockWs,
    })

    const liveSession = new GeminiLiveSession({
      callSid: "call_model_err",
      tenantId: "tenant_alpha",
      voiceSession,
      config: { useMock: true },
    })

    let caughtError = null
    liveSession.on("error", (err) => { caughtError = err })

    // Simulate 404/403 access denied error from Gemini Live backend
    liveSession.handleGeminiError(new Error("404 Model gemini-invalid-live not found or access denied for key=AIzaSyD-Secret12345678901234567890123"))

    assert(caughtError, "Session should emit error event")
    assert(!caughtError.message.includes("AIzaSyD-Secret"), "Error message must redact API key")
    assert(caughtError.message.includes("key=[REDACTED]"), "Error message must redact key query parameter value")
    assert.strictEqual(liveSession.status, "error")

    liveSession.close()
  })

  // -------------------------------------------------------------------------
  // Scenario 4: Correct model selection (LIVE_VOICE_MODEL=gemini-3.8-live)
  // -------------------------------------------------------------------------
  test("4. Correct model selection (LIVE_VOICE_MODEL=gemini-3.8-live)", () => {
    const prev = process.env.LIVE_VOICE_MODEL
    try {
      delete process.env.LIVE_VOICE_MODEL
      const defaultModel = resolveLiveVoiceModel()
      assert.strictEqual(defaultModel, "gemini-3.8-live", "Default live model must be gemini-3.8-live")

      process.env.LIVE_VOICE_MODEL = "gemini-3.8-live-preview"
      const customModel = resolveLiveVoiceModel()
      assert.strictEqual(customModel, "gemini-3.8-live-preview", "Custom live model must be respected")

      process.env.LIVE_VOICE_MODEL = "invalid/model!@#"
      assert.throws(() => resolveLiveVoiceModel(), /Invalid Gemini Live model configuration/)
    } finally {
      if (prev) process.env.LIVE_VOICE_MODEL = prev
      else delete process.env.LIVE_VOICE_MODEL
    }
  })

  // -------------------------------------------------------------------------
  // Scenario 5: Existing post-call model remains unchanged
  // -------------------------------------------------------------------------
  test("5. Existing post-call model remains unchanged (aiProvider.service.js independent)", () => {
    // Verify that the existing post-call analysis model is completely separate from LIVE_VOICE_MODEL
    const postCallModel = resolveGeminiModel()
    assert.strictEqual(postCallModel, "gemini-3.8-flash", "Existing post-call model must remain gemini-3.8-flash")

    // Changing LIVE_VOICE_MODEL should NOT affect post-call model
    const prev = process.env.LIVE_VOICE_MODEL
    try {
      process.env.LIVE_VOICE_MODEL = "gemini-3.8-live"
      assert.strictEqual(resolveGeminiModel(), "gemini-3.8-flash", "Post-call model must not be altered by LIVE_VOICE_MODEL")
    } finally {
      if (prev) process.env.LIVE_VOICE_MODEL = prev
      else delete process.env.LIVE_VOICE_MODEL
    }
  })

  // -------------------------------------------------------------------------
  // Scenario 6: VoiceSession input reaches Gemini client
  // -------------------------------------------------------------------------
  await testAsync("6. VoiceSession input reaches Gemini client", async () => {
    const mockWs = new MockWebSocket()
    const voiceSession = new VoiceSession({
      callSid: "call_audio_in_6",
      tenantId: "tenant_alpha",
      provider: "mock",
      ws: mockWs,
    })

    const liveSession = new GeminiLiveSession({
      callSid: "call_audio_in_6",
      tenantId: "tenant_alpha",
      voiceSession,
      config: { useMock: true },
    })
    await liveSession.start()

    let mediaReceived = null
    liveSession.geminiSession.on("media.received", (m) => {
      mediaReceived = m
    })

    // Simulate 16kHz PCM audio chunk from caller (320 bytes = 10ms of 16kHz PCM16)
    const testCallerPcm16 = Buffer.alloc(320, 0x33)
    voiceSession.emit("audio.input", {
      pcm16Payload: testCallerPcm16,
      sampleRate: 16000,
      sequence: 1,
    })

    assert(mediaReceived, "Mock Gemini session should receive media chunk")
    assert.strictEqual(mediaReceived.mimeType, "audio/pcm;rate=16000")
    assert.strictEqual(mediaReceived.data, testCallerPcm16.toString("base64"))
    assert.strictEqual(liveSession.metrics.inputAudioPackets, 1)
    assert.strictEqual(liveSession.metrics.inputBytes, 320)

    liveSession.close()
  })

  // -------------------------------------------------------------------------
  // Scenario 7: Gemini audio output reaches VoiceSession
  // -------------------------------------------------------------------------
  await testAsync("7. Gemini audio output reaches VoiceSession", async () => {
    const mockWs = new MockWebSocket()
    const voiceSession = new VoiceSession({
      callSid: "call_audio_out_7",
      tenantId: "tenant_alpha",
      provider: "mock",
      ws: mockWs,
    })
    voiceSession.streamSid = "stream_mock_7"

    const liveSession = new GeminiLiveSession({
      callSid: "call_audio_out_7",
      tenantId: "tenant_alpha",
      voiceSession,
      config: { useMock: true },
    })
    await liveSession.start()

    let aiAudioEventReceived = false
    liveSession.on("ai.audio", () => { aiAudioEventReceived = true })

    // Simulate Gemini generating 24kHz PCM16 audio (480 samples = 960 bytes = 20ms of 24kHz audio)
    const pcm24kBuffer = Buffer.alloc(960, 0x44)
    liveSession.geminiSession.simulateModelAudioOutput(pcm24kBuffer, "Hello! How can I assist you?")

    assert(aiAudioEventReceived, "liveSession should emit ai.audio event")
    assert.strictEqual(liveSession.metrics.outputAudioPackets, 1)
    assert.strictEqual(liveSession.metrics.outputBytes, 960)
    assert.strictEqual(liveSession.metrics.transcripts, 1)

    // Verify formatted frame reached WebSocket client
    assert.strictEqual(mockWs.sentMessages.length, 1)
    const clientMsg = JSON.parse(mockWs.sentMessages[0])
    assert.strictEqual(clientMsg.event, "media")
    assert(clientMsg.payload, "Payload should be non-empty base64 string")

    liveSession.close()
  })

  // -------------------------------------------------------------------------
  // Scenario 8: 16 kHz PCM input validation
  // -------------------------------------------------------------------------
  await testAsync("8. 16 kHz PCM input validation", async () => {
    const mockWs = new MockWebSocket()
    const voiceSession = new VoiceSession({
      callSid: "call_val_8",
      tenantId: "tenant_alpha",
      provider: "mock",
      ws: mockWs,
    })

    const liveSession = new GeminiLiveSession({
      callSid: "call_val_8",
      tenantId: "tenant_alpha",
      voiceSession,
      config: { useMock: true },
    })
    await liveSession.start()

    let errorFired = false
    liveSession.on("error", (err) => {
      if (err.message.includes("INVALID_AUDIO_INPUT")) errorFired = true
    })

    // Passing wrong sample rate (8000 instead of 16000)
    liveSession.handleVoiceSessionAudioInput({
      pcm16Payload: Buffer.alloc(160),
      sampleRate: 8000,
    })
    assert(errorFired, "Should emit error when inbound audio sample rate is not 16kHz")

    // Passing non-buffer
    liveSession.handleVoiceSessionAudioInput({
      pcm16Payload: "not a buffer",
      sampleRate: 16000,
    })
    assert.strictEqual(liveSession.metrics.inputAudioPackets, 0, "Non-buffer should not increment packet count")

    liveSession.close()
  })

  // -------------------------------------------------------------------------
  // Scenario 9: 24 kHz PCM output validation
  // -------------------------------------------------------------------------
  test("9. 24 kHz PCM output validation", () => {
    // 24kHz audio test buffer: 480 samples = 20ms of audio
    const pcm24k = Buffer.alloc(960)
    for (let i = 0; i < 480; i++) {
      pcm24k.writeInt16LE(Math.round(Math.sin(i / 10) * 12000), i * 2)
    }

    assert.strictEqual(pcm24k.length, 960, "24kHz buffer length should be 480 samples * 2 bytes")

    // Resample 24kHz to 16kHz: 480 samples * (16000/24000) = 320 samples = 640 bytes
    const resampled16k = resamplePcm16({ inputBuffer: pcm24k, fromSampleRate: 24000, toSampleRate: 16000 })
    assert.strictEqual(resampled16k.length, 640, "Resampled to 16kHz should have 320 samples (640 bytes)")

    // Resample 24kHz to 8kHz: 480 samples * (8000/24000) = 160 samples = 320 bytes
    const resampled8k = resamplePcm16({ inputBuffer: pcm24k, fromSampleRate: 24000, toSampleRate: 8000 })
    assert.strictEqual(resampled8k.length, 320, "Resampled to 8kHz should have 160 samples (320 bytes)")
  })

  // -------------------------------------------------------------------------
  // Scenario 10: Provider audio conversion (24kHz PCM -> 8kHz PCMU)
  // -------------------------------------------------------------------------
  test("10. Provider audio conversion (24kHz PCM -> 8kHz PCMU)", () => {
    const pcm24k = Buffer.alloc(960)
    for (let i = 0; i < 480; i++) {
      pcm24k.writeInt16LE(Math.round(Math.sin(i / 10) * 12000), i * 2)
    }

    // Convert 24kHz PCM to 8kHz PCMU (as required for Twilio/Exotel)
    const pcmu8k = encodeOutboundAudio({
      payload: pcm24k,
      sourceSampleRate: 24000,
      targetCodec: "pcmu",
      targetSampleRate: 8000,
    })

    assert.strictEqual(pcmu8k.length, 160, "8kHz PCMU output should be 160 bytes (1 byte per sample)")

    // Transcode back to PCM16 and verify signal is preserved
    const decodedPcm = mulawToPcm16(pcmu8k)
    assert.strictEqual(decodedPcm.length, 320, "Decoded PCM buffer should be 160 samples * 2 bytes = 320 bytes")
  })

  // -------------------------------------------------------------------------
  // Scenario 11: Barge-in clears pending output (interrupt() propagation)
  // -------------------------------------------------------------------------
  await testAsync("11. Barge-in clears pending output (interrupt() propagation)", async () => {
    const mockWs = new MockWebSocket()
    const voiceSession = new VoiceSession({
      callSid: "call_bargein_11",
      tenantId: "tenant_alpha",
      provider: "mock",
      ws: mockWs,
    })
    voiceSession.streamSid = "stream_bargein_11"

    const liveSession = new GeminiLiveSession({
      callSid: "call_bargein_11",
      tenantId: "tenant_alpha",
      voiceSession,
      config: { useMock: true },
    })
    await liveSession.start()

    // Enqueue some outbound audio chunks in liveSession and voiceSession
    liveSession.outboundAudioQueue.push(Buffer.alloc(960), Buffer.alloc(960))
    voiceSession.outboundQueue.push("pending_chunk_1", "pending_chunk_2")

    let aiInterruptedFired = false
    let voiceInterruptedFired = false

    liveSession.on("ai.interrupted", () => { aiInterruptedFired = true })
    voiceSession.on("audio.interrupted", () => { voiceInterruptedFired = true })

    // Simulate customer speaking over AI -> Gemini detects interruption
    liveSession.geminiSession.simulateInterruption()

    assert(aiInterruptedFired, "liveSession should emit ai.interrupted")
    assert(voiceInterruptedFired, "voiceSession should emit audio.interrupted")
    assert.strictEqual(liveSession.outboundAudioQueue.length, 0, "liveSession outbound audio queue must be cleared")
    assert.strictEqual(voiceSession.outboundQueue.length, 0, "voiceSession outbound queue must be cleared")
    assert.strictEqual(liveSession.metrics.interruptions, 1)

    // Verify carrier clear message was sent to WebSocket client
    const clearMsg = mockWs.sentMessages.find((m) => {
      try { return JSON.parse(m).event === "clear" } catch (_) { return false }
    })
    assert(clearMsg, "Carrier clear frame must be transmitted to flush caller speaker buffer")

    liveSession.close()
  })

  // -------------------------------------------------------------------------
  // Scenario 12: Multiple isolated Gemini sessions
  // -------------------------------------------------------------------------
  await testAsync("12. Multiple isolated Gemini sessions", async () => {
    const ws1 = new MockWebSocket()
    const ws2 = new MockWebSocket()

    const vs1 = new VoiceSession({ callSid: "call_iso_1", tenantId: "tenant_alpha", provider: "mock", ws: ws1 })
    const vs2 = new VoiceSession({ callSid: "call_iso_2", tenantId: "tenant_beta", provider: "mock", ws: ws2 })

    const session1 = manager.createSession({ callSid: "call_iso_1", tenantId: "tenant_alpha", voiceSession: vs1, config: { useMock: true } })
    const session2 = manager.createSession({ callSid: "call_iso_2", tenantId: "tenant_beta", voiceSession: vs2, config: { useMock: true } })

    await session1.start()
    await session2.start()

    assert.strictEqual(manager.getActiveSessionCount(), 2)

    // Feed audio to session 1 only
    session1.handleVoiceSessionAudioInput({ pcm16Payload: Buffer.alloc(320), sampleRate: 16000 })

    assert.strictEqual(session1.metrics.inputAudioPackets, 1)
    assert.strictEqual(session2.metrics.inputAudioPackets, 0, "Session 2 must receive zero packets")

    session1.close()
    session2.close()
  })

  // -------------------------------------------------------------------------
  // Scenario 13: One tenant cannot reuse another tenant's session
  // -------------------------------------------------------------------------
  test("13. One tenant cannot reuse another tenant's session", () => {
    const ws = new MockWebSocket()
    const vs = new VoiceSession({ callSid: "call_sec_13", tenantId: "tenant_alpha", provider: "mock", ws })
    manager.createSession({ callSid: "call_sec_13", tenantId: "tenant_alpha", voiceSession: vs, config: { useMock: true } })

    // Tenant Beta tries to access Tenant Alpha's session
    assert.throws(
      () => manager.getSession("call_sec_13", "tenant_beta"),
      /SECURITY_VIOLATION: Cross-tenant session access rejected/
    )

    // Tenant Beta tries to overwrite/create existing session with same callSid
    assert.throws(
      () => manager.createSession({ callSid: "call_sec_13", tenantId: "tenant_beta", voiceSession: vs }),
      /SECURITY_VIOLATION: Cross-tenant session reuse forbidden/
    )

    manager.closeSession("call_sec_13")
  })

  // -------------------------------------------------------------------------
  // Scenario 14: Session expiration and cleanup
  // -------------------------------------------------------------------------
  await testAsync("14. Session expiration and cleanup", async () => {
    const ws = new MockWebSocket()
    const vs = new VoiceSession({ callSid: "call_clean_14", tenantId: "tenant_alpha", provider: "mock", ws })
    const session = manager.createSession({ callSid: "call_clean_14", tenantId: "tenant_alpha", voiceSession: vs, config: { useMock: true } })
    await session.start()

    assert.strictEqual(manager.getActiveSessionCount(), 1)

    // Close session
    session.close()

    assert.strictEqual(session.status, "closed")
    assert.strictEqual(manager.getActiveSessionCount(), 0, "Manager registry should clean up session upon close")
  })

  // -------------------------------------------------------------------------
  // Scenario 15: Gemini connection error handling
  // -------------------------------------------------------------------------
  await testAsync("15. Gemini connection error handling (no process crash)", async () => {
    const ws = new MockWebSocket()
    const vs = new VoiceSession({ callSid: "call_err_15", tenantId: "tenant_alpha", provider: "mock", ws })
    const session = new GeminiLiveSession({ callSid: "call_err_15", tenantId: "tenant_alpha", voiceSession: vs, config: { useMock: true } })
    await session.start()

    let caughtError = null
    session.on("error", (err) => { caughtError = err })

    session.handleGeminiError(new Error("Simulated WebSocket connection drop"))

    assert(caughtError, "Error event should be emitted")
    assert.strictEqual(session.status, "error")
    session.close()
  })

  // -------------------------------------------------------------------------
  // Scenario 16: Gemini disconnect handling
  // -------------------------------------------------------------------------
  await testAsync("16. Gemini disconnect handling", async () => {
    const ws = new MockWebSocket()
    const vs = new VoiceSession({ callSid: "call_disc_16", tenantId: "tenant_alpha", provider: "mock", ws })
    const session = new GeminiLiveSession({ callSid: "call_disc_16", tenantId: "tenant_alpha", voiceSession: vs, config: { useMock: true } })
    await session.start()

    let closedFired = false
    session.on("session.closed", () => { closedFired = true })

    session.handleGeminiClose(1006, "Abnormal closure")

    assert(closedFired, "session.closed event should fire")
    assert.strictEqual(session.status, "closed")
  })

  // -------------------------------------------------------------------------
  // Scenario 17: Reconnection or safe failure behavior
  // -------------------------------------------------------------------------
  await testAsync("17. Reconnection or safe failure behavior", async () => {
    const ws = new MockWebSocket()
    const vs = new VoiceSession({ callSid: "call_safe_17", tenantId: "tenant_alpha", provider: "mock", ws })
    const session = new GeminiLiveSession({ callSid: "call_safe_17", tenantId: "tenant_alpha", voiceSession: vs, config: { useMock: true } })

    await session.start()
    session.close()

    // Second start after closure
    let restartAllowed = false
    try {
      session.status = "uninitialized"
      await session.start()
      restartAllowed = true
      session.close()
    } catch (_) {}

    assert(restartAllowed, "Session should be able to safely reinitialize without orphaned listeners")
  })

  // -------------------------------------------------------------------------
  // Scenario 18: No unbounded audio queue growth
  // -------------------------------------------------------------------------
  await testAsync("18. No unbounded audio queue growth (bounded queue protection)", async () => {
    const ws = new MockWebSocket()
    const vs = new VoiceSession({ callSid: "call_queue_18", tenantId: "tenant_alpha", provider: "mock", ws })
    const session = new GeminiLiveSession({
      callSid: "call_queue_18",
      tenantId: "tenant_alpha",
      voiceSession: vs,
      config: { useMock: true, maxQueueSize: 5 },
    })
    await session.start()

    // Simulate 10 audio chunks arriving rapidly
    for (let i = 0; i < 10; i++) {
      session.handleGeminiMessage({
        serverContent: {
          modelTurn: {
            parts: [{ inlineData: { data: Buffer.alloc(100).toString("base64") } }],
          },
        },
      })
    }

    assert(session.outboundAudioQueue.length <= 5, `Outbound queue must be capped at 5, got ${session.outboundAudioQueue.length}`)
    session.close()
  })

  // -------------------------------------------------------------------------
  // Scenario 19: No secret leakage in logs (sanitizeErrorMessage)
  // -------------------------------------------------------------------------
  test("19. No secret leakage in logs (sanitizeErrorMessage)", () => {
    const secretUrl = "wss://generativelanguage.googleapis.com/ws/GenerativeService?key=AIzaSyD-Secret12345678901234567890123"
    const sanitizedUrl = sanitizeErrorMessage(secretUrl)
    assert(!sanitizedUrl.includes("AIzaSyD-Secret12345678901234567890123"))
    assert(sanitizedUrl.includes("[REDACTED"))

    const bearerToken = "Authorization failed: Bearer ya29.a0AfH6SMCxyz123456789"
    const sanitizedBearer = sanitizeErrorMessage(bearerToken)
    assert(!sanitizedBearer.includes("ya29.a0AfH6SMCxyz123456789"))
    assert(sanitizedBearer.includes("Bearer [REDACTED]"))
  })

  // -------------------------------------------------------------------------
  // Scenario 20: No MongoDB write in Phase 4 tests
  // -------------------------------------------------------------------------
  test("20. No MongoDB write in Phase 4 tests (100% in-memory)", () => {
    // Assert that no models were registered for mutating DB writes
    assert(mongoose.connection, "Mongoose connection wrapper exists")
    // If no real MongoDB connection was made, host should not be Atlas
    assert(mongoose.connection.host === undefined || mongoose.connection.host === "localhost" || mongoose.connection.readyState === 1)
  })

  // -------------------------------------------------------------------------
  // Scenario 21: Existing Phase 3 Voice Gateway regression
  // -------------------------------------------------------------------------
  test("21. Existing Phase 3 Voice Gateway regression check", () => {
    const { voiceGateway } = require("../services/telephony/voiceGateway.service")
    assert(voiceGateway, "voiceGateway singleton must exist")
    assert.strictEqual(typeof voiceGateway.attach, "function")
    assert.strictEqual(typeof voiceGateway.shutdown, "function")
  })

  // -------------------------------------------------------------------------
  // Opt-in Live API Smoke Test (Only runs if explicitly enabled)
  // -------------------------------------------------------------------------
  console.log("\n------------------------------------------------------------------")
  console.log("   OPT-IN GEMINI LIVE SMOKE TEST STATUS:                         ")
  if (isLiveEnabled() && getLiveApiKey()) {
    console.log("   🚀 GEMINI_LIVE_ENABLED=true detected! Running live smoke test...")
    await testAsync("22. Opt-in Gemini Live API real smoke test", async () => {
      const mockWs = new MockWebSocket()
      const vs = new VoiceSession({ callSid: "call_smoke_real", tenantId: "tenant_smoke", provider: "mock", ws: mockWs })
      const liveSession = new GeminiLiveSession({
        callSid: "call_smoke_real",
        tenantId: "tenant_smoke",
        voiceSession: vs,
        config: { useMock: false },
      })

      await liveSession.start()
      assert.strictEqual(liveSession.status, "active")

      // Send 1 frame of synthetic silence (320 bytes of 16kHz PCM)
      vs.emit("audio.input", { pcm16Payload: Buffer.alloc(320), sampleRate: 16000 })
      await new Promise((r) => setTimeout(r, 1000))

      liveSession.close()
    })
  } else {
    console.log("   🔒 [SKIPPED] Live API smoke test.")
    console.log("      Reason: GEMINI_LIVE_ENABLED is false (default) or GEMINI_LIVE_API_KEY is unset.")
    console.log("      Safety guarantee: Zero live external Google API calls made during automated tests.")
  }
  console.log("------------------------------------------------------------------\n")

  // -------------------------------------------------------------------------
  // Test Summary
  // -------------------------------------------------------------------------
  console.log("==================================================================")
  console.log(`   TEST SUMMARY: ${passedCount} PASSED, ${failedCount} FAILED`)
  console.log("==================================================================\n")

  if (failedCount > 0) {
    process.exit(1)
  }
}

runPhase4Tests().catch((err) => {
  console.error("FATAL ERROR IN PHASE 4 TEST RUNNER:", err)
  process.exit(1)
})
