const { AIKeywordTopic } = require("../models/AIKeywordTopic")
const { sanitizeErrorMessage } = require("./aiProvider.service")

/**
 * Semantic Approved Topic Matcher - Phase 3: AI Call Intelligence
 * 
 * Compares call transcript text and segments against tenant's approved AI Keyword Topics.
 * 
 * Strict Grounding & Safety Rules:
 * 1. ONLY topics with status === 'APPROVED' are eligible for matching.
 * 2. Topics with status 'DRAFT', 'PENDING_APPROVAL', 'REJECTED', or 'ARCHIVED' are strictly excluded.
 * 3. Cross-tenant topics are strictly isolated.
 * 4. NEVER automatically approves, creates, or mutates any topics.
 * 5. Returns grounded quote evidence and timestamps from transcript segments.
 */

/**
 * Normalizes text to lowercase alphanumeric tokens.
 */
function tokenize(text) {
  if (!text || typeof text !== "string") return []
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2)
}

/**
 * Calculates Jaccard / token similarity between text snippet and target keywords.
 */
function calculateKeywordMatch(transcriptText, keywords = []) {
  if (!transcriptText || !keywords || keywords.length === 0) {
    return { matched: [], score: 0 }
  }

  const lowerText = transcriptText.toLowerCase()
  const textTokens = new Set(tokenize(lowerText))
  const matched = []

  for (const kw of keywords) {
    if (!kw || typeof kw !== "string") continue
    const cleanKw = kw.toLowerCase().trim()
    if (!cleanKw) continue

    // Exact phrase match
    if (lowerText.includes(cleanKw)) {
      matched.push(kw)
    } else {
      // Token overlap
      const kwTokens = tokenize(cleanKw)
      if (kwTokens.length > 0 && kwTokens.every((t) => textTokens.has(t))) {
        matched.push(kw)
      }
    }
  }

  const uniqueMatched = Array.from(new Set(matched))
  const score = uniqueMatched.length > 0 ? Math.min(0.6 + uniqueMatched.length * 0.1, 0.98) : 0
  return { matched: uniqueMatched, score }
}

/**
 * Finds the best matching transcript segment for evidence and timestamp.
 */
function findBestEvidenceSegment(segments = [], matchedKeywords = [], topicName = "") {
  if (!segments || segments.length === 0) {
    return { quote: "", timestamp: 0 }
  }

  const targetTerms = [...matchedKeywords, topicName].map((t) => (t || "").toLowerCase()).filter(Boolean)
  let bestSegment = segments[0]
  let bestHits = -1

  for (const seg of segments) {
    const text = (seg.text || "").toLowerCase()
    let hits = 0
    for (const term of targetTerms) {
      if (text.includes(term)) hits += 2
      const tokens = tokenize(term)
      for (const tok of tokens) {
        if (text.includes(tok)) hits += 1
      }
    }
    if (hits > bestHits) {
      bestHits = hits
      bestSegment = seg
    }
  }

  const quote = bestSegment.text.length > 150 ? `${bestSegment.text.slice(0, 147)}...` : bestSegment.text
  return {
    quote,
    timestamp: typeof bestSegment.startTime === "number" ? bestSegment.startTime : 0,
  }
}

/**
 * Matches a call transcript against tenant's APPROVED topics.
 * 
 * @param {Object} options
 * @param {string} options.tenantId - Partitioned tenant ID
 * @param {string} options.transcriptText - Full call transcript text
 * @param {Array} options.segments - Timestamped transcript segments
 * @param {number} [options.minConfidence=0.65] - Minimum confidence threshold
 * @returns {Promise<Array>} List of matched approved topics with evidence
 */
async function matchApprovedTopicsForCall({
  tenantId,
  transcriptText = "",
  segments = [],
  minConfidence = 0.65,
}) {
  if (!tenantId || typeof tenantId !== "string" || !tenantId.trim()) {
    throw new Error("A valid tenantId is required for topic matching.")
  }

  const cleanTenantId = tenantId.trim()

  // 1. Strictly load APPROVED topics for this tenant using Phase 2 contract
  const approvedTopics = await AIKeywordTopic.getApprovedTopicsForTenant(cleanTenantId)

  if (!approvedTopics || approvedTopics.length === 0) {
    return []
  }

  // Double-check: Enforce approved-only invariant in memory
  const verifiedApprovedOnly = approvedTopics.filter(
    (t) => t.tenantId === cleanTenantId && t.status === "APPROVED"
  )

  const matches = []

  for (const topic of verifiedApprovedOnly) {
    const allSearchTerms = [
      topic.name,
      ...(Array.isArray(topic.primaryKeywords) ? topic.primaryKeywords : []),
      ...(Array.isArray(topic.synonyms) ? topic.synonyms : []),
      ...(Array.isArray(topic.productTerminology) ? topic.productTerminology : []),
    ]

    const { matched, score } = calculateKeywordMatch(transcriptText, allSearchTerms)

    // Check if score meets minimum threshold or has direct matches
    if (matched.length > 0 && score >= minConfidence) {
      const { quote, timestamp } = findBestEvidenceSegment(segments, matched, topic.name)

      // Calculate confidence clamped between 0.65 and 0.98
      const confidenceScore = Number(Math.min(Math.max(score, 0.65), 0.98).toFixed(2))

      matches.push({
        topicId: topic._id,
        topicName: topic.name,
        category: topic.category || "Sales & Inquiries",
        confidenceScore,
        matchedKeywords: matched.slice(0, 8),
        evidenceQuote: quote,
        timestamp,
      })
    }
  }

  // Sort descending by confidenceScore, deduplicate by topicId
  matches.sort((a, b) => b.confidenceScore - a.confidenceScore)

  const seenIds = new Set()
  const deduplicated = []
  for (const m of matches) {
    const idStr = m.topicId.toString()
    if (!seenIds.has(idStr)) {
      seenIds.add(idStr)
      deduplicated.push(m)
    }
  }

  return deduplicated
}

module.exports = {
  matchApprovedTopicsForCall,
  calculateKeywordMatch,
  findBestEvidenceSegment,
}
