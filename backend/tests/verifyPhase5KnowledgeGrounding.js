/**
 * Leads365 AI Receptionist — Phase 5 Verification Test Suite
 * 
 * Verifies Tenant Knowledge Base Grounding & AI Personality:
 *  1. Builds isolated grounding context for Tenant A and Tenant B.
 *  2. Verified products, pricing, and features correctly rendered.
 *  3. Verified knowledge sources (FAQs, manuals) correctly ingested.
 *  4. Incomplete or failed knowledge sources (PENDING/FAILED) strictly excluded.
 *  5. Language instruction customization (Hindi, English, Hinglish).
 *  6. Custom greeting from Tenant telephonyConfig respected.
 *  7. Missing knowledge handles safely without process error.
 *  8. Strict isolation: Tenant A's products/docs never leak into Tenant B's prompt.
 *  9. GeminiLiveSession loads tenant grounding context into systemInstruction.
 * 10. Database offline graceful fallback.
 */

require("dotenv").config({ path: require("path").join(__dirname, "../.env") })
process.env.NODE_ENV = "test"

const assert = require("assert")
const EventEmitter = require("events")
const {
  buildTenantGroundingContext,
  buildTenantReceptionistPrompt,
  fetchTenantGroundingData,
} = require("../services/telephony/receptionistPromptBuilder.service")
const { GeminiLiveSession } = require("../services/telephony/geminiLiveClient.service")
const VoiceSession = require("../services/telephony/voiceSession.service")

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

class MockWebSocket extends EventEmitter {
  constructor() {
    super()
    this.readyState = 1
    this.bufferedAmount = 0
  }
  send() {}
  close() {}
}

async function runPhase5Tests() {
  console.log("\n==================================================================")
  console.log("   LEADS365 AI RECEPTIONIST — PHASE 5 KNOWLEDGE GROUNDING SUITE  ")
  console.log("==================================================================\n")

  const TENANT_A_ID = "ACC-TENANT-ALPHA"
  const TENANT_B_ID = "ACC-TENANT-BETA"

  const TENANT_A_PROFILE = {
    tenantId: TENANT_A_ID,
    businessName: "Alpha Solar Power Solutions",
    industry: "Energy",
    description: "Leading residential rooftop solar installation company in North India.",
    website: "https://alphasolar.example.com",
    contactPhone: "+919876500001",
    telephonyConfig: {
      aiLanguage: "hindi",
      aiGreeting: "Namaste! Alpha Solar mein aapka swagat hai. Main aapki kya sahayata kar sakti hoon?",
      humanHandoverNumber: "+919876599999",
    },
  }

  const TENANT_A_PRODUCTS = [
    {
      tenantId: TENANT_A_ID,
      name: "3kW Residential Rooftop Solar Kit",
      type: "PRODUCT",
      description: "Monocrystalline panels with 5-year on-site warranty.",
      price: { amount: 150000, currency: "INR", billingCycle: "one-time" },
      features: ["25-year panel warranty", "Subsidized by PM Surya Ghar", "Free Net Metering"],
    },
    {
      tenantId: TENANT_A_ID,
      name: "Solar Maintenance AMC",
      type: "SERVICE",
      description: "Quarterly panel cleaning and inverter inspection.",
      price: { amount: 5000, currency: "INR", billingCycle: "yearly" },
      features: ["4 visits per year", "Zero breakdown guarantee"],
    },
  ]

  const TENANT_A_DOCS = [
    {
      tenantId: TENANT_A_ID,
      title: "Subsidy and Installation FAQs",
      status: "COMPLETED",
      extractedText: "PM Surya Ghar subsidy provides up to Rs 78,000 for a 3kW system. Average installation takes 5 to 7 working days after meter approval.",
    },
    {
      tenantId: TENANT_A_ID,
      title: "Draft Unapproved Document",
      status: "PENDING", // Should be ignored!
      extractedText: "Unverified pricing notes: 50% discount on all installations.",
    },
  ]

  const TENANT_B_PROFILE = {
    tenantId: TENANT_B_ID,
    businessName: "Beta Dental Clinic",
    industry: "Healthcare",
    description: "Advanced cosmetic dentistry and painless root canal treatments.",
    website: "https://betadental.example.com",
    telephonyConfig: {
      aiLanguage: "english",
      aiGreeting: "Hello and thank you for calling Beta Dental Clinic. How may I assist you today?",
    },
  }

  const TENANT_B_PRODUCTS = [
    {
      tenantId: TENANT_B_ID,
      name: "Invisalign Clear Aligners",
      type: "SERVICE",
      description: "Custom invisible teeth alignment treatment.",
      price: { amount: 80000, currency: "INR", billingCycle: "one-time" },
      features: ["Free 3D digital scan", "Zero metal braces"],
    },
  ]

  // Test 1: Grounding context for Tenant A contains verified details
  test("1. Builds structured grounding context for Tenant A", () => {
    const ctx = buildTenantGroundingContext({
      tenantId: TENANT_A_ID,
      profile: TENANT_A_PROFILE,
      products: TENANT_A_PRODUCTS,
      knowledgeSources: TENANT_A_DOCS,
    })

    assert(ctx.includes("Alpha Solar Power Solutions"), "Must contain business name")
    assert(ctx.includes("3kW Residential Rooftop Solar Kit"), "Must contain product name")
    assert(ctx.includes("INR 150000 (one-time)"), "Must contain price")
    assert(ctx.includes("PM Surya Ghar"), "Must contain feature/doc text")
    assert(ctx.includes("Human Escalation Number: +919876599999"), "Must contain escalation number")
  })

  // Test 2: Incomplete or failed knowledge sources strictly excluded
  test("2. PENDING and unapproved knowledge sources strictly excluded", () => {
    const ctx = buildTenantGroundingContext({
      tenantId: TENANT_A_ID,
      profile: TENANT_A_PROFILE,
      products: TENANT_A_PRODUCTS,
      knowledgeSources: TENANT_A_DOCS,
    })

    assert(!ctx.includes("Unapproved Document"), "PENDING doc title must not appear")
    assert(!ctx.includes("50% discount"), "PENDING unverified content must not appear")
  })

  // Test 3: Language instruction customizations (Hindi, English, Hinglish)
  test("3. Language instruction customization works accurately", () => {
    const hindiPrompt = buildTenantReceptionistPrompt({
      tenantId: TENANT_A_ID,
      profile: TENANT_A_PROFILE,
      language: "hindi",
    })
    assert(hindiPrompt.includes("Respond in Hindi"), "Must contain Hindi directive")

    const englishPrompt = buildTenantReceptionistPrompt({
      tenantId: TENANT_B_ID,
      profile: TENANT_B_PROFILE,
      language: "english",
    })
    assert(englishPrompt.includes("professional, natural, articulate English"), "Must contain English directive")

    const hinglishPrompt = buildTenantReceptionistPrompt({
      tenantId: "TENANT_C",
      profile: { businessName: "Gamma Motors" },
      language: "hinglish",
    })
    assert(hinglishPrompt.includes("Hinglish"), "Must contain Hinglish directive")
  })

  // Test 4: Custom greeting integration
  test("4. Custom greeting from telephonyConfig is respected", () => {
    const promptA = buildTenantReceptionistPrompt({
      tenantId: TENANT_A_ID,
      profile: TENANT_A_PROFILE,
    })
    assert(promptA.includes(TENANT_A_PROFILE.telephonyConfig.aiGreeting), "Greeting A must match")

    const promptB = buildTenantReceptionistPrompt({
      tenantId: TENANT_B_ID,
      profile: TENANT_B_PROFILE,
    })
    assert(promptB.includes(TENANT_B_PROFILE.telephonyConfig.aiGreeting), "Greeting B must match")
  })

  // Test 5: Strict cross-tenant isolation (zero leakage)
  test("5. Cross-tenant knowledge isolation (Tenant A != Tenant B)", () => {
    const promptA = buildTenantReceptionistPrompt({
      tenantId: TENANT_A_ID,
      profile: TENANT_A_PROFILE,
      products: TENANT_A_PRODUCTS,
      knowledgeSources: TENANT_A_DOCS,
    })

    const promptB = buildTenantReceptionistPrompt({
      tenantId: TENANT_B_ID,
      profile: TENANT_B_PROFILE,
      products: TENANT_B_PRODUCTS,
      knowledgeSources: [],
    })

    // Assert Tenant A contains zero Dental info
    assert(!promptA.includes("Beta Dental"), "Tenant A must not have Tenant B business name")
    assert(!promptA.includes("Invisalign"), "Tenant A must not have Tenant B products")

    // Assert Tenant B contains zero Solar info
    assert(!promptB.includes("Alpha Solar"), "Tenant B must not have Tenant A business name")
    assert(!promptB.includes("Rooftop Solar"), "Tenant B must not have Tenant A products")
  })

  // Test 6: Missing knowledge fallback does not crash
  test("6. Missing knowledge handles safely with graceful defaults", () => {
    const promptEmpty = buildTenantReceptionistPrompt({
      tenantId: "ACC_EMPTY_TENANT",
      profile: null,
      products: [],
      knowledgeSources: [],
    })

    assert(promptEmpty.includes("ACC_EMPTY_TENANT"), "Should fallback to tenant ID identifier")
    assert(promptEmpty.includes("STRICT BEHAVIORAL PROTOCOLS"), "Must retain core behavioral safety rules")
  })

  // Test 7: Integration with GeminiLiveSession
  await testAsync("7. GeminiLiveSession loads tenant grounding context on start()", async () => {
    const mockWs = new MockWebSocket()
    const voiceSession = new VoiceSession({
      callSid: "call_grounding_7",
      tenantId: TENANT_A_ID,
      provider: "mock",
      ws: mockWs,
    })

    const liveSession = new GeminiLiveSession({
      callSid: "call_grounding_7",
      tenantId: TENANT_A_ID,
      voiceSession,
      config: {
        useMock: true,
        profile: TENANT_A_PROFILE,
        products: TENANT_A_PRODUCTS,
        knowledgeSources: TENANT_A_DOCS,
      },
    })

    await liveSession.start()

    const sysInstruction = liveSession.geminiSession.systemInstruction
    assert(sysInstruction.includes("Alpha Solar Power Solutions"), "Live session must receive Tenant A business name")
    assert(sysInstruction.includes("3kW Residential Rooftop Solar Kit"), "Live session must receive Tenant A products")
    assert(sysInstruction.includes("Namaste! Alpha Solar mein aapka swagat hai"), "Live session must receive greeting")

    liveSession.close()
  })

  // Test 8: Database offline graceful fallback
  await testAsync("8. fetchTenantGroundingData handles disconnected database gracefully", async () => {
    const data = await fetchTenantGroundingData("ACC_NON_EXISTENT")
    assert.deepStrictEqual(data.products, [], "Products should be empty array on fallback")
    assert.deepStrictEqual(data.knowledgeSources, [], "Knowledge sources should be empty array on fallback")
  })

  console.log("\n==================================================================")
  console.log(`   PHASE 5 SUMMARY: ${passedCount} PASSED, ${failedCount} FAILED`)
  console.log("==================================================================\n")

  if (failedCount > 0) process.exit(1)
}

runPhase5Tests().catch((err) => {
  console.error("FATAL ERROR IN PHASE 5 TEST:", err)
  process.exit(1)
})

