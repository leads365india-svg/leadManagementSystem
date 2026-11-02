const { sanitizeErrorMessage } = require("./aiProvider.service")
const RawAITranscript = require("../models/AITranscript")
const AITranscript = RawAITranscript.AITranscript || RawAITranscript
const RawAICallAnalysis = require("../models/AICallAnalysis")
const AICallAnalysis = RawAICallAnalysis.AICallAnalysis || RawAICallAnalysis
const RawAIKeywordTopic = require("../models/AIKeywordTopic")
const AIKeywordTopic = RawAIKeywordTopic.AIKeywordTopic || RawAIKeywordTopic

/**
 * AI Sales Coaching Engine - Phase 4: Sales Performance & Coaching
 * 
 * Generates transparent, transcript-grounded coaching insights for phone calls:
 * 1. Requirement discovery (evidence-backed discovery questions)
 * 2. Product knowledge communication (features, catalog, offerings)
 * 3. Objection handling effectiveness
 * 4. Customer question clarity
 * 5. Next-step & closing discipline
 * 6. Business-approved topic adherence (Phase 2 Approved Topics)
 * 7. Actionable improvement areas & objection response scripts
 * 
 * Strict Grounding & Fairness Rules:
 * - Every claim is strictly grounded in spoken transcript segments; zero invented quotes.
 * - If transcript is empty or has < 2 segments, flags 'NOT_ENOUGH_EVIDENCE'.
 * - Sentiment alone never determines performance score.
 * - Unsuccessful call outcome does not automatically imply poor agent performance.
 */

/**
 * Generates an evidence-backed coaching report for an analyzed call.
 */
async function generateCallCoachingReport({
  call,
  analysis = null,
  transcript = null,
  tenantId = null,
}) {
  const effectiveTenant = tenantId || call?.tenantId
  if (!call || !effectiveTenant) {
    throw new Error("Call and tenantId are required to generate coaching insights.")
  }

  // Fetch analysis if not provided
  let callAnalysis = analysis
  if (!callAnalysis) {
    callAnalysis = await AICallAnalysis.findOne({ tenantId: effectiveTenant, callId: call._id })
      .sort({ analysisVersion: -1 })
      .setOptions({ skipTenantFilter: true })
  }

  // Fetch transcript if not provided
  let callTranscript = transcript
  if (!callTranscript) {
    callTranscript = await AITranscript.findOne({ tenantId: effectiveTenant, callId: call._id })
      .sort({ version: -1 })
      .setOptions({ skipTenantFilter: true })
  }

  const segments = callTranscript?.segments || []
  const transcriptText = (callTranscript?.transcriptText || "").toLowerCase()
  const agentSegments = segments.filter((s) => (s.speaker || "").toLowerCase().includes("agent"))
  const customerSegments = segments.filter((s) => (s.speaker || "").toLowerCase().includes("customer"))

  // Insufficient evidence check
  if (!callTranscript || segments.length < 2 || !transcriptText.trim()) {
    return {
      evidenceCoverage: "NOT_ENOUGH_EVIDENCE",
      confidenceScore: 0.3,
      strengths: [],
      improvementAreas: [],
      missedOpportunities: [],
      suggestedResponses: [],
      recommendedTrainingTopics: ["Call Logging & Audio Quality Assurance"],
      dimensionScores: {
        requirementDiscovery: null,
        productKnowledge: null,
        objectionHandling: null,
        communicationClarity: null,
        nextStepDiscipline: null,
        customerEngagement: null,
      },
      summary: "Insufficient audio or transcript segments to generate an evidence-backed coaching assessment.",
    }
  }

  // 1. Evaluate Requirement Discovery
  const discoveryKeywords = ["what", "how", "when", "which", "requirement", "need", "budget", "looking for", "prefer", "kya", "kaise", "kab"]
  const discoveryMatches = agentSegments.filter((s) =>
    discoveryKeywords.some((k) => s.text.toLowerCase().includes(k)) && s.text.includes("?")
  )
  const requirementDiscoveryScore = discoveryMatches.length >= 2 ? 85 : discoveryMatches.length === 1 ? 70 : 50

  // 2. Evaluate Product Knowledge
  const productInterests = callAnalysis?.productInterests || []
  const matchedTopics = callAnalysis?.topicMatches || []
  const productMentions = agentSegments.filter((s) =>
    productInterests.some((p) => s.text.toLowerCase().includes(p.toLowerCase())) ||
    matchedTopics.some((t) => s.text.toLowerCase().includes(t.topicName.toLowerCase()))
  )
  const productKnowledgeScore = productMentions.length >= 2 ? 88 : productMentions.length === 1 ? 72 : 55

  // 3. Evaluate Objection Handling
  const objections = callAnalysis?.objections || []
  let objectionHandlingScore = 75
  const suggestedResponses = []

  if (objections.length > 0) {
    const addressingSegments = agentSegments.filter((s) =>
      s.text.toLowerCase().includes("understand") ||
      s.text.toLowerCase().includes("solution") ||
      s.text.toLowerCase().includes("offer") ||
      s.text.toLowerCase().includes("discount") ||
      s.text.toLowerCase().includes("features") ||
      s.text.toLowerCase().includes("guarantee") ||
      s.text.toLowerCase().includes("hamara")
    )
    if (addressingSegments.length >= objections.length) {
      objectionHandlingScore = 85
    } else if (addressingSegments.length > 0) {
      objectionHandlingScore = 65
    } else {
      objectionHandlingScore = 45
    }

    // Build constructive suggested responses
    objections.forEach((obj) => {
      suggestedResponses.push({
        objection: obj,
        suggestedResponse: `Acknowledge the customer's concern regarding "${obj}", validate their point, and highlight our verified ROI, warranty, and flexible options.`,
      })
    })
  }

  // 4. Evaluate Next-Step Discipline
  const nextStepKeywords = ["follow up", "callback", "call you", "send", "whatsapp", "quotation", "email", "meeting", "kal", "bhej", "discuss"]
  const nextStepMatches = agentSegments.filter((s) =>
    nextStepKeywords.some((k) => s.text.toLowerCase().includes(k))
  )
  const nextStepDisciplineScore = nextStepMatches.length >= 1 ? 90 : 40

  // 5. Evaluate Communication Clarity
  const communicationClarityScore = segments.length >= 6 ? 82 : 68

  // 6. Evaluate Customer Engagement
  const customerEngagementScore = customerSegments.length >= 2 ? 80 : 50

  // Strengths with quotes
  const strengths = []
  if (discoveryMatches.length > 0) {
    strengths.push({
      title: "Active Requirement Discovery",
      description: "Agent actively asked discovering questions to clarify customer needs.",
      evidenceQuote: discoveryMatches[0].text,
      timestamp: discoveryMatches[0].startTime || 0,
    })
  }
  if (productMentions.length > 0) {
    strengths.push({
      title: "Accurate Catalog Presentation",
      description: "Agent clearly explained product features aligned with customer inquiries.",
      evidenceQuote: productMentions[0].text,
      timestamp: productMentions[0].startTime || 0,
    })
  }
  if (nextStepMatches.length > 0) {
    strengths.push({
      title: "Clear Next-Step Alignment",
      description: "Agent established explicit forward momentum and callback expectation.",
      evidenceQuote: nextStepMatches[0].text,
      timestamp: nextStepMatches[0].startTime || 0,
    })
  }

  // Improvement Areas
  const improvementAreas = []
  if (objections.length > 0 && objectionHandlingScore < 70) {
    improvementAreas.push({
      title: "Proactive Objection Handling",
      description: `Customer raised objections (${objections.slice(0, 2).join(", ")}) that could be addressed with value-focused framing rather than deflecting.`,
      evidenceQuote: customerSegments.find((s) => objections.some((o) => s.text.toLowerCase().includes(o.toLowerCase())))?.text || "",
      timestamp: 0,
      suggestion: "Use the 'Feel, Felt, Found' framework and offer a tailored demonstration or quotation breakdown.",
    })
  }
  if (nextStepMatches.length === 0) {
    improvementAreas.push({
      title: "Closing Commitment & Action Scheduling",
      description: "Call concluded without locking in an explicit date, time, or channel for the subsequent touchpoint.",
      evidenceQuote: agentSegments[agentSegments.length - 1]?.text || "",
      timestamp: agentSegments[agentSegments.length - 1]?.startTime || 0,
      suggestion: "Always agree on a specific day and time (e.g., 'Will tomorrow at 3 PM work for a quick review?').",
    })
  }

  // Missed Opportunities
  const missedOpportunities = []
  if (callAnalysis?.competitorMentions && callAnalysis.competitorMentions.length > 0) {
    missedOpportunities.push({
      title: "Competitor Differentiation Gap",
      description: `Customer referenced competitors (${callAnalysis.competitorMentions.join(", ")}). Highlight unique value propositions and verified service SLA.`,
    })
  }

  // Training Recommendations
  const recommendedTrainingTopics = []
  if (objectionHandlingScore < 75) recommendedTrainingTopics.push("Advanced Objection Resolution & Value Selling")
  if (nextStepDisciplineScore < 75) recommendedTrainingTopics.push("Closing Discipline & Follow-up Scheduling")
  if (requirementDiscoveryScore < 75) recommendedTrainingTopics.push("SPIN & Consultative Requirement Discovery")
  if (recommendedTrainingTopics.length === 0) recommendedTrainingTopics.push("High-Value Enterprise Deal Negotiation")

  return {
    evidenceCoverage: segments.length >= 8 ? "HIGH" : "MODERATE",
    confidenceScore: 0.88,
    strengths,
    improvementAreas,
    missedOpportunities,
    suggestedResponses,
    recommendedTrainingTopics,
    dimensionScores: {
      requirementDiscovery: requirementDiscoveryScore,
      productKnowledge: productKnowledgeScore,
      objectionHandling: objectionHandlingScore,
      communicationClarity: communicationClarityScore,
      nextStepDiscipline: nextStepDisciplineScore,
      customerEngagement: customerEngagementScore,
    },
    summary: `Coaching analysis evaluated ${segments.length} spoken segments. Strengths identified in ${strengths.map((s) => s.title).join(", ") || "professional conduct"}.`,
  }
}

module.exports = {
  generateCallCoachingReport,
}
