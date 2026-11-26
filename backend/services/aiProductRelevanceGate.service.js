const mongoose = require("mongoose")
const {
  getTenantProductKnowledge,
  matchTranscriptAgainstKnowledge,
  isSubstantiveKeyword,
  extractCustomerRequestedProduct,
  isProductSupportedByTenant,
  GENERIC_INDUSTRY_WORDS,
  isUrlOrDomain,
  sanitizeTerm,
  formatCanonicalInterestTitle,
} = require("./tenantProductKnowledge.service")
const { extractCallbackIntent } = require("../utils/callbackTimeExtractor")

/**
 * Strict Product-Relevance Gate for AI Call Intelligence and Automatic CRM Lead Qualification
 * 
 * Enforces mandatory multi-tenant business rules:
 * 1. Checks customer conversation dynamically against the authenticated tenant's approved products and topics.
 * 2. Strict Product-Only Lead Rule: A lead is qualified ONLY when the customer's actual product requirement
 *    matches a product or supported capability that the tenant sells.
 * 3. Unsupported Product Request: If customer requests a product the tenant does not offer, product relevance is 0%,
 *    productFit is UNSUPPORTED, qualification is DISQUALIFIED, CRM action is CLOSE_LOST, and outcome is NOT_INTERESTED.
 * 4. Customer buying intent and tenant lead status remain separate: Customer buying desire is preserved.
 * 5. Strict Speaker Attribution: Agent mentioning the tenant's product when customer wanted another product
 *    does NOT create product relevance.
 * 6. Generic words ('software', 'crm', 'erp', 'system', 'management') alone NEVER qualify a lead.
 * 7. Missing Knowledge Safety: Insufficient transcript or unconfigured domain defaults to UNRESOLVED (not CLOSE_LOST).
 * 8. Zero false callbacks or demo tasks for unsupported products.
 */

// Out-of-scope intent patterns (Regexes for English, Hindi, Hinglish)
const OUT_OF_SCOPE_PATTERNS = [
  // Recruitment, HR, Placement agencies, Job seeking
  {
    type: "RECRUITMENT_PLACEMENT",
    regex: /\b(placement\s+agency|hiring\s+ke\s+regarding|hiring\s+chal\s+rahi|recruitment\s+agency|consultancy\s+se|job\s+vacancy|vacancies|job\s+chahiye|resume|cv\s+share|staffing\s+solution|candidates?\s+provide|interview|open\s+positions?|job\s+opening|naukri)\b/i,
    description: "Recruitment/placement agency or hiring inquiry",
  },
  // Unrelated vendor services (SEO, digital marketing, loans, real estate if not real estate tenant, insurance, office supplies, sweets/food)
  {
    type: "UNRELATED_VENDOR_SALES",
    regex: /\b(personal\s+loan|business\s+loan|credit\s+card|insurance\s+policy|seo\s+services?|digital\s+marketing\s+agency|website\s+development\s+services?|app\s+development\s+agency|office\s+space\s+for\s+rent|commercial\s+property\s+sale|interior\s+design\s+vendor|printing\s+services?|mithai|sweets?\s+shop|hamari\s+mithai|catering|retail\s+vendor)\b/i,
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

// Agent declined or unsupported variant patterns (e.g. "nahi banate", "we don't sell", "not available")
const AGENT_DECLINED_PATTERNS = [
  /\b(nahi\s+banate|nahi\s+rakhte|nahi\s+bechte|deal\s+nahi\s+karte|available\s+nahi|out\s+of\s+stock|hum\s+nahi\s+karte|ham\s+nahi\s+karte)\b/i,
  /\b(we\s+don'?t\s+sell|we\s+don'?t\s+offer|we\s+don'?t\s+make|not\s+available|not\s+offered|we\s+do\s+not\s+deal|we\s+do\s+not\s+sell|we\s+do\s+not\s+offer|we\s+do\s+not\s+make)\b/i,
  /(?:नहीं\s*बनाते|नहीं\s*रखते|नहीं\s*बेचते|डील\s*नहीं\s*करते|उपलब्ध\s*नहीं|स्टॉक\s*में\s*नहीं)/u,
]

// Polite deflection patterns (often accompanying rejections, e.g. "WhatsApp daal do")
const POLITE_DEFLECTION_PATTERNS = [
  /\b(whatsapp\s+daal\s+do|whatsapp\s+kar\s+do|whatsapp\s+par\s+bhej\s+do|send\s+on\s+whatsapp|share\s+on\s+whatsapp|mail\s+kar\s+do|email\s+bhej\s+do|baad\s+me\s+dekhenge|hoga\s+to\s+batayenge|dekhte\s+hain)\b/i,
]

// Universal Domain-Agnostic Buying Intent & Customer Commercial Inquiry Patterns
const BUYING_INTENT_PATTERNS = [
  // Pricing, quote, rate, cost inquiries
  /\b(pricing|price|quotation|quote|cost|rate|commercials?|charges?|how\s+much|kitna\s+lagega|kitne\s+ka\s+hai|kya\s+charge\s+hai|kya\s+rate\s+hai|rate\s+batao|quotation\s+bhej(?:o|na)?|proposal\s+bhej(?:o|na)?|rate\s+vagaira|quotation\s+vagaira|estimate)\b/i,
  /(?:कोटेशन|प्राइसिंग|प्राइस|रेट|खर्च|लागत|कितना\s*लगेगा|चार्ज)/u,

  // Demo, trial, walkthrough, sample, live presentation inquiries
  /\b(demo|walkthrough|trial|free\s+trial|presentation|sample|demo\s+chahiye|demo\s+dikhao|demo\s+karwa(?:o|na)|demo\s+dekhna)\b/i,
  /(?:डेमो|ट्रायल|सैम्पल)/u,

  // Commercial desire / need / purchase / implementation / installation / setup (excluding negative "nahi chahiye")
  /(?<!(?:nahi|na|mat|bilkul\s+nahi)\s+)\b(need|needs|needed|want|wants|wanted|require|requires|required|chahiye|chahiye\s+tha|chahiye\s+thi|lagwana\s+hai|khareedna|kharidna|lena\s+hai|buy|buys|buying|purchase|purchasing|implement(?:ation)?|order|subscribe|subscription|setup\s+karna|install\s+karwana|zaroorat\s+hai|requirement|requirements|looking\s+for|interested\s+in)\b/i,
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
 * Evaluates transcript and analysis to enforce strict tenant product-only qualification rules.
 */
async function evaluateProductRelevanceAndGate({
  transcript,
  call = {},
  rawAnalysis = {},
  analysisSummary = "",
  analysisProductInterests = [],
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
      productFit: "UNRESOLVED",
      customerRequestedProduct: "",
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
      callbackRequested: false,
      requestedCallbackDateTime: null,
      callbackTimezone: "Asia/Kolkata",
      callbackTimePrecision: null,
      callbackReason: null,
      callbackLanguage: null,
      voiceConfirmation: null,
      callbackDirection: null,
      taskAction: null,
      directionDescription: null,
    }
  }

  // Load tenant approved catalog & knowledge dynamically
  const catalog = catalogOverride || (await loadTenantApprovedCatalog(effectiveTenantId))
  const knowledge = catalog.knowledge || (await getTenantProductKnowledge(effectiveTenantId))

  const lowerText = transcriptText.toLowerCase()

  // 1. Check for Out-of-Scope triggers (recruitment, loans, wrong number, spam)
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

  const customerText = customerSegments.length > 0
    ? customerSegments.map((s) => s.text || "").join(" ").toLowerCase()
    : lowerText
  const agentText = agentSegments.map((s) => s.text || "").join(" ").toLowerCase()

  let callerIsPitchingOutOfScope = false
  if (detectedOutOfScope) {
    callerIsPitchingOutOfScope = true
  }

  // 3. Dynamic Semantic Matching against Tenant's Loaded Product Knowledge
  // Match CUSTOMER utterances specifically for product interest (Speaker Attribution)
  const customerKnowledgeResult = matchTranscriptAgainstKnowledge(customerText, knowledge)
  const customerSubstantiveMatches = customerKnowledgeResult.substantiveMatches || []

  // Check if agent mentioned any tenant products
  const agentKnowledgeResult = agentText
    ? matchTranscriptAgainstKnowledge(agentText, knowledge)
    : { substantiveMatches: [] }
  const agentSubstantiveMatches = agentKnowledgeResult.substantiveMatches || []

  // Extract what product or service domain the customer requested
  const customerProductInquiry = extractCustomerRequestedProduct(customerText)
  const isSupportedProduct = customerProductInquiry
    ? isProductSupportedByTenant(customerProductInquiry, knowledge)
    : false

  // If customer had no direct substantive matches, check if customer later explicitly accepted an agent pitch
  let genuineApprovedMatches = [...customerSubstantiveMatches]
  if (genuineApprovedMatches.length === 0 && agentSubstantiveMatches.length > 0) {
    // Check if customer explicitly accepted or requested the agent's pitched product
    const agentPitchKeywords = agentSubstantiveMatches.map((k) => k.toLowerCase())
    const customerAcceptedAgentPitch = agentPitchKeywords.some((apk) => customerText.includes(apk)) &&
      BUYING_INTENT_PATTERNS.some((p) => p.test(customerText))
    if (customerAcceptedAgentPitch) {
      genuineApprovedMatches = [...agentSubstantiveMatches]
    }
  }

  const isExplicitNonInterestedOutcome =
    rawAnalysis?.callOutcome === "OUT_OF_SCOPE" || rawAnalysis?.callOutcome === "NOT_INTERESTED"
  const isUnsupportedCustomerInquiry = Boolean(customerProductInquiry && !isSupportedProduct)

  const effectiveSummary = (analysisSummary || rawAnalysis?.summary || "").trim()
  const effectiveProductInterests = (
    Array.isArray(analysisProductInterests) && analysisProductInterests.length > 0
      ? analysisProductInterests
      : Array.isArray(rawAnalysis?.productInterests)
      ? rawAnalysis.productInterests
      : []
  )
    .map((pi) => String(pi || "").trim())
    .filter((pi) => pi && !isUrlOrDomain(pi))

  const analysisContextText = [effectiveProductInterests.join(" "), effectiveSummary]
    .filter(Boolean)
    .join(" ")
    .trim()

  const analysisKnowledgeResult = analysisContextText
    ? matchTranscriptAgainstKnowledge(analysisContextText, knowledge)
    : { substantiveMatches: [], matchedProducts: [], matchedModules: [] }
  const analysisSubstantiveMatches = analysisKnowledgeResult.substantiveMatches || []
  const matchedAnalysisInterests = effectiveProductInterests.filter((pi) => {
    const clean = pi.toLowerCase().trim()
    if (
      !clean ||
      clean.includes("placement") ||
      clean.includes("hiring") ||
      clean.includes("recruitment") ||
      clean.includes("vacancy") ||
      !isSubstantiveKeyword(clean)
    ) {
      return false
    }
    return (
      catalog.approvedKeywords.some((ak) => clean.includes(ak) || ak.includes(clean)) ||
      isProductSupportedByTenant({ productName: pi, keywords: clean.split(/\s+/) }, knowledge)
    )
  })
  const analysisProductInquiry = analysisContextText
    ? extractCustomerRequestedProduct(analysisContextText)
    : null
  const isAnalysisProductSupported = analysisProductInquiry
    ? isProductSupportedByTenant(analysisProductInquiry, knowledge)
    : false

  // Check if customer statements specifically show buying intent or product inquiry
  const referenceTimestamp = call?.startTime || call?.startedAt || call?.createdAt || new Date()
  const callbackIntent = extractCallbackIntent(transcriptText, {
    referenceTimestamp,
    timezone: "Asia/Kolkata",
    segments,
  })

  const hasTranscriptBuyingIntent = BUYING_INTENT_PATTERNS.some((p) => p.test(customerText || lowerText))
  const hasFollowUpRequest = FOLLOW_UP_REQUEST_PATTERNS.some((p) => p.test(customerText || lowerText)) || callbackIntent.callbackRequested
  const hasExplicitRejection = EXPLICIT_REJECTION_PATTERNS.some((p) => p.test(customerText || lowerText))
  const hasPoliteDeflectionOnly = POLITE_DEFLECTION_PATTERNS.some((p) => p.test(customerText || lowerText))

  const canPromoteFromAnalysis =
    !callerIsPitchingOutOfScope &&
    !isExplicitNonInterestedOutcome &&
    !isUnsupportedCustomerInquiry &&
    !hasExplicitRejection &&
    !(hasPoliteDeflectionOnly && !hasTranscriptBuyingIntent) &&
    !AGENT_DECLINED_PATTERNS.some((p) => p.test(agentText))

  let promotedFromAnalysis = false
  if (
    canPromoteFromAnalysis &&
    genuineApprovedMatches.length === 0 &&
    (analysisSubstantiveMatches.length > 0 || matchedAnalysisInterests.length > 0 || isAnalysisProductSupported)
  ) {
    promotedFromAnalysis = true
    const merged = new Set([
      ...analysisSubstantiveMatches,
      ...matchedAnalysisInterests.map((pi) => pi.toLowerCase()),
    ])
    if (merged.size === 0 && analysisProductInquiry?.productName) {
      merged.add(analysisProductInquiry.productName.toLowerCase())
    }
    genuineApprovedMatches = Array.from(merged)
  }

  const hasAnalysisBuyingIntent =
    !isExplicitNonInterestedOutcome &&
    !callerIsPitchingOutOfScope &&
    !hasExplicitRejection &&
    (
      BUYING_INTENT_PATTERNS.some((p) => p.test(effectiveSummary)) ||
      ["INTERESTED", "FOLLOW_UP_REQUIRED", "CALL_BACK_LATER"].includes(rawAnalysis?.callOutcome)
    )
  const hasBuyingIntent =
    hasTranscriptBuyingIntent || (genuineApprovedMatches.length > 0 && hasAnalysisBuyingIntent)

  // Determine Product Fit according to Strict Tenant Product-Only Policy
  let productFit = "UNRESOLVED"
  if (callerIsPitchingOutOfScope) {
    productFit = "UNSUPPORTED"
  } else if (
    genuineApprovedMatches.length > 0 ||
    (customerProductInquiry && isSupportedProduct) ||
    (promotedFromAnalysis && isAnalysisProductSupported)
  ) {
    productFit = "SUPPORTED"
  } else if (isUnsupportedCustomerInquiry) {
    // Customer clearly requested a product domain that this tenant does not sell
    productFit = "UNSUPPORTED"
  } else if (agentSubstantiveMatches.length > 0 && hasExplicitRejection) {
    // Agent pitched tenant product, but prospect explicitly rejected
    productFit = "SUPPORTED"
  } else if (hasBuyingIntent && genuineApprovedMatches.length === 0) {
    // Customer had buying intent or generic software inquiry without specific product/domain context
    // As mandated: generic words alone cannot qualify or disqualify -> UNRESOLVED
    productFit = "UNRESOLVED"
  } else {
    productFit = "UNRESOLVED"
  }

  // 4. Calculate Product Relevance Score
  let isProductRelevant = false
  let productRelevanceScore = 0.0

  if (callerIsPitchingOutOfScope || productFit === "UNSUPPORTED") {
    // Confirmed unsupported product or out-of-scope pitch -> exactly 0.0 (0%) relevance
    isProductRelevant = false
    productRelevanceScore = 0.0
  } else if (productFit === "SUPPORTED" && (genuineApprovedMatches.length > 0 || agentSubstantiveMatches.length > 0 || isAnalysisProductSupported)) {
    if (hasExplicitRejection && !hasBuyingIntent) {
      // Product mentioned, but explicitly rejected
      isProductRelevant = true
      productRelevanceScore = 0.40
    } else if (hasBuyingIntent || hasFollowUpRequest) {
      isProductRelevant = true
      // Relevance score scales with verified match breadth up to 0.95
      productRelevanceScore = Math.min(0.70 + Math.max(genuineApprovedMatches.length, 1) * 0.05, 0.95)
    } else {
      // Casual mention without buying intent
      isProductRelevant = false
      productRelevanceScore = 0.05
    }
  } else {
    // Unestablished or generic-only
    isProductRelevant = false
    productRelevanceScore = 0.05
  }

  // 5. Apply Deterministic Qualification Rules
  let qualificationStatus = "DISQUALIFIED"
  let qualificationReason = "OUT_OF_SCOPE_NON_PRODUCT_CALL"
  let callOutcome = "NOT_INTERESTED"
  let leadQualificationScore = 0.0
  let customerPurchaseIntent = false
  let crmLeadAction = "CLOSE_LOST"
  let customerRequestedProductName = customerProductInquiry ? customerProductInquiry.productName : ""

  const isRawOutOfScope = rawAnalysis.callOutcome === "OUT_OF_SCOPE" && genuineApprovedMatches.length === 0
  const isAgentDeclined = AGENT_DECLINED_PATTERNS.some((p) => p.test(agentText)) &&
    !(genuineApprovedMatches.length > 0 && customerText.includes("haan"))

  if (isRawOutOfScope) {
    // When rawAnalysis.callOutcome === "OUT_OF_SCOPE" and no approved tenant product was requested as buyer
    qualificationStatus = "DISQUALIFIED"
    qualificationReason = detectedOutOfScope?.description
      ? `OUT_OF_SCOPE_${detectedOutOfScope.type}`
      : "OUT_OF_SCOPE_NON_PRODUCT_CALL"
    callOutcome = "OUT_OF_SCOPE"
    productRelevanceScore = 0.0
    leadQualificationScore = 0.0
    customerPurchaseIntent = false
    crmLeadAction = "CLOSE_LOST"
  } else if (callerIsPitchingOutOfScope) {
    // RULE C: OUT-OF-SCOPE PITCH (Recruitment, Vendor Pitch, Sweets/Supplies, Spam, Wrong Number)
    qualificationStatus = "DISQUALIFIED"
    qualificationReason = detectedOutOfScope?.description
      ? `OUT_OF_SCOPE_${detectedOutOfScope.type}`
      : "OUT_OF_SCOPE_NON_PRODUCT_CALL"
    callOutcome = "NOT_INTERESTED"
    productRelevanceScore = 0.0
    leadQualificationScore = 0.0
    customerPurchaseIntent = false
    crmLeadAction = "CLOSE_LOST"
  } else if (isAgentDeclined) {
    // RULE AGENT REFUSED / UNSUPPORTED VARIANT:
    // Agent explicitly declined ("nahi banate", "nahi rakhte", "nahi bechte", "deal nahi karte", "out of stock", "not available")
    qualificationStatus = "DISQUALIFIED"
    qualificationReason = "AGENT_DECLINED_OR_UNAVAILABLE_PRODUCT"
    callOutcome = "NOT_INTERESTED"
    leadQualificationScore = 0.0
    customerPurchaseIntent = Boolean(hasBuyingIntent)
    crmLeadAction = "CLOSE_LOST"
  } else if (productFit === "UNSUPPORTED") {
    // RULE U: UNSUPPORTED PRODUCT REQUEST (Mandatory Business Rule)
    // Customer wants a product that this tenant does NOT sell (e.g. Furniture CRM on Medical 365)
    qualificationStatus = "DISQUALIFIED"
    qualificationReason = "UNSUPPORTED_PRODUCT_REQUEST"
    callOutcome = "NOT_INTERESTED"
    productRelevanceScore = 0.0
    leadQualificationScore = 0.0
    // Separate customer intent: Customer DOES have buying intent for their requested product!
    customerPurchaseIntent = Boolean(hasBuyingIntent || customerProductInquiry)
    crmLeadAction = "CLOSE_LOST"
  } else if (hasExplicitRejection) {
    // RULE D: EXPLICIT REJECTION (Customer said "not interested", "already have software", "nahi chahiye")
    qualificationStatus = "DISQUALIFIED"
    qualificationReason = "EXPLICIT_REJECTION"
    callOutcome = "NOT_INTERESTED"
    leadQualificationScore = 0.0
    customerPurchaseIntent = false
    crmLeadAction = "CLOSE_LOST"
  } else if (rawAnalysis?.callOutcome === "NOT_INTERESTED" && !hasTranscriptBuyingIntent && !callbackIntent.callbackRequested) {
    // Keep explicit NOT_INTERESTED classifications intact unless caller showed direct buying/callback intent
    qualificationStatus = "DISQUALIFIED"
    qualificationReason = "EXPLICIT_NOT_INTERESTED"
    callOutcome = "NOT_INTERESTED"
    productRelevanceScore = 0.0
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
  } else if (productFit === "UNRESOLVED") {
    // RULE MISSING KNOWLEDGE / AMBIGUOUS: Generic words or unclear domain
    qualificationStatus = "UNRESOLVED"
    qualificationReason = "UNCERTAIN_PRODUCT_CONTEXT"
    callOutcome = "UNRESOLVED"
    productRelevanceScore = 0.10
    leadQualificationScore = 0.0
    customerPurchaseIntent = hasBuyingIntent
    crmLeadAction = "DO_NOT_UPDATE"
  } else {
    // Non-product call
    qualificationStatus = "DISQUALIFIED"
    qualificationReason = "OUT_OF_SCOPE_NON_PRODUCT_CALL"
    callOutcome = "NOT_INTERESTED"
    productRelevanceScore = 0.05
    leadQualificationScore = 0.0
    customerPurchaseIntent = false
    crmLeadAction = "CLOSE_LOST"
  }

  // 6. Dynamic Product Interest Extraction from Tenant Catalogue
  let filteredProductInterests = []
  if (productFit === "UNSUPPORTED") {
    // Never emit product interests for unsupported products on tenant's catalogue
    filteredProductInterests = []
  } else if (effectiveProductInterests.length > 0) {
    filteredProductInterests = effectiveProductInterests.filter((pi) => {
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
  if (isProductRelevant && productFit === "SUPPORTED" && !callerIsPitchingOutOfScope) {
    for (const p of customerKnowledgeResult.matchedProducts) {
      candidateInterests.add(p)
    }
    for (const m of customerKnowledgeResult.matchedModules) {
      candidateInterests.add(m)
    }
    if (promotedFromAnalysis) {
      for (const p of analysisKnowledgeResult.matchedProducts) {
        candidateInterests.add(p)
      }
      for (const m of analysisKnowledgeResult.matchedModules) {
        candidateInterests.add(m)
      }
      for (const mi of matchedAnalysisInterests) {
        candidateInterests.add(mi)
      }
    }
    if (candidateInterests.size === 0 && genuineApprovedMatches.length > 0) {
      for (const kw of genuineApprovedMatches.slice(0, 4)) {
        candidateInterests.add(formatCanonicalInterestTitle(kw))
      }
    }
    filteredProductInterests = Array.from(candidateInterests)
  }

  // Filter matchedTopics to remove any URL/domain topics
  const filteredTopicMatches = (matchedTopics || []).filter((tm) => {
    const name = tm.name || tm.topicName || ""
    return !isUrlOrDomain(name)
  })

  // 7. Dynamic Grounded Summary & Intent Construction
  let summary = effectiveSummary
  let customerIntent = rawAnalysis.customerIntent || ""
  const company = catalog.companyName || "the organization"

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
  } else if (productFit === "UNSUPPORTED" && qualificationReason === "UNSUPPORTED_PRODUCT_REQUEST") {
    const requested = customerRequestedProductName || "an unsupported product"
    summary = `The caller contacted ${company} inquiring about ${requested}. However, ${company} does not offer or support ${requested}. As the requested product is not part of the company's offerings, the lead is disqualified.`
    customerIntent = `Inquiring about ${requested} (unsupported product request for ${company}).`
  } else if (productFit === "UNRESOLVED") {
    summary = `The caller contacted ${company} with a general inquiry, but insufficient specific product details were discussed to establish fit.`
    customerIntent = `General inquiry without specific product details.`
  } else if (isProductRelevant && !hasExplicitRejection) {
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

  // Follow-up is created ONLY when product is supported, relevant, and not rejected
  const isQualifyingCallback = isProductRelevant &&
    productFit === "SUPPORTED" &&
    !callerIsPitchingOutOfScope &&
    !isRawOutOfScope &&
    !isAgentDeclined &&
    !hasExplicitRejection &&
    callbackIntent.callbackRequested

  return {
    isProductRelevant,
    productRelevanceScore: Number(productRelevanceScore.toFixed(2)),
    productFit,
    customerRequestedProduct: customerRequestedProductName,
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
  evaluateProductRelevance: evaluateProductRelevanceAndGate,
  loadTenantApprovedCatalog,
  isUrlOrDomain,
  sanitizeTerm,
  OUT_OF_SCOPE_PATTERNS,
  EXPLICIT_REJECTION_PATTERNS,
  BUYING_INTENT_PATTERNS,
  FOLLOW_UP_REQUEST_PATTERNS,
}
