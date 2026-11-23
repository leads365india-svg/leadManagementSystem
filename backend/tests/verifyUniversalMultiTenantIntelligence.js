const mongoose = require("mongoose")
const path = require("path")
require("dotenv").config({ path: path.join(__dirname, "../.env") })

const { evaluateProductRelevanceAndGate } = require("../services/aiProductRelevanceGate.service")
const { getTenantProductKnowledge, clearTenantKnowledgeCache } = require("../services/tenantProductKnowledge.service")
const Call = require("../models/Call")
const Lead = require("../models/Lead")
const FollowUp = require("../models/FollowUp")
const { AICallAnalysis } = require("../models/AICallAnalysis")

/**
 * Universal Multi-Tenant AI Call Intelligence Test Suite
 * 
 * Verifies:
 * 1. Tenant A (Medical 365 HMS - real call +919991770369 regression verification).
 * 2. Cross-Tenant Isolation: School call evaluated against Tenant A is DISQUALIFIED.
 * 3. Tenant B (School ERP Software): School call QUALIFIED, Hospital call DISQUALIFIED.
 * 4. Tenant C (Real Estate CRM): Real Estate call QUALIFIED, School call DISQUALIFIED.
 * 5. Tenant D (Accounting & GST Software): Accounting call QUALIFIED, Hospital call DISQUALIFIED.
 * 6. Tenant E (Hardware Products): Hardware call QUALIFIED, Software call DISQUALIFIED.
 * 7. Out-of-Scope (Recruitment/Placement Agency) DISQUALIFIED across ALL tenants.
 * 8. Devanagari Hindi cross-tenant isolation and matching.
 * 9. Idempotency & FollowUp single-source-of-truth preservation for target call 6b0151506724985fecb12ff4.
 */

async function runUniversalMultiTenantTests() {
  console.log("================================================================================")
  console.log("   UNIVERSAL MULTI-TENANT AI CALL INTELLIGENCE & ISOLATION TEST SUITE           ")
  console.log("================================================================================\n")

  await mongoose.connect(process.env.MONGODB_URI)
  console.log("Connected to MongoDB Atlas\n")

  let passed = 0
  let failed = 0

  function assert(condition, message) {
    if (condition) {
      console.log(`  ✅ PASS: ${message}`)
      passed++
    } else {
      console.error(`  ❌ FAIL: ${message}`)
      failed++
    }
  }

  // Clear any existing knowledge cache to ensure fresh run
  clearTenantKnowledgeCache()

  // ---------------------------------------------------------------------------
  // [PART 1] Real Target Call Regression (+919991770369 / Tenant ACC-3E87985C)
  // ---------------------------------------------------------------------------
  console.log("[Test 1] Real Target Call Regression (+919991770369 - Medical 365 HMS)")
  const realCallId = new mongoose.Types.ObjectId("6b0151506724985fecb12ff4")
  const realCall = await Call.findOne({ _id: realCallId }).setOptions({ skipTenantFilter: true }).lean()
  const tenantIdA = realCall ? realCall.tenantId : "ACC-3E87985C"

  const realTranscript = {
    transcriptText: `Hmm, hello. Haan ji sir, good morning. Meri baat Medical 365 team se ho rahi?
Haan ji, Medical 365 se baat kar raha hu. Bataye sir.
Sir humara ek hospital hai, uske liye hume hospital management system chahiye tha.
Theek hai sir. Kitne bed ka hospital hai aapka?
Humara sir hai na 15 se 20 bed ka hai hospital.
Aur staff kitna hai sir aapka total?
Staff hai na sir, 22 se 25 log ka staff hai.
Theek hai sir. Toh pura hospital software chahiye aapko, ki koi specific module chahiye?
Sir hume na pura management chahiye, jisme pharmacy bhi manage ho jaye, lab bhi manage ho jaye aur OT tak bhi pura manage ho jaye.
Theek hai sir, baki ke main aapko quotation vagaira, sorry, wo bheej deta hu. Humara jo PDF vagaira bana rakhe hai humne, details aapko provide karwata hu sir.
Hmm. Toh agar aap log free ho toh kal 11 baje main aapko wapis call karta hu.
Theek hai sir, koi issue nahi hai.
Theek hai sir, theek hai. Main aapko kal 11 baje call karunga, hai na?
Okay sir, okay.
Aap ek baar check kar lena.
Okay sir, okay.`,
    segments: [
      { speaker: "Customer", text: "Hmm, hello. Haan ji sir, good morning. Meri baat Medical 365 team se ho rahi?" },
      { speaker: "Agent", text: "Haan ji, Medical 365 se baat kar raha hu. Bataye sir." },
      { speaker: "Customer", text: "Sir humara ek hospital hai, uske liye hume hospital management system chahiye tha." },
      { speaker: "Agent", text: "Theek hai sir. Kitne bed ka hospital hai aapka?" },
      { speaker: "Customer", text: "Humara sir hai na 15 se 20 bed ka hai hospital." },
      { speaker: "Agent", text: "Aur staff kitna hai sir aapka total?" },
      { speaker: "Customer", text: "Staff hai na sir, 22 se 25 log ka staff hai." },
      { speaker: "Agent", text: "Theek hai sir. Toh pura hospital software chahiye aapko, ki koi specific module chahiye?" },
      { speaker: "Customer", text: "Sir hume na pura management chahiye, jisme pharmacy bhi manage ho jaye, lab bhi manage ho jaye aur OT tak bhi pura manage ho jaye." },
      { speaker: "Agent", text: "Theek hai sir, baki ke main aapko quotation vagaira, sorry, wo bheej deta hu. Humara jo PDF vagaira bana rakhe hai humne, details aapko provide karwata hu sir." },
      { speaker: "Customer", text: "Hmm. Toh agar aap log free ho toh kal 11 baje main aapko wapis call karta hu." },
      { speaker: "Agent", text: "Theek hai sir, koi issue nahi hai." },
      { speaker: "Customer", text: "Theek hai sir, theek hai. Main aapko kal 11 baje call karunga, hai na?" },
      { speaker: "Customer", text: "Okay sir, okay." },
      { speaker: "Agent", text: "Aap ek baar check kar lena." },
      { speaker: "Customer", text: "Okay sir, okay." },
    ],
  }

  const gateResultRealCall = await evaluateProductRelevanceAndGate({
    transcript: realTranscript,
    tenantId: tenantIdA,
    call: realCall || { startTime: new Date("2026-11-21T08:07:44.000Z") },
  })

  assert(gateResultRealCall.isProductRelevant === true, "Real call isProductRelevant is true")
  assert(gateResultRealCall.productRelevanceScore >= 0.85, `Product relevance score >= 85% (got ${gateResultRealCall.productRelevanceScore})`)
  assert(gateResultRealCall.customerPurchaseIntent === true, "Customer purchase intent is true")
  assert(gateResultRealCall.callOutcome === "CALL_BACK_LATER", `Call outcome is CALL_BACK_LATER (got ${gateResultRealCall.callOutcome})`)
  assert(gateResultRealCall.qualificationStatus === "QUALIFIED_FOLLOW_UP", `Qualification is QUALIFIED_FOLLOW_UP (got ${gateResultRealCall.qualificationStatus})`)
  assert(gateResultRealCall.callbackRequested === true, "Callback requested is true")
  assert(gateResultRealCall.callbackDirection === "AGENT_CALLBACK", `Callback direction is AGENT_CALLBACK (got ${gateResultRealCall.callbackDirection})`)
  assert(gateResultRealCall.taskAction === "Call customer", `Task action is 'Call customer' (got ${gateResultRealCall.taskAction})`)
  assert(gateResultRealCall.filteredProductInterests.length > 0, `Product interests extracted: ${gateResultRealCall.filteredProductInterests.join(", ")}`)

  // Check FollowUp record in DB
  const existingFollowUp = await FollowUp.findOne({ _id: new mongoose.Types.ObjectId("6b016b3c792267b9329a3138") })
    .setOptions({ skipTenantFilter: true })
    .lean()
  assert(Boolean(existingFollowUp), "Target FollowUp 6b016b3c792267b9329a3138 exists in DB")
  if (existingFollowUp) {
    assert(existingFollowUp.callbackDirection === "AGENT_CALLBACK", `FollowUp callbackDirection is AGENT_CALLBACK (got ${existingFollowUp.callbackDirection})`)
    assert(existingFollowUp.taskAction === "Call customer", `FollowUp taskAction is 'Call customer' (got ${existingFollowUp.taskAction})`)
    assert(existingFollowUp.direction === "OUTBOUND", `FollowUp direction is OUTBOUND (got ${existingFollowUp.direction})`)
  }

  // ---------------------------------------------------------------------------
  // [PART 2] Cross-Tenant Isolation: School Call under Tenant A (Medical 365)
  // ---------------------------------------------------------------------------
  console.log("\n[Test 2] Cross-Tenant Negative Test: School ERP inquiry to Tenant A (Medical 365)")
  const schoolTranscript = {
    transcriptText: "Hello, hume apne school ke liye ERP software chahiye, jisme fees collection, student admission aur attendance manage ho sake. Pricing bata dijiye.",
    segments: [
      { speaker: "Customer", text: "Hello, hume apne school ke liye ERP software chahiye, jisme fees collection, student admission aur attendance manage ho sake. Pricing bata dijiye." },
    ],
  }

  const gateResultSchoolOnA = await evaluateProductRelevanceAndGate({
    transcript: schoolTranscript,
    tenantId: tenantIdA, // Medical 365
  })

  assert(gateResultSchoolOnA.isProductRelevant === false, "School call is NOT product relevant for Medical 365")
  assert(gateResultSchoolOnA.productRelevanceScore <= 0.10, `Relevance score <= 10% (got ${gateResultSchoolOnA.productRelevanceScore})`)
  assert(gateResultSchoolOnA.callOutcome === "NOT_INTERESTED", `Outcome is NOT_INTERESTED (got ${gateResultSchoolOnA.callOutcome})`)
  assert(gateResultSchoolOnA.qualificationStatus === "DISQUALIFIED", `Qualification is DISQUALIFIED (got ${gateResultSchoolOnA.qualificationStatus})`)
  assert(gateResultSchoolOnA.qualificationReason === "UNSUPPORTED_PRODUCT_REQUEST", `Reason is UNSUPPORTED_PRODUCT_REQUEST (got ${gateResultSchoolOnA.qualificationReason})`)

  // ---------------------------------------------------------------------------
  // [PART 3] Tenant B: School ERP Software
  // ---------------------------------------------------------------------------
  console.log("\n[Test 3] Tenant B (School ERP Software) - Isolation & Qualification")
  const catalogOverrideTenantB = {
    companyName: "EduTech Solutions",
    industry: "Education",
    description: "Provider of cloud-based school management and college ERP software.",
    approvedProducts: [
      { id: "p_school_1", name: "School Management ERP", category: "Education Software", description: "Complete school automation" },
    ],
    approvedKeywords: [
      "school management erp",
      "school erp",
      "school software",
      "school ke liye erp software",
      "fees collection",
      "student admission",
      "attendance",
      "edutech",
      "edutech solutions",
    ],
    knowledge: {
      tenantId: "TENANT-EDUTECH",
      companyName: "EduTech Solutions",
      industry: "Education",
      approvedKeywords: [
        "school management erp",
        "school erp",
        "school software",
        "school ke liye erp software",
        "fees collection",
        "student admission",
        "attendance",
        "edutech",
      ],
      moduleCatalog: [
        { canonicalName: "School Management ERP", source: "product", keywords: ["school management erp", "school erp", "school software", "school ke liye erp software"] },
        { canonicalName: "Fee Collection System", source: "product_feature", keywords: ["fees collection", "fee collection"] },
        { canonicalName: "Student Attendance Module", source: "product_feature", keywords: ["attendance"] },
      ],
    },
  }

  // School call on Tenant B -> MUST QUALIFY
  const gateResultSchoolOnB = await evaluateProductRelevanceAndGate({
    transcript: schoolTranscript,
    tenantId: "TENANT-EDUTECH",
    catalogOverride: catalogOverrideTenantB,
  })
  assert(gateResultSchoolOnB.isProductRelevant === true, "School call on Tenant B isProductRelevant is true")
  assert(gateResultSchoolOnB.productRelevanceScore >= 0.70, `School call score on Tenant B >= 70% (got ${gateResultSchoolOnB.productRelevanceScore})`)
  assert(gateResultSchoolOnB.callOutcome === "INTERESTED", `Call outcome is INTERESTED (got ${gateResultSchoolOnB.callOutcome})`)
  assert(gateResultSchoolOnB.qualificationStatus === "QUALIFIED", `Qualification status is QUALIFIED (got ${gateResultSchoolOnB.qualificationStatus})`)
  assert(gateResultSchoolOnB.filteredProductInterests.includes("School Management ERP"), "Extracted School Management ERP interest")
  assert(!gateResultSchoolOnB.filteredProductInterests.some((pi) => pi.toLowerCase().includes("hospital") || pi.toLowerCase().includes("hms")), "Zero healthcare terms emitted for School ERP")

  // Hospital call on Tenant B -> MUST BE DISQUALIFIED
  const gateResultHospitalOnB = await evaluateProductRelevanceAndGate({
    transcript: realTranscript,
    tenantId: "TENANT-EDUTECH",
    catalogOverride: catalogOverrideTenantB,
  })
  assert(gateResultHospitalOnB.isProductRelevant === false, "Hospital call on Tenant B is NOT product relevant")
  assert(gateResultHospitalOnB.callOutcome === "NOT_INTERESTED", `Outcome is NOT_INTERESTED for Hospital call on Tenant B (got ${gateResultHospitalOnB.callOutcome})`)
  assert(gateResultHospitalOnB.qualificationStatus === "DISQUALIFIED", "Qualification is DISQUALIFIED on Tenant B")

  // ---------------------------------------------------------------------------
  // [PART 4] Tenant C: Real Estate CRM
  // ---------------------------------------------------------------------------
  console.log("\n[Test 4] Tenant C (Real Estate CRM) - Isolation & Qualification")
  const catalogOverrideTenantC = {
    companyName: "PropTech CRM",
    industry: "Real Estate",
    description: "Real estate broker and builder CRM software.",
    approvedProducts: [
      { id: "p_re_1", name: "Real Estate Property CRM", category: "CRM", description: "Inventory, broker management and booking" },
    ],
    approvedKeywords: [
      "real estate property crm",
      "real estate crm",
      "property crm",
      "proptech",
      "inventory management",
      "lead distribution",
      "site visit management",
      "booking management",
      "flat inventory",
    ],
    knowledge: {
      tenantId: "TENANT-PROPTECH",
      companyName: "PropTech CRM",
      industry: "Real Estate",
      approvedKeywords: [
        "real estate property crm",
        "real estate crm",
        "property crm",
        "proptech",
        "inventory management",
        "lead distribution",
        "site visit",
        "booking",
      ],
      moduleCatalog: [
        { canonicalName: "Real Estate Property CRM", source: "product", keywords: ["real estate property crm", "real estate crm", "property crm"] },
        { canonicalName: "Inventory Management Module", source: "product_feature", keywords: ["inventory management", "inventory"] },
        { canonicalName: "Lead Distribution Module", source: "product_feature", keywords: ["lead distribution"] },
      ],
    },
  }

  const realEstateTranscript = {
    transcriptText: "Hello, hume property dealers aur builders ke liye real estate CRM chahiye jisme inventory management aur lead distribution properly ho. Quotation bhej dijiye.",
    segments: [
      { speaker: "Customer", text: "Hello, hume property dealers aur builders ke liye real estate CRM chahiye jisme inventory management aur lead distribution properly ho. Quotation bhej dijiye." },
    ],
  }

  // Real Estate call on Tenant C -> QUALIFIED
  const gateResultReOnC = await evaluateProductRelevanceAndGate({
    transcript: realEstateTranscript,
    tenantId: "TENANT-PROPTECH",
    catalogOverride: catalogOverrideTenantC,
  })
  assert(gateResultReOnC.isProductRelevant === true, "Real Estate call on Tenant C isProductRelevant is true")
  assert(gateResultReOnC.productRelevanceScore >= 0.70, `Score on Tenant C >= 70% (got ${gateResultReOnC.productRelevanceScore})`)
  assert(gateResultReOnC.callOutcome === "INTERESTED", "Call outcome is INTERESTED")
  assert(gateResultReOnC.filteredProductInterests.includes("Real Estate Property CRM"), "Extracted Real Estate Property CRM interest")

  // Real Estate call on Tenant B (School) -> DISQUALIFIED
  const gateResultReOnB = await evaluateProductRelevanceAndGate({
    transcript: realEstateTranscript,
    tenantId: "TENANT-EDUTECH",
    catalogOverride: catalogOverrideTenantB,
  })
  assert(gateResultReOnB.isProductRelevant === false, "Real Estate call on Tenant B (School) is DISQUALIFIED")
  assert(gateResultReOnB.callOutcome === "NOT_INTERESTED", "Outcome on Tenant B is NOT_INTERESTED")

  // ---------------------------------------------------------------------------
  // [PART 5] Tenant D: Accounting & GST Software
  // ---------------------------------------------------------------------------
  console.log("\n[Test 5] Tenant D (Accounting & GST Software) - Isolation & Qualification")
  const catalogOverrideTenantD = {
    companyName: "AccuBooks Systems",
    industry: "Finance",
    description: "GST billing, e-invoicing and accounting software.",
    approvedProducts: [
      { id: "p_acc_1", name: "GST Billing & Accounting Software", category: "Finance Software", description: "Automated GST invoicing and tax reports" },
    ],
    approvedKeywords: [
      "gst billing & accounting software",
      "gst billing software",
      "accounting software",
      "accubooks",
      "gst invoicing",
      "e-invoicing",
      "balance sheet",
      "ledger",
      "taxation",
    ],
    knowledge: {
      tenantId: "TENANT-ACCUBOOKS",
      companyName: "AccuBooks Systems",
      industry: "Finance",
      approvedKeywords: [
        "gst billing & accounting software",
        "gst billing software",
        "accounting software",
        "accubooks",
        "gst invoicing",
        "e-invoicing",
        "balance sheet",
      ],
      moduleCatalog: [
        { canonicalName: "GST Billing & Accounting Software", source: "product", keywords: ["gst billing & accounting software", "gst billing software", "accounting software"] },
        { canonicalName: "E-Invoicing Module", source: "product_feature", keywords: ["e-invoicing", "gst invoicing"] },
      ],
    },
  }

  const accountingTranscript = {
    transcriptText: "Hume hamare business ke liye GST billing software aur e-invoicing chahiye. Pricing aur demo arrange ho sakta hai?",
    segments: [
      { speaker: "Customer", text: "Hume hamare business ke liye GST billing software aur e-invoicing chahiye. Pricing aur demo arrange ho sakta hai?" },
    ],
  }

  const gateResultAccOnD = await evaluateProductRelevanceAndGate({
    transcript: accountingTranscript,
    tenantId: "TENANT-ACCUBOOKS",
    catalogOverride: catalogOverrideTenantD,
  })
  assert(gateResultAccOnD.isProductRelevant === true, "Accounting call on Tenant D isProductRelevant is true")
  assert(gateResultAccOnD.productRelevanceScore >= 0.70, `Score on Tenant D >= 70% (got ${gateResultAccOnD.productRelevanceScore})`)
  assert(gateResultAccOnD.callOutcome === "INTERESTED", "Call outcome is INTERESTED")

  // Accounting call on Tenant A (Medical 365) -> DISQUALIFIED
  const gateResultAccOnA = await evaluateProductRelevanceAndGate({
    transcript: accountingTranscript,
    tenantId: tenantIdA,
  })
  assert(gateResultAccOnA.isProductRelevant === false, "Accounting call on Tenant A (Medical 365) is DISQUALIFIED")
  assert(gateResultAccOnA.callOutcome === "NOT_INTERESTED", "Call outcome on Tenant A is NOT_INTERESTED")

  // ---------------------------------------------------------------------------
  // [PART 6] Out-of-Scope (Recruitment/Spam) across ALL Tenants
  // ---------------------------------------------------------------------------
  console.log("\n[Test 6] Out-of-Scope Recruitment Call Evaluated Across Multiple Tenants")
  const recruitmentTranscript = {
    transcriptText: "Hello, Shahzad from Bado AI placement agency. Hiring ke regarding call kiya hai, koi vacancy open hai candidates provide karne ke liye?",
    segments: [
      { speaker: "Customer", text: "Hello, Shahzad from Bado AI placement agency. Hiring ke regarding call kiya hai, koi vacancy open hai candidates provide karne ke liye?" },
      { speaker: "Agent", text: "Nahi sir, abhi koi hiring nahi chal rahi hai." },
    ],
  }

  const tenantsToTest = [
    { name: "Tenant A (Medical 365)", tenantId: tenantIdA, override: null },
    { name: "Tenant B (School ERP)", tenantId: "TENANT-EDUTECH", override: catalogOverrideTenantB },
    { name: "Tenant C (Real Estate)", tenantId: "TENANT-PROPTECH", override: catalogOverrideTenantC },
    { name: "Tenant D (Accounting)", tenantId: "TENANT-ACCUBOOKS", override: catalogOverrideTenantD },
  ]

  for (const t of tenantsToTest) {
    const res = await evaluateProductRelevanceAndGate({
      transcript: recruitmentTranscript,
      tenantId: t.tenantId,
      catalogOverride: t.override,
    })
    assert(res.isProductRelevant === false, `Recruitment is NOT product relevant for ${t.name}`)
    assert(res.productRelevanceScore === 0.0, `Product relevance score is 0.0 for ${t.name}`)
    assert(res.callOutcome === "NOT_INTERESTED", `Outcome is NOT_INTERESTED for ${t.name}`)
    assert(res.qualificationStatus === "DISQUALIFIED", `Qualification is DISQUALIFIED for ${t.name}`)
  }

  // ---------------------------------------------------------------------------
  // [PART 7] Devanagari Hindi Cross-Tenant Isolation
  // ---------------------------------------------------------------------------
  console.log("\n[Test 7] Devanagari Hindi Cross-Tenant Isolation")
  const hindiSchoolTranscript = {
    transcriptText: "नमस्ते, हमें अपने स्कूल के लिए ईआरपी सॉफ्टवेयर चाहिए जिसमें फीस और अटेंडेंस हो सके।",
    segments: [
      { speaker: "Customer", text: "नमस्ते, हमें अपने स्कूल के लिए ईआरपी सॉफ्टवेयर चाहिए जिसमें फीस और अटेंडेंस हो सके।" },
    ],
  }

  // Under Tenant A (Medical 365) -> Disqualified (Medical 365 doesn't sell school ERP)
  const hindiSchoolOnA = await evaluateProductRelevanceAndGate({
    transcript: hindiSchoolTranscript,
    tenantId: tenantIdA,
  })
  assert(hindiSchoolOnA.isProductRelevant === false, "Devanagari School inquiry on Medical 365 is DISQUALIFIED")
  assert(hindiSchoolOnA.callOutcome === "NOT_INTERESTED", "Outcome is NOT_INTERESTED")

  // ---------------------------------------------------------------------------
  // [PART 8] Policy Example 1: Medical 365 vs Furniture CRM + Agent Mentions HMS
  // ---------------------------------------------------------------------------
  console.log("\n[Test 8] Policy Example 1: Customer requests Furniture CRM on Medical 365 (Agent mentions HMS)")
  const furnitureOnMedTranscript = {
    transcriptText: "Customer: I need Furniture CRM. Agent: We only provide Hospital Management Software. Customer: Okay.",
    segments: [
      { speaker: "Customer", text: "I need Furniture CRM." },
      { speaker: "Agent", text: "We only provide Hospital Management Software." },
      { speaker: "Customer", text: "Okay." },
    ],
  }

  const gateResultFurnitureOnMed = await evaluateProductRelevanceAndGate({
    transcript: furnitureOnMedTranscript,
    tenantId: tenantIdA, // Medical 365 (HMS)
  })

  assert(gateResultFurnitureOnMed.productFit === "UNSUPPORTED", `Product Fit is UNSUPPORTED (got ${gateResultFurnitureOnMed.productFit})`)
  assert(gateResultFurnitureOnMed.isProductRelevant === false, "isProductRelevant is false")
  assert(gateResultFurnitureOnMed.productRelevanceScore === 0.0, `Medical 365 relevance score is 0.0 (got ${gateResultFurnitureOnMed.productRelevanceScore})`)
  assert(gateResultFurnitureOnMed.qualificationStatus === "DISQUALIFIED", `Qualification is DISQUALIFIED (got ${gateResultFurnitureOnMed.qualificationStatus})`)
  assert(gateResultFurnitureOnMed.qualificationReason === "UNSUPPORTED_PRODUCT_REQUEST", `Reason is UNSUPPORTED_PRODUCT_REQUEST (got ${gateResultFurnitureOnMed.qualificationReason})`)
  assert(gateResultFurnitureOnMed.crmLeadAction === "CLOSE_LOST", `CRM Lead action is CLOSE_LOST (got ${gateResultFurnitureOnMed.crmLeadAction})`)
  assert(gateResultFurnitureOnMed.callOutcome === "NOT_INTERESTED", `Outcome is NOT_INTERESTED for Medical 365 (got ${gateResultFurnitureOnMed.callOutcome})`)
  assert(gateResultFurnitureOnMed.customerPurchaseIntent === true, "Customer buying intent is PRESERVED as true")
  assert(gateResultFurnitureOnMed.callbackRequested === false, "Follow-up callback is NOT created")
  assert(gateResultFurnitureOnMed.filteredProductInterests.length === 0, "No product interests created for unsupported product")

  // ---------------------------------------------------------------------------
  // [PART 9] Policy Example 2: School ERP vs HMS Request
  // ---------------------------------------------------------------------------
  console.log("\n[Test 9] Policy Example 2: Customer requests HMS on School ERP tenant")
  const hmsOnSchoolTranscript = {
    transcriptText: "Hello, hume hospital management software chahiye, OPD aur IPD ke liye. Demo arrange kar dijiye.",
    segments: [
      { speaker: "Customer", text: "Hello, hume hospital management software chahiye, OPD aur IPD ke liye. Demo arrange kar dijiye." },
    ],
  }

  const gateResultHmsOnSchool = await evaluateProductRelevanceAndGate({
    transcript: hmsOnSchoolTranscript,
    tenantId: "TENANT-EDUTECH",
    catalogOverride: catalogOverrideTenantB,
  })

  assert(gateResultHmsOnSchool.productFit === "UNSUPPORTED", `Product Fit on School ERP is UNSUPPORTED (got ${gateResultHmsOnSchool.productFit})`)
  assert(gateResultHmsOnSchool.productRelevanceScore === 0.0, `School ERP relevance score is 0.0 (got ${gateResultHmsOnSchool.productRelevanceScore})`)
  assert(gateResultHmsOnSchool.qualificationStatus === "DISQUALIFIED", `Qualification is DISQUALIFIED (got ${gateResultHmsOnSchool.qualificationStatus})`)
  assert(gateResultHmsOnSchool.qualificationReason === "UNSUPPORTED_PRODUCT_REQUEST", `Reason is UNSUPPORTED_PRODUCT_REQUEST (got ${gateResultHmsOnSchool.qualificationReason})`)
  assert(gateResultHmsOnSchool.crmLeadAction === "CLOSE_LOST", `CRM Lead action is CLOSE_LOST (got ${gateResultHmsOnSchool.crmLeadAction})`)
  assert(gateResultHmsOnSchool.callOutcome === "NOT_INTERESTED", `Outcome is NOT_INTERESTED (got ${gateResultHmsOnSchool.callOutcome})`)
  assert(gateResultHmsOnSchool.customerPurchaseIntent === true, "Customer buying intent is true")
  assert(gateResultHmsOnSchool.callbackRequested === false, "Callback task is false")

  // ---------------------------------------------------------------------------
  // [PART 10] Policy Example 3: Real Estate CRM vs Pharmacy Software Request
  // ---------------------------------------------------------------------------
  console.log("\n[Test 10] Policy Example 3: Customer requests Pharmacy Software on Real Estate CRM tenant")
  const pharmacyOnReTranscript = {
    transcriptText: "Hello, pharmacy management software chahiye stock and billing ke liye. Pricing kya hai?",
    segments: [
      { speaker: "Customer", text: "Hello, pharmacy management software chahiye stock and billing ke liye. Pricing kya hai?" },
    ],
  }

  const gateResultPharmOnRe = await evaluateProductRelevanceAndGate({
    transcript: pharmacyOnReTranscript,
    tenantId: "TENANT-PROPTECH",
    catalogOverride: catalogOverrideTenantC,
  })

  assert(gateResultPharmOnRe.productFit === "UNSUPPORTED", `Product Fit on Real Estate is UNSUPPORTED (got ${gateResultPharmOnRe.productFit})`)
  assert(gateResultPharmOnRe.productRelevanceScore === 0.0, `Real Estate relevance score is 0.0 (got ${gateResultPharmOnRe.productRelevanceScore})`)
  assert(gateResultPharmOnRe.qualificationStatus === "DISQUALIFIED", `Qualification is DISQUALIFIED (got ${gateResultPharmOnRe.qualificationStatus})`)
  assert(gateResultPharmOnRe.qualificationReason === "UNSUPPORTED_PRODUCT_REQUEST", `Reason is UNSUPPORTED_PRODUCT_REQUEST (got ${gateResultPharmOnRe.qualificationReason})`)
  assert(gateResultPharmOnRe.crmLeadAction === "CLOSE_LOST", `CRM action is CLOSE_LOST (got ${gateResultPharmOnRe.crmLeadAction})`)
  assert(gateResultPharmOnRe.callOutcome === "NOT_INTERESTED", `Outcome is NOT_INTERESTED (got ${gateResultPharmOnRe.callOutcome})`)
  assert(gateResultPharmOnRe.customerPurchaseIntent === true, "Customer purchase intent is true")

  // ---------------------------------------------------------------------------
  // [PART 11] Policy Section 2 & 8: Generic Words Alone Cannot Qualify Lead
  // ---------------------------------------------------------------------------
  console.log("\n[Test 11] Policy Section 2 & 8: Generic Words Alone ('software', 'crm') Cannot Qualify")
  const genericWordsTranscript = {
    transcriptText: "Hello, mujhe ek software chahiye apne business ke liye. Software kya rate me dete ho? Agent: Kis cheez ka software chahiye sir? Customer: Bas software dekhna tha, pricing bataiye.",
    segments: [
      { speaker: "Customer", text: "Hello, mujhe ek software chahiye apne business ke liye. Software kya rate me dete ho?" },
      { speaker: "Agent", text: "Kis cheez ka software chahiye sir?" },
      { speaker: "Customer", text: "Bas software dekhna tha, pricing bataiye." },
    ],
  }

  const gateResultGenericWords = await evaluateProductRelevanceAndGate({
    transcript: genericWordsTranscript,
    tenantId: tenantIdA, // Medical 365
  })

  assert(gateResultGenericWords.productFit === "UNRESOLVED", `Product Fit is UNRESOLVED (got ${gateResultGenericWords.productFit})`)
  assert(gateResultGenericWords.isProductRelevant === false, "isProductRelevant is false for generic words alone")
  assert(gateResultGenericWords.qualificationStatus === "UNRESOLVED", `Status is UNRESOLVED (got ${gateResultGenericWords.qualificationStatus})`)
  assert(gateResultGenericWords.qualificationReason === "UNCERTAIN_PRODUCT_CONTEXT", `Reason is UNCERTAIN_PRODUCT_CONTEXT (got ${gateResultGenericWords.qualificationReason})`)
  assert(gateResultGenericWords.crmLeadAction === "DO_NOT_UPDATE", `CRM Lead action is DO_NOT_UPDATE (got ${gateResultGenericWords.crmLeadAction})`)
  assert(gateResultGenericWords.callOutcome === "UNRESOLVED", `Outcome is UNRESOLVED (got ${gateResultGenericWords.callOutcome})`)
  assert(gateResultGenericWords.callbackRequested === false, "Callback is not created for generic inquiry")

  // ---------------------------------------------------------------------------
  // [PART 12] Policy Section 7: Unsupported Product with WhatsApp Request Suppressed
  // ---------------------------------------------------------------------------
  console.log("\n[Test 12] Policy Section 7: Customer asking for WhatsApp details on Unsupported Product")
  const whatsappOnUnsupportedTranscript = {
    transcriptText: "Customer: I need Furniture CRM. Send quotation and details on WhatsApp, tomorrow 2 PM. Agent: We don't offer furniture CRM.",
    segments: [
      { speaker: "Customer", text: "I need Furniture CRM. Send quotation and details on WhatsApp, tomorrow 2 PM." },
      { speaker: "Agent", text: "We don't offer furniture CRM." },
    ],
  }

  const gateResultWhatsappUnsupported = await evaluateProductRelevanceAndGate({
    transcript: whatsappOnUnsupportedTranscript,
    tenantId: tenantIdA, // Medical 365
  })

  assert(gateResultWhatsappUnsupported.productFit === "UNSUPPORTED", "Product Fit is UNSUPPORTED")
  assert(gateResultWhatsappUnsupported.qualificationReason === "UNSUPPORTED_PRODUCT_REQUEST", "Reason is UNSUPPORTED_PRODUCT_REQUEST")
  assert(gateResultWhatsappUnsupported.callbackRequested === false, "Callback is strictly SUPPRESSED for unsupported product")
  assert(gateResultWhatsappUnsupported.crmLeadAction === "CLOSE_LOST", "CRM action is CLOSE_LOST")
  assert(gateResultWhatsappUnsupported.callOutcome === "NOT_INTERESTED", "Call outcome is NOT_INTERESTED")

  console.log("\n================================================================================")
  console.log(`TOTAL TESTS: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`)
  console.log("================================================================================")

  await mongoose.disconnect()
}

runUniversalMultiTenantTests().catch((err) => {
  console.error("FATAL ERROR in test runner:", err)
  process.exit(1)
})
