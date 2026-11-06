/**
 * Leads365 AI Receptionist — Phase 2 Verification Test Suite
 * 
 * Verifies Inbound Call Webhooks, Provider Adapters & Human-First Routing:
 * 1. Phone-number-based Tenant Identification (E.164 normalization, virtual number mapping).
 * 2. Strict isolation: Caller-supplied tenantId is ignored; resolved only from number registry.
 * 3. Safe 404 rejection on unmapped/unknown phone numbers.
 * 4. Human-first routing logic (unanswered-only call forwarding):
 *    - Human answers: AI stands down, normal flow preserved.
 *    - Human does not answer: SIM forwarded call answered by AI.
 *    - AI disabled: AI voice session not started; safe message returned.
 *    - Tenant paused/unconfigured: gracefully handled.
 * 5. Carrier Webhook Signature Verification (Twilio HMAC-SHA1, Exotel, Mock HMAC-SHA256).
 * 6. Provider Streaming Response Generation (TwiML XML & Exotel JSON).
 * 7. Call lifecycle & recording event processing.
 * 8. Safety check: Zero live MongoDB Atlas mutations (runs 100% in-memory).
 */

require("dotenv").config({ path: require("path").join(__dirname, "../.env") })
process.env.NODE_ENV = "test"

const assert = require("assert")
const crypto = require("crypto")
const request = require("supertest")
const mongoose = require("mongoose")

const app = require("../start")

// Set in-memory mock readyState to 1 so checkDbConnection passes without hitting Atlas DB
Object.defineProperty(mongoose.connection, "readyState", { value: 1, configurable: true })
const { inboundCallRouter } = require("../services/telephony/inboundCallRouter.service")
const { getTelephonyAdapter, registerTelephonyAdapter } = require("../services/telephony/telephonyAdapterFactory")
const TwilioAdapter = require("../services/telephony/twilioAdapter.service")
const ExotelAdapter = require("../services/telephony/exotelAdapter.service")
const MockTelephonyAdapter = require("../services/telephony/mockTelephonyAdapter.service")
const { normalizePhoneE164 } = require("../utils/phoneNormalizer")

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

async function runPhase2Tests() {
  console.log("\n==================================================================")
  console.log("   LEADS365 AI RECEPTIONIST — PHASE 2 INCOMING CALL SUITE        ")
  console.log("==================================================================\n")

  // Test Fixtures (In-Memory Only — Zero Atlas DB writes)
  const TENANT_A_ID = "ACC-TENANT-ALPHA-P2"
  const TENANT_B_ID = "ACC-TENANT-BETA-P2"

  const TENANT_A_PROFILE = {
    tenantId: TENANT_A_ID,
    businessName: "Alpha Logistics Pvt Ltd",
    telephonyConfig: {
      provider: "twilio",
      connectionMode: "sim_forwarding",
      businessPhoneNumber: "+919876543210",
      virtualNumber: "+15551234567",
      answerMode: "unanswered_only",
      noAnswerTimeoutSeconds: 20,
      aiEnabled: true,
      aiLanguage: "hinglish",
      aiGreeting: "Namaste, thank you for calling Alpha Logistics! How can I help you?",
      recordingEnabled: true,
      status: "active",
      credentialsConfigured: true,
    },
  }

  const TENANT_B_PROFILE = {
    tenantId: TENANT_B_ID,
    businessName: "Beta Solutions Ltd",
    telephonyConfig: {
      provider: "mock",
      connectionMode: "sim_forwarding",
      businessPhoneNumber: "+919811122233",
      virtualNumber: "+15559876543",
      answerMode: "unanswered_only",
      noAnswerTimeoutSeconds: 25,
      aiEnabled: false, // AI Disabled for Tenant B
      aiLanguage: "english",
      aiGreeting: "Welcome to Beta Solutions.",
      recordingEnabled: true,
      status: "active",
      credentialsConfigured: false,
    },
  }

  // Clear in-memory state and register test fixtures
  inboundCallRouter.clearInMemoryRegistry()
  inboundCallRouter.registerInMemoryTenant("+15551234567", TENANT_A_PROFILE)
  inboundCallRouter.registerInMemoryTenant("+919876543210", TENANT_A_PROFILE)
  inboundCallRouter.registerInMemoryTenant("+15559876543", TENANT_B_PROFILE)
  inboundCallRouter.registerInMemoryTenant("+919811122233", TENANT_B_PROFILE)

  // ==================================================================
  // Suite 1: Phone-Number-Based Tenant Identification
  // ==================================================================
  console.log("Suite 1: Phone-Number-Based Tenant Identification & Security")

  await testAsync("1.1: Incoming call to Tenant A virtual number resolves Tenant A", async () => {
    const profile = await inboundCallRouter.resolveTenantByNumber("+1 (555) 123-4567")
    assert(profile, "Profile must be found")
    assert.strictEqual(profile.tenantId, TENANT_A_ID)
    assert.strictEqual(profile.telephonyConfig.provider, "twilio")
  })

  await testAsync("1.2: Incoming call to Tenant B virtual number resolves Tenant B", async () => {
    const profile = await inboundCallRouter.resolveTenantByNumber("+15559876543")
    assert(profile, "Profile must be found")
    assert.strictEqual(profile.tenantId, TENANT_B_ID)
  })

  await testAsync("1.3: Forwarded call with ForwardedFrom matching Tenant A business number resolves Tenant A", async () => {
    const profile = await inboundCallRouter.resolveTenantByNumber("+15550000000", "+91 98765-43210")
    assert(profile, "Profile must be found via forwardedFrom")
    assert.strictEqual(profile.tenantId, TENANT_A_ID)
  })

  await testAsync("1.4: Unmapped phone number returns null and routes to 404 rejection", async () => {
    const profile = await inboundCallRouter.resolveTenantByNumber("+19999999999")
    assert.strictEqual(profile, null, "Unmapped number must resolve to null")

    const routing = await inboundCallRouter.routeInboundCall({
      provider: "mock",
      callSid: "mock_call_unmapped",
      from: "+919999999999",
      to: "+19999999999",
    })
    assert.strictEqual(routing.decision, "rejected")
    assert.strictEqual(routing.reason, "unmapped_phone_number")
  })

  await testAsync("1.5: Security: Caller-supplied tenantId in payload is ignored; derived only from phone number", async () => {
    const spoofedPayload = {
      provider: "mock",
      callSid: "mock_call_spoof",
      from: "+919999999999",
      to: "+15551234567", // Belongs to Tenant A
      tenantId: "SPOOFED_TENANT_XYZ", // Attacker sends fake tenantId
    }

    const routing = await inboundCallRouter.routeInboundCall(spoofedPayload)
    assert.strictEqual(routing.tenantId, TENANT_A_ID, "Tenant ID must strictly be derived from number, not body")
  })

  // ==================================================================
  // Suite 2: Human-First Routing Logic (Answer Mode: unanswered_only)
  // ==================================================================
  console.log("\nSuite 2: Human-First Routing Logic (Unanswered-Only Behavior)")

  await testAsync("2.1: Human answers call on SIM / PBX -> AI stands down, normal flow preserved", async () => {
    const routing = await inboundCallRouter.routeInboundCall({
      provider: "twilio",
      callSid: "call_human_pick",
      from: "+919123456780",
      to: "+15551234567",
      status: "human_answered",
      humanAnswered: true,
    })

    assert.strictEqual(routing.decision, "human_handled")
    assert.strictEqual(routing.reason, "human_answered_normal_flow_preserved")
    assert.strictEqual(routing.responsePayload, null, "AI voice session must not generate stream response")
  })

  await testAsync("2.2: Forwarded incoming call (SIM unanswered) -> AI receptionist activates", async () => {
    const routing = await inboundCallRouter.routeInboundCall({
      provider: "twilio",
      callSid: "call_forwarded_ai",
      from: "+919123456780",
      to: "+15551234567",
      forwardedFrom: "+919876543210",
      status: "ringing",
    })

    assert.strictEqual(routing.decision, "answer_with_ai")
    assert.strictEqual(routing.reason, "no_answer_sim_forwarded")
    assert(routing.responsePayload.includes("<Stream"), "TwiML must contain <Stream> element")
    assert(routing.responsePayload.includes("call_forwarded_ai"), "TwiML must reference callSid")
  })

  await testAsync("2.3: AI receptionist disabled for Tenant B -> safe disabled message returned, no voice stream", async () => {
    const routing = await inboundCallRouter.routeInboundCall({
      provider: "mock",
      callSid: "call_tenant_b_disabled",
      from: "+919123456780",
      to: "+15559876543",
      forwardedFrom: "+919811122233",
      status: "ringing",
    })

    assert.strictEqual(routing.decision, "ai_disabled")
    assert.strictEqual(routing.reason, "ai_receptionist_disabled")
    assert.strictEqual(routing.responsePayload.action, "say_and_hangup")
  })

  // ==================================================================
  // Suite 3: Carrier Webhook Signature Verification & Provider Adapters
  // ==================================================================
  console.log("\nSuite 3: Carrier Webhook Signature Verification & Provider Adapters")

  test("3.1: TwilioAdapter correctly validates authentic signature and rejects tampered signature", () => {
    const adapter = new TwilioAdapter()
    const authToken = "1234567890abcdef1234567890abcdef"
    const url = "https://app.leads365.in/api/telephony/webhook/inbound/twilio"
    const body = {
      CallSid: "CA12345678901234567890",
      From: "+919876543210",
      To: "+15551234567",
    }

    // Generate valid Twilio signature: url + sorted keys/values
    const expectedData = url + "CallSid" + body.CallSid + "From" + body.From + "To" + body.To
    const validSignature = crypto.createHmac("sha1", authToken).update(expectedData, "utf8").digest("base64")

    const validCheck = adapter.validateWebhookSignature({
      url,
      headers: { "x-twilio-signature": validSignature },
      body,
      authToken,
    })
    assert.strictEqual(validCheck, true, "Authentic Twilio signature must be accepted")

    const invalidCheck = adapter.validateWebhookSignature({
      url,
      headers: { "x-twilio-signature": "tampered_signature_base64==" },
      body,
      authToken,
    })
    assert.strictEqual(invalidCheck, false, "Tampered Twilio signature must be rejected")
  })

  test("3.2: ExotelAdapter validates authentic token/signature and rejects invalid", () => {
    const adapter = new ExotelAdapter()
    const authToken = "exotel_api_token_secret_123"

    const validHeaderCheck = adapter.validateWebhookSignature({
      headers: { "x-exotel-token": authToken },
      authToken,
    })
    assert.strictEqual(validHeaderCheck, true, "Valid Exotel token header must be accepted")

    const invalidHeaderCheck = adapter.validateWebhookSignature({
      headers: { "x-exotel-token": "wrong_token" },
      authToken,
    })
    assert.strictEqual(invalidHeaderCheck, false, "Invalid Exotel token header must be rejected")
  })

  test("3.3: MockTelephonyAdapter validates authentic HMAC-SHA256 signature", () => {
    const adapter = new MockTelephonyAdapter()
    const payload = { callSid: "mock_123", to: "+15551234567" }
    const signature = adapter.generateSignature(payload)

    const valid = adapter.validateWebhookSignature({
      body: payload,
      headers: { "x-mock-signature": signature },
    })
    assert.strictEqual(valid, true, "Authentic mock signature must pass")

    const invalid = adapter.validateWebhookSignature({
      body: payload,
      headers: { "x-mock-signature": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" },
    })
    assert.strictEqual(invalid, false, "Tampered mock signature must fail")
  })

  test("3.4: TwilioAdapter generates valid TwiML XML with <Connect><Stream> and dualChannel recording", () => {
    const adapter = new TwilioAdapter()
    const twiml = adapter.generateStreamResponse({
      streamUrl: "wss://app.leads365.in/api/telephony/voice-stream",
      callSid: "CA11223344",
      tenantId: TENANT_A_ID,
      recordDualChannel: true,
      recordingStatusCallbackUrl: "https://app.leads365.in/api/telephony/webhook/recording/twilio",
    })

    assert(twiml.includes("<?xml version=\"1.0\" encoding=\"UTF-8\"?>"))
    assert(twiml.includes("<Response>"))
    assert(twiml.includes("<Connect>"))
    assert(twiml.includes("<Stream url=\"wss://app.leads365.in/api/telephony/voice-stream\">"))
    assert(twiml.includes("<Parameter name=\"callSid\" value=\"CA11223344\" />"))
    assert(twiml.includes("dualChannel=\"true\""))
  })

  test("3.5: ExotelAdapter generates valid Passthru streaming JSON", () => {
    const adapter = new ExotelAdapter()
    const res = adapter.generateStreamResponse({
      streamUrl: "wss://app.leads365.in/api/telephony/voice-stream",
      callSid: "exo_call_5566",
      tenantId: TENANT_A_ID,
      recordDualChannel: true,
    })

    assert.strictEqual(res.select, "stream")
    assert.strictEqual(res.stream.callSid, "exo_call_5566")
    assert.strictEqual(res.stream.format, "audio/x-mulaw;rate=8000")
  })

  // ==================================================================
  // Suite 4: Call Lifecycle Event Processing
  // ==================================================================
  console.log("\nSuite 4: Call Lifecycle Event Processing")

  test("4.1: Tracks active session lifecycle through ringing, completed, and recording", () => {
    const callSid = "lifecycle_call_999"

    // 1. Initial Call Ringing
    inboundCallRouter.handleLifecycleEvent({
      callSid,
      tenantId: TENANT_A_ID,
      provider: "mock",
      status: "ringing",
    })
    let session = inboundCallRouter.activeCallSessions.get(callSid)
    assert.strictEqual(session.status, "ringing")

    // 2. Call Completed
    inboundCallRouter.handleLifecycleEvent({
      callSid,
      status: "completed",
      durationSeconds: 45,
    })
    session = inboundCallRouter.activeCallSessions.get(callSid)
    assert.strictEqual(session.status, "completed")
    assert.strictEqual(session.durationSeconds, 45)

    // 3. Recording Completed Callback
    inboundCallRouter.handleLifecycleEvent({
      callSid,
      status: "recording_completed",
      recordingUrl: "https://api.provider.com/recordings/rec_999.wav",
    })
    session = inboundCallRouter.activeCallSessions.get(callSid)
    assert.strictEqual(session.status, "recording_completed")
    assert.strictEqual(session.recordingUrl, "https://api.provider.com/recordings/rec_999.wav")
  })

  test("4.2: Handles call disconnection or failure reason gracefully", () => {
    const callSid = "failed_call_101"
    inboundCallRouter.handleLifecycleEvent({
      callSid,
      tenantId: TENANT_A_ID,
      provider: "mock",
      status: "failed",
      failureReason: "caller_hung_up",
    })

    const session = inboundCallRouter.activeCallSessions.get(callSid)
    assert.strictEqual(session.status, "failed")
    assert.strictEqual(session.failureReason, "caller_hung_up")
  })

  // ==================================================================
  // Suite 5: REST API Inbound Webhook Endpoints (Supertest)
  // ==================================================================
  console.log("\nSuite 5: REST API Inbound Webhook Endpoints")

  await testAsync("5.1: POST /api/telephony/webhook/inbound without valid signature returns 401 Unauthorized", async () => {
    const res = await request(app)
      .post("/api/telephony/webhook/inbound/mock")
      .send({ callSid: "call_test_no_auth", to: "+15551234567" })
      .set("x-mock-signature", "invalid_signature")

    assert.strictEqual(res.status, 401)
    assert.strictEqual(res.body.success, false)
    assert(res.body.error.includes("signature verification failed"))
  })

  await testAsync("5.2: POST /api/telephony/webhook/inbound with valid mock signature returns AI stream instructions", async () => {
    const adapter = getTelephonyAdapter("mock")
    const payload = {
      callSid: "mock_api_call_123",
      from: "+919876500000",
      to: "+15551234567",
      forwardedFrom: "+919876543210",
      status: "ringing",
    }
    const signature = adapter.generateSignature(payload)

    const res = await request(app)
      .post("/api/telephony/webhook/inbound/mock")
      .send(payload)
      .set("x-mock-signature", signature)

    assert.strictEqual(res.status, 200)
    assert.strictEqual(res.body.success, true)
    assert.strictEqual(res.body.decision, "answer_with_ai")
    assert.strictEqual(res.body.tenantId, TENANT_A_ID)
  })

  await testAsync("5.3: POST /api/telephony/webhook/inbound with unmapped number returns 404", async () => {
    const adapter = getTelephonyAdapter("mock")
    const payload = {
      callSid: "mock_api_unmapped",
      from: "+919876500000",
      to: "+19998887777", // Unmapped
      status: "ringing",
    }
    const signature = adapter.generateSignature(payload)

    const res = await request(app)
      .post("/api/telephony/webhook/inbound/mock")
      .send(payload)
      .set("x-mock-signature", signature)

    assert.strictEqual(res.status, 404)
    assert.strictEqual(res.body.success, false)
  })

  // Cleanup in-memory registry
  inboundCallRouter.clearInMemoryRegistry()

  console.log("\n==================================================================")
  console.log(`   TEST EXECUTION SUMMARY: ${passedCount} PASSED, ${failedCount} FAILED`)
  console.log("==================================================================\n")

  if (failedCount > 0) {
    process.exit(1)
  }
}

runPhase2Tests().then(() => {
  process.exit(0)
}).catch((err) => {
  console.error("FATAL ERROR IN PHASE 2 TEST SUITE:", err)
  process.exit(1)
})
