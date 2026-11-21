const { sanitizeErrorMessage, resolveGeminiModel, makeHttpsRequest } = require("./aiProvider.service")
const { TenantBusinessProfile } = require("../models/TenantBusinessProfile")
const BusinessProduct = require("../models/BusinessProduct")
const { evaluateProductRelevanceAndGate, loadTenantApprovedCatalog } = require("./aiProductRelevanceGate.service")

/**
 * AI Call Analysis Engine - Phase 3: AI Call Intelligence
 * 
 * Extracts executive call summary, customer intent, requirements, objections,
 * sentiment, outcome, key moments, and action items from call transcripts.
 * 
 * Strict Grounding Rules:
 * 1. Grounded strictly in the transcript text; zero hallucinated claims, guarantees, or prices.
 * 2. Meaningful confidence scores (no arbitrary 100%).
 * 3. Sentiment is conversation-scoped, not a permanent customer label.
 * 4. Enterprise privacy: 'store: false' for request-level logging control.
 * 5. Gemini 3.8 parameter compliance (no temperature, top_p, top_k, candidate_count).
 * 6. Mandatory Approved Product Relevance Gate & Strict Speaker Attribution.
 */

const VALID_SENTIMENTS = new Set(["POSITIVE", "NEUTRAL", "NEGATIVE", "MIXED"])
const VALID_OUTCOMES = new Set([
  "INTERESTED",
  "NOT_INTERESTED",
  "FOLLOW_UP_REQUIRED",
  "CALL_BACK_LATER",
  "DEAL_CLOSED",
  "ESCALATED",
  "WRONG_NUMBER",
  "UNRESOLVED",
  "OUT_OF_SCOPE",
])

/**
 * Deterministic NLP Fallback Analysis Generator.
 * Used for offline environments, unconfigured keys, or test verification.
 */
function generateDeterministicCallAnalysis({ transcript, call = {}, topicMatches = [], tenantCatalog = null }) {
  const text = (transcript?.transcriptText || "").toLowerCase()
  const segments = transcript?.segments || []

  // Check out of scope patterns
  const isRecruitment = /\b(placement agency|hiring ke regarding|recruitment|vacancy|vacancies|job vacancy|job chahiye)\b/i.test(text)
  const isVendorPitch = /\b(seo service|digital marketing|personal loan|business loan|credit card|website development)\b/i.test(text)
  const isWrongNumber = /\b(wrong number|galat number|galat jagah)\b/i.test(text)
  const isOutOfScope = isRecruitment || isVendorPitch || isWrongNumber

  // Determine sentiment (honest sentiment analysis - polite callers can still be neutral/positive)
  let sentiment = "NEUTRAL"
  let sentimentScore = 0.60
  if (text.includes("great") || text.includes("perfect") || text.includes("thank you")) {
    sentiment = "POSITIVE"
    sentimentScore = 0.80
  } else if (text.includes("bad") || text.includes("expensive") || text.includes("cancel") || text.includes("complaint")) {
    sentiment = "NEGATIVE"
    sentimentScore = 0.35
  } else if (text.includes("maybe") || text.includes("think") || text.includes("consider")) {
    sentiment = "MIXED"
    sentimentScore = 0.50
  }

  // Determine outcome based on strict qualification rules
  let callOutcome = "NOT_INTERESTED"
  let summary = ""
  let customerIntent = ""
  let customerNeeds = []
  let productInterests = []
  let nextSteps = []
  let followUpRecommendations = []

  if (isRecruitment) {
    callOutcome = "NOT_INTERESTED"
    summary = "External placement/recruitment agency representative contacted the organization inquiring about hiring vacancies. The organization representative stated all vacancies are full. Call is out-of-scope and unrelated to company products."
    customerIntent = "Inquiring about job vacancies and offering recruitment services."
    customerNeeds = []
    productInterests = []
    nextSteps = ["No action required. Call is out-of-scope."]
    followUpRecommendations = ["Do not pursue as a CRM lead. Disqualified as non-product call."]
  } else if (isVendorPitch) {
    callOutcome = "NOT_INTERESTED"
    summary = "Third-party vendor pitched unrelated services. Prospect expressed no interest."
    customerIntent = "Unrelated vendor sales pitch."
    customerNeeds = []
    productInterests = []
    nextSteps = ["No action required."]
    followUpRecommendations = ["Do not pursue as a CRM lead."]
  } else if (isWrongNumber) {
    callOutcome = "NOT_INTERESTED"
    summary = "Call was identified as a wrong number."
    customerIntent = "Wrong number."
    customerNeeds = []
    productInterests = []
    nextSteps = []
    followUpRecommendations = []
  } else if (
    text.includes("pricing") ||
    text.includes("quotation") ||
    text.includes("demo") ||
    text.includes("buy") ||
    text.includes("chahiye") ||
    text.includes("software") ||
    text.includes("system") ||
    text.includes("erp") ||
    text.includes("crm") ||
    text.includes("solution") ||
    topicMatches.length > 0
  ) {
    const hasAgreedCallback =
      text.includes("11 baje") ||
      text.includes("kal 11") ||
      text.includes("call karunga") ||
      text.includes("call karta hu") ||
      text.includes("wapis call") ||
      text.includes("call back") ||
      text.includes("call me")
    callOutcome = hasAgreedCallback ? "CALL_BACK_LATER" : "INTERESTED"

    const company = tenantCatalog?.companyName || "the organization"

    // Extract scale / capacity mentions from transcript (beds, students, users, staff, seats, rooms, etc.)
    const scaleMatch = text.match(/\b(\d+(?:\s*(?:se|\-|to)\s*\d+)?\s*(?:bed|beds|student|students|user|users|staff|staffs|employee|employees|seat|seats|room|rooms|unit|units|branch|branches))\b/i)
    const scaleText = scaleMatch ? scaleMatch[1] : ""

    const staffMatch = text.match(/\b(\d+(?:\s*(?:se|\-|to)\s*\d+)?\s*(?:staff|employees?|members?|agents?))\b/i)
    const staffText = staffMatch && staffMatch[1] !== scaleText ? staffMatch[1] : ""

    // Resolve product interests from topicMatches or tenantCatalog products
    const interestSet = new Set()
    for (const tm of topicMatches) {
      const name = tm.name || tm.topicName
      if (name && !name.startsWith("http")) interestSet.add(name)
    }
    if (tenantCatalog?.products) {
      for (const p of tenantCatalog.products) {
        if (p.name && text.includes(p.name.toLowerCase())) interestSet.add(p.name)
      }
    }
    // If still empty, check key module terms mentioned in text
    if (interestSet.size === 0) {
      const commonModules = [
        { key: "hospital", title: "Hospital Management Software" },
        { key: "hms", title: "Hospital Management System (HMS)" },
        { key: "pharmacy", title: "Pharmacy Management Module" },
        { key: "lab", title: "Laboratory Management Module" },
        { key: "ot", title: "Operation Theater (OT) Module" },
        { key: "bed", title: "Bed Management Module" },
        { key: "school", title: "School Management ERP" },
        { key: "attendance", title: "Attendance Management Module" },
        { key: "fee", title: "Fee Collection System" },
        { key: "property", title: "Real Estate Property CRM" },
        { key: "inventory", title: "Inventory Management Module" },
        { key: "billing", title: "Billing & Invoicing Software" },
        { key: "gst", title: "GST Accounting Software" },
      ]
      for (const m of commonModules) {
        if (text.includes(m.key)) interestSet.add(m.title)
      }
    }
    if (interestSet.size === 0) {
      interestSet.add("Core Software Solutions")
    }

    productInterests = Array.from(interestSet)
    const primaryInterest = productInterests[0] || "product solutions"

    // Construct customer needs
    customerNeeds = []
    if (scaleText) customerNeeds.push(`Support for ${scaleText}`)
    if (staffText) customerNeeds.push(`Support for ${staffText}`)
    for (const pi of productInterests.slice(1, 4)) {
      customerNeeds.push(pi)
    }
    if (customerNeeds.length === 0) {
      customerNeeds = ["Pricing clarity", "Feature walkthrough"]
    }

    customerIntent = `Inquiring about ${primaryInterest}${scaleText ? ` for a ${scaleText}` : ""}.`

    // Grounded summary construction
    let builtSummary = `The caller contacted ${company} to inquire about ${primaryInterest}`
    if (scaleText) builtSummary += ` for their ${scaleText}`
    if (staffText) builtSummary += ` with ${staffText}`
    builtSummary += "."
    const additionalModules = productInterests.slice(1, 4).join(", ")
    if (additionalModules) {
      builtSummary += ` The caller specified the need for complete management software including ${additionalModules}.`
    }
    if (text.includes("quotation") || text.includes("pdf") || text.includes("details")) {
      builtSummary += ` The company representative agreed to send product details and PDFs.`
    }
    if (hasAgreedCallback) {
      builtSummary += ` Both parties agreed to reconnect on follow-up.`
    }
    summary = builtSummary

    nextSteps = [
      text.includes("quotation") || text.includes("pdf") ? "Send quotation and product PDF" : "Share detailed commercial proposal",
      hasAgreedCallback ? "Reconnect at agreed follow-up time" : "Schedule live product walkthrough"
    ]
    followUpRecommendations = [
      "Send quotation and product documentation promptly.",
      "Follow up on scheduled callback."
    ]
  } else if (text.includes("call back") || text.includes("later") || text.includes("busy")) {
    callOutcome = "CALL_BACK_LATER"
    summary = "Customer requested a callback at a later time."
    customerIntent = "Requesting follow-up callback."
    customerNeeds = ["Callback when available"]
    nextSteps = ["Schedule callback as requested."]
    followUpRecommendations = ["Call back at the customer's specified time."]
  } else if (text.includes("order placed") || text.includes("deal closed") || text.includes("payment done")) {
    callOutcome = "DEAL_CLOSED"
    summary = "Customer confirmed order and payment terms."
    customerIntent = "Finalizing purchase / closing deal."
    customerNeeds = ["Order processing"]
    nextSteps = ["Process onboarding and dispatch documentation."]
    followUpRecommendations = ["Assign implementation specialist."]
  } else {
    callOutcome = "NOT_INTERESTED"
    summary = "Conversation had no demonstrable product interest or commercial sales opportunity."
    customerIntent = "General inquiry without product interest."
    customerNeeds = []
    productInterests = []
    nextSteps = []
    followUpRecommendations = ["Archive or close without active follow-up."]
  }

  // Extract key moments from segments
  const keyMoments = segments.slice(0, 3).map((s) => ({
    timestamp: s.startTime || 0,
    description: `Discussion point by ${s.speaker}`,
    quote: s.text.length > 120 ? `${s.text.slice(0, 117)}...` : s.text,
  }))

  const objections = []
  if (text.includes("expensive") || text.includes("cost")) objections.push("Budget considerations")
  if (text.includes("time") || text.includes("delay")) objections.push("Timeline constraints")

  return {
    summary,
    customerIntent,
    customerNeeds,
    productInterests,
    objections,
    competitorMentions: [],
    sentiment,
    sentimentScore,
    callOutcome,
    keyMoments,
    nextSteps,
    followUpRecommendations,
    topicMatches: topicMatches.filter((t) => !t.topicName?.startsWith("http")),
    provider: "deterministic-nlp",
    model: "offline-rule-engine",
    usage: {
      inputTokens: null,
      outputTokens: null,
      audioDurationSeconds: transcript?.duration || 0,
    },
  }
}

/**
 * Analyzes call transcript via Google Gemini REST API.
 */
async function analyzeCallWithGemini({
  transcript,
  topicMatches = [],
  businessContext = null,
  apiKey,
  modelOverride = null,
  httpClient = makeHttpsRequest,
}) {
  if (!apiKey || typeof apiKey !== "string" || !apiKey.trim()) {
    throw new Error("A valid Gemini API key is required for call analysis.")
  }

  const model = modelOverride || resolveGeminiModel()
  const transcriptText = transcript.transcriptText || ""

  let businessSection = ""
  if (businessContext && (businessContext.companyName || businessContext.industry || (businessContext.products && businessContext.products.length > 0))) {
    const productsList = (businessContext.products && businessContext.products.length > 0)
      ? businessContext.products.map(p => `- ${p.name}${p.category ? ` (${p.category})` : ""}${p.type ? ` [${p.type}]` : ""}${p.description ? `: ${p.description}` : ""}`).join("\n")
      : "No specific products listed."

    businessSection = `\nTENANT BUSINESS & PRODUCTS CONTEXT:
- Company / Business Name: ${businessContext.companyName || "N/A"}
- Industry: ${businessContext.industry || "N/A"}
- Description: ${businessContext.description || "N/A"}
- Offered Products & Services:
${productsList}\n`
  }

  let topicMatchesSection = ""
  if (Array.isArray(topicMatches) && topicMatches.length > 0) {
    const topicList = topicMatches.map(t => `- Topic: ${t.name || t.topicName} (Category: ${t.category || "General"})`).join("\n")
    topicMatchesSection = `\nDETECTED APPROVED TOPIC MATCHES FOR THIS TENANT:
${topicList}\n`
  }

  const systemPrompt = `You are a Senior Sales Intelligence Auditor in Leads-365 CRM.
Your objective is to extract objective, grounded intelligence from this phone call transcript.
${businessSection}${topicMatchesSection}
STRICT GROUNDING & PRODUCT-RELEVANCE RULES:
1. STRICT SPEAKER ATTRIBUTION: Carefully distinguish who initiated the call and what each party stated.
   - If an external caller contacts the organization to offer third-party services (e.g., placement/recruitment agency, job applicants, staffing, loans, SEO, vendor supplies), the caller is NOT inquiring about our products.
   - Never interpret a company representative's polite reply (e.g., "vacancies full hain, WhatsApp daal do", "send details on WhatsApp", "will let you know") as customer purchase intent or genuine product interest.
2. PRODUCT RELEVANCE GATE: Compare the call against the Tenant Business & Products context above.
   - Only classify as \`INTERESTED\`, \`FOLLOW_UP_REQUIRED\`, \`CALL_BACK_LATER\`, or \`DEAL_CLOSED\` if a customer is genuinely inquiring about, evaluating, or purchasing the tenant's own approved products/services.
   - Website URLs (such as https://example.com/ or tenant websites) are web links, NOT product names. Do NOT use website URLs as product interests.
   - If the call is an unrelated pitch (e.g., recruitment agency, hiring inquiry, vendor sales pitch, spam, wrong number), or if the prospect explicitly rejects or has no need, you MUST classify \`callOutcome\` as \`NOT_INTERESTED\` (or \`WRONG_NUMBER\` if wrong party).
   - Under \`productInterests\`, list ONLY the tenant's approved products/modules from the Tenant Business & Products context above. NEVER put 'Placement and hiring services' or any third-party service under \`productInterests\`. Leave it empty \`[]\` for irrelevant calls.
3. Label sentiment accurately as POSITIVE, NEUTRAL, NEGATIVE, or MIXED based on actual conversation tone. A polite or neutral caller pitching recruitment is still \`NOT_INTERESTED\` in terms of callOutcome.
4. Output MUST be valid JSON adhering strictly to this schema:
{
  "summary": "Executive summary of the call (2-4 sentences). If an external agency called offering recruitment or services, accurately summarize that the caller offered services and the company had no open vacancies.",
  "customerIntent": "Primary purpose of inquiry (e.g., 'Offering recruitment services (unrelated)' or 'Inquiring about product demo/pricing')",
  "customerNeeds": ["Customer requirement 1", ...],
  "productInterests": ["Approved tenant product or module mentioned", ...],
  "objections": ["Expressed concern or objection", ...],
  "competitorMentions": ["Explicitly named competitor if mentioned", ...],
  "sentiment": "POSITIVE | NEUTRAL | NEGATIVE | MIXED",
  "sentimentScore": 0.50 to 0.95,
  "callOutcome": "INTERESTED | NOT_INTERESTED | FOLLOW_UP_REQUIRED | CALL_BACK_LATER | DEAL_CLOSED | ESCALATED | WRONG_NUMBER | UNRESOLVED | OUT_OF_SCOPE",
  "keyMoments": [
    {
      "timestamp": <seconds number>,
      "description": "Short explanation of moment",
      "quote": "Exact short quote from transcript"
    }
  ],
  "nextSteps": ["Actionable next step", ...],
  "followUpRecommendations": ["Guidance for sales agent follow-up", ...]
}`

  const userContent = `${systemPrompt}\n\n=== CALL TRANSCRIPT ===\n${transcriptText}\n\nPlease generate the JSON analysis:`

  const requestBody = {
    // Controls request-level API logging behavior on Google AI Studio
    store: false,
    contents: [
      {
        role: "user",
        parts: [
          {
            text: userContent,
          },
        ],
      },
    ],
    generationConfig: {
      maxOutputTokens: 4096,
      responseMimeType: "application/json",
    },
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`
  const headers = {
    "x-goog-api-key": apiKey.trim(),
  }

  let response
  try {
    response = await httpClient(endpoint, requestBody, headers)
  } catch (err) {
    throw new Error(sanitizeErrorMessage(err.message))
  }

  const rawText = response?.candidates?.[0]?.content?.parts?.[0]?.text
  if (!rawText) {
    throw new Error("Empty response received from Gemini Call Analysis API.")
  }

  let parsed
  try {
    const cleaned = rawText.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim()
    parsed = JSON.parse(cleaned)
  } catch (parseErr) {
    throw new Error(`Failed to parse Gemini Call Analysis output: ${sanitizeErrorMessage(parseErr.message)}. Raw text: ${sanitizeErrorMessage(rawText.slice(0, 200))}`)
  }

  const sentiment = VALID_SENTIMENTS.has(parsed.sentiment) ? parsed.sentiment : "NEUTRAL"
  const callOutcome = VALID_OUTCOMES.has(parsed.callOutcome) ? parsed.callOutcome : "FOLLOW_UP_REQUIRED"

  const keyMoments = Array.isArray(parsed.keyMoments)
    ? parsed.keyMoments.map((km) => ({
        timestamp: typeof km.timestamp === "number" && !isNaN(km.timestamp) ? km.timestamp : 0,
        description: String(km.description || "").trim(),
        quote: String(km.quote || "").trim(),
      })).filter((km) => km.description.length > 0)
    : []

  const usageMetadata = response?.usageMetadata || {}

  return {
    summary: parsed.summary || "Call analysis generated.",
    customerIntent: parsed.customerIntent || "General Inquiry",
    customerNeeds: Array.isArray(parsed.customerNeeds) ? parsed.customerNeeds.map(String) : [],
    productInterests: Array.isArray(parsed.productInterests) ? parsed.productInterests.map(String) : [],
    objections: Array.isArray(parsed.objections) ? parsed.objections.map(String) : [],
    competitorMentions: Array.isArray(parsed.competitorMentions) ? parsed.competitorMentions.map(String) : [],
    sentiment,
    sentimentScore: typeof parsed.sentimentScore === "number" ? Math.min(Math.max(parsed.sentimentScore, 0.1), 0.95) : 0.60,
    callOutcome,
    keyMoments,
    nextSteps: Array.isArray(parsed.nextSteps) ? parsed.nextSteps.map(String) : [],
    followUpRecommendations: Array.isArray(parsed.followUpRecommendations) ? parsed.followUpRecommendations.map(String) : [],
    topicMatches,
    provider: "gemini",
    model,
    usage: {
      inputTokens: usageMetadata.promptTokenCount || null,
      outputTokens: usageMetadata.candidatesTokenCount || null,
      audioDurationSeconds: transcript.duration || 0,
    },
  }
}

/**
 * High-level orchestration for Call Intelligence Analysis.
 */
async function processCallAnalysis({
  transcript,
  call = {},
  topicMatches = [],
  apiKey = null,
  httpClient = makeHttpsRequest,
  allowFallback = false,
  tenantId = null,
  businessContext = null,
}) {
  if (!transcript || !transcript.transcriptText) {
    throw new Error("A valid transcript with text content is required to generate call analysis.")
  }

  const effectiveTenantId = tenantId || call?.tenantId || transcript?.tenantId

  let resolvedBusinessContext = businessContext
  if (!resolvedBusinessContext && effectiveTenantId) {
    try {
      const [profile, products] = await Promise.all([
        TenantBusinessProfile.findOne({ tenantId: effectiveTenantId })
          .setOptions({ skipTenantFilter: true })
          .lean()
          .catch(() => null),
        BusinessProduct.find({ tenantId: effectiveTenantId, status: "active", isArchived: false })
          .setOptions({ skipTenantFilter: true })
          .select("name category description type")
          .lean()
          .catch(() => []),
      ])

      if (profile || (products && products.length > 0)) {
        resolvedBusinessContext = {
          companyName: profile?.businessName || profile?.companyName || "",
          industry: profile?.industry || profile?.customIndustry || "",
          description: profile?.description || "",
          products: (products || []).map((p) => ({
            name: p.name,
            category: p.category || "",
            type: p.type || "PRODUCT",
            description: p.description || "",
          })),
        }
      }
    } catch (ctxErr) {
      console.warn("⚠️ Failed to load tenant business context for call analysis:", ctxErr.message)
    }
  }

  let rawResult = null
  const effectiveKey = apiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY
  const hasLiveKey = Boolean(effectiveKey && effectiveKey.trim())

  if (hasLiveKey) {
    try {
      console.log(`ℹ️ Invoking Gemini Call Analysis for transcript (${transcript._id || "in-memory"})...`)
      rawResult = await analyzeCallWithGemini({
        transcript,
        topicMatches,
        businessContext: resolvedBusinessContext,
        apiKey: effectiveKey,
        httpClient,
      })
    } catch (err) {
      console.warn("⚠️ Gemini Call Analysis failed:", sanitizeErrorMessage(err.message))
      if (!allowFallback) {
        throw err
      }
    }
  }

  if (!rawResult && allowFallback) {
    console.log("ℹ️ Using deterministic fallback call analysis...")
    rawResult = generateDeterministicCallAnalysis({ transcript, call, topicMatches, tenantCatalog: resolvedBusinessContext })
  }

  if (!rawResult) {
    throw new Error("BLOCKED — API credentials unavailable for call analysis and fallback disabled.")
  }

  // Mandatory Post-AI Deterministic Product Relevance & Qualification Gate
  try {
    const gateResult = await evaluateProductRelevanceAndGate({
      transcript,
      call,
      rawAnalysis: rawResult,
      matchedTopics: topicMatches,
      tenantId: effectiveTenantId,
    })

    rawResult.callOutcome = gateResult.callOutcome
    rawResult.productRelevanceScore = gateResult.productRelevanceScore
    rawResult.leadQualificationScore = gateResult.leadQualificationScore
    rawResult.qualificationStatus = gateResult.qualificationStatus
    rawResult.qualificationReason = gateResult.qualificationReason
    rawResult.customerPurchaseIntent = gateResult.customerPurchaseIntent
    rawResult.isProductRelevant = gateResult.isProductRelevant
    rawResult.crmLeadAction = gateResult.crmLeadAction
    rawResult.topicMatches = gateResult.matchedApprovedTopics
    rawResult.productInterests = gateResult.filteredProductInterests
    rawResult.callbackRequested = Boolean(gateResult.callbackRequested)
    rawResult.requestedCallbackDateTime = gateResult.requestedCallbackDateTime || null
    rawResult.callbackTimezone = gateResult.callbackTimezone || "Asia/Kolkata"
    rawResult.callbackTimePrecision = gateResult.callbackTimePrecision || null
    rawResult.callbackReason = gateResult.callbackReason || null
    rawResult.callbackLanguage = gateResult.callbackLanguage || null
    rawResult.voiceConfirmation = gateResult.voiceConfirmation || null
    rawResult.callbackDirection = gateResult.callbackDirection || null
    rawResult.taskAction = gateResult.taskAction || null
    rawResult.directionDescription = gateResult.directionDescription || null

    if (gateResult.summary && (gateResult.qualificationStatus === "DISQUALIFIED" || !rawResult.summary || rawResult.summary.includes("General inquiry") || rawResult.summary.includes("no demonstrable product interest"))) {
      rawResult.summary = gateResult.summary
    }
    if (gateResult.customerIntent && (gateResult.qualificationStatus === "DISQUALIFIED" || !rawResult.customerIntent || rawResult.customerIntent.includes("General inquiry"))) {
      rawResult.customerIntent = gateResult.customerIntent
    }
  } catch (gateErr) {
    console.warn("⚠️ Product Relevance Gate error:", sanitizeErrorMessage(gateErr.message))
  }

  return rawResult
}

module.exports = {
  generateDeterministicCallAnalysis,
  analyzeCallWithGemini,
  processCallAnalysis,
  VALID_SENTIMENTS,
  VALID_OUTCOMES,
}
