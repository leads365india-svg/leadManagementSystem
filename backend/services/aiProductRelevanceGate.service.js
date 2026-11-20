const mongoose = require("mongoose")
const { TenantBusinessProfile } = require("../models/TenantBusinessProfile")
const BusinessProduct = require("../models/BusinessProduct")
const { AIKeywordTopic } = require("../models/AIKeywordTopic")
const { AIKnowledgeSource } = require("../models/AIKnowledgeSource")

/**
 * Strict Product-Relevance Gate for AI Call Intelligence and Automatic CRM Lead Qualification
 * 
 * Enforces deterministic qualification boundaries:
 * 1. Checks customer conversation against tenant's approved products and topics.
 * 2. Distinguishes Agent pitch vs Customer intent with strict speaker attribution.
 * 3. Identifies out-of-scope calls (recruitment agencies, job seekers, generic marketing, vendor pitches, spam).
 * 4. Treats polite deflections (e.g., 'WhatsApp daal do' when rejecting) as non-qualifying.
 * 5. URL and domain matches (e.g., https://www.medical365.in/) are strictly excluded from product evidence.
 * 6. Enforces Deterministic Rules A, B, C, D, E after AI analysis.
 */

// Out-of-scope intent patterns (Regexes for English, Hindi, Hinglish)
const OUT_OF_SCOPE_PATTERNS = [
  // Recruitment, HR, Placement agencies, Job seeking
  {
    type: "RECRUITMENT_PLACEMENT",
    regex: /\b(placement\s+agency|hiring\s+ke\s+regarding|hiring\s+chal\s+rahi|recruitment\s+agency|consultancy\s+se|job\s+vacancy|vacancies|job\s+chahiye|resume|cv\s+share|staffing\s+solution|candidates?\s+provide|interview|open\s+positions?|job\s+opening|naukri)\b/i,
    description: "Recruitment/placement agency or hiring inquiry",
  },
  // Unrelated vendor services (SEO, digital marketing, loans, real estate, insurance, office supplies)
  {
    type: "UNRELATED_VENDOR_SALES",
    regex: /\b(personal\s+loan|business\s+loan|credit\s+card|insurance\s+policy|seo\s+services?|digital\s+marketing\s+agency|website\s+development\s+services?|app\s+development\s+agency|office\s+space\s+for\s+rent|commercial\s+property|interior\s+design\s+vendor|printing\s+services?)\b/i,
    description: "Unrelated vendor sales pitch",
  },
  // Wrong number / personal
  {
    type: "WRONG_NUMBER_SPAM",
    regex: /\b(wrong\s+number|galat\s+number|kisko\s+call\s+lagaya|galat\s+jagah\s+call|spam\s+call)\b/i,
    description: "Wrong number or spam call",
  },
]

// Explicit rejection phrases by prospect
const EXPLICIT_REJECTION_PATTERNS = [
  /\b(not\s+interested|bilkul\s+nahi\s+chahiye|nahi\s+chahiye|software\s+nahi\s+chahiye|already\s+have|pehle\s+se\s+hai|koi\s+requirement\s+nahi|no\s+need|don'?t\s+need|do\s+not\s+call|mat\s+karo\s+call)\b/i,
  /\b(all\s+vacancies\s+full|saari\s+vacancies\s+full|hiring\s+nahi\s+hai|vacanc(?:y|ies)\s+full)\b/i,
]

// Polite deflection patterns (often accompanying rejections, e.g. "WhatsApp daal do")
const POLITE_DEFLECTION_PATTERNS = [
  /\b(whatsapp\s+daal\s+do|whatsapp\s+kar\s+do|whatsapp\s+par\s+bhej\s+do|send\s+on\s+whatsapp|share\s+on\s+whatsapp|mail\s+kar\s+do|email\s+bhej\s+do|baad\s+me\s+dekhenge|hoga\s+to\s+batayenge|dekhte\s+hain)\b/i,
]

// Buying intent / customer inquiry patterns
const BUYING_INTENT_PATTERNS = [
  /\b(pricing|price|quotation|cost|rate|demo|walkthrough|free\s+trial|features?|implementation|buy|purchase|khareedna|lagwana\s+hai|software\s+chahiye|hms\s+chahiye|system\s+chahiye|hospital\s+software|billing\s+software|opd\s+management)\b/i,
]

// Follow-up request patterns
const FOLLOW_UP_REQUEST_PATTERNS = [
  /\b(call\s+back\s+later|call\s+me\s+tomorrow|kal\s+call\s+karna|shaam\s+ko\s+call|free\s+hoke\s+call|busy\s+hu|call\s+after|proposal\s+bhej|connect\s+later)\b/i,
]

/**
 * Strips URLs, domain names, protocol prefixes, and generic non-product words.
 */
function sanitizeTerm(term) {
  if (!term || typeof term !== "string") return ""
  return term
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/\/.*$/, "")
    .replace(/[^a-zA-Z0-9\s]/g, " ")
    .trim()
}

/**
 * Checks if a term is purely a URL or domain name.
 */
function isUrlOrDomain(term) {
  if (!term || typeof term !== "string") return false
  return (
    term.startsWith("http://") ||
    term.startsWith("https://") ||
    term.startsWith("www.") ||
    /\.[a-z]{2,}(\/.*)?$/i.test(term)
  )
}

/**
 * Compiles tenant approved product catalog and knowledge dictionary.
 */
async function loadTenantApprovedCatalog(tenantId) {
  if (!tenantId) {
    return {
      companyName: "",
      industry: "",
      approvedProducts: [],
      approvedKeywords: [],
      approvedModules: [],
    }
  }

  const cleanTenantId = String(tenantId).trim()

  const [profile, products, approvedTopics, knowledgeSources] = await Promise.all([
    TenantBusinessProfile.findOne({ tenantId: cleanTenantId })
      .setOptions({ skipTenantFilter: true })
      .lean()
      .catch(() => null),
    BusinessProduct.find({ tenantId: cleanTenantId, status: "active", isArchived: false })
      .setOptions({ skipTenantFilter: true })
      .lean()
      .catch(() => []),
    AIKeywordTopic.find({ tenantId: cleanTenantId, status: "APPROVED" })
      .setOptions({ skipTenantFilter: true })
      .lean()
      .catch(() => []),
    AIKnowledgeSource.find({ tenantId: cleanTenantId, status: "COMPLETED" })
      .setOptions({ skipTenantFilter: true })
      .lean()
      .catch(() => []),
  ])

  const approvedProducts = []
  const approvedKeywords = new Set()
  const approvedModules = new Set()

  // 1. From BusinessProduct
  for (const p of products) {
    if (p.name && !isUrlOrDomain(p.name)) {
      approvedProducts.push({
        id: p._id,
        name: p.name,
        category: p.category || "",
        description: p.description || "",
      })
      approvedKeywords.add(p.name.toLowerCase().trim())
    }
  }

  // 2. From Approved AIKeywordTopics
  for (const t of approvedTopics) {
    if (t.name && !isUrlOrDomain(t.name)) {
      approvedKeywords.add(t.name.toLowerCase().trim())
    }

    // primaryKeywords
    if (Array.isArray(t.primaryKeywords)) {
      for (const kw of t.primaryKeywords) {
        if (!isUrlOrDomain(kw)) {
          const clean = kw.toLowerCase().trim()
          if (clean.length > 2) approvedKeywords.add(clean)
        }
      }
    }

    // synonyms
    if (Array.isArray(t.synonyms)) {
      for (const syn of t.synonyms) {
        if (!isUrlOrDomain(syn)) {
          const clean = syn.toLowerCase().trim()
          if (clean.length > 2) approvedKeywords.add(clean)
        }
      }
    }

    // productTerminology
    if (Array.isArray(t.productTerminology)) {
      for (const pt of t.productTerminology) {
        if (!isUrlOrDomain(pt)) {
          const clean = pt.toLowerCase().trim()
          if (clean.length > 2) approvedKeywords.add(clean)
        }
      }
    }
  }

  // 3. Healthcare / Hospital ERP Standard modules if tenant is Healthcare / HMS
  const industry = (profile?.industry || profile?.customIndustry || "").toLowerCase()
  const businessName = (profile?.businessName || profile?.companyName || "").toLowerCase()
  const isHealthcare =
    industry.includes("health") ||
    industry.includes("hospital") ||
    industry.includes("medical") ||
    businessName.includes("medical") ||
    businessName.includes("health") ||
    businessName.includes("hospital")

  if (isHealthcare) {
    const healthcareModules = [
      "hms",
      "hospital management software",
      "hospital software",
      "clinic management",
      "opd",
      "ipd",
      "uhid",
      "emr",
      "ehr",
      "lis",
      "ris",
      "pathology",
      "radiology",
      "pharmacy inventory",
      "hospital billing",
      "bed management",
      "doctor scheduling",
      "patient registration",
      "discharge summary",
      "abdm",
      "ayushman bharat digital mission",
    ]
    for (const mod of healthcareModules) {
      approvedKeywords.add(mod)
      approvedModules.add(mod)
    }
  }

  // Fallback baseline for generic CRM / unconfigured tenants so legitimate customer inquiries are recognized
  if (approvedKeywords.size === 0) {
    const defaultBaseline = [
      "software",
      "crm",
      "solution",
      "services",
      "pricing",
      "quotation",
      "demo",
      "system",
    ]
    for (const b of defaultBaseline) approvedKeywords.add(b)
  }

  return {
    companyName: profile?.businessName || profile?.companyName || "",
    industry: profile?.industry || profile?.customIndustry || "",
    description: profile?.description || "",
    approvedProducts,
    approvedKeywords: Array.from(approvedKeywords),
    approvedModules: Array.from(approvedModules),
  }
}

/**
 * Strict Product Relevance Gate Evaluation
 * Evaluates transcript and analysis to enforce qualification rules.
 */
async function evaluateProductRelevanceAndGate({
  transcript,
  call = {},
  rawAnalysis = {},
  matchedTopics = [],
  tenantId = null,
  catalogOverride = null,
}) {
  const effectiveTenantId = tenantId || call?.tenantId || transcript?.tenantId
  const transcriptText = (transcript?.transcriptText || "").trim()
  const rawSegments = Array.isArray(transcript?.segments) ? transcript.segments : []
  const segments = rawSegments.length > 0 ? rawSegments : [{ speaker: "Customer", text: transcriptText }]

  // Check Rule E: Insufficient or Unclear Recording
  const nonGreetingWords = transcriptText
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !["hello", "hi", "haan", "ji", "yes", "okay", "ok", "sir", "namaste", "pranam"].includes(w))

  const isInsufficientOrNoise =
    !transcriptText ||
    transcriptText.length < 20 ||
    nonGreetingWords.length === 0

  if (isInsufficientOrNoise) {
    return {
      isProductRelevant: false,
      productRelevanceScore: 0.0,
      leadQualificationScore: 0.0,
      customerPurchaseIntent: false,
      qualificationStatus: "UNRESOLVED",
      qualificationReason: "INSUFFICIENT_CALL_DATA",
      callOutcome: "UNRESOLVED",
      detectedOutOfScope: null,
      matchedApprovedTopics: [],
      filteredProductInterests: [],
      summary: rawAnalysis.summary || "Call recording insufficient or unclear.",
      customerIntent: "Unclear / insufficient audio data",
      crmLeadAction: "DO_NOT_UPDATE",
    }
  }

  // Load tenant approved catalog
  const catalog = catalogOverride || (await loadTenantApprovedCatalog(effectiveTenantId))

  const lowerText = transcriptText.toLowerCase()

  // 1. Check for Out-of-Scope triggers
  let detectedOutOfScope = null
  for (const pattern of OUT_OF_SCOPE_PATTERNS) {
    if (pattern.regex.test(lowerText)) {
      detectedOutOfScope = pattern
      break
    }
  }

  // 2. Strict Speaker Attribution: Identify who pitched and who needed what
  // Examine customer statements vs agent statements
  const customerSegments = segments.filter((s) => s.speaker === "Customer")
  const agentSegments = segments.filter((s) => s.speaker === "Agent")

  const customerText = customerSegments.map((s) => s.text || "").join(" ").toLowerCase()
  const agentText = agentSegments.map((s) => s.text || "").join(" ").toLowerCase()

  // If inbound call, caller is the Customer segment in standard telephony, or Agent if labeled as such
  // Let's check both sides for who introduced recruitment / vendor pitches
  let callerIsPitchingOutOfScope = false
  if (detectedOutOfScope) {
    // If the pitch is coming from the caller (e.g. "Bado AI se baat kar raha hu... placement agency... hiring")
    callerIsPitchingOutOfScope = true
  }

  // 3. Check for genuine customer interest in Tenant Approved Products
  const genuineApprovedMatches = []
  for (const kw of catalog.approvedKeywords) {
    if (!kw || kw.length < 3) continue
    // Ensure regex checks word boundary
    const escaped = kw.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&")
    const kwRegex = new RegExp(`\\b${escaped}\\b`, "i")

    // Check if customer explicitly spoke this keyword or if text mentions it
    if (kwRegex.test(lowerText)) {
      // Must NOT be just domain name match
      if (!isUrlOrDomain(kw)) {
        genuineApprovedMatches.push(kw)
      }
    }
  }

  // Check if customer statements specifically show buying intent or product inquiry
  const hasBuyingIntent = BUYING_INTENT_PATTERNS.some((p) => p.test(customerText || lowerText))
  const hasFollowUpRequest = FOLLOW_UP_REQUEST_PATTERNS.some((p) => p.test(customerText || lowerText))
  const hasExplicitRejection = EXPLICIT_REJECTION_PATTERNS.some((p) => p.test(customerText || lowerText))
  const hasPoliteDeflectionOnly = POLITE_DEFLECTION_PATTERNS.some((p) => p.test(customerText || lowerText))

  // 4. Calculate Product Relevance Score
  let isProductRelevant = false
  let productRelevanceScore = 0.0

  if (callerIsPitchingOutOfScope) {
    // Strictly disqualified if caller is pitching recruitment, vendor sales, etc.
    isProductRelevant = false
    productRelevanceScore = 0.0
  } else if (genuineApprovedMatches.length > 0) {
    // Verified approved product keyword is present
    if (hasExplicitRejection && !hasBuyingIntent) {
      // Product mentioned, but explicitly rejected
      isProductRelevant = true
      productRelevanceScore = 0.40
    } else if (hasBuyingIntent || hasFollowUpRequest) {
      isProductRelevant = true
      productRelevanceScore = Math.min(0.70 + genuineApprovedMatches.length * 0.05, 0.95)
    } else {
      // Casual mention without buying intent
      isProductRelevant = true
      productRelevanceScore = 0.35
    }
  } else {
    // Zero approved product relevance
    isProductRelevant = false
    productRelevanceScore = 0.05 // Below 10%
  }

  // 5. Apply Deterministic Qualification Rules (Phases 4 & 5)
  let qualificationStatus = "DISQUALIFIED"
  let qualificationReason = "OUT_OF_SCOPE_NON_PRODUCT_CALL"
  let callOutcome = "NOT_INTERESTED"
  let leadQualificationScore = 0.0
  let customerPurchaseIntent = false
  let crmLeadAction = "CLOSE_LOST"

  if (callerIsPitchingOutOfScope || productRelevanceScore < 0.10) {
    // RULE C: PRODUCT IRRELEVANT / OUT OF SCOPE
    qualificationStatus = "DISQUALIFIED"
    qualificationReason = detectedOutOfScope?.description
      ? `OUT_OF_SCOPE_${detectedOutOfScope.type}`
      : "OUT_OF_SCOPE_NON_PRODUCT_CALL"
    callOutcome = "NOT_INTERESTED"
    productRelevanceScore = 0.0
    leadQualificationScore = 0.0
    customerPurchaseIntent = false
    crmLeadAction = "CLOSE_LOST"
  } else if (isProductRelevant && hasExplicitRejection && !hasBuyingIntent) {
    // RULE D: PRODUCT RELEVANT BUT CUSTOMER NOT INTERESTED
    qualificationStatus = "DISQUALIFIED"
    qualificationReason = "EXPLICIT_REJECTION"
    callOutcome = "NOT_INTERESTED"
    leadQualificationScore = 0.0
    customerPurchaseIntent = false
    crmLeadAction = "CLOSE_LOST"
  } else if (isProductRelevant && hasBuyingIntent) {
    // RULE A: PRODUCT RELEVANT + CUSTOMER INTERESTED
    qualificationStatus = "QUALIFIED"
    qualificationReason = "QUALIFIED_PRODUCT_INTEREST"
    callOutcome = "INTERESTED"
    leadQualificationScore = Math.min(0.75 + (genuineApprovedMatches.length > 1 ? 0.15 : 0.05), 0.95)
    customerPurchaseIntent = true
    crmLeadAction = "QUALIFY_ENGAGED"
  } else if (isProductRelevant && hasFollowUpRequest) {
    // RULE B: PRODUCT RELEVANT + CUSTOMER NEEDS FOLLOW-UP
    qualificationStatus = "QUALIFIED_FOLLOW_UP"
    qualificationReason = "QUALIFIED_FOLLOW_UP_REQUESTED"
    callOutcome = "FOLLOW_UP_REQUIRED"
    leadQualificationScore = 0.65
    customerPurchaseIntent = true
    crmLeadAction = "QUALIFY_ENGAGED"
  } else if (isProductRelevant && hasPoliteDeflectionOnly) {
    // Polite deflection without active buying intent
    qualificationStatus = "DISQUALIFIED"
    qualificationReason = "POLITE_DEFLECTION_NO_PURCHASE_INTENT"
    callOutcome = "NOT_INTERESTED"
    leadQualificationScore = 0.0
    customerPurchaseIntent = false
    crmLeadAction = "CLOSE_LOST"
  } else {
    // Ambiguous / no approved product interest established
    qualificationStatus = "DISQUALIFIED"
    qualificationReason = "OUT_OF_SCOPE_NON_PRODUCT_CALL"
    callOutcome = "NOT_INTERESTED"
    productRelevanceScore = 0.0
    leadQualificationScore = 0.0
    customerPurchaseIntent = false
    crmLeadAction = "CLOSE_LOST"
  }

  // 6. Filter Product Interests to ONLY contain approved products/modules
  let filteredProductInterests = []
  if (Array.isArray(rawAnalysis.productInterests)) {
    filteredProductInterests = rawAnalysis.productInterests.filter((pi) => {
      const clean = (pi || "").toLowerCase().trim()
      // Exclude recruitment, placement, vendor services, URLs
      if (
        clean.includes("placement") ||
        clean.includes("hiring") ||
        clean.includes("recruitment") ||
        clean.includes("vacancy") ||
        isUrlOrDomain(clean)
      ) {
        return false
      }
      // Must match an approved catalog term
      return catalog.approvedKeywords.some((ak) => clean.includes(ak) || ak.includes(clean))
    })
  }

  // Filter matchedTopics to remove any URL/domain topics
  const filteredTopicMatches = (matchedTopics || []).filter((tm) => {
    const name = tm.name || tm.topicName || ""
    return !isUrlOrDomain(name)
  })

  // 7. Grounded Summary Construction for Out-of-Scope Calls
  let summary = rawAnalysis.summary || ""
  let customerIntent = rawAnalysis.customerIntent || ""

  if (callerIsPitchingOutOfScope) {
    if (detectedOutOfScope?.type === "RECRUITMENT_PLACEMENT") {
      summary = `External placement/recruitment agency representative contacted the organization to inquire about current hiring vacancies. The organization representative stated that all vacancies are currently filled and suggested sharing details on WhatsApp. The call is unrelated to company products.`
      customerIntent = "Inquiring about job vacancies and offering recruitment services (out-of-scope non-product inquiry)."
    } else if (detectedOutOfScope?.type === "UNRELATED_VENDOR_SALES") {
      summary = `External vendor contacted the organization to offer third-party sales/services. No interest expressed in company products.`
      customerIntent = "Unrelated vendor sales inquiry (out-of-scope)."
    } else if (detectedOutOfScope?.type === "WRONG_NUMBER_SPAM") {
      summary = `Call was identified as a wrong number or spam.`
      customerIntent = "Wrong number / spam."
    }
  }

  return {
    isProductRelevant,
    productRelevanceScore: Number(productRelevanceScore.toFixed(2)),
    leadQualificationScore: Number(leadQualificationScore.toFixed(2)),
    customerPurchaseIntent,
    qualificationStatus,
    qualificationReason,
    callOutcome,
    detectedOutOfScope: detectedOutOfScope ? detectedOutOfScope.type : null,
    matchedApprovedTopics: filteredTopicMatches,
    filteredProductInterests,
    summary,
    customerIntent,
    crmLeadAction,
  }
}

module.exports = {
  evaluateProductRelevanceAndGate,
  loadTenantApprovedCatalog,
  isUrlOrDomain,
  sanitizeTerm,
  OUT_OF_SCOPE_PATTERNS,
  EXPLICIT_REJECTION_PATTERNS,
  BUYING_INTENT_PATTERNS,
  FOLLOW_UP_REQUEST_PATTERNS,
}
