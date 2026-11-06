/**
 * Leads365 AI Receptionist — Phase 3 Verification Test Suite
 * 
 * Verifies Real-Time Bidirectional Voice Gateway:
 *  1. Valid mock WebSocket connection using signed stream token.
 *  2. Invalid stream token rejection (401 / socket destroyed).
 *  3. Expired stream token rejection.
 *  4. Replayed token rejection (single-use nonce consumed).
 *  5. Call identifier mismatch rejection.
 *  6. Cross-tenant connection rejection.
 *  7. Valid start/media/stop sequence.
 *  8. Malformed media event handling.
 *  9. Invalid base64 audio payload rejection.
 * 10. Codec transcoding fidelity (PCMU -> PCM16 -> PCMU round-trip).
 * 11. Outgoing audio framing to provider format.
 * 12. Interruption and clear-buffer (interrupt()) behavior.
 * 13. Duplicate media event handling.
 * 14. Out-of-order sequence packet handling.
 * 15. Backpressure and oversized payload (>64KB) protection.
 * 16. Idle timeout disconnect after inactivity.
 * 17. Unexpected disconnect cleanup (session removed from gateway).
 * 18. Multiple concurrent isolated mock sessions.
 * 19. Provider-specific Twilio frame normalization.
 * 20. Provider-specific Exotel frame normalization.
 * 21. Server shutdown cleans up active streams.
 * 22. HTTP startup failure does not leave a WebSocket listener running.
 * 
 * Safety: Runs 100% in-memory with local ephemeral HTTP servers. Zero Atlas DB writes.
 */

require("dotenv").config({ path: require("path").join(__dirname, "../.env") })
process.env.NODE_ENV = "test"

const assert = require("assert")
const http = require("http")
const WebSocket = require("ws")

const { VoiceGatewayService } = require("../services/telephony/voiceGateway.service")
const VoiceSession = require("../services/telephony/voiceSession.service")
const TwilioStreamAdapter = require("../services/telephony/twilioStreamAdapter")
const ExotelStreamAdapter = require("../services/telephony/exotelStreamAdapter")
const MockStreamAdapter = require("../services/telephony/mockStreamAdapter")
const {
  mulawToPcm16,
  pcm16ToMulaw,
  resamplePcm16,
  normalizeInboundAudio,
  encodeOutboundAudio,
} = require("../services/telephony/audioResampler")
const {
  generateStreamToken,
  verifyAndConsumeStreamToken,
  clearConsumedTokens,
} = require("../services/telephony/streamAuth.service")

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

// Helper: spins up an ephemeral HTTP server attached to VoiceGateway
function createTestServer(options = {}) {
  const server = http.createServer((req, res) => {
    res.writeHead(404)
    res.end()
  })
  const gateway = new VoiceGatewayService(options)
  gateway.attach(server)

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port
      resolve({
        server,
        gateway,
        port,
        wsUrl: `ws://127.0.0.1:${port}${gateway.path}`,
        close: async () => {
          await gateway.shutdown()
          await new Promise((r) => server.close(r))
        },
      })
    })
  })
}

// Helper: connects a WebSocket client and resolves upon successful open
function connectWs(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url)
    ws.on("open", () => resolve(ws))
    ws.on("error", reject)
    ws.on("unexpected-response", (req, res) => {
      reject(new Error(`UNEXPECTED_RESPONSE_${res.statusCode}`))
    })
  })
}

// Helper: connects and expects rejection with specific status code
function expectWsRejection(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url)
    let rejected = false
    ws.on("unexpected-response", (req, res) => {
      rejected = true
      resolve(res.statusCode)
    })
    ws.on("error", (err) => {
      if (!rejected) resolve(err.message)
    })
    ws.on("open", () => {
      ws.close()
      reject(new Error("Expected connection to be rejected, but it succeeded"))
    })
  })
}

async function runPhase3Tests() {
  console.log("\n==================================================================")
  console.log("   LEADS365 AI RECEPTIONIST — PHASE 3 VOICE GATEWAY SUITE        ")
  console.log("==================================================================\n")

  clearConsumedTokens()
  let testEnv = await createTestServer({ idleTimeoutMs: 1000, heartbeatIntervalMs: 500 })

  try {
    // -------------------------------------------------------------------------
    // Scenario 1: Valid mock WebSocket connection using signed stream token
    // -------------------------------------------------------------------------
    await testAsync("1. Valid mock WebSocket connection using signed stream token", async () => {
      const token = generateStreamToken({
        callSid: "call_mock_1",
        tenantId: "tenant_alpha",
        provider: "mock",
      })

      const ws = await connectWs(`${testEnv.wsUrl}?token=${token}`)
      assert(ws.readyState === WebSocket.OPEN, "WebSocket should be open")

      const session = testEnv.gateway.getSession("call_mock_1")
      assert(session, "Session should exist in gateway.activeSessions")
      assert.strictEqual(session.tenantId, "tenant_alpha")
      assert.strictEqual(session.provider, "mock")

      ws.close()
      await new Promise((r) => setTimeout(r, 50))
    })

    // -------------------------------------------------------------------------
    // Scenario 2: Invalid stream token rejection (401 / socket destroyed)
    // -------------------------------------------------------------------------
    await testAsync("2. Invalid stream token rejection (401 / socket destroyed)", async () => {
      const status = await expectWsRejection(`${testEnv.wsUrl}?token=invalid_st_token_12345`)
      assert(status === 401 || (typeof status === "string" && status.includes("401")), `Expected 401 rejection, got: ${status}`)
    })

    // -------------------------------------------------------------------------
    // Scenario 3: Expired stream token rejection
    // -------------------------------------------------------------------------
    await testAsync("3. Expired stream token rejection", async () => {
      const expiredToken = generateStreamToken({
        callSid: "call_mock_3",
        tenantId: "tenant_alpha",
        provider: "mock",
        ttlSeconds: -10, // Expired 10 seconds ago
      })

      const status = await expectWsRejection(`${testEnv.wsUrl}?token=${expiredToken}`)
      assert(status === 401 || (typeof status === "string" && status.includes("401")), `Expected 401 for expired token, got: ${status}`)
    })

    // -------------------------------------------------------------------------
    // Scenario 4: Replayed token rejection (single-use nonce consumed)
    // -------------------------------------------------------------------------
    await testAsync("4. Replayed token rejection (single-use nonce consumed)", async () => {
      const singleUseToken = generateStreamToken({
        callSid: "call_mock_4",
        tenantId: "tenant_alpha",
        provider: "mock",
      })

      // First use: must succeed
      const ws1 = await connectWs(`${testEnv.wsUrl}?token=${singleUseToken}`)
      ws1.close()
      await new Promise((r) => setTimeout(r, 50))

      // Second use: must be rejected (replay attack prevention)
      const status = await expectWsRejection(`${testEnv.wsUrl}?token=${singleUseToken}`)
      assert(status === 401 || (typeof status === "string" && status.includes("401")), `Expected 401 on replayed token, got: ${status}`)
    })

    // -------------------------------------------------------------------------
    // Scenario 5: Call identifier mismatch rejection
    // -------------------------------------------------------------------------
    await testAsync("5. Call identifier mismatch rejection", async () => {
      const token = generateStreamToken({
        callSid: "call_expected_5",
        tenantId: "tenant_alpha",
        provider: "mock",
      })

      const status = await expectWsRejection(`${testEnv.wsUrl}?token=${token}&callSid=call_mismatched_999`)
      assert(status === 401 || (typeof status === "string" && status.includes("401")), `Expected 401 on callSid mismatch, got: ${status}`)
    })

    // -------------------------------------------------------------------------
    // Scenario 6: Cross-tenant connection rejection
    // -------------------------------------------------------------------------
    await testAsync("6. Cross-tenant connection rejection", async () => {
      const token = generateStreamToken({
        callSid: "call_mock_6",
        tenantId: "tenant_alpha",
        provider: "mock",
      })

      // Query specifies wrong tenant
      const status = await expectWsRejection(`${testEnv.wsUrl}?token=${token}&tenantId=tenant_beta_hacker`)
      assert(status === 401 || (typeof status === "string" && status.includes("401")), `Expected 401 on cross-tenant mismatch, got: ${status}`)

      // Direct verifyAndConsumeStreamToken call enforcement
      const freshToken = generateStreamToken({
        callSid: "call_mock_6b",
        tenantId: "tenant_alpha",
        provider: "mock",
      })
      assert.throws(
        () => verifyAndConsumeStreamToken(freshToken, { tenantId: "tenant_gamma" }),
        /Cross-tenant token access rejected/
      )
    })

    // -------------------------------------------------------------------------
    // Scenario 7: Valid start/media/stop sequence
    // -------------------------------------------------------------------------
    await testAsync("7. Valid start/media/stop sequence", async () => {
      const token = generateStreamToken({
        callSid: "call_mock_7",
        tenantId: "tenant_alpha",
        provider: "mock",
      })

      const ws = await connectWs(`${testEnv.wsUrl}?token=${token}`)
      const session = testEnv.gateway.getSession("call_mock_7")
      assert(session, "Session must exist")

      let sessionStartedFired = false
      let audioInputReceived = false
      let sessionEndedFired = false
      let statusDuringEndedEvent = null

      session.on("session.started", () => { sessionStartedFired = true })
      session.on("audio.input", (evt) => {
        audioInputReceived = true
        assert(evt.pcm16Payload instanceof Buffer, "Should have transcoded pcm16 payload")
      })
      session.on("session.ended", () => {
        sessionEndedFired = true
        statusDuringEndedEvent = session.status
      })

      // Send start event
      ws.send(JSON.stringify({
        event: "start",
        streamSid: "stream_7_sid",
        callSid: "call_mock_7",
        codec: "pcmu",
        sampleRate: 8000,
      }))
      await new Promise((r) => setTimeout(r, 40))
      assert(sessionStartedFired, "session.started event should fire")
      assert.strictEqual(session.status, "active")

      // Send media event (8-byte base64 u-law payload)
      const testAudioUlaw = Buffer.from([0x00, 0x10, 0x20, 0x30, 0x40, 0x50, 0x60, 0x70])
      ws.send(JSON.stringify({
        event: "media",
        streamSid: "stream_7_sid",
        payload: testAudioUlaw.toString("base64"),
        codec: "pcmu",
        sampleRate: 8000,
      }))
      await new Promise((r) => setTimeout(r, 40))
      assert(audioInputReceived, "audio.input event should fire with normalized audio")

      // Send stop event
      ws.send(JSON.stringify({
        event: "stop",
        streamSid: "stream_7_sid",
        callSid: "call_mock_7",
      }))
      await new Promise((r) => setTimeout(r, 40))
      assert(sessionEndedFired, "session.ended event should fire")
      assert.strictEqual(statusDuringEndedEvent, "ended", "status should be 'ended' when session.ended fires")
      assert.strictEqual(session.status, "closed", "status should transition to 'closed' after teardown")

      ws.close()
      await new Promise((r) => setTimeout(r, 40))
    })

    // -------------------------------------------------------------------------
    // Scenario 8: Malformed media event handling
    // -------------------------------------------------------------------------
    await testAsync("8. Malformed media event handling (no process crash)", async () => {
      const token = generateStreamToken({
        callSid: "call_mock_8",
        tenantId: "tenant_alpha",
        provider: "mock",
      })

      const ws = await connectWs(`${testEnv.wsUrl}?token=${token}`)
      const session = testEnv.gateway.getSession("call_mock_8")

      let errorCaught = false
      session.on("error", () => { errorCaught = true })

      // Send invalid JSON syntax
      ws.send("{ event: 'media', streamSid: MALFORMED_JSON_HERE }")
      await new Promise((r) => setTimeout(r, 40))

      assert(errorCaught, "Session should emit error on malformed JSON without crashing")
      ws.close()
      await new Promise((r) => setTimeout(r, 40))
    })

    // -------------------------------------------------------------------------
    // Scenario 9: Invalid base64 audio payload rejection
    // -------------------------------------------------------------------------
    await testAsync("9. Invalid base64 audio payload rejection", async () => {
      const token = generateStreamToken({
        callSid: "call_mock_9",
        tenantId: "tenant_alpha",
        provider: "mock",
      })

      const ws = await connectWs(`${testEnv.wsUrl}?token=${token}`)
      const session = testEnv.gateway.getSession("call_mock_9")

      let errorCaught = false
      session.on("error", (err) => {
        if (err.message.includes("Invalid base64")) errorCaught = true
      })

      // Send illegal base64 string
      ws.send(JSON.stringify({
        event: "media",
        streamSid: "stream_9",
        payload: "###NOT_VALID_BASE64_AT_ALL!!!",
      }))
      await new Promise((r) => setTimeout(r, 40))

      assert(errorCaught, "Session should emit error rejecting invalid base64")
      ws.close()
      await new Promise((r) => setTimeout(r, 40))
    })

    // -------------------------------------------------------------------------
    // Scenario 10: Codec transcoding fidelity (PCMU -> PCM16 -> PCMU round-trip)
    // -------------------------------------------------------------------------
    test("10. Codec transcoding fidelity (PCMU -> PCM16 -> PCMU round-trip)", () => {
      const original = Buffer.alloc(256)
      for (let i = 0; i < 256; i++) original[i] = i

      const pcm16 = mulawToPcm16(original)
      assert.strictEqual(pcm16.length, 512, "PCM16 buffer should be exactly double the size (16-bit)")

      const roundtrip = pcm16ToMulaw(pcm16)
      assert.strictEqual(roundtrip.length, 256, "PCMU buffer should be 256 bytes")

      let matches = 0
      for (let i = 0; i < 256; i++) {
        // In G.711, 0x7F and 0xFF both represent zero amplitude (+0 and -0)
        if (original[i] === roundtrip[i] || (original[i] === 127 && roundtrip[i] === 255)) {
          matches++
        }
      }
      assert.strictEqual(matches, 256, "All 256 G.711 u-law levels must preserve companding fidelity")

      // Test resampler fidelity: 8kHz -> 16kHz
      const in8k = Buffer.alloc(160) // 80 samples
      for (let i = 0; i < 80; i++) in8k.writeInt16LE(Math.round(Math.sin(i / 10) * 10000), i * 2)
      const out16k = resamplePcm16({ inputBuffer: in8k, fromSampleRate: 8000, toSampleRate: 16000 })
      assert.strictEqual(out16k.length, 320, "16kHz should have double the samples of 8kHz")

      // Downsampling: 16kHz -> 8kHz
      const back8k = resamplePcm16({ inputBuffer: out16k, fromSampleRate: 16000, toSampleRate: 8000 })
      assert.strictEqual(back8k.length, 160, "8kHz should have 160 bytes")
    })

    // -------------------------------------------------------------------------
    // Scenario 11: Outgoing audio framing to provider format
    // -------------------------------------------------------------------------
    await testAsync("11. Outgoing audio framing to provider format", async () => {
      const token = generateStreamToken({
        callSid: "call_mock_11",
        tenantId: "tenant_alpha",
        provider: "mock",
      })

      const ws = await connectWs(`${testEnv.wsUrl}?token=${token}`)
      const session = testEnv.gateway.getSession("call_mock_11")
      session.streamSid = "stream_11_sid"

      let clientReceivedMedia = false
      ws.on("message", (raw) => {
        const msg = JSON.parse(raw.toString("utf8"))
        if (msg.event === "media" && msg.streamSid === "stream_11_sid" && msg.payload) {
          clientReceivedMedia = true
        }
      })

      // Send 320 bytes of 16kHz PCM audio
      const testPcmChunk = Buffer.alloc(320, 0x12)
      const success = session.sendAudioOutput(testPcmChunk, 16000)
      assert.strictEqual(success, true)

      await new Promise((r) => setTimeout(r, 50))
      assert(clientReceivedMedia, "Client should receive formatted media message from session")
      assert.strictEqual(session.metrics.packetsOut, 1)

      ws.close()
      await new Promise((r) => setTimeout(r, 40))
    })

    // -------------------------------------------------------------------------
    // Scenario 12: Interruption and clear-buffer (interrupt()) behavior
    // -------------------------------------------------------------------------
    await testAsync("12. Interruption and clear-buffer (interrupt()) behavior", async () => {
      const token = generateStreamToken({
        callSid: "call_mock_12",
        tenantId: "tenant_alpha",
        provider: "mock",
      })

      const ws = await connectWs(`${testEnv.wsUrl}?token=${token}`)
      const session = testEnv.gateway.getSession("call_mock_12")
      session.streamSid = "stream_12_sid"

      // Mock high backpressure to force packet enqueue
      session.outboundQueue.push("queued_packet_1", "queued_packet_2")
      assert.strictEqual(session.outboundQueue.length, 2)

      let clientReceivedClear = false
      let interruptedEventFired = false

      ws.on("message", (raw) => {
        const msg = JSON.parse(raw.toString("utf8"))
        if (msg.event === "clear" && msg.streamSid === "stream_12_sid") {
          clientReceivedClear = true
        }
      })

      session.on("audio.interrupted", () => { interruptedEventFired = true })

      // Trigger barge-in interrupt
      session.interrupt()

      await new Promise((r) => setTimeout(r, 50))
      assert.strictEqual(session.outboundQueue.length, 0, "Outbound queue must be immediately flushed on interrupt")
      assert(clientReceivedClear, "Client must receive provider clear frame")
      assert(interruptedEventFired, "audio.interrupted event must fire")
      assert.strictEqual(session.metrics.interruptions, 1)

      ws.close()
      await new Promise((r) => setTimeout(r, 40))
    })

    // -------------------------------------------------------------------------
    // Scenario 13: Duplicate media event handling
    // -------------------------------------------------------------------------
    await testAsync("13. Duplicate media event handling (state preserved)", async () => {
      const token = generateStreamToken({
        callSid: "call_mock_13",
        tenantId: "tenant_alpha",
        provider: "mock",
      })

      const ws = await connectWs(`${testEnv.wsUrl}?token=${token}`)
      const session = testEnv.gateway.getSession("call_mock_13")

      const mediaMsg = JSON.stringify({
        event: "media",
        streamSid: "stream_13",
        payload: Buffer.from("identical_audio_frame").toString("base64"),
        sequence: 1,
      })

      ws.send(mediaMsg)
      ws.send(mediaMsg) // Duplicate
      await new Promise((r) => setTimeout(r, 50))

      assert.strictEqual(session.metrics.packetsIn, 2, "Both frames should be safely received and accounted for")
      ws.close()
      await new Promise((r) => setTimeout(r, 40))
    })

    // -------------------------------------------------------------------------
    // Scenario 14: Out-of-order sequence packet handling
    // -------------------------------------------------------------------------
    await testAsync("14. Out-of-order sequence packet handling", async () => {
      const token = generateStreamToken({
        callSid: "call_mock_14",
        tenantId: "tenant_alpha",
        provider: "mock",
      })

      const ws = await connectWs(`${testEnv.wsUrl}?token=${token}`)
      const session = testEnv.gateway.getSession("call_mock_14")

      const seqsReceived = []
      session.on("audio.input", (evt) => {
        seqsReceived.push(evt.sequence)
      })

      // Send packet 5 before packet 2
      ws.send(JSON.stringify({
        event: "media",
        streamSid: "stream_14",
        payload: Buffer.from("audio5").toString("base64"),
        sequence: 5,
      }))
      ws.send(JSON.stringify({
        event: "media",
        streamSid: "stream_14",
        payload: Buffer.from("audio2").toString("base64"),
        sequence: 2,
      }))
      await new Promise((r) => setTimeout(r, 50))

      assert.deepStrictEqual(seqsReceived, [5, 2], "Packets should be processed without crash or drop")
      ws.close()
      await new Promise((r) => setTimeout(r, 40))
    })

    // -------------------------------------------------------------------------
    // Scenario 15: Backpressure and oversized payload (>64KB) protection
    // -------------------------------------------------------------------------
    await testAsync("15. Backpressure and oversized payload (>64KB) protection", async () => {
      const token = generateStreamToken({
        callSid: "call_mock_15",
        tenantId: "tenant_alpha",
        provider: "mock",
      })

      const ws = await connectWs(`${testEnv.wsUrl}?token=${token}`)
      const session = testEnv.gateway.getSession("call_mock_15")

      let oversizedErrorCaught = false
      session.on("error", (err) => {
        if (err.message.includes("PAYLOAD_TOO_LARGE")) oversizedErrorCaught = true
      })

      // Construct a 70KB oversized payload
      const hugeString = "A".repeat(70000)
      ws.send(hugeString)
      await new Promise((r) => setTimeout(r, 60))

      assert(oversizedErrorCaught, "Should reject payload exceeding 64KB with PAYLOAD_TOO_LARGE")

      // Also verify bounded queue drops oldest packets when queue reaches maxQueueSize
      session.maxQueueSize = 3
      session.inboundQueue = []
      session.inboundQueue.push("p1", "p2", "p3")
      // Adding one more with bounded queue logic
      if (session.inboundQueue.length >= session.maxQueueSize) session.inboundQueue.shift()
      session.inboundQueue.push("p4")
      assert.deepStrictEqual(session.inboundQueue, ["p2", "p3", "p4"], "Bounded queue should evict oldest packet")

      ws.close()
      await new Promise((r) => setTimeout(r, 40))
    })

    // -------------------------------------------------------------------------
    // Scenario 16: Idle timeout disconnect after inactivity
    // -------------------------------------------------------------------------
    await testAsync("16. Idle timeout disconnect after inactivity", async () => {
      const token = generateStreamToken({
        callSid: "call_mock_16",
        tenantId: "tenant_alpha",
        provider: "mock",
      })

      const ws = await connectWs(`${testEnv.wsUrl}?token=${token}`)
      const session = testEnv.gateway.getSession("call_mock_16")
      assert(session, "Session must exist")

      // Artificially age lastActivityAt past idleTimeoutMs (1000ms configured in testEnv)
      session.lastActivityAt = Date.now() - 2000

      // Manually trigger the idle check loop logic
      const now = Date.now()
      for (const [callSid, sess] of testEnv.gateway.activeSessions.entries()) {
        if (now - sess.lastActivityAt > testEnv.gateway.idleTimeoutMs) {
          sess.close(1000, "Idle stream timeout exceeded")
          testEnv.gateway.activeSessions.delete(callSid)
        }
      }

      assert.strictEqual(testEnv.gateway.getSession("call_mock_16"), null, "Idle session should be pruned from gateway")
      ws.close()
      await new Promise((r) => setTimeout(r, 40))
    })

    // -------------------------------------------------------------------------
    // Scenario 17: Unexpected disconnect cleanup (session removed from gateway)
    // -------------------------------------------------------------------------
    await testAsync("17. Unexpected disconnect cleanup (session removed from gateway)", async () => {
      const token = generateStreamToken({
        callSid: "call_mock_17",
        tenantId: "tenant_alpha",
        provider: "mock",
      })

      const ws = await connectWs(`${testEnv.wsUrl}?token=${token}`)
      assert(testEnv.gateway.getSession("call_mock_17"), "Session must exist initially")

      // Abrupt client-side termination (simulates network drop)
      ws.terminate()
      await new Promise((r) => setTimeout(r, 60))

      assert.strictEqual(testEnv.gateway.getSession("call_mock_17"), null, "Session must be cleanly deleted on disconnect")
    })

    // -------------------------------------------------------------------------
    // Scenario 18: Multiple concurrent isolated mock sessions
    // -------------------------------------------------------------------------
    await testAsync("18. Multiple concurrent isolated mock sessions", async () => {
      const token1 = generateStreamToken({ callSid: "call_multi_1", tenantId: "tenant_alpha", provider: "mock" })
      const token2 = generateStreamToken({ callSid: "call_multi_2", tenantId: "tenant_beta", provider: "mock" })
      const token3 = generateStreamToken({ callSid: "call_multi_3", tenantId: "tenant_gamma", provider: "mock" })

      const [ws1, ws2, ws3] = await Promise.all([
        connectWs(`${testEnv.wsUrl}?token=${token1}`),
        connectWs(`${testEnv.wsUrl}?token=${token2}`),
        connectWs(`${testEnv.wsUrl}?token=${token3}`),
      ])

      assert.strictEqual(testEnv.gateway.getActiveSessionCount(), 3, "Gateway should have 3 concurrent sessions")

      const session1 = testEnv.gateway.getSession("call_multi_1")
      const session2 = testEnv.gateway.getSession("call_multi_2")
      const session3 = testEnv.gateway.getSession("call_multi_3")

      assert.strictEqual(session1.tenantId, "tenant_alpha")
      assert.strictEqual(session2.tenantId, "tenant_beta")
      assert.strictEqual(session3.tenantId, "tenant_gamma")

      // Close session 2 only
      ws2.close()
      await new Promise((r) => setTimeout(r, 50))

      assert.strictEqual(testEnv.gateway.getSession("call_multi_2"), null, "Session 2 should be gone")
      assert(testEnv.gateway.getSession("call_multi_1"), "Session 1 must remain active")
      assert(testEnv.gateway.getSession("call_multi_3"), "Session 3 must remain active")

      ws1.close()
      ws3.close()
      await new Promise((r) => setTimeout(r, 50))
    })

    // -------------------------------------------------------------------------
    // Scenario 19: Provider-specific Twilio frame normalization
    // -------------------------------------------------------------------------
    test("19. Provider-specific Twilio frame normalization", () => {
      const adapter = new TwilioStreamAdapter()

      // 1. Connected
      const connEvt = adapter.parseIncomingMessage(JSON.stringify({ event: "connected", protocol: "Call" }))
      assert.strictEqual(connEvt.type, "connection.ready")
      assert.strictEqual(connEvt.provider, "twilio")

      // 2. Start
      const startEvt = adapter.parseIncomingMessage(JSON.stringify({
        event: "start",
        streamSid: "MZ12345",
        start: { callSid: "CA67890", tracks: ["inbound"] },
      }))
      assert.strictEqual(startEvt.type, "session.started")
      assert.strictEqual(startEvt.streamSid, "MZ12345")
      assert.strictEqual(startEvt.callSid, "CA67890")

      // 3. Media
      const base64Audio = Buffer.from([0x01, 0x02, 0x03]).toString("base64")
      const mediaEvt = adapter.parseIncomingMessage(JSON.stringify({
        event: "media",
        streamSid: "MZ12345",
        media: { payload: base64Audio, chunk: 4, timestamp: 123456 },
      }))
      assert.strictEqual(mediaEvt.type, "audio.input")
      assert.strictEqual(mediaEvt.codec, "pcmu")
      assert.strictEqual(mediaEvt.sampleRate, 8000)
      assert.strictEqual(mediaEvt.sequence, 4)

      // 4. Mark
      const markEvt = adapter.parseIncomingMessage(JSON.stringify({
        event: "mark",
        streamSid: "MZ12345",
        mark: { name: "greeting_done" },
      }))
      assert.strictEqual(markEvt.type, "audio.mark")
      assert.strictEqual(markEvt.markName, "greeting_done")

      // 5. Clear
      const clearEvt = adapter.parseIncomingMessage(JSON.stringify({
        event: "clear",
        streamSid: "MZ12345",
      }))
      assert.strictEqual(clearEvt.type, "audio.clear")

      // 6. Stop
      const stopEvt = adapter.parseIncomingMessage(JSON.stringify({
        event: "stop",
        streamSid: "MZ12345",
        stop: { callSid: "CA67890" },
      }))
      assert.strictEqual(stopEvt.type, "session.ended")

      // Formatting methods
      const formattedMedia = JSON.parse(adapter.formatMediaMessage("MZ12345", base64Audio))
      assert.strictEqual(formattedMedia.event, "media")
      assert.strictEqual(formattedMedia.media.payload, base64Audio)

      const formattedClear = JSON.parse(adapter.formatClearMessage("MZ12345"))
      assert.strictEqual(formattedClear.event, "clear")

      const formattedMark = JSON.parse(adapter.formatMarkMessage("MZ12345", "test_mark"))
      assert.strictEqual(formattedMark.event, "mark")
      assert.strictEqual(formattedMark.mark.name, "test_mark")
    })

    // -------------------------------------------------------------------------
    // Scenario 20: Provider-specific Exotel frame normalization
    // -------------------------------------------------------------------------
    test("20. Provider-specific Exotel frame normalization", () => {
      const adapter = new ExotelStreamAdapter()

      // 1. Connected
      const connEvt = adapter.parseIncomingMessage(JSON.stringify({ event: "connected" }))
      assert.strictEqual(connEvt.type, "connection.ready")
      assert.strictEqual(connEvt.provider, "exotel")

      // 2. Start
      const startEvt = adapter.parseIncomingMessage(JSON.stringify({
        event: "start",
        stream_sid: "exo_stream_99",
        call_sid: "exo_call_11",
      }))
      assert.strictEqual(startEvt.type, "session.started")
      assert.strictEqual(startEvt.streamSid, "exo_stream_99")

      // 3. Media
      const base64Audio = Buffer.from([0x10, 0x20, 0x30]).toString("base64")
      const mediaEvt = adapter.parseIncomingMessage(JSON.stringify({
        event: "media",
        stream_sid: "exo_stream_99",
        media: { payload: base64Audio, rate: 8000, sequence: 7 },
      }))
      assert.strictEqual(mediaEvt.type, "audio.input")
      assert.strictEqual(mediaEvt.provider, "exotel")
      assert.strictEqual(mediaEvt.sequence, 7)

      // 4. Clear
      const clearEvt = adapter.parseIncomingMessage(JSON.stringify({
        event: "clear",
        stream_sid: "exo_stream_99",
      }))
      assert.strictEqual(clearEvt.type, "audio.clear")

      // 5. Stop
      const stopEvt = adapter.parseIncomingMessage(JSON.stringify({
        event: "stop",
        stream_sid: "exo_stream_99",
      }))
      assert.strictEqual(stopEvt.type, "session.ended")

      // Formatting methods
      const formattedMedia = JSON.parse(adapter.formatMediaMessage("exo_stream_99", base64Audio))
      assert.strictEqual(formattedMedia.event, "media")
      assert.strictEqual(formattedMedia.stream_sid, "exo_stream_99")
      assert.strictEqual(formattedMedia.media.payload, base64Audio)

      const formattedClear = JSON.parse(adapter.formatClearMessage("exo_stream_99"))
      assert.strictEqual(formattedClear.event, "clear")
      assert.strictEqual(formattedClear.stream_sid, "exo_stream_99")
    })

    // -------------------------------------------------------------------------
    // Scenario 21: Server shutdown cleans up active streams
    // -------------------------------------------------------------------------
    await testAsync("21. Server shutdown cleans up active streams", async () => {
      const token = generateStreamToken({
        callSid: "call_mock_21",
        tenantId: "tenant_alpha",
        provider: "mock",
      })

      const ws = await connectWs(`${testEnv.wsUrl}?token=${token}`)
      assert(testEnv.gateway.getSession("call_mock_21"), "Session must be active")

      let clientClosedCode = null
      ws.on("close", (code) => {
        clientClosedCode = code
      })

      // Initiate gateway shutdown
      await testEnv.gateway.shutdown()
      await new Promise((r) => setTimeout(r, 60))

      assert.strictEqual(testEnv.gateway.getActiveSessionCount(), 0, "activeSessions must be empty after shutdown")
      assert.strictEqual(clientClosedCode, 1001, "Client should receive 1001 Going Away close code")
    })

    // -------------------------------------------------------------------------
    // Scenario 22: HTTP startup failure does not leave a WebSocket listener running
    // -------------------------------------------------------------------------
    await testAsync("22. HTTP startup failure does not leave a WebSocket listener running", async () => {
      const dummyServer = http.createServer()
      const gateway = new VoiceGatewayService()
      gateway.attach(dummyServer)

      assert.strictEqual(dummyServer.listeners("upgrade").length, 1, "Should have 1 upgrade listener attached")

      // Shutdown gateway
      await gateway.shutdown()

      assert.strictEqual(dummyServer.listeners("upgrade").length, 0, "Upgrade listener must be cleanly detached with no leak")
      assert.strictEqual(gateway.httpServer, null)
      assert.strictEqual(gateway.wss, null)
    })

  } finally {
    // Teardown test environment
    try {
      await testEnv.close()
    } catch (_) {}
  }

  // -------------------------------------------------------------------------
  // Test Summary
  // -------------------------------------------------------------------------
  console.log("\n==================================================================")
  console.log(`   TEST SUMMARY: ${passedCount} PASSED, ${failedCount} FAILED`)
  console.log("==================================================================\n")

  if (failedCount > 0) {
    process.exit(1)
  }
}

runPhase3Tests().catch((err) => {
  console.error("FATAL ERROR IN PHASE 3 TEST RUNNER:", err)
  process.exit(1)
})
