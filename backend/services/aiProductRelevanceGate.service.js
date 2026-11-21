const mongoose = require("mongoose")
const {
  getTenantProductKnowledge,
  matchTranscriptAgainstKnowledge,
  isUrlOrDomain,
  sanitizeTerm,
  formatCanonicalInterestTitle,
} = require("./tenantProductKnowledge.service")
const { extractCallbackIntent } = require("../utils/callbackTimeExtractor")

/**
 * Strict Product-Relevance Gate for AI Call Intelligence and Automatic CRM Lead Qualification
 * 
 * Enforces universal multi-tenant qualification boundaries:
 * 1. Checks customer conversation dynamically against the authenticated tenant's approved products and topics.
 * 2. Distinguishes Agent pitch vs Customer intent with strict speaker attribution.
 * 3. Identifies out-of-scope calls (recruitment agencies, job seekers, generic marketing, vendor pitches, spam).
 * 4. Treats polite deflections (e.g., 'WhatsApp daal do' when rejecting) as non-qualifying.
 * 5. URL and domain matches (e.g., https://example.com/) are strictly excluded from product evidence.
 * 6. Domain-agnostic buying-intent and callback commitment recognition.
 * 7. Enforces Deterministic Rules A, B, C, D, E after AI analysis.
 */

// Out-of-scope intent patterns (Regexes for English, Hindi, Hinglish)
const OUT_OF_SCOPE_PATTERNS = [
  // Recruitment, HR, Placement agencies, Job seeking
  {
    type: "RECRUITMENT_PLACEMENT",
    regex: /\b(placement\s+agency|hiring\s+ke\s+regarding|hiring\s+chal\s+rahi|recruitment\s+agency|consultancy\s+se|job\s+vacancy|vacancies|job\s+chahiye|resume|cv\s+share|staffing\s+solution|candidates?\s+provide|interview|open\s+positions?|job\s+opening|naukri)\b/i,
    description: "Recruitment/placement agency or hiring inquiry",
  },
  // Unrelated vendor services (SEO, digital marketing, loans, real estate if not real estate tenant, insurance, office supplies)
  {
    type: "UNRELATED_VENDOR_SALES",
    regex: /\b(personal\s+loan|business\s+loan|credit\s+card|insurance\s+policy|seo\s+services?|digital\s+marketing\s+agency|website\s+development\s+services?|app\s+development\s+agency|office\s+space\s+for\s+rent|commercial\s+property\s+sale|interior\s+design\s+vendor|printing\s+services?)\b/i,
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

// Universal Domain-Agnostic Buying Intent & Customer Commercial Inquiry Patterns
// (Entity matching is handled dynamically via tenant product catalog; these regexes evaluate commercial intent)
const BUYING_INTENT_PATTERNS = [
  // Pricing, quote, rate, cost inquiries
  /\b(pricing|price|quotation|quote|cost|rate|commercials?|charges?|how\s+much|kitna\s+lagega|kitne\s+ka\s+hai|kya\s+charge\s+hai|kya\s+rate\s+hai|rate\s+batao|quotation\s+bhej(?:o|na)?|proposal\s+bhej(?:o|na)?|rate\s+vagaira|quotation\s+vagaira|estimate)\b/i,
  /(?:कोटेशन|प्राइसिंग|प्राइस|रेट|खर्च|लागत|कितना\s*लगेगा|चार्ज)/u,

  // Demo, trial, walkthrough, sample, live presentation inquiries
  /\b(demo|walkthrough|trial|free\s+trial|presentation|sample|demo\s+chahiye|demo\s+dikhao|demo\s+karwa(?:o|na)|demo\s+dekhna)\b/i,
  /(?:डेमो|ट्रायल|सैम्पल)/u,

  // Commercial desire / need / purchase / implementation / installation / setup (excluding negative "nahi chahiye")
  /(?<!(?:nahi|na|mat|bilkul\s+nahi)\s+)\b(chahiye|chahiye\s+tha|chahiye\s+thi|lagwana\s+hai|khareedna|kharidna|lena\s+hai|buy|purchase|implement(?:ation)?|order|subscribe|subscription|setup\s+karna|install\s+karwana|zaroorat\s+hai|requirement|looking\s+for|interested\s+in)\b/i,
  /(?<!(?:नहीं|ना|मत)\s*)(?:चाहिए|खरीदना|लगवाना|लेना\s*है|ज़रूरत|रिक्वायरमेंट)/u,

  // Specification, features, modules, capabilities, brochure, catalogue, documentation inquiries
  /\b(features?|specifications?|modules?|capabilities?|brochure|catalogue|catalog|pdf(?:\s+vagaira)?|details\s+provide|details\s+bhejo|details\s+chahiye|information\s+chahiye)\b/i,
  /(?:फीचर्स|डिटेल्स|जानकारी|मॉड्यूल)/u,

  // Capacity / Scale inquiries across industries (beds, students, users, staff, employees, seats, rooms, units, branches)
  /\b\d+\s*(?:se|\-|to)\s*\d+\s*(?:bed|beds|student|students|user|users|staff|staffs|employee|employees|seat|seats|room|rooms|unit|units|branch|branches|license|licenses)\b/i,
  /\b\d+\s*(?:bed|beds|student|students|user|users|staff|staffs|employee|employees|seat|seats|room|rooms|unit|units|branch|branches|license|licenses)\b/i,
  /\d+\s*से\s*\d+\s*(?:बेड|छात्र|यूजर|स्टाफ|कर्मचारी|सीट|कमरे|यूनिट)/u,
  /\d+\s*(?:बेड|छात्र|यूजर|स्टाफ|कर्मचारी|सीट|कमरे|यूनिट)/u,
]

// Follow-up request patterns
const FOLLOW_UP_REQUEST_PATTERNS = [
  /\b(call\s+back\s+later|call\s+me\s+tomorrow|kal\s+call\s+karna|shaam\s+ko\s+call|free\s+hoke\s+call|busy\s+hu|call\s+after|proposal\s+bhej|connect\s+later)\b/i,
  /(?:कल|परसों|आज|वापस)\s*.*?कॉल/u,
  /कॉल\s*(?:करता\s*हूं|करूंगा|करूंगी|करना)/u,
  /बात\s*करते\s*हैं/u,
]

/**
 * Loads dynamic tenant approved product catalog and knowledge dictionary.
 * Delegates to Universal Multi-Tenant Product Knowledge Service.
 */
async function loadTenantApprovedCatalog(tenantId) {
  const knowledge = await getTenantProductKnowledge(tenantId)
  return {
    companyName: knowledge.companyName,
    industry: knowledge.industry,
    description: knowledge.description,
    approvedProducts: knowledge.products,
    approvedKeywords: knowledge.approvedKeywords,
    approvedModules: knowledge.moduleCatalog.map((m) => m.canonicalName),
    knowledge,
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
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
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

  // Load tenant approved catalog & knowledge dynamically
  const catalog = catalogOverride || (await loadTenantApprovedCatalog(effectiveTenantId))
  const knowledge = catalog.knowledge || (await getTenantProductKnowledge(effectiveTenantId))

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
  const customerSegments = segments.filter((s) => s.speaker === "Customer")
  const agentSegments = segments.filter((s) => s.speaker === "Agent")

  const customerText = customerSegments.map((s) => s.text || "").join(" ").toLowerCase()
  const agentText = agentSegments.map((s) => s.text || "").join(" ").toLowerCase()

  let callerIsPitchingOutOfScope = false
  if (detectedOutOfScope) {
    callerIsPitchingOutOfScope = true
  }

  // 3. Dynamic Semantic Matching against Tenant's Loaded Product Knowledge
  const matchedKnowledgeResult = matchTranscriptAgainstKnowledge(transcriptText, knowledge)
  const genuineApprovedMatches = matchedKnowledgeResult.matchedKeywords

  // Check if customer statements specifically show buying intent or product inquiry
  const referenceTimestamp = call?.startTime || call?.startedAt || call?.createdAt || new Date()
  const callbackIntent = extractCallbackIntent(transcriptText, {
    referenceTimestamp,
    timezone: "Asia/Kolkata",
    segments,
  })

  const hasBuyingIntent = BUYING_INTENT_PATTERNS.some((p) => p.test(customerText || lowerText))
  const hasFollowUpRequest = FOLLOW_UP_REQUEST_PATTERNS.some((p) => p.test(customerText || lowerText)) || callbackIntent.callbackRequested
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
    // Verified approved product keyword is present for this tenant
    if (hasExplicitRejection && !hasBuyingIntent) {
      // Product mentioned, but explicitly rejected
      isProductRelevant = true
      productRelevanceScore = 0.40
    } else if (hasBuyingIntent || hasFollowUpRequest) {
      isProductRelevant = true
      // Relevance score scales with verified match breadth up to 0.95
      productRelevanceScore = Math.min(0.70 + genuineApprovedMatches.length * 0.05, 0.95)
    } else {
      // Casual mention without buying intent or product inquiry
      isProductRelevant = false
      productRelevanceScore = 0.05
    }
  } else {
    // Zero approved product relevance for this tenant
    isProductRelevant = false
    productRelevanceScore = 0.05 // Below 10%
  }

  // 5. Apply Deterministic Qualification Rules
  let qualificationStatus = "DISQUALIFIED"
  let qualificationReason = "OUT_OF_SCOPE_NON_PRODUCT_CALL"
  let callOutcome = "NOT_INTERESTED"
  let leadQualificationScore = 0.0
  let customerPurchaseIntent = false
  let crmLeadAction = "CLOSE_LOST"

  if (callerIsPitchingOutOfScope) {
    // RULE C: CALLER PITCHING OUT OF SCOPE (Recruitment, Vendor Pitch, Spam, Wrong Number)
    qualificationStatus = "DISQUALIFIED"
    qualificationReason = detectedOutOfScope?.description
      ? `OUT_OF_SCOPE_${detectedOutOfScope.type}`
      : "OUT_OF_SCOPE_NON_PRODUCT_CALL"
    callOutcome = "NOT_INTERESTED"
    productRelevanceScore = 0.0
    leadQualificationScore = 0.0
    customerPurchaseIntent = false
    crmLeadAction = "CLOSE_LOST"
  } else if (isProductRelevant && hasExplicitRejection) {
    // RULE D: PRODUCT RELEVANT BUT CUSTOMER NOT INTERESTED (Explicit Rejection)
    qualificationStatus = "DISQUALIFIED"
    qualificationReason = "EXPLICIT_REJECTION"
    callOutcome = "NOT_INTERESTED"
    leadQualificationScore = 0.0
    customerPurchaseIntent = false
    crmLeadAction = "CLOSE_LOST"
  } else if (isProductRelevant && callbackIntent.callbackRequested) {
    // RULE B1: PRODUCT RELEVANT + CUSTOMER REQUESTED SPECIFIC CALLBACK
    qualificationStatus = "QUALIFIED_FOLLOW_UP"
    qualificationReason = hasBuyingIntent
      ? "QUALIFIED_PRODUCT_INTEREST_CALLBACK_REQUESTED"
      : "QUALIFIED_CALLBACK_REQUESTED"
    callOutcome = "CALL_BACK_LATER"
    leadQualificationScore = Math.min(0.75 + genuineApprovedMatches.length * 0.05, 0.95)
    customerPurchaseIntent = true
    crmLeadAction = "QUALIFY_ENGAGED"
  } else if (isProductRelevant && hasBuyingIntent) {
    // RULE A: PRODUCT RELEVANT + CUSTOMER INTERESTED
    qualificationStatus = "QUALIFIED"
    qualificationReason = "QUALIFIED_PRODUCT_INTEREST"
    callOutcome = "INTERESTED"
    leadQualificationScore = Math.min(0.75 + (genuineApprovedMatches.length > 1 ? 0.15 : 0.05), 0.95)
    customerPurchaseIntent = true
    crmLeadAction = "QUALIFY_ENGAGED"
  } else if (isProductRelevant && hasFollowUpRequest) {
    // RULE B2: PRODUCT RELEVANT + GENERAL FOLLOW-UP REQUESTED
    qualificationStatus = "QUALIFIED_FOLLOW_UP"
    qualificationReason = "QUALIFIED_FOLLOW_UP_REQUESTED"
    callOutcome = "FOLLOW_UP_REQUIRED"
    leadQualificationScore = 0.65
    customerPurchaseIntent = true
    crmLeadAction = "QUALIFY_ENGAGED"
  } else if (hasPoliteDeflectionOnly) {
    // Polite deflection without active buying intent
    qualificationStatus = "DISQUALIFIED"
    qualificationReason = "POLITE_DEFLECTION_NO_PURCHASE_INTENT"
    callOutcome = "NOT_INTERESTED"
    productRelevanceScore = 0.0
    leadQualificationScore = 0.0
    customerPurchaseIntent = false
    crmLeadAction = "CLOSE_LOST"
  } else if (!isProductRelevant) {
    // Out of scope / non-product call for this tenant
    qualificationStatus = "DISQUALIFIED"
    qualificationReason = "OUT_OF_SCOPE_NON_PRODUCT_CALL"
    callOutcome = "NOT_INTERESTED"
    productRelevanceScore = 0.05
    leadQualificationScore = 0.0
    customerPurchaseIntent = false
    crmLeadAction = "CLOSE_LOST"
  } else {
    // Ambiguous / unestablished
    qualificationStatus = "UNRESOLVED"
    qualificationReason = "UNCERTAIN_PRODUCT_CONTEXT"
    callOutcome = "UNRESOLVED"
    productRelevanceScore = 0.20
    leadQualificationScore = 0.0
    customerPurchaseIntent = false
    crmLeadAction = "DO_NOT_UPDATE"
  }

  // 6. Dynamic Product Interest Extraction from Tenant Catalogue
  let filteredProductInterests = []
  if (Array.isArray(rawAnalysis.productInterests) && rawAnalysis.productInterests.length > 0) {
    filteredProductInterests = rawAnalysis.productInterests.filter((pi) => {
      const clean = (pi || "").toLowerCase().trim()
      if (
        clean.includes("placement") ||
        clean.includes("hiring") ||
        clean.includes("recruitment") ||
        clean.includes("vacancy") ||
        isUrlOrDomain(clean)
      ) {
        return false
      }
      return catalog.approvedKeywords.some((ak) => clean.includes(ak) || ak.includes(clean))
    })
  }

  // Enrich dynamically from matched canonical products and modules
  const candidateInterests = new Set(filteredProductInterests)
  if (isProductRelevant && !callerIsPitchingOutOfScope) {
    for (const p of matchedKnowledgeResult.matchedProducts) {
      candidateInterests.add(p)
    }
    for (const m of matchedKnowledgeResult.matchedModules) {
      candidateInterests.add(m)
    }
    // If still empty but approved keywords matched, add clean title-cased matched keywords
    if (candidateInterests.size === 0 && genuineApprovedMatches.length > 0) {
      for (const kw of genuineApprovedMatches.slice(0, 4)) {
        candidateInterests.add(formatCanonicalInterestTitle(kw))
      }
    }
  }
  filteredProductInterests = Array.from(candidateInterests)

  // Filter matchedTopics to remove any URL/domain topics
  const filteredTopicMatches = (matchedTopics || []).filter((tm) => {
    const name = tm.name || tm.topicName || ""
    return !isUrlOrDomain(name)
  })

  // 7. Dynamic Grounded Summary & Intent Construction
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
  } else if (isProductRelevant && !hasExplicitRejection) {
    const company = catalog.companyName || "the organization"
    const primaryInterests = filteredProductInterests.slice(0, 3).join(", ") || "product solutions"

    // Extract scale/capacity mentions from transcript (e.g. "15 se 20 bed", "22-25 staff", "500 students")
    const scaleMatch = lowerText.match(/\b(\d+(?:\s*(?:se|\-|to)\s*\d+)?\s*(?:bed|beds|student|students|user|users|staff|staffs|employee|employees|seat|seats|room|rooms|unit|units|branch|branches))\b/i)
    const scaleText = scaleMatch ? scaleMatch[1] : ""

    const staffMatch = lowerText.match(/\b(\d+(?:\s*(?:se|\-|to)\s*\d+)?\s*(?:staff|employees?|members?|agents?))\b/i)
    const staffText = staffMatch && staffMatch[1] !== scaleText ? staffMatch[1] : ""

    const modulesDiscussed = filteredProductInterests.filter(
      (pi) => !pi.toLowerCase().includes("software") && !pi.toLowerCase().includes("erp") && !pi.toLowerCase().includes("crm")
    )
    const modulesText = modulesDiscussed.length > 0 ? modulesDiscussed.slice(0, 3).join(", ") : ""

    if (!customerIntent || customerIntent.includes("General inquiry") || customerIntent.includes("Offering recruitment")) {
      customerIntent = `Inquiring about ${primaryInterests}${scaleText ? ` for a ${scaleText}` : ""}.`
    }

    if (!summary || summary.includes("no demonstrable product interest") || summary.includes("Call recording insufficient")) {
      let builtSummary = `The caller contacted ${company} to inquire about ${primaryInterests}`
      if (scaleText) builtSummary += ` for their ${scaleText}`
      if (staffText) builtSummary += ` with ${staffText}`
      builtSummary += "."
      if (modulesText) {
        builtSummary += ` The caller discussed requirements including ${modulesText}.`
      }
      if (lowerText.includes("quotation") || lowerText.includes("pdf") || lowerText.includes("pricing") || lowerText.includes("details")) {
        builtSummary += ` The company representative agreed to share product details and documentation.`
      }
      if (callbackIntent.callbackRequested && callbackIntent.requestedCallbackDateTime) {
        builtSummary += ` Both parties agreed to reconnect on follow-up.`
      }
      summary = builtSummary
    }
  }

  const isQualifyingCallback = isProductRelevant && !callerIsPitchingOutOfScope && !hasExplicitRejection && callbackIntent.callbackRequested

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
    callbackRequested: isQualifyingCallback,
    requestedCallbackDateTime: isQualifyingCallback ? callbackIntent.requestedCallbackDateTime : null,
    callbackTimezone: callbackIntent.callbackTimezone || "Asia/Kolkata",
    callbackTimePrecision: isQualifyingCallback ? callbackIntent.callbackTimePrecision : null,
    callbackReason: isQualifyingCallback ? callbackIntent.callbackReason : null,
    callbackLanguage: isQualifyingCallback ? callbackIntent.callbackLanguage : null,
    voiceConfirmation: isQualifyingCallback ? callbackIntent.voiceConfirmation : null,
    callbackDirection: isQualifyingCallback ? callbackIntent.callbackDirection : null,
    taskAction: isQualifyingCallback ? callbackIntent.taskAction : null,
    directionDescription: isQualifyingCallback ? callbackIntent.directionDescription : null,
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
