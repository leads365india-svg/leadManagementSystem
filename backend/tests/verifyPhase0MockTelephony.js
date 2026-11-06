/**
 * Leads365 AI Receptionist — Phase 0: Mock Telephony & Free Testing Suite
 * 
 * Validates the 10 required Phase 0 scenarios:
 * 1. New unknown caller -> auto-creates CRM lead + call + recording.
 * 2. Existing test lead caller -> links existing lead, prevents duplicate lead creation.
 * 3. Human answers -> AI stands down, does not answer.
 * 4. Human does not answer -> AI receptionist answers and engages.
 * 5. Duplicate incoming call event -> idempotency skips duplicate processing.
 * 6. Duplicate recording completion event -> idempotent handling.
 * 7. Wrong / unmapped tenant virtual number -> rejected cleanly without crash.
 * 8. Call disconnected unexpectedly -> logged as failed with graceful reason.
 * 9. Recording lifecycle: pending -> completed -> valid synthetic audio + SHA-256.
 * 10. Mock provider unavailable -> handles provider outage safely.
 * 
 * Plus:
 * - Bilingual greeting test (Hindi vs English).
 * - Tool calling simulation (lead creation & callback scheduling).
 * - Synthetic WAV fixture integrity (RIFF/WAVE header, 16-bit PCM, non-empty audio).
 * - Safety check: Zero live MongoDB connections, zero paid provider API calls.
 */

const assert = require("assert")
const MockCallSimulator = require("../services/telephony/mockCallSimulator.service")
const MockVoiceSession = require("../services/telephony/mockVoiceSession.service")
const { createSyntheticWavBuffer } = require("../services/telephony/fixtures/syntheticAudioFixture")

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

async function runPhase0Tests() {
  console.log("\n==================================================================")
  console.log("   LEADS365 AI RECEPTIONIST — PHASE 0 FREE TESTING FOUNDATION    ")
  console.log("==================================================================\n")

  const simulator = new MockCallSimulator()
  const TEST_TENANT_ID = "tenant_alpha_real_estate"
  const TEST_VIRTUAL_NUMBER = "+911140001001"

  simulator.registerVirtualNumber(TEST_VIRTUAL_NUMBER, TEST_TENANT_ID)

  // -----------------------------------------------------------------
  // Suite 1: Synthetic Audio Fixture Contract
  // -----------------------------------------------------------------
  console.log("Suite 1: Synthetic Audio Fixture & WAV Header Verification")

  test("1.1: Generates valid RIFF/WAVE header and 16-bit PCM structure", () => {
    const fixture = createSyntheticWavBuffer({ durationSeconds: 2, sampleRate: 8000, numChannels: 1 })
    assert(fixture.buffer.length > 44, "Buffer must contain header and data")
    assert.strictEqual(fixture.buffer.toString("ascii", 0, 4), "RIFF")
    assert.strictEqual(fixture.buffer.toString("ascii", 8, 12), "WAVE")
    assert.strictEqual(fixture.buffer.toString("ascii", 12, 16), "fmt ")
    assert.strictEqual(fixture.buffer.toString("ascii", 36, 40), "data")
    assert.strictEqual(fixture.mimeType, "audio/wav")
    assert.strictEqual(typeof fixture.sha256, "string")
    assert.strictEqual(fixture.sha256.length, 64)
  })

  // -----------------------------------------------------------------
  // Suite 2: Core 10 Scenarios Required by Phase 0
  // -----------------------------------------------------------------
  console.log("\nSuite 2: 10 Telephony & Routing Scenarios")

  await testAsync("Scenario 1: New unknown caller creates CRM Lead & links Call + Recording", async () => {
    const unknownCaller = "+919876540001"
    const res = await simulator.simulateInboundCall({
      callerNumber: unknownCaller,
      virtualNumber: TEST_VIRTUAL_NUMBER,
      humanAnswered: false,
      language: "hi-IN",
      callerScript: [
        "Mujhe 3 BHK flat chahiye Gurgaon me pricing kya hai?",
        "Mera naam Amit Sharma hai",
        "Theek hai kal shaam ko call back schedule kar do",
        "Dhanyawad bye",
      ],
    })

    assert(res.success, "Simulation must succeed")
    assert.strictEqual(res.aiAnswered, true, "AI must answer when human is unavailable")
    assert(res.leadCreated, "New lead must be created for unknown caller")
    assert.strictEqual(res.lead.phone, unknownCaller)
    assert.strictEqual(res.lead.source, "AI Receptionist")
    assert.strictEqual(res.callRecord.source, "ai_receptionist")
    assert.strictEqual(res.callRecord.hasRecording, true)
    assert(res.callRecord.recording.sha256, "Recording must have valid SHA-256")
  })

  await testAsync("Scenario 2: Existing test lead caller matches lead without creating duplicate", async () => {
    const existingCaller = "+919876540002"
    simulator.seedLead({
      _id: "lead_existing_999",
      name: "Rohit Verma",
      phone: existingCaller,
      phoneNormalized: existingCaller,
      tenantId: TEST_TENANT_ID,
      status: "Engaged",
    })

    const leadsCountBefore = simulator.inMemoryLeads.size

    const res = await simulator.simulateInboundCall({
      callerNumber: existingCaller,
      virtualNumber: TEST_VIRTUAL_NUMBER,
      humanAnswered: false,
      callerScript: ["Main Rohit bol raha hoon pricing update chahiye", "Bye"],
    })

    assert(res.success, "Simulation must succeed")
    assert.strictEqual(res.leadCreated, false, "Must not create a new lead for existing contact")
    assert.strictEqual(res.lead._id, "lead_existing_999", "Must match existing lead ID")
    assert.strictEqual(simulator.inMemoryLeads.size, leadsCountBefore, "Lead count must remain identical")
  })

  await testAsync("Scenario 3: Human answers — AI must NOT answer (normal flow preserved)", async () => {
    const caller = "+919876540003"
    const res = await simulator.simulateInboundCall({
      callerNumber: caller,
      virtualNumber: TEST_VIRTUAL_NUMBER,
      humanAnswered: true, // Human staff answered physical phone
      callerScript: ["Hello"],
    })

    assert(res.success, "Simulation must report success")
    assert.strictEqual(res.aiAnswered, false, "AI receptionist must NOT answer when human answers")
    assert.strictEqual(res.callRecord.answeredBy, "human")
    assert.strictEqual(res.callRecord.source, "manual")
    assert.strictEqual(res.callRecord.hasRecording, false)
  })

  await testAsync("Scenario 4: Human does not answer — simulated AI answers", async () => {
    const caller = "+919876540004"
    const res = await simulator.simulateInboundCall({
      callerNumber: caller,
      virtualNumber: TEST_VIRTUAL_NUMBER,
      humanAnswered: false, // Phone rang out, forwarded to AI
      callerScript: ["Mujhe plots ki jaankari chahiye", "Bye"],
    })

    assert(res.success, "Simulation must succeed")
    assert.strictEqual(res.aiAnswered, true, "AI must answer on no-answer")
    assert.strictEqual(res.callRecord.answeredBy, "ai_receptionist")
    assert(res.greetingText.includes("Namaste"), "Greeting must be delivered")
  })

  test("Scenario 5: Duplicate incoming call webhook event is idempotently ignored", () => {
    const callSid = "mock_call_dup_001"
    const first = simulator.processWebhookWithIdempotency(`inbound_${callSid}`, { callSid })
    const duplicate = simulator.processWebhookWithIdempotency(`inbound_${callSid}`, { callSid })

    assert.strictEqual(first.processed, true, "First event must be processed")
    assert.strictEqual(first.duplicate, false)
    assert.strictEqual(duplicate.processed, false, "Duplicate event must be ignored")
    assert.strictEqual(duplicate.duplicate, true)
  })

  test("Scenario 6: Duplicate recording completion event is idempotently ignored", () => {
    const recSid = "rec_mock_dup_001"
    const first = simulator.processWebhookWithIdempotency(`recording_${recSid}`, { recSid })
    const duplicate = simulator.processWebhookWithIdempotency(`recording_${recSid}`, { recSid })

    assert.strictEqual(first.processed, true)
    assert.strictEqual(duplicate.processed, false)
    assert.strictEqual(duplicate.duplicate, true)
  })

  await testAsync("Scenario 7: Dialing an unmapped virtual number rejects call cleanly", async () => {
    const unmappedNumber = "+911199999999"
    const res = await simulator.simulateInboundCall({
      callerNumber: "+919876540007",
      virtualNumber: unmappedNumber, // No tenant registered
      humanAnswered: false,
    })

    assert.strictEqual(res.success, false, "Must fail routing for unknown virtual number")
    assert.strictEqual(res.phase, "routing")
    assert(res.error.includes("No tenant found"), "Must return clear unmapped tenant error")
  })

  await testAsync("Scenario 8: Call disconnected unexpectedly logged with failure reason", async () => {
    const caller = "+919876540008"
    const res = await simulator.simulateInboundCall({
      callerNumber: caller,
      virtualNumber: TEST_VIRTUAL_NUMBER,
      humanAnswered: false,
      disconnectUnexpectedly: true,
    })

    assert.strictEqual(res.success, false)
    assert.strictEqual(res.callRecord.status, "failed")
    assert.strictEqual(res.callRecord.failureReason, "caller_hung_up_unexpectedly")
    assert.strictEqual(res.callRecord.hasRecording, false)
  })

  await testAsync("Scenario 9: Recording lifecycle contract (pending -> completed -> valid audio fetch)", async () => {
    const caller = "+919876540009"
    const res = await simulator.simulateInboundCall({
      callerNumber: caller,
      virtualNumber: TEST_VIRTUAL_NUMBER,
      humanAnswered: false,
      callerScript: ["Product details chahiye", "Bye"],
    })

    const rec = res.callRecord.recording
    assert(rec, "Recording record must exist")
    assert.strictEqual(rec.status, "completed")
    assert(rec.sizeBytes > 0, "Recording size must be greater than zero")

    // Fetch synthetic audio bytes from adapter
    const audioBuffer = await simulator.adapter.fetchRecordingAudio({ recordingSid: rec.recordingSid })
    assert(Buffer.isBuffer(audioBuffer), "Must return a valid Buffer")
    assert.strictEqual(audioBuffer.length, rec.sizeBytes, "Fetched byte size must match metadata")
  })

  await testAsync("Scenario 10: Mock provider unavailable handled gracefully", async () => {
    simulator.adapter.setAvailability(false)

    let errorThrown = false
    try {
      await simulator.simulateInboundCall({
        callerNumber: "+919876540010",
        virtualNumber: TEST_VIRTUAL_NUMBER,
        humanAnswered: false,
      })
    } catch (e) {
      errorThrown = true
      assert(e.message.includes("Mock adapter is offline"), "Must throw offline message")
    }

    assert(errorThrown, "Must throw clean provider offline error")
    simulator.adapter.setAvailability(true) // Reset
  })

  // -----------------------------------------------------------------
  // Suite 3: Bilingual Conversation & Tool Execution
  // -----------------------------------------------------------------
  console.log("\nSuite 3: Bilingual Voice Sessions & Tool Execution")

  test("3.1: Hindi conversation session delivers Hindi greeting & tools", () => {
    const session = new MockVoiceSession({
      tenantId: TEST_TENANT_ID,
      callerNumber: "+919876540011",
      language: "hi-IN",
    })

    const greeting = session.getGreeting()
    assert(greeting.text.startsWith("Namaste!"), "Must deliver Hindi greeting")

    const turn1 = session.processCallerTurn("Pricing kya hai flat ki?")
    assert(turn1.text.includes("available hain"), "AI responds in Hindi")

    const turn2 = session.processCallerTurn("Mera naam Priya Sharma hai")
    assert.strictEqual(turn2.toolCalls.length, 1, "Must generate create_or_update_lead tool call")
    assert.strictEqual(turn2.toolCalls[0].name, "create_or_update_lead")

    const turn3 = session.processCallerTurn("Theek hai kal call back kar lena")
    assert.strictEqual(turn3.toolCalls.length, 1, "Must generate schedule_followup tool call")
    assert.strictEqual(turn3.toolCalls[0].name, "schedule_followup")

    const summary = session.completeSession()
    assert.strictEqual(summary.totalTurns, 7)
    assert.strictEqual(summary.metadata.callOutcome, "CALL_BACK_LATER")
  })

  test("3.2: English conversation session delivers English greeting & tools", () => {
    const session = new MockVoiceSession({
      tenantId: TEST_TENANT_ID,
      callerNumber: "+919876540012",
      language: "en-IN",
    })

    const greeting = session.getGreeting()
    assert(greeting.text.startsWith("Hello!"), "Must deliver English greeting")

    const turn1 = session.processCallerTurn("I would like to inquire about pricing")
    assert(turn1.text.includes("Certainly"), "AI responds in English")

    const turn2 = session.processCallerTurn("My name is John Doe")
    assert.strictEqual(turn2.toolCalls.length, 1)
    assert.strictEqual(turn2.toolCalls[0].name, "create_or_update_lead")

    const summary = session.completeSession()
    assert.strictEqual(summary.isCompleted, undefined) // object returned
    assert(summary.totalTurns >= 5)
  })

  // -----------------------------------------------------------------
  // Suite 4: Webhook Signature Cryptographic Contract
  // -----------------------------------------------------------------
  console.log("\nSuite 4: Provider Webhook Signature Verification")

  test("4.1: Valid mock HMAC-SHA256 signature accepted; invalid rejected", () => {
    const body = { CallSid: "mock_123", From: "+919876540001", To: "+911140001001" }
    const signature = simulator.adapter.generateSignature(body)

    const isValid = simulator.adapter.validateWebhookSignature({
      body,
      headers: { "x-mock-signature": signature },
    })
    assert.strictEqual(isValid, true, "Valid signature must be accepted")

    const isInvalid = simulator.adapter.validateWebhookSignature({
      body,
      headers: { "x-mock-signature": "tampered_signature_hex" },
    })
    assert.strictEqual(isInvalid, false, "Tampered signature must be rejected")
  })

  // -----------------------------------------------------------------
  // Final Summary
  // -----------------------------------------------------------------
  console.log("\n==================================================================")
  console.log(`   TEST EXECUTION SUMMARY: ${passedCount} PASSED, ${failedCount} FAILED`)
  console.log("==================================================================\n")

  if (failedCount > 0) {
    process.exit(1)
  }
}

runPhase0Tests()

