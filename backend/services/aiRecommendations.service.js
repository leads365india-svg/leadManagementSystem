const mongoose = require("mongoose")
const AIManagerRecommendation = require("../models/AIManagerRecommendation")
const AICoachingReview = require("../models/AICoachingReview")
const Call = require("../models/Call")
const FollowUp = require("../models/FollowUp")
const Lead = require("../models/Lead")

/**
 * AI Recommendations & Coaching Review Service - Phase 4: Modules F & G
 * 
 * Manages the manager alert lifecycle:
 * - High-intent follow-up alerts
 * - Explicit callback requests
 * - Repeated objection escalation
 * - Agent coaching review triggers
 * - Manager coaching review 1-on-1 workflow
 * 
 * Strict Deduplication & Idempotency:
 * - Prevents duplicate alerts for the same underlying call or lead event using composite idempotency keys.
 */

/**
 * Analyzes call outcomes and creates actionable manager alerts.
 */
async function generateRecommendationsForCall({ call, analysis, tenantId }) {
  const effectiveTenant = tenantId || call?.tenantId
  if (!call || !analysis || !effectiveTenant) return []

  const createdRecommendations = []
  const callIdStr = call._id.toString()
  const leadId = call.leadId?._id || call.leadId
  const agentId = call.agentId?._id || call.agentId

  // Trigger 1: Customer explicitly requested a callback
  if (
    analysis.callOutcome === "CALL_BACK_LATER" ||
    (analysis.summary && analysis.summary.toLowerCase().includes("call back")) ||
    (analysis.keyMoments && analysis.keyMoments.some((km) => km.description.toLowerCase().includes("call back")))
  ) {
    const key = `rec_callback_${callIdStr}`
    const rec = await AIManagerRecommendation.findOneAndUpdate(
      { tenantId: effectiveTenant, idempotencyKey: key },
      {
        tenantId: effectiveTenant,
        recommendationType: "CALLBACK_REQUESTED",
        priority: "HIGH",
        title: "Customer Requested Callback",
        description: `Customer on call (${call.customerNumber || "Lead"}) explicitly requested a scheduled callback.`,
        suggestedAction: "Ensure agent locks in a scheduled callback touchpoint in CRM.",
        leadId: leadId ? new mongoose.Types.ObjectId(leadId) : null,
        callId: call._id,
        agentId: agentId ? new mongoose.Types.ObjectId(agentId) : null,
        evidence: {
          quote: analysis.keyMoments?.[0]?.quote || analysis.summary,
          timestamp: analysis.keyMoments?.[0]?.timestamp || 0,
          context: "Direct customer request during interaction",
        },
        idempotencyKey: key,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).setOptions({ skipTenantFilter: true })

    createdRecommendations.push(rec)
  }

  // Trigger 2: High Intent Lead Needing Follow-up
  if (
    analysis.callOutcome === "INTERESTED" ||
    (analysis.sentiment === "POSITIVE" && analysis.productInterests?.length > 0)
  ) {
    const key = `rec_highintent_${callIdStr}`
    const rec = await AIManagerRecommendation.findOneAndUpdate(
      { tenantId: effectiveTenant, idempotencyKey: key },
      {
        tenantId: effectiveTenant,
        recommendationType: "HIGH_INTENT_FOLLOWUP",
        priority: "HIGH",
        title: "High-Intent Commercial Lead",
        description: `High interest expressed for ${analysis.productInterests?.join(", ") || "product offerings"}.`,
        suggestedAction: "Dispatch official commercial proposal or schedule technical demo within 24h.",
        leadId: leadId ? new mongoose.Types.ObjectId(leadId) : null,
        callId: call._id,
        agentId: agentId ? new mongoose.Types.ObjectId(agentId) : null,
        evidence: {
          quote: analysis.summary,
          context: `Outcome: ${analysis.callOutcome}, Tone: ${analysis.sentiment}`,
        },
        idempotencyKey: key,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).setOptions({ skipTenantFilter: true })

    createdRecommendations.push(rec)
  }

  // Trigger 3: Repeated Objections (2 or more objections)
  if (Array.isArray(analysis.objections) && analysis.objections.length >= 2) {
    const key = `rec_objections_${callIdStr}`
    const rec = await AIManagerRecommendation.findOneAndUpdate(
      { tenantId: effectiveTenant, idempotencyKey: key },
      {
        tenantId: effectiveTenant,
        recommendationType: "REPEATED_OBJECTION",
        priority: "MEDIUM",
        title: "Multiple Objections Encountered",
        description: `Customer raised multiple objections: ${analysis.objections.join("; ")}.`,
        suggestedAction: "Review call recording to evaluate if objection handling scripts require refinement.",
        leadId: leadId ? new mongoose.Types.ObjectId(leadId) : null,
        callId: call._id,
        agentId: agentId ? new mongoose.Types.ObjectId(agentId) : null,
        evidence: {
          quote: analysis.objections.join(", "),
          context: "Multiple customer hesitations raised",
        },
        idempotencyKey: key,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).setOptions({ skipTenantFilter: true })

    createdRecommendations.push(rec)
  }

  return createdRecommendations
}

/**
 * Lists manager recommendations with filtering and pagination.
 */
async function listManagerRecommendations({
  tenantId,
  status = "all",
  priority = "all",
  type = "all",
  page = 1,
  limit = 20,
}) {
  if (!tenantId) {
    throw new Error("tenantId is required.")
  }

  const query = { tenantId }
  if (status && status !== "all") query.status = status
  if (priority && priority !== "all") query.priority = priority
  if (type && type !== "all") query.recommendationType = type

  const p = Math.max(1, parseInt(page, 10) || 1)
  const lim = Math.max(1, Math.min(parseInt(limit, 10) || 20, 100))
  const skip = (p - 1) * lim

  const [items, total] = await Promise.all([
    AIManagerRecommendation.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(lim)
      .populate("leadId", "name phone email status")
      .populate("agentId", "name email role")
      .populate("callId", "customerNumber direction duration startedAt")
      .setOptions({ skipTenantFilter: true })
      .lean(),
    AIManagerRecommendation.countDocuments(query).setOptions({ skipTenantFilter: true }),
  ])

  return {
    recommendations: items,
    pagination: {
      page: p,
      limit: lim,
      total,
      totalPages: Math.ceil(total / lim) || 1,
    },
  }
}

/**
 * Updates a recommendation's status (VIEWED, ACCEPTED, DISMISSED, RESOLVED).
 */
async function updateRecommendationStatus({
  tenantId,
  id,
  status,
  userId = null,
  managerNotes = "",
}) {
  if (!tenantId || !id || !status) {
    throw new Error("tenantId, id, and status are required.")
  }

  const rec = await AIManagerRecommendation.findOneAndUpdate(
    { _id: new mongoose.Types.ObjectId(id), tenantId },
    {
      status,
      reviewedBy: userId ? new mongoose.Types.ObjectId(userId) : null,
      reviewedAt: new Date(),
      ...(managerNotes ? { managerNotes } : {}),
    },
    { new: true }
  ).setOptions({ skipTenantFilter: true })

  if (!rec) {
    throw new Error("Recommendation not found.")
  }

  return rec
}

/**
 * Creates a formal manager coaching review (1-on-1 record).
 */
async function createCoachingReview({
  tenantId,
  agentId,
  managerId,
  callId = null,
  scorecardId = null,
  managerNotes,
  strengthsAcknowledged = [],
  improvementCommitments = [],
  agreedActionItems = [],
}) {
  if (!tenantId || !agentId || !managerId || !managerNotes) {
    throw new Error("tenantId, agentId, managerId, and managerNotes are required.")
  }

  const review = new AICoachingReview({
    tenantId,
    agentId: new mongoose.Types.ObjectId(agentId),
    managerId: new mongoose.Types.ObjectId(managerId),
    callId: callId ? new mongoose.Types.ObjectId(callId) : null,
    scorecardId: scorecardId ? new mongoose.Types.ObjectId(scorecardId) : null,
    status: "DISCUSSED",
    managerNotes: managerNotes.trim(),
    strengthsAcknowledged,
    improvementCommitments,
    agreedActionItems,
    discussedAt: new Date(),
  })

  await review.save()
  return review
}

/**
 * Lists formal coaching reviews with role-based scoping.
 */
async function listCoachingReviews({
  tenantId,
  agentId = null,
  managerId = null,
  page = 1,
  limit = 20,
}) {
  if (!tenantId) {
    throw new Error("tenantId is required.")
  }

  const query = { tenantId }
  if (agentId) query.agentId = new mongoose.Types.ObjectId(agentId)
  if (managerId) query.managerId = new mongoose.Types.ObjectId(managerId)

  const p = Math.max(1, parseInt(page, 10) || 1)
  const lim = Math.max(1, Math.min(parseInt(limit, 10) || 20, 100))
  const skip = (p - 1) * lim

  const [items, total] = await Promise.all([
    AICoachingReview.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(lim)
      .populate("agentId", "name email role")
      .populate("managerId", "name email role")
      .populate("callId", "customerNumber startedAt duration")
      .setOptions({ skipTenantFilter: true })
      .lean(),
    AICoachingReview.countDocuments(query).setOptions({ skipTenantFilter: true }),
  ])

  return {
    reviews: items,
    pagination: {
      page: p,
      limit: lim,
      total,
      totalPages: Math.ceil(total / lim) || 1,
    },
  }
}

/**
 * Marks a coaching review as ACTION_COMPLETED.
 */
async function completeCoachingReview({ tenantId, reviewId }) {
  if (!tenantId || !reviewId) {
    throw new Error("tenantId and reviewId are required.")
  }

  const review = await AICoachingReview.findOneAndUpdate(
    { _id: new mongoose.Types.ObjectId(reviewId), tenantId },
    {
      status: "ACTION_COMPLETED",
      completedAt: new Date(),
    },
    { new: true }
  ).setOptions({ skipTenantFilter: true })

  if (!review) {
    throw new Error("Coaching review not found.")
  }

  return review
}

module.exports = {
  generateRecommendationsForCall,
  listManagerRecommendations,
  updateRecommendationStatus,
  createCoachingReview,
  listCoachingReviews,
  completeCoachingReview,
}
