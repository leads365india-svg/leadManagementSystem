const mongoose = require("mongoose")
require("dotenv").config({ path: "d:/LEADS/Leads-365/backend/.env" })

const { evaluateProductRelevanceAndGate } = require("../services/aiProductRelevanceGate.service")
const { generateDeterministicCallAnalysis, analyzeCallWithGemini } = require("../services/aiCallAnalysis.service")
const { processCallIntelligenceJob } = require("../services/aiCallProcessingPipeline")
const { AICallAnalysis } = require("../models/AICallAnalysis")
const Call = require("../models/Call")
const Lead = require("../models/Lead")
const Account = require("../models/Account")

async function runTests() {
  console.log("======================================================================")
  console.log("  AI CALL INTELLIGENCE & CALL CAPTURE VERIFICATION SUITE")
  console.log("======================================================================")

  await mongoose.connect(process.env.MONGODB_URI)
  console.log("Connected to MongoDB Atlas\n")

  const tenantId = "ACC-3E87985C" // Medical 365
  let passedCount = 0
  let failedCount = 0

  function assert(condition, message) {
    if (condition) {
      console.log(`  ✅ PASS: ${message}`)
      passedCount++
    } else {
      console.error(`  ❌ FAIL: ${message}`)
      failedCount++
    }
  }

  // -------------------------------------------------------------------------
  // Test 1: Vendor Pitch Call -> OUT_OF_SCOPE (Rule 1)
  // -------------------------------------------------------------------------
  console.log("\n[Test 1] Vendor Pitch Call (Sweets/Mithai shop offering products to agent)")
  {
    const transcript = {
      transcriptText: "Customer: Namaste sir, hamari mithai ki shop hai, fresh sweets aur dry fruits supply karte hain. Agar aapko corporate gifting ya regular supply ke liye chahiye toh batayein. Agent: Haan theek hai, aap WhatsApp kar do.",
      segments: [
        { speaker: "Customer", text: "Namaste sir, hamari mithai ki shop hai, fresh sweets aur dry fruits supply karte hain. Agar aapko corporate gifting ya regular supply ke liye chahiye toh batayein." },
        { speaker: "Agent", text: "Haan theek hai, aap WhatsApp kar do." },
      ],
    }

    const fallbackResult = generateDeterministicCallAnalysis({
      transcript,
      topicMatches: [],
      tenantCatalog: { companyName: "Medical 365", products: [] },
    })

    assert(fallbackResult.callOutcome === "OUT_OF_SCOPE", `Fallback outcome for vendor pitch is OUT_OF_SCOPE (was ${fallbackResult.callOutcome})`)

    const gateResult = await evaluateProductRelevanceAndGate({
      transcript,
      tenantId,
      rawAnalysis: { callOutcome: "OUT_OF_SCOPE", summary: "Vendor pitched sweets", customerIntent: "Offering sweets" },
    })

    assert(gateResult.callOutcome === "OUT_OF_SCOPE", `Gate callOutcome is OUT_OF_SCOPE (was ${gateResult.callOutcome})`)
    assert(gateResult.qualificationStatus === "DISQUALIFIED", `Qualification status is DISQUALIFIED (was ${gateResult.qualificationStatus})`)
    assert(gateResult.crmLeadAction === "CLOSE_LOST", `CRM lead action is CLOSE_LOST (was ${gateResult.crmLeadAction})`)
    assert(gateResult.callbackRequested === false, "No callback scheduled for vendor pitch")
    assert(gateResult.requestedCallbackDateTime === null, "requestedCallbackDateTime is null")
  }

  // -------------------------------------------------------------------------
  // Test 2: Agent Refused / Unsupported Variant -> NOT_INTERESTED / CLOSE_LOST (Rule 2)
  // -------------------------------------------------------------------------
  console.log("\n[Test 2] Agent-Declined / Unsupported Product (Agent says 'nahi banate' / 'not available')")
  {
    const transcript = {
      transcriptText: "Customer: Hello, kya aapke paas veterinary pet clinic software available hai? Hume dog clinic ke liye software chahiye. Agent: Nahi sir, hum veterinary software nahi banate, available nahi hai hamare paas. Customer: Achha theek hai.",
      segments: [
        { speaker: "Customer", text: "Hello, kya aapke paas veterinary pet clinic software available hai? Hume dog clinic ke liye software chahiye." },
        { speaker: "Agent", text: "Nahi sir, hum veterinary software nahi banate, available nahi hai hamare paas." },
        { speaker: "Customer", text: "Achha theek hai." },
      ],
    }

    const gateResult = await evaluateProductRelevanceAndGate({ transcript, tenantId })

    assert(gateResult.qualificationStatus === "DISQUALIFIED", `Qualification status is DISQUALIFIED (was ${gateResult.qualificationStatus})`)
    assert(gateResult.qualificationReason === "AGENT_DECLINED_OR_UNAVAILABLE_PRODUCT", `Qualification reason is AGENT_DECLINED_OR_UNAVAILABLE_PRODUCT (was ${gateResult.qualificationReason})`)
    assert(gateResult.callOutcome === "NOT_INTERESTED", `Call outcome is NOT_INTERESTED (was ${gateResult.callOutcome})`)
    assert(gateResult.crmLeadAction === "CLOSE_LOST", `CRM lead action is CLOSE_LOST (was ${gateResult.crmLeadAction})`)
    assert(gateResult.callbackRequested === false, "Callback is false for agent-declined product")
  }

  // -------------------------------------------------------------------------
  // Test 3: Genuine Approved Tenant Product -> INTERESTED / FOLLOW_UP_REQUIRED
  // -------------------------------------------------------------------------
  console.log("\n[Test 3] Genuine Approved Tenant Product (Hospital Management Software / OPD / IPD)")
  {
    const transcript = {
      transcriptText: "Customer: Hello, hume apne 40 bed hospital ke liye Hospital Management System chahiye jisme OPD, IPD, pharmacy aur billing modules properly integrate ho sake. Pricing aur quotation share kar sakte hain? Agent: Ji bilkul sir, hum details bhejte hain.",
      segments: [
        { speaker: "Customer", text: "Hello, hume apne 40 bed hospital ke liye Hospital Management System chahiye jisme OPD, IPD, pharmacy aur billing modules properly integrate ho sake. Pricing aur quotation share kar sakte hain?" },
        { speaker: "Agent", text: "Ji bilkul sir, hum details bhejte hain." },
      ],
    }

    const gateResult = await evaluateProductRelevanceAndGate({ transcript, tenantId })

    assert(gateResult.isProductRelevant === true, "isProductRelevant is true")
    assert(gateResult.productFit === "SUPPORTED", `productFit is SUPPORTED (was ${gateResult.productFit})`)
    assert(gateResult.callOutcome === "INTERESTED" || gateResult.callOutcome === "FOLLOW_UP_REQUIRED", `Call outcome is INTERESTED or FOLLOW_UP_REQUIRED (was ${gateResult.callOutcome})`)
    assert(gateResult.qualificationStatus === "QUALIFIED" || gateResult.qualificationStatus === "QUALIFIED_FOLLOW_UP", `Qualification is QUALIFIED (was ${gateResult.qualificationStatus})`)
    assert(gateResult.customerPurchaseIntent === true, "Customer purchase intent is true")
    assert(gateResult.crmLeadAction === "QUALIFY_ENGAGED", "CRM action is QUALIFY_ENGAGED")
  }

  // -------------------------------------------------------------------------
  // Test 4: Audio & Transcript-First Verification (Pipeline Pre-Flight Check)
  // -------------------------------------------------------------------------
  console.log("\n[Test 4] Audio & Transcript-First Verification (Missing/Zero-Byte Audio & Short Transcript)")
  {
    // Test 4a: Missing audio (sizeBytes = 0, duration = 0)
    const testCallNoAudio = await Call.create({
      tenantId,
      agentId: new mongoose.Types.ObjectId(),
      clientCallId: `test_preflight_no_audio_${Date.now()}`,
      phoneNumber: "+919999000001",
      phoneNormalized: "+919999000001",
      startTime: new Date(),
      startTimeMs: Date.now(),
      durationSeconds: 0,
      callOutcome: "Connected",
      recording: {
        fileId: new mongoose.Types.ObjectId(),
        sizeBytes: 0,
        duration: 0,
      },
    })

    const jobResult = await processCallIntelligenceJob({
      payload: {
        callId: testCallNoAudio._id.toString(),
        tenantId,
      },
    })

    assert(jobResult.callOutcome === "UNRESOLVED", `Zero-byte audio call returns UNRESOLVED (was ${jobResult.callOutcome})`)
    assert(jobResult.crmLeadAction === "DO_NOT_UPDATE", `Zero-byte audio call action is DO_NOT_UPDATE (was ${jobResult.crmLeadAction})`)

    const analysisDoc = await AICallAnalysis.findById(jobResult.analysisId)
    assert(analysisDoc.callOutcome === "UNRESOLVED", `Analysis doc callOutcome is UNRESOLVED (was ${analysisDoc.callOutcome})`)
    assert(analysisDoc.qualificationStatus === "UNRESOLVED", `Analysis doc qualificationStatus is UNRESOLVED`)

    // Clean up
    await Call.deleteOne({ _id: testCallNoAudio._id })
    await AICallAnalysis.deleteOne({ _id: analysisDoc._id })
  }

  // -------------------------------------------------------------------------
  // Test 5: Fallback Default Outcome is UNRESOLVED (Rule 3)
  // -------------------------------------------------------------------------
  console.log("\n[Test 5] Fallback Default Outcome is UNRESOLVED")
  {
    const fallbackResult = generateDeterministicCallAnalysis({
      transcript: { transcriptText: "The user spoke indistinctly in background noise." },
      topicMatches: [],
      tenantCatalog: { companyName: "Medical 365", products: [] },
    })

    assert(fallbackResult.callOutcome === "UNRESOLVED", `Fallback default outcome is UNRESOLVED (was ${fallbackResult.callOutcome})`)

    // Verify AICallAnalysis model default
    const defaultInstance = new AICallAnalysis()
    assert(defaultInstance.callOutcome === "UNRESOLVED", `AICallAnalysis schema default is UNRESOLVED (was ${defaultInstance.callOutcome})`)
  }

  // -------------------------------------------------------------------------
  // Test 6: Mobile Controller reportMobileCall: Answered and Missed Lead Auto-Creation
  // -------------------------------------------------------------------------
  console.log("\n[Test 6] Backend Mobile Controller: Answered vs Missed Call Auto Lead Creation")
  {
    const { reportMobileCall } = require("../controllers/mobileController")

    // Mock Express req/res
    function createMockRes() {
      return {
        statusCode: 200,
        body: null,
        status(code) {
          this.statusCode = code
          return this
        },
        json(data) {
          this.body = data
          return this
        },
      }
    }

    const agentObjId = new mongoose.Types.ObjectId()
    const testUser = {
      id: agentObjId.toString(),
      _id: agentObjId,
      name: "Test Agent",
      role: "agent",
      tenantId,
    }

    // 6a: Missed Call (durationSeconds = 0, call_direction = "MISSED")
    const missedPhone = `+9198765${Math.floor(10000 + Math.random() * 90000)}`
    const missedReq = {
      user: testUser,
      headers: {},
      body: {
        client_call_id: `test_mobile_missed_${Date.now()}`,
        phone_number: missedPhone,
        call_direction: "MISSED",
        start_time_ms: Date.now() - 60000,
        duration_seconds: 0,
        call_outcome: "Missed",
        notes: "Auto-captured from missed incoming call",
        auto_create_lead: true,
      },
    }
    const missedRes = createMockRes()
    await reportMobileCall(missedReq, missedRes)

    assert(missedRes.statusCode === 200 || missedRes.statusCode === 201, `Missed call report HTTP status 200/201 (was ${missedRes.statusCode})`)
    assert(missedRes.body?.success === true, "Missed call report success: true")
    assert(Boolean(missedRes.body?.lead_id), `Missed call auto-created or linked lead_id (${missedRes.body?.lead_id})`)

    // Clean up created test call and lead
    if (missedRes.body?.call_id) {
      await Call.deleteOne({ _id: missedRes.body.call_id })
    }
    if (missedRes.body?.lead_id) {
      await Lead.deleteOne({ _id: missedRes.body.lead_id })
    }

    // 6b: Answered Incoming Call (durationSeconds = 30, call_direction = "INCOMING")
    const answeredPhone = `+9198765${Math.floor(10000 + Math.random() * 90000)}`
    const answeredReq = {
      user: testUser,
      headers: {},
      body: {
        client_call_id: `test_mobile_answered_${Date.now()}`,
        phone_number: answeredPhone,
        call_direction: "INCOMING",
        start_time_ms: Date.now() - 30000,
        duration_seconds: 30,
        call_outcome: "Connected",
        notes: "Auto-captured from answered incoming call (30s)",
        auto_create_lead: true,
      },
    }
    const answeredRes = createMockRes()
    await reportMobileCall(answeredReq, answeredRes)

    assert(answeredRes.statusCode === 200 || answeredRes.statusCode === 201, `Answered call report HTTP status 200/201 (was ${answeredRes.statusCode})`)
    assert(answeredRes.body?.success === true, "Answered call report success: true")
    assert(Boolean(answeredRes.body?.lead_id), `Answered call auto-created or linked lead_id (${answeredRes.body?.lead_id})`)

    // Clean up created test call and lead
    if (answeredRes.body?.call_id) {
      await Call.deleteOne({ _id: answeredRes.body.call_id })
    }
    if (answeredRes.body?.lead_id) {
      await Lead.deleteOne({ _id: answeredRes.body.lead_id })
    }
  }

  console.log("\n======================================================================")
  console.log(`TOTAL TESTS: ${passedCount + failedCount} | PASSED: ${passedCount} | FAILED: ${failedCount}`)
  console.log("======================================================================")

  await mongoose.disconnect()
  if (failedCount > 0) {
    process.exit(1)
  }
}

runTests().catch((err) => {
  console.error("Test execution encountered an error:", err)
  process.exit(1)
})
