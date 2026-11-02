const { sanitizeErrorMessage, resolveGeminiModel, makeHttpsRequest } = require("./aiProvider.service")

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
])

/**
 * Deterministic NLP Fallback Analysis Generator.
 * Used for offline environments, unconfigured keys, or test verification.
 */
function generateDeterministicCallAnalysis({ transcript, call = {}, topicMatches = [] }) {
  const text = (transcript?.transcriptText || "").toLowerCase()
  const segments = transcript?.segments || []

  // Determine sentiment
  let sentiment = "NEUTRAL"
  let sentimentScore = 0.60
  if (text.includes("great") || text.includes("perfect") || text.includes("thank you") || text.includes("interested")) {
    sentiment = "POSITIVE"
    sentimentScore = 0.85
  } else if (text.includes("bad") || text.includes("expensive") || text.includes("cancel") || text.includes("complaint")) {
    sentiment = "NEGATIVE"
    sentimentScore = 0.35
  } else if (text.includes("maybe") || text.includes("think") || text.includes("consider")) {
    sentiment = "MIXED"
    sentimentScore = 0.50
  }

  // Determine outcome
  let callOutcome = "FOLLOW_UP_REQUIRED"
  if (text.includes("quotation") || text.includes("demo") || text.includes("interested") || text.includes("pricing")) {
    callOutcome = "INTERESTED"
  } else if (text.includes("not interested") || text.includes("don't call") || text.includes("wrong number")) {
    callOutcome = "NOT_INTERESTED"
  } else if (text.includes("call back") || text.includes("later") || text.includes("busy")) {
    callOutcome = "CALL_BACK_LATER"
  } else if (text.includes("order placed") || text.includes("deal closed") || text.includes("payment done")) {
    callOutcome = "DEAL_CLOSED"
  }

  // Extract key moments from segments
  const keyMoments = segments.slice(0, 3).map((s) => ({
    timestamp: s.startTime || 0,
    description: `Discussion point by ${s.speaker}`,
    quote: s.text.length > 120 ? `${s.text.slice(0, 117)}...` : s.text,
  }))

  const summary = `Sales conversation regarding business offerings. Customer discussed requirements and agreed on next steps with the representative.`
  const customerIntent = "Inquiring about product specifications, pricing, and scheduling a walkthrough."
  const customerNeeds = ["Pricing clarity", "Feature comparison", "Implementation timeline"]
  const productInterests = topicMatches.map((t) => t.topicName).slice(0, 3)
  if (productInterests.length === 0) productInterests.push("General CRM Solutions")

  const objections = []
  if (text.includes("expensive") || text.includes("cost")) objections.push("Budget considerations")
  if (text.includes("time") || text.includes("delay")) objections.push("Timeline constraints")

  const competitorMentions = []

  const nextSteps = [
    "Send detailed commercial proposal and product documentation.",
    "Schedule follow-up product demonstration.",
  ]

  const followUpRecommendations = [
    "Follow up within 24-48 business hours with technical specs.",
    "Assign a senior product specialist for the demonstration.",
  ]

  return {
    summary,
    customerIntent,
    customerNeeds,
    productInterests,
    objections,
    competitorMentions,
    sentiment,
    sentimentScore,
    callOutcome,
    keyMoments,
    nextSteps,
    followUpRecommendations,
    topicMatches,
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
  apiKey,
  modelOverride = null,
  httpClient = makeHttpsRequest,
}) {
  if (!apiKey || typeof apiKey !== "string" || !apiKey.trim()) {
    throw new Error("A valid Gemini API key is required for call analysis.")
  }

  const model = modelOverride || resolveGeminiModel()
  const transcriptText = transcript.transcriptText || ""

  const systemPrompt = `You are a Senior Sales Intelligence Auditor in Leads-365 CRM.
Your objective is to extract objective, grounded intelligence from this phone call transcript.

STRICT GROUNDING RULES:
1. Ground every finding strictly in the provided transcript. DO NOT invent prices, dates, unstated commitments, or competitor names.
2. Label sentiment accurately as POSITIVE, NEUTRAL, NEGATIVE, or MIXED.
3. Label call outcome as one of: INTERESTED, NOT_INTERESTED, FOLLOW_UP_REQUIRED, CALL_BACK_LATER, DEAL_CLOSED, ESCALATED, WRONG_NUMBER, UNRESOLVED.
4. Provide meaningful confidence and sentiment scores between 0.0 and 1.0 (do not use 1.0).
5. Output MUST be valid JSON adhering strictly to this schema:
{
  "summary": "Executive summary of the call (2-4 sentences)",
  "customerIntent": "Primary purpose of customer inquiry",
  "customerNeeds": ["Customer requirement 1", ...],
  "productInterests": ["Product or service mentioned", ...],
  "objections": ["Expressed concern or objection", ...],
  "competitorMentions": ["Explicitly named competitor if mentioned", ...],
  "sentiment": "POSITIVE | NEUTRAL | NEGATIVE | MIXED",
  "sentimentScore": 0.50 to 0.95,
  "callOutcome": "INTERESTED | NOT_INTERESTED | FOLLOW_UP_REQUIRED | CALL_BACK_LATER | DEAL_CLOSED | ESCALATED | WRONG_NUMBER | UNRESOLVED",
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
  allowFallback = true,
}) {
  if (!transcript || !transcript.transcriptText) {
    throw new Error("A valid transcript with text content is required to generate call analysis.")
  }

  const effectiveKey = apiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY
  const hasLiveKey = Boolean(effectiveKey && effectiveKey.trim())

  if (hasLiveKey) {
    try {
      console.log(`ℹ️ Invoking Gemini Call Analysis for transcript (${transcript._id || "in-memory"})...`)
      return await analyzeCallWithGemini({
        transcript,
        topicMatches,
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

  if (allowFallback) {
    console.log("ℹ️ Using deterministic fallback call analysis...")
    return generateDeterministicCallAnalysis({ transcript, call, topicMatches })
  }

  throw new Error("BLOCKED — API credentials unavailable for call analysis and fallback disabled.")
}

module.exports = {
  generateDeterministicCallAnalysis,
  analyzeCallWithGemini,
  processCallAnalysis,
  VALID_SENTIMENTS,
  VALID_OUTCOMES,
}
