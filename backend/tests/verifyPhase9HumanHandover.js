/**
 * Leads365 AI Receptionist — Phase 9 Verification Test Suite
 * 
 * Verifies Human Handover and Failure Recovery:
 *  1. Initiates human handover with provider transfer directives (Mock, Twilio, Exotel).
 *  2. Updates CRM Call outcome to 'Escalated'.
 *  3. Prevents self-forwarding loop when caller phone === destination phone.
 *  4. Enforces hop-count limit to prevent bounce routing loops.
 *  5. Gracefully handles unconfigured human handover number (logs urgent callback).
 *  6. Generates polite bilingual system failure recovery fallbacks.
 */

require("dotenv").config({ path: require("path").join(__dirname, "../.env") })
process.env.NODE_ENV = "test"

const assert = require("assert")
const {
  initiateHumanHandover,
  getSystemFailureFallbackMessage,
  clearTransferRegistry,
} = require("../services/telephony/humanHandover.service")
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

async function runPhase9Tests() {
  console.log("\n==================================================================")
  console.log("   LEADS365 AI RECEPTIONIST — PHASE 9 HUMAN HANDOVER SUITE       ")
  console.log("==================================================================\n")

  clearTransferRegistry()
  inMemoryStore.clear()
  const TENANT_A = "ACC-TENANT-ALPHA"
  process.env.TEST_HANDOVER_NUMBER = "+919876599999"

  // Test 1: Initiates human handover with mock provider
  await testAsync("1. Initiates human handover with mock telephony provider", async () => {
    const result = await initiateHumanHandover({
      tenantId: TENANT_A,
      callSid: "CA_handover_1",
      callerPhone: "+919876543210",
      reason: "Customer wants enterprise custom plan",
      provider: "mock",
    })

    assert.strictEqual(result.success, true)
    assert.strictEqual(result.status, "transferred")
    assert.strictEqual(result.destination, "+919876599999")
    assert.strictEqual(result.providerDirective.action, "transfer")

    const call = inMemoryStore.calls.get("CA_handover_1")
    assert(call, "Call should be registered")
    assert.strictEqual(call.callOutcome, "Escalated")
  })

  // Test 2: Generates valid TwiML Dial for Twilio
  await testAsync("2. Generates valid TwiML <Dial> XML for Twilio provider", async () => {
    const result = await initiateHumanHandover({
      tenantId: TENANT_A,
      callSid: "CA_handover_twilio",
      callerPhone: "+919876543210",
      provider: "twilio",
    })

    assert.strictEqual(result.success, true)
    assert(result.providerDirective.includes("<Dial timeout=\"25\">+919876599999</Dial>"))
    assert(result.providerDirective.includes("<Response>"))
  })

  // Test 3: Anti-loop protection: Caller phone === Destination phone
  await testAsync("3. Anti-loop protection: Blocks transfer when caller === destination", async () => {
    const result = await initiateHumanHandover({
      tenantId: TENANT_A,
      callSid: "CA_handover_loop_caller",
      callerPhone: "+919876599999", // Same as destination!
      provider: "mock",
    })

    assert.strictEqual(result.success, false)
    assert.strictEqual(result.status, "loop_prevented")
    assert(result.fallbackSpokenText.includes("matches your current calling number"))
  })

  // Test 4: Hop count limit prevents transfer bouncing loop
  await testAsync("4. Hop count limit: Blocks second transfer on same callSid", async () => {
    const secondAttempt = await initiateHumanHandover({
      tenantId: TENANT_A,
      callSid: "CA_handover_1", // Already transferred in test 1!
      callerPhone: "+919876543210",
      provider: "mock",
    })

    assert.strictEqual(secondAttempt.success, false)
    assert.strictEqual(secondAttempt.status, "loop_blocked")
    assert(secondAttempt.fallbackSpokenText.includes("already connected this call"))
  })

  // Test 5: Missing / unconfigured destination number
  await testAsync("5. Missing destination number schedules callback task gracefully", async () => {
    delete process.env.TEST_HANDOVER_NUMBER
    const result = await initiateHumanHandover({
      tenantId: TENANT_A,
      callSid: "CA_handover_no_dest",
      callerPhone: "+919876543210",
      provider: "mock",
    })

    assert.strictEqual(result.success, false)
    assert.strictEqual(result.status, "no_destination")
    assert(result.fallbackSpokenText.includes("urgent callback request"))
    process.env.TEST_HANDOVER_NUMBER = "+919876599999"
  })

  // Test 6: Technical disconnect fallback messages
  test("6. System failure recovery fallback messages in Hindi and English", () => {
    const hindiMsg = getSystemFailureFallbackMessage("hindi")
    assert(hindiMsg.includes("Takneeki samasya"))

    const engMsg = getSystemFailureFallbackMessage("english")
    assert(engMsg.includes("temporary network issue"))
  })

  console.log("\n==================================================================")
  console.log(`   PHASE 9 SUMMARY: ${passedCount} PASSED, ${failedCount} FAILED`)
  console.log("==================================================================\n")

  if (failedCount > 0) process.exit(1)
}

runPhase9Tests().catch((err) => {
  console.error("FATAL ERROR IN PHASE 9 TEST:", err)
  process.exit(1)
})

