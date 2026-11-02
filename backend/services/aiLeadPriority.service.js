const mongoose = require("mongoose")
const RawAILeadPriority = require("../models/AILeadPriority")
const AILeadPriority = RawAILeadPriority.AILeadPriority || RawAILeadPriority
const Lead = require("../models/Lead")
const Call = require("../models/Call")
const RawAICallAnalysis = require("../models/AICallAnalysis")
const AICallAnalysis = RawAICallAnalysis.AICallAnalysis || RawAICallAnalysis
const FollowUp = require("../models/FollowUp")

/**
 * AI Lead Priority Service - Phase 4: Lead Intelligence & Action Hub
 * 
 * Generates transparent, explainable priority signals:
 * - HIGH_INTENT: Explicit commercial interest, pricing/demo requests, positive engagement.
 * - NEEDS_FOLLOWUP: Agreed callback or explicit proposal follow-up required.
 * - AT_RISK: Overdue scheduled follow-up or recurring unaddressed objections.
 * - MEDIUM_INTENT: General inquiries with unresolved questions.
 * - LOW_INTENT: Explicit non-interest, not interested disposition, or wrong numbers.
 * - INSUFFICIENT_DATA: 0 call interactions or incomplete analyses.
 * 
 * Strict Grounding & Human-in-the-Loop Rules:
 * - AI recommendations NEVER automatically mutate lead status, pipeline stage, or assignees.
 * - Explicit user actions (Accept / Dismiss) are required.
 * - No fabricated revenue forecasts or conversion probabilities without historical backing.
 */

async function evaluateLeadPriority({ tenantId, leadId }) {
  if (!tenantId || !leadId) {
    throw new Error("tenantId and leadId are required to evaluate lead priority.")
  }

  const leadObjId = new mongoose.Types.ObjectId(leadId)

  // 1. Fetch Lead
  const lead = await Lead.findOne({ _id: leadObjId, tenantId })
    .setOptions({ skipTenantFilter: true })
    .lean()

  if (!lead) {
    throw new Error(`Lead '${leadId}' not found for tenant '${tenantId}'.`)
  }

  // If already Closed-Won or Closed-Lost, note actual CRM status
  if (lead.status === "Closed-Won") {
    return await AILeadPriority.findOneAndUpdate(
      { tenantId, leadId: leadObjId },
      {
        tenantId,
        leadId: leadObjId,
        priorityCategory: "LOW_INTENT",
        score: 100,
        reason: "Lead is already marked as Closed-Won in CRM.",
        factors: [{ name: "Deal Closed", impact: "POSITIVE", evidenceQuote: "CRM status: Closed-Won" }],
        recommendedAction: "Maintain account servicing and customer onboarding.",
        status: "ACCEPTED",
        lastEvaluatedAt: new Date(),
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).setOptions({ skipTenantFilter: true })
  }

  if (lead.status === "Closed-Lost") {
    return await AILeadPriority.findOneAndUpdate(
      { tenantId, leadId: leadObjId },
      {
        tenantId,
        leadId: leadObjId,
        priorityCategory: "LOW_INTENT",
        score: 10,
        reason: "Lead is marked as Closed-Lost in CRM.",
        factors: [{ name: "Opportunity Closed", impact: "NEGATIVE", evidenceQuote: "CRM status: Closed-Lost" }],
        recommendedAction: "Nurture on a long-term automated drip campaign.",
        status: "DISMISSED",
        lastEvaluatedAt: new Date(),
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).setOptions({ skipTenantFilter: true })
  }

  // 2. Fetch all calls for this lead or matching phone
  const callQuery = {
    tenantId,
    $or: [{ leadId: leadObjId }],
  }
  if (lead.phoneNormalized || lead.phone) {
    callQuery.$or.push({ customerNumber: lead.phoneNormalized || lead.phone })
  }

  const calls = await Call.find(callQuery)
    .sort({ startedAt: -1 })
    .setOptions({ skipTenantFilter: true })
    .lean()

  const callIds = calls.map((c) => c._id)

  // 3. Fetch latest completed analyses
  const analyses = await AICallAnalysis.find({
    tenantId,
    callId: { $in: callIds },
    status: "COMPLETED",
  })
    .sort({ createdAt: -1 })
    .setOptions({ skipTenantFilter: true })
    .lean()

  // 4. Fetch follow-ups
  const followUps = await FollowUp.find({
    tenantId,
    leadId: leadObjId,
  })
    .sort({ scheduledAt: -1 })
    .setOptions({ skipTenantFilter: true })
    .lean()

  const now = new Date()
  const overdueFollowUp = followUps.find((f) => f.status === "pending" && new Date(f.scheduledAt) < now)
  const pendingFollowUp = followUps.find((f) => f.status === "pending")

  // If no calls or analyses exist
  if (analyses.length === 0) {
    return await AILeadPriority.findOneAndUpdate(
      { tenantId, leadId: leadObjId },
      {
        tenantId,
        leadId: leadObjId,
        priorityCategory: pendingFollowUp ? "NEEDS_FOLLOWUP" : "INSUFFICIENT_DATA",
        score: pendingFollowUp ? 60 : 40,
        reason: pendingFollowUp
          ? "Lead has scheduled pending follow-up touchpoint but no recorded call interactions."
          : "No recorded sales interactions or AI transcripts available for this lead.",
        factors: pendingFollowUp
          ? [{ name: "Pending Follow-Up", impact: "NEUTRAL", evidenceQuote: pendingFollowUp.title }]
          : [{ name: "Zero Call History", impact: "NEUTRAL", evidenceQuote: "No audio calls logged" }],
        recommendedAction: "Initiate initial discovery call via dialer to establish customer requirements.",
        status: "ACTIVE",
        lastEvaluatedAt: new Date(),
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).setOptions({ skipTenantFilter: true })
  }

  const latestAnalysis = analyses[0]
  const factors = []
  let category = "MEDIUM_INTENT"
  let score = 65
  let reason = "Customer engaged in sales interaction."
  let recommendedAction = "Schedule follow-up to continue discussion."

  // Evaluate Overdue Risk
  if (overdueFollowUp) {
    category = "AT_RISK"
    score = 75
    reason = `Scheduled follow-up ('${overdueFollowUp.title}') is overdue since ${new Date(overdueFollowUp.scheduledAt).toLocaleDateString()}.`
    factors.push({
      name: "Overdue Follow-Up",
      impact: "NEGATIVE",
      evidenceQuote: `Due on ${new Date(overdueFollowUp.scheduledAt).toLocaleDateString()}`,
    })
    recommendedAction = "Immediately execute overdue touchpoint to prevent lead disengagement."
  }
  // Evaluate High Intent
  else if (
    latestAnalysis.callOutcome === "INTERESTED" ||
    latestAnalysis.callOutcome === "DEAL_CLOSED" ||
    (latestAnalysis.productInterests && latestAnalysis.productInterests.length > 0 && latestAnalysis.sentiment === "POSITIVE")
  ) {
    category = "HIGH_INTENT"
    score = 90
    reason = `Customer expressed explicit interest in ${latestAnalysis.productInterests?.join(", ") || "catalog offerings"} with ${latestAnalysis.sentiment} sentiment.`
    factors.push({
      name: "Commercial Interest",
      impact: "POSITIVE",
      evidenceQuote: latestAnalysis.summary || "Customer requested product details",
      callId: latestAnalysis.callId,
    })
    if (latestAnalysis.keyMoments && latestAnalysis.keyMoments[0]?.quote) {
      factors.push({
        name: "Supporting Quote",
        impact: "POSITIVE",
        evidenceQuote: latestAnalysis.keyMoments[0].quote,
        callId: latestAnalysis.callId,
      })
    }
    recommendedAction = "Send comprehensive formal quotation or contract proposal within 24 hours."
  }
  // Evaluate Needs Follow-up
  else if (
    latestAnalysis.callOutcome === "FOLLOW_UP_REQUIRED" ||
    latestAnalysis.callOutcome === "CALL_BACK_LATER" ||
    pendingFollowUp
  ) {
    category = "NEEDS_FOLLOWUP"
    score = 70
    reason = "Customer agreed to callback or requested additional information."
    factors.push({
      name: "Callback Agreement",
      impact: "NEUTRAL",
      evidenceQuote: latestAnalysis.summary || "Follow-up touchpoint agreed",
      callId: latestAnalysis.callId,
    })
    recommendedAction = "Verify and prepare customized product brochure before scheduled callback."
  }
  // Evaluate Low Intent
  else if (
    latestAnalysis.callOutcome === "NOT_INTERESTED" ||
    latestAnalysis.callOutcome === "WRONG_NUMBER"
  ) {
    category = "LOW_INTENT"
    score = 25
    reason = `Customer indicated not interested (${latestAnalysis.objections?.join(", ") || "explicit decline"}).`
    factors.push({
      name: "Declined Inquiries",
      impact: "NEGATIVE",
      evidenceQuote: latestAnalysis.objections?.[0] || "Customer not interested",
      callId: latestAnalysis.callId,
    })
    recommendedAction = "Pause direct telephony outreach; place lead into quarterly nurture queue."
  }

  // Persist or Update AILeadPriority
  const result = await AILeadPriority.findOneAndUpdate(
    { tenantId, leadId: leadObjId },
    {
      tenantId,
      leadId: leadObjId,
      priorityCategory: category,
      score,
      reason,
      factors,
      recommendedAction,
      status: "ACTIVE",
      lastEvaluatedAt: new Date(),
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).setOptions({ skipTenantFilter: true })

  return result
}

/**
 * Lists priority recommendations with filtering and pagination.
 */
async function listLeadPriorities({
  tenantId,
  priorityCategory = "all",
  status = "all",
  page = 1,
  limit = 20,
}) {
  if (!tenantId) {
    throw new Error("tenantId is required.")
  }

  const query = { tenantId }
  if (priorityCategory && priorityCategory !== "all") {
    query.priorityCategory = priorityCategory
  }
  if (status && status !== "all") {
    query.status = status
  }

  const p = Math.max(1, parseInt(page, 10) || 1)
  const lim = Math.max(1, Math.min(parseInt(limit, 10) || 20, 100))
  const skip = (p - 1) * lim

  const [items, total] = await Promise.all([
    AILeadPriority.find(query)
      .sort({ score: -1, updatedAt: -1 })
      .skip(skip)
      .limit(lim)
      .populate("leadId", "name phone email status company")
      .setOptions({ skipTenantFilter: true })
      .lean(),
    AILeadPriority.countDocuments(query).setOptions({ skipTenantFilter: true }),
  ])

  return {
    priorities: items,
    pagination: {
      page: p,
      limit: lim,
      total,
      totalPages: Math.ceil(total / lim) || 1,
    },
  }
}

/**
 * Marks priority recommendation as ACCEPTED without mutating core CRM lead status.
 */
async function acceptLeadPriority({ tenantId, leadId, userId, actionTaken, notes = "" }) {
  if (!tenantId || !leadId) {
    throw new Error("tenantId and leadId are required.")
  }

  const priority = await AILeadPriority.findOneAndUpdate(
    { tenantId, leadId: new mongoose.Types.ObjectId(leadId) },
    {
      status: "ACCEPTED",
      userAction: {
        actionTaken: actionTaken || "Accepted AI Priority Recommendation",
        actionedBy: userId ? new mongoose.Types.ObjectId(userId) : null,
        actionedAt: new Date(),
        notes,
      },
    },
    { new: true }
  ).setOptions({ skipTenantFilter: true })

  if (!priority) {
    throw new Error("Lead priority recommendation not found.")
  }

  return priority
}

/**
 * Marks priority recommendation as DISMISSED.
 */
async function dismissLeadPriority({ tenantId, leadId, userId, notes = "" }) {
  if (!tenantId || !leadId) {
    throw new Error("tenantId and leadId are required.")
  }

  const priority = await AILeadPriority.findOneAndUpdate(
    { tenantId, leadId: new mongoose.Types.ObjectId(leadId) },
    {
      status: "DISMISSED",
      userAction: {
        actionTaken: "Dismissed by user",
        actionedBy: userId ? new mongoose.Types.ObjectId(userId) : null,
        actionedAt: new Date(),
        notes,
      },
    },
    { new: true }
  ).setOptions({ skipTenantFilter: true })

  if (!priority) {
    throw new Error("Lead priority recommendation not found.")
  }

  return priority
}

module.exports = {
  evaluateLeadPriority,
  listLeadPriorities,
  acceptLeadPriority,
  dismissLeadPriority,
}
