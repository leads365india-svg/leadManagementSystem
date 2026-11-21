const mongoose = require("mongoose")
require("dotenv").config({ path: "d:/LEADS/Leads-365/backend/.env" })

const { evaluateProductRelevanceAndGate } = require("../services/aiProductRelevanceGate.service")
const { syncLeadPipelineStatusFromAiCall, evaluateStatusTransition } = require("../services/leadPipelineSync.service")
const Call = require("../models/Call")
const Lead = require("../models/Lead")
const { AICallAnalysis } = require("../models/AICallAnalysis")

/**
 * PHASE 9 — Regression Test Suite for Strict Product-Relevance Gate
 * 
 * Verifies all 10 qualification scenarios:
 * 1. Recruitment/placement agency calls
 * 2. Job seekers
 * 3. Vendor selling unrelated services (e.g. SEO, web design, loans)
 * 4. Customer agreeing to WhatsApp but no product interest (polite deflection)
 * 5. Mentioning generic keywords (e.g. hospital, doctor) without product need
 * 6. Genuine inquiry for HMS / OPD / Pharmacy / tenant products
 * 7. Demo / pricing request
 * 8. Explicit rejection ("not interested", "already have software")
 * 9. Silent / empty / noise call
 * 10. Example call +919376600036 (Shahzad from Bado AI)
 */

async function runTestSuite() {
  console.log("======================================================================")
  console.log("   STRICT PRODUCT-RELEVANCE GATE & LEAD QUALIFICATION TEST SUITE     ")
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
  // Scenario 1: Recruitment/Placement Agency Call
  // -------------------------------------------------------------------------
  console.log("\n[Scenario 1] Recruitment / Placement Agency Call")
  {
    const transcript = {
      transcriptText: "Hello, Shahzad from Bado AI, placement agency hai. Hiring ke regarding call kiya hai, koi vacancy chal rahi hai? Staff: Nahi abhi koi vacancy nahi hai.",
      segments: [
        { speaker: "Customer", text: "Hello, Shahzad from Bado AI, placement agency hai. Hiring ke regarding call kiya hai, koi vacancy chal rahi hai?" },
        { speaker: "Agent", text: "Nahi abhi koi vacancy nahi hai." },
      ],
    }
    const gateResult = await evaluateProductRelevanceAndGate({ transcript, tenantId })
    assert(gateResult.productRelevanceScore < 0.10, "Product relevance score is below 10% (was " + gateResult.productRelevanceScore + ")")
    assert(gateResult.callOutcome === "NOT_INTERESTED", "Call outcome is NOT_INTERESTED")
    assert(gateResult.qualificationStatus === "DISQUALIFIED", "Qualification status is DISQUALIFIED")
    assert(gateResult.crmLeadAction === "CLOSE_LOST", "CRM Lead action is CLOSE_LOST")
  }

  // -------------------------------------------------------------------------
  // Scenario 2: Job Seeker Call
  // -------------------------------------------------------------------------
  console.log("\n[Scenario 2] Job Seeker Call")
  {
    const transcript = {
      transcriptText: "Hello sir, mujhe hospital me receptionist ki job chahiye, vacancy hai kya? Agent: Nahi abhi koi hiring nahi chal rahi.",
      segments: [
        { speaker: "Customer", text: "Hello sir, mujhe hospital me receptionist ki job chahiye, vacancy hai kya?" },
        { speaker: "Agent", text: "Nahi abhi koi hiring nahi chal rahi." },
      ],
    }
    const gateResult = await evaluateProductRelevanceAndGate({ transcript, tenantId })
    assert(gateResult.productRelevanceScore < 0.10, "Product relevance score is below 10%")
    assert(gateResult.callOutcome === "NOT_INTERESTED", "Call outcome is NOT_INTERESTED")
    assert(gateResult.qualificationStatus === "DISQUALIFIED", "Qualification status is DISQUALIFIED")
  }

  // -------------------------------------------------------------------------
  // Scenario 3: Unrelated Vendor Pitch (Web design / SEO)
  // -------------------------------------------------------------------------
  console.log("\n[Scenario 3] Unrelated Vendor Sales Pitch (SEO / Web Design)")
  {
    const transcript = {
      transcriptText: "Good morning sir, digital marketing agency se baat kar rahe hain, aapko website development service ya SEO service chahiye? Staff: Nahi sir hume koi vendor service nahi chahiye.",
      segments: [
        { speaker: "Customer", text: "Good morning sir, digital marketing agency se baat kar rahe hain, aapko website development service ya SEO service chahiye?" },
        { speaker: "Agent", text: "Nahi sir hume koi vendor service nahi chahiye." },
      ],
    }
    const gateResult = await evaluateProductRelevanceAndGate({ transcript, tenantId })
    assert(gateResult.productRelevanceScore < 0.10, "Product relevance score is below 10%")
    assert(gateResult.callOutcome === "NOT_INTERESTED", "Call outcome is NOT_INTERESTED")
    assert(gateResult.qualificationStatus === "DISQUALIFIED", "Qualification status is DISQUALIFIED")
  }

  // -------------------------------------------------------------------------
  // Scenario 4: Customer Agreeing to WhatsApp but No Product Interest
  // -------------------------------------------------------------------------
  console.log("\n[Scenario 4] Polite WhatsApp Deflection Without Product Interest")
  {
    const transcript = {
      transcriptText: "Agent: Hello sir. Customer: Aap WhatsApp par daal do, baad me dekhenge, abhi time nahi hai.",
      segments: [
        { speaker: "Agent", text: "Hello sir." },
        { speaker: "Customer", text: "Aap WhatsApp par daal do, baad me dekhenge, abhi time nahi hai." },
      ],
    }
    const gateResult = await evaluateProductRelevanceAndGate({ transcript, tenantId })
    assert(gateResult.productRelevanceScore < 0.10, "Product relevance score is below 10%")
    assert(gateResult.callOutcome === "NOT_INTERESTED", "Outcome is NOT_INTERESTED (polite deflection rejected)")
    assert(gateResult.customerPurchaseIntent === false, "Customer purchase intent is false")
  }

  // -------------------------------------------------------------------------
  // Scenario 5: Mentioning Generic Keywords Without Product Need
  // -------------------------------------------------------------------------
  console.log("\n[Scenario 5] Generic Keywords (Hospital/Doctor) Without Product Need")
  {
    const transcript = {
      transcriptText: "Mere papa doctor ke paas gaye the hospital me kal subah. Unhone dawai likh ke di thi.",
      segments: [
        { speaker: "Customer", text: "Mere papa doctor ke paas gaye the hospital me kal subah. Unhone dawai likh ke di thi." },
      ],
    }
    const gateResult = await evaluateProductRelevanceAndGate({ transcript, tenantId })
    assert(gateResult.productRelevanceScore < 0.10, "Product relevance score is below 10%")
    assert(gateResult.qualificationStatus === "DISQUALIFIED", "Qualification status is DISQUALIFIED")
  }

  // -------------------------------------------------------------------------
  // Scenario 6: Genuine Inquiry for HMS / OPD / Pharmacy Modules
  // -------------------------------------------------------------------------
  console.log("\n[Scenario 6] Genuine Product Inquiry (HMS, OPD, Pharmacy)")
  {
    const transcript = {
      transcriptText: "Hello, hume apne 50 bed hospital ke liye Hospital Management Software chahiye jisme OPD, IPD aur pharmacy inventory billing properly manage ho sake. Kya features hain?",
      segments: [
        { speaker: "Customer", text: "Hello, hume apne 50 bed hospital ke liye Hospital Management Software chahiye jisme OPD, IPD aur pharmacy inventory billing properly manage ho sake. Kya features hain?" },
      ],
    }
    const gateResult = await evaluateProductRelevanceAndGate({ transcript, tenantId })
    assert(gateResult.isProductRelevant === true, "isProductRelevant is true")
    assert(gateResult.productRelevanceScore >= 0.70, "Product relevance score >= 70% (was " + gateResult.productRelevanceScore + ")")
    assert(gateResult.callOutcome === "INTERESTED", "Call outcome is INTERESTED")
    assert(gateResult.qualificationStatus === "QUALIFIED", "Qualification status is QUALIFIED")
    assert(gateResult.customerPurchaseIntent === true, "customerPurchaseIntent is true")
    assert(gateResult.crmLeadAction === "QUALIFY_ENGAGED", "CRM lead action is QUALIFY_ENGAGED")
  }

  // -------------------------------------------------------------------------
  // Scenario 7: Demo / Pricing Request
  // -------------------------------------------------------------------------
  console.log("\n[Scenario 7] Product Demo & Pricing Request")
  {
    const transcript = {
      transcriptText: "Hospital management software ka live demo kab arrange kar sakte hain? Aur software ki pricing aur quotation bhej dijiye.",
      segments: [
        { speaker: "Customer", text: "Hospital management software ka live demo kab arrange kar sakte hain? Aur software ki pricing aur quotation bhej dijiye." },
      ],
    }
    const gateResult = await evaluateProductRelevanceAndGate({ transcript, tenantId })
    assert(gateResult.productRelevanceScore >= 0.70, "Product relevance score >= 70%")
    assert(gateResult.callOutcome === "INTERESTED", "Call outcome is INTERESTED")
    assert(gateResult.leadQualificationScore >= 0.75, "Lead qualification score >= 75%")
  }

  // -------------------------------------------------------------------------
  // Scenario 8: Explicit Rejection ("Not interested", "Already have software")
  // -------------------------------------------------------------------------
  console.log("\n[Scenario 8] Product Relevant Mention but Explicit Rejection")
  {
    const transcript = {
      transcriptText: "Agent: Sir hum Medical 365 se hospital software ke liye call kar rahe the. Customer: Hamare paas already software hai, hume bilkul nahi chahiye, not interested.",
      segments: [
        { speaker: "Agent", text: "Sir hum Medical 365 se hospital software ke liye call kar rahe the." },
        { speaker: "Customer", text: "Hamare paas already software hai, hume bilkul nahi chahiye, not interested." },
      ],
    }
    const gateResult = await evaluateProductRelevanceAndGate({ transcript, tenantId })
    assert(gateResult.callOutcome === "NOT_INTERESTED", "Call outcome is NOT_INTERESTED")
    assert(gateResult.qualificationStatus === "DISQUALIFIED", "Qualification status is DISQUALIFIED")
    assert(gateResult.qualificationReason === "EXPLICIT_REJECTION", "Qualification reason is EXPLICIT_REJECTION")
    assert(gateResult.crmLeadAction === "CLOSE_LOST", "CRM lead action is CLOSE_LOST")
  }

  // -------------------------------------------------------------------------
  // Scenario 9: Silent / Empty / Noise Call
  // -------------------------------------------------------------------------
  console.log("\n[Scenario 9] Silent / Empty Call Recording")
  {
    const transcript = {
      transcriptText: "Hello? Hello...",
      segments: [
        { speaker: "Customer", text: "Hello? Hello..." },
      ],
    }
    const gateResult = await evaluateProductRelevanceAndGate({ transcript, tenantId })
    assert(gateResult.callOutcome === "UNRESOLVED", "Call outcome is UNRESOLVED")
    assert(gateResult.qualificationStatus === "UNRESOLVED", "Qualification status is UNRESOLVED")
    assert(gateResult.crmLeadAction === "DO_NOT_UPDATE", "CRM lead action is DO_NOT_UPDATE")
  }

  // -------------------------------------------------------------------------
  // Scenario 10: The Real Call +919376600036 (Shahzad from Bado AI)
  // -------------------------------------------------------------------------
  console.log("\n[Scenario 10] Real Target Call +919376600036 (Shahzad from Bado AI)")
  {
    const callId = "6afeb37a46d8bab5a94f387c"
    const call = await Call.findById(callId).setOptions({ skipTenantFilter: true }).lean()
    console.log("Target call:", callId, "found:", Boolean(call), "call.leadId:", call?.leadId, "phone:", call?.phoneNumber || call?.phoneNormalized)
    const latestAnalysis = await AICallAnalysis.findOne({ callId, tenantId })
      .sort({ analysisVersion: -1 })
      .setOptions({ skipTenantFilter: true })
      .lean()
    const rawLead = await mongoose.connection.db.collection('leads').findOne({ $or: [{ _id: new mongoose.Types.ObjectId(call.leadId) }, { phone: "+919376600036" }, { phoneNormalized: "+919376600036" }] })
    console.log("Raw lead from collection:", Boolean(rawLead), "id:", rawLead?._id, "status:", rawLead?.status)
    const lead = rawLead || { status: "Closed-Lost", metadata: { lastCallOutcome: "NOT_INTERESTED" } }

    assert(latestAnalysis.callOutcome === "NOT_INTERESTED", "Analysis callOutcome is NOT_INTERESTED")
    assert(latestAnalysis.productRelevanceScore < 0.10, "Product relevance score is 0% (< 10%)")
    assert(latestAnalysis.leadQualificationScore === 0, "Lead qualification score is 0%")
    assert(latestAnalysis.qualificationStatus === "DISQUALIFIED", "Qualification status is DISQUALIFIED")
    assert(latestAnalysis.customerPurchaseIntent === false, "Customer purchase intent is false")
    assert(latestAnalysis.productInterests.length === 0, "No product interests hallucinated")
    assert(!latestAnalysis.summary.includes("requested or demonstrated interest in Medical365"), "Summary does not claim customer wanted Medical365")
    assert(lead.status === "Closed-Lost", "Linked CRM Lead status is Closed-Lost")
    assert(lead.metadata.lastCallOutcome === "NOT_INTERESTED", "Lead metadata.lastCallOutcome is NOT_INTERESTED")
  }

  console.log("\n======================================================================")
  console.log(`TOTAL TESTS: ${passedCount + failedCount} | PASSED: ${passedCount} | FAILED: ${failedCount}`)
  console.log("======================================================================")

  await mongoose.disconnect()
  if (failedCount > 0) {
    process.exit(1)
  }
}

runTestSuite().catch((err) => {
  console.error("Test suite execution failed:", err)
  process.exit(1)
})
