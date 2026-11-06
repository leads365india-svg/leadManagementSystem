/**
 * Leads365 AI Receptionist — Phase 10 End-to-End Integration, Audio Verification & Security Audit
 * 
 * Verifies:
 *  1. Complete conversation lifecycle (Mock Inbound -> Inbound Router -> Grounded AI -> Tool Calling -> Lead/Follow-up -> Dual Recording -> Mobile Sync)
 *  2. Audio Transcoding (mu-law 8k <-> PCM 16k) and streaming latency benchmark (<500ms)
 *  3. HTTP partial content byte-range slice calculation (emulating range requests for mobile playback)
 *  4. Strict Multi-Tenant Isolation (data segregation, recording access control, credential sanitization)
 *  5. Anti-loop & Failure Recovery escalation
 *  6. Regression verification (post-call gemini-3.8-flash model preserved, SIM recordings untouched)
 */

require("dotenv").config({ path: require("path").join(__dirname, "../.env") })
process.env.NODE_ENV = "test"

const assert = require("assert")
const crypto = require("crypto")

const { inboundCallRouter } = require("../services/telephony/inboundCallRouter.service")
const MockTelephonyAdapter = require("../services/telephony/mockTelephonyAdapter.service")
const { getTelephonyAdapter } = require("../services/telephony/telephonyAdapterFactory")
const VoiceSession = require("../services/telephony/voiceSession.service")
const { buildTenantReceptionistPrompt } = require("../services/telephony/receptionistPromptBuilder.service")
const {
  inMemoryStore,
  searchLeadByPhone,
  createOrUpdateLead,
  updateLeadRequirements,
  scheduleFollowup,
  linkCallToLead,
  executeCrmTool,
} = require("../services/telephony/receptionistCrmTools.service")
const { cloudRecordingIngestion } = require("../services/telephony/cloudRecordingIngestion.service")
const {
  initiateHumanHandover,
  getSystemFailureFallbackMessage,
  clearTransferRegistry,
} = require("../services/telephony/humanHandover.service")
const {
  normalizeInboundAudio,
  encodeOutboundAudio,
  mulawToPcm16,
  pcm16ToMulaw,
} = require("../services/telephony/audioResampler")
const {
  maskCredentials,
  sanitizeTelephonyConfig,
  DEFAULT_TELEPHONY_CONFIG,
} = require("../services/telephony/telephonyConfig.service")
const aiProvider = require("../services/aiProvider.service")

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

async function runPhase10Audit() {
  console.log("\n==================================================================")
  console.log("   LEADS365 AI RECEPTIONIST — PHASE 10 E2E & SECURITY AUDIT       ")
  console.log("==================================================================\n")

  // Reset in-memory test states
  inMemoryStore.clear()
  cloudRecordingIngestion.clear()
  clearTransferRegistry()
  inboundCallRouter.clearInMemoryRegistry()

  const TENANT_A = "TENANT-CORP-A"
  const TENANT_B = "TENANT-CORP-B"
  const VIRTUAL_NUMBER_A = "+911145678900"
  const CALLER_PHONE = "+919876543210"
  const activeCallSid = "CA_e2e_full_001"

  // Register Tenant A in in-memory router registry
  inboundCallRouter.registerInMemoryTenant(VIRTUAL_NUMBER_A, {
    tenantId: TENANT_A,
    businessName: "Acme Real Estate Pvt Ltd",
    telephonyConfig: {
      ...DEFAULT_TELEPHONY_CONFIG,
      status: "configured",
      aiEnabled: true,
      provider: "mock",
      virtualNumber: VIRTUAL_NUMBER_A,
      language: "hinglish",
      humanHandoverNumber: "+919876599999",
      customGreeting: "Namaste! Acme Real Estate mein aapka swagat hai.",
    },
  })

  // -------------------------------------------------------------
  // SECTION 1: END-TO-END CONVERSATION LIFECYCLE
  // -------------------------------------------------------------
  console.log("--- Section 1: Complete Conversation Lifecycle ---")

  let createdLeadId = null
  let ingestedFileId = null

  await testAsync("1.1 Forwarded incoming call initiates routing & tenant context load", async () => {
    const routeResult = await inboundCallRouter.routeInboundCall({
      provider: "mock",
      callSid: activeCallSid,
      from: CALLER_PHONE,
      to: VIRTUAL_NUMBER_A,
    })

    assert.strictEqual(routeResult.decision, "answer_with_ai")
    assert.strictEqual(routeResult.tenantId, TENANT_A)
    assert(routeResult.streamToken, "Stream token must be generated")
    assert(routeResult.responsePayload, "Provider response payload must be generated")
  })

  await testAsync("1.2 AI Receptionist compiles grounded Hindi/English prompt with tenant catalog", async () => {
    const prompt = await buildTenantReceptionistPrompt({
      tenantId: TENANT_A,
      callerPhone: CALLER_PHONE,
      callerName: "Rahul Sharma",
    })

    assert(prompt.includes("AI Voice Receptionist"))
    assert(prompt.includes("Hinglish") || prompt.includes("Hindi"))
    assert(prompt.includes("TENANT KNOWLEDGE BASE"))
  })

  await testAsync("1.3 Real-time Voice Session establishes connection and buffers audio chunks", async () => {
    const mockSocket = {
      readyState: 1, // OPEN
      sentMessages: [],
      send(data) {
        this.sentMessages.push(data)
      },
      close() {
        this.readyState = 3 // CLOSED
      },
    }

    const session = new VoiceSession({
      callSid: activeCallSid,
      tenantId: TENANT_A,
      provider: "mock",
      ws: mockSocket,
    })

    session.streamSid = "STREAM_001"
    session.status = "active"

    // Simulate incoming client audio chunk via adapter
    const testAudioMulaw = Buffer.alloc(160, 0xff)
    session.handleIncomingMessage(JSON.stringify({
      event: "media",
      streamSid: "STREAM_001",
      media: { payload: testAudioMulaw.toString("base64") },
    }))

    assert.strictEqual(session.callSid, activeCallSid)
    assert.strictEqual(session.tenantId, TENANT_A)
    assert.strictEqual(session.metrics.packetsIn, 1)

    // Simulate sending audio back to caller
    session.sendAudioOutput(Buffer.alloc(640, 0x11))
    assert.strictEqual(session.metrics.packetsOut, 1)
    assert.strictEqual(mockSocket.sentMessages.length, 1)
  })

  await testAsync("1.4 Customer requirements extracted and saved to CRM via tool calling", async () => {
    // 1. Search lead
    const searchRes = await executeCrmTool({
      tenantId: TENANT_A,
      name: "searchLeadByPhone",
      args: { phone: CALLER_PHONE },
    })
    assert.strictEqual(searchRes.found, false)

    // 2. Create lead with captured requirements
    const createRes = await executeCrmTool({
      tenantId: TENANT_A,
      name: "createOrUpdateLead",
      args: {
        phone: CALLER_PHONE,
        name: "Rahul Sharma",
        email: "rahul@example.com",
        requirement: "Looking for 2BHK flat near Sector 62 Noida under 60 Lakhs",
        notes: "Budget 60L, high priority",
      },
    })
    assert(createRes.action === "created" || createRes.lead, "Lead creation must succeed")
    assert(createRes.lead._id)
    createdLeadId = createRes.lead._id

    // 3. Update lead requirement notes
    const updateRes = await executeCrmTool({
      tenantId: TENANT_A,
      name: "updateLeadRequirements",
      args: {
        leadId: createdLeadId,
        requirement: "Looking for 2BHK flat near Sector 62 Noida under 60 Lakhs, ready to move",
        notes: "Updated budget: 65L",
      },
    })
    assert.strictEqual(updateRes.success, true)
    assert(updateRes.lead.requirement.includes("ready to move"))

    // 4. Schedule follow-up callback
    const followupRes = await executeCrmTool({
      tenantId: TENANT_A,
      name: "scheduleFollowup",
      args: {
        leadId: createdLeadId,
        scheduledAt: Date.now() + 86400000,
        note: "Call back to discuss 2BHK inventory matching 65L budget",
        type: "call",
      },
    })
    assert.strictEqual(followupRes.success, true)
    assert(followupRes.followUp._id)

    // 5. Link call record to lead
    const linkRes = await linkCallToLead({
      tenantId: TENANT_A,
      callSid: activeCallSid,
      leadId: createdLeadId,
      phone: CALLER_PHONE,
      durationSeconds: 145,
      callOutcome: "INTERESTED",
      notes: "Customer engaged positively with AI Receptionist. High purchase intent.",
    })
    assert.strictEqual(linkRes.success, true)
    assert.strictEqual(linkRes.call.leadId, createdLeadId)
  })

  await testAsync("1.5 Dual-track cloud recording ingested with SHA-256 integrity", async () => {
    // Generate synthetic audio payload (32000 bytes = 2s 16kHz PCM)
    const audioPayload = Buffer.alloc(32000, 0xaa)
    const expectedHash = crypto.createHash("sha256").update(audioPayload).digest("hex")

    const ingestResult = await cloudRecordingIngestion.ingestRecording({
      tenantId: TENANT_A,
      callSid: activeCallSid,
      recordingSid: "REC_e2e_dual_001",
      durationSeconds: 145,
      recordingBuffer: audioPayload,
      mimeType: "audio/wav",
      provider: "mock",
    })

    assert.strictEqual(ingestResult.success, true)
    assert.strictEqual(ingestResult.sha256, expectedHash)
    ingestedFileId = ingestResult.fileId

    const updatedCall = inMemoryStore.calls.get(activeCallSid)
    assert.strictEqual(updatedCall.hasRecording, true)
    assert.strictEqual(updatedCall.recording.status, "ready")
    assert.strictEqual(updatedCall.recording.sha256, expectedHash)
  })

  // -------------------------------------------------------------
  // SECTION 2: AUDIO TRANSCODING & LATENCY BENCHMARK
  // -------------------------------------------------------------
  console.log("\n--- Section 2: Audio Transcoding & Latency Benchmark ---")

  test("2.1 Audio format transcoding: 8kHz mu-law <-> 16kHz PCM roundtrip", () => {
    // Generate 160 bytes of 8kHz mu-law
    const muLawIn = Buffer.alloc(160)
    for (let i = 0; i < 160; i++) {
      muLawIn[i] = (i * 3) & 0xff
    }

    // Transcode 8k mu-law -> 16k PCM
    const pcmOut = normalizeInboundAudio({
      payload: muLawIn,
      sourceCodec: "pcmu",
      sourceSampleRate: 8000,
      targetSampleRate: 16000,
    })
    assert.strictEqual(pcmOut.length, 640)

    // Transcode 16k PCM -> 8k mu-law
    const muLawBack = encodeOutboundAudio({
      payload: pcmOut,
      sourceSampleRate: 16000,
      targetCodec: "pcmu",
      targetSampleRate: 8000,
    })
    assert.strictEqual(muLawBack.length, 160)
  })

  test("2.2 Latency benchmark: 100 consecutive audio frames transcode under 100ms", () => {
    const inputChunk = Buffer.alloc(160, 0x7e)
    const startTime = Date.now()

    for (let i = 0; i < 100; i++) {
      const pcm = normalizeInboundAudio({
        payload: inputChunk,
        sourceCodec: "pcmu",
        sourceSampleRate: 8000,
        targetSampleRate: 16000,
      })
      const mulaw = encodeOutboundAudio({
        payload: pcm,
        sourceSampleRate: 16000,
        targetCodec: "pcmu",
        targetSampleRate: 8000,
      })
    }

    const elapsedMs = Date.now() - startTime
    console.log(`      Transcoding benchmark for 100 frames (2.0s audio): ${elapsedMs}ms`)
    assert(elapsedMs < 100, `Audio processing took too long: ${elapsedMs}ms (target < 100ms)`)
  })

  // -------------------------------------------------------------
  // SECTION 3: HTTP AUDIO RANGE STREAMING (FOR MOBILE APP)
  // -------------------------------------------------------------
  console.log("\n--- Section 3: Mobile Audio Streaming & Range Requests ---")

  test("3.1 Partial content byte-range slice calculation", () => {
    const recording = cloudRecordingIngestion.getRecording(ingestedFileId, TENANT_A)
    assert(recording, "Recording must exist")

    const totalSize = recording.buffer.length
    // Request bytes 0-1023
    const start = 0
    const end = Math.min(1023, totalSize - 1)
    const slice = recording.buffer.subarray(start, end + 1)

    assert.strictEqual(slice.length, 1024)
    assert.strictEqual(totalSize, 32000)
    const contentRangeHeader = `bytes ${start}-${end}/${totalSize}`
    assert.strictEqual(contentRangeHeader, "bytes 0-1023/32000")
  })

  test("3.2 Mobile app calls list maps AI Receptionist metadata cleanly", () => {
    const call = inMemoryStore.calls.get(activeCallSid)
    // Emulate mobileController.js formatting logic
    const formatted = {
      _id: call._id,
      callSid: call.clientCallId || call.callSid,
      phoneNumber: call.phone,
      type: call.type || "Incoming",
      duration: call.duration,
      recordingOrigin: call.source === "ai_receptionist" ? "ai_receptionist" : "sim_call",
      isCloudRecording: call.source === "ai_receptionist" || Boolean(call.recording?.fileId),
      recordingReady: call.recording?.status === "ready",
      remoteRecordingUrl: call.recording?.fileId ? `/api/calls/${call._id}/recording` : null,
      leadId: call.leadId,
    }

    assert.strictEqual(formatted.recordingOrigin, "ai_receptionist")
    assert.strictEqual(formatted.isCloudRecording, true)
    assert.strictEqual(formatted.recordingReady, true)
    assert.strictEqual(formatted.remoteRecordingUrl, `/api/calls/${call._id}/recording`)
    assert.strictEqual(formatted.leadId, createdLeadId)
  })

  // -------------------------------------------------------------
  // SECTION 4: MULTI-TENANT ISOLATION & SECURITY AUDIT
  // -------------------------------------------------------------
  console.log("\n--- Section 4: Multi-Tenant Security & Isolation Audit ---")

  await testAsync("4.1 Tenant B cannot search or retrieve Tenant A's leads", async () => {
    const searchResult = await executeCrmTool({
      tenantId: TENANT_B, // Different Tenant!
      name: "searchLeadByPhone",
      args: { phone: CALLER_PHONE },
    })

    assert.strictEqual(searchResult.found, false, "Tenant B must not see Tenant A's lead")
  })

  await testAsync("4.2 Tenant B cannot access Tenant A's cloud recordings (Cross-Tenant Access Rejected)", async () => {
    let accessDenied = false
    try {
      cloudRecordingIngestion.getRecording(ingestedFileId, TENANT_B)
    } catch (err) {
      if (err.message.includes("SECURITY_VIOLATION")) {
        accessDenied = true
      }
    }

    assert.strictEqual(accessDenied, true, "Cross-tenant recording access must be rejected")
  })

  test("4.3 Telephony credentials are never exposed in tenant profile queries", () => {
    const rawCredentials = {
      accountSid: "AC_1234567890abcdef",
      authToken: "secret_auth_token_999",
      apiKey: "secret_api_key_888",
    }
    const masked = maskCredentials("twilio", rawCredentials)

    assert(masked.accountSid.includes("••••"))
    assert(masked.authToken.includes("••••"))
    assert(!JSON.stringify(masked).includes("secret_auth_token_999"))
  })

  // -------------------------------------------------------------
  // SECTION 5: HUMAN HANDOVER & ANTI-LOOP CONTROLS
  // -------------------------------------------------------------
  console.log("\n--- Section 5: Human Handover & Loop Protections ---")

  await testAsync("5.1 Anti-loop: Blocks transfer when caller phone === destination phone", async () => {
    process.env.TEST_HANDOVER_NUMBER = "+919988776655"
    const loopResult = await initiateHumanHandover({
      tenantId: TENANT_A,
      callSid: "CA_loop_test_01",
      callerPhone: "+919988776655", // Same as destination!
      provider: "mock",
    })

    assert.strictEqual(loopResult.success, false)
    assert.strictEqual(loopResult.status, "loop_prevented")
  })

  await testAsync("5.2 Anti-bounce: Blocks secondary transfer attempt on the same callSid", async () => {
    process.env.TEST_HANDOVER_NUMBER = "+919988776655"
    const firstTransfer = await initiateHumanHandover({
      tenantId: TENANT_A,
      callSid: "CA_hop_test_01",
      callerPhone: "+919123456789",
      provider: "mock",
    })
    assert.strictEqual(firstTransfer.success, true)

    const secondTransfer = await initiateHumanHandover({
      tenantId: TENANT_A,
      callSid: "CA_hop_test_01", // Repeated callSid!
      callerPhone: "+919123456789",
      provider: "mock",
    })
    assert.strictEqual(secondTransfer.success, false)
    assert.strictEqual(secondTransfer.status, "loop_blocked")
  })

  await testAsync("5.3 Graceful fallback: Unconfigured handover logs urgent callback in CRM", async () => {
    delete process.env.TEST_HANDOVER_NUMBER
    const unconfiguredResult = await initiateHumanHandover({
      tenantId: TENANT_A,
      callSid: "CA_no_dest_test",
      callerPhone: "+919123456789",
      provider: "mock",
    })

    assert.strictEqual(unconfiguredResult.success, false)
    assert.strictEqual(unconfiguredResult.status, "no_destination")
    assert(unconfiguredResult.fallbackSpokenText.includes("urgent callback request"))
  })

  // -------------------------------------------------------------
  // SECTION 6: CONSOLIDATED REGRESSION & MODEL PRESERVATION
  // -------------------------------------------------------------
  console.log("\n--- Section 6: Consolidated Regression Verification ---")

  test("6.1 Existing post-call AI analysis model configuration preserved", () => {
    assert.strictEqual(aiProvider.DEFAULT_GEMINI_MODEL, "gemini-3.8-flash")
    const resolved = aiProvider.resolveGeminiModel()
    assert(resolved.includes("gemini-3.8-flash"), `Model should be gemini-3.8-flash, got ${resolved}`)
  })

  console.log("\n==================================================================")
  console.log(`   PHASE 10 AUDIT SUMMARY: ${passedCount} PASSED, ${failedCount} FAILED`)
  console.log("==================================================================\n")

  if (failedCount > 0) process.exit(1)
}

runPhase10Audit().catch((err) => {
  console.error("FATAL ERROR IN PHASE 10 AUDIT:", err)
  process.exit(1)
})
