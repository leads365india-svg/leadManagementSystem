const mongoose = require("mongoose")
const Call = require("../models/Call")
const Lead = require("../models/Lead")
const User = require("../models/User")
const { getSalesIntelligenceDashboard, getTopicIntelligence } = require("../services/aiBusinessInsights.service")
const { generateCallCoachingReport } = require("../services/aiSalesCoaching.service")
const { computeAgentScorecard, listAgentScorecards } = require("../services/aiSalesScorecard.service")
const { evaluateLeadPriority, listLeadPriorities, acceptLeadPriority, dismissLeadPriority } = require("../services/aiLeadPriority.service")
const {
  listManagerRecommendations,
  updateRecommendationStatus,
  createCoachingReview,
  listCoachingReviews,
  completeCoachingReview,
} = require("../services/aiRecommendations.service")
const { getEffectiveTenant } = require("../middleware/tenantContext")
const audit = require("../services/auditService")

function getTenantId(req) {
  const effective = getEffectiveTenant ? getEffectiveTenant(req) : {}
  return effective.tenantId || req.tenantId || req.user?.tenantId
}

function checkManagerOrAdmin(req) {
  const role = (req.user?.role || "").toLowerCase()
  return (
    role === "admin" ||
    role === "account_admin" ||
    role === "super_admin" ||
    role === "superadmin" ||
    role === "manager" ||
    Boolean(req.user?.isSuperAdmin)
  )
}

/**
 * 1. GET /api/ai-sales-intelligence/dashboard
 * Aggregates KPIs, conversion funnel, objection distribution, and trends.
 */
async function getDashboard(req, res) {
  try {
    const tenantId = getTenantId(req)
    if (!tenantId) {
      return res.status(401).json({ success: false, error: "Unauthorized: Missing tenant context" })
    }

    const { dateRange = "all", agentId, callOutcome, topic } = req.query
    const data = await getSalesIntelligenceDashboard({
      tenantId,
      dateRange,
      agentId,
      callOutcome,
      topic,
    })

    return res.status(200).json({ success: true, data })
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message || "Failed to load sales intelligence dashboard" })
  }
}

/**
 * 2. GET /api/ai-sales-intelligence/topics
 * Provides topic-level performance intelligence based on approved Phase 2 topics.
 */
async function getTopics(req, res) {
  try {
    const tenantId = getTenantId(req)
    if (!tenantId) {
      return res.status(401).json({ success: false, error: "Unauthorized: Missing tenant context" })
    }

    const data = await getTopicIntelligence({ tenantId })
    return res.status(200).json({ success: true, data })
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message || "Failed to load topic intelligence" })
  }
}

/**
 * 3. GET /api/ai-sales-intelligence/coaching/:callId
 * Returns evidence-backed coaching report for an individual call.
 */
async function getCallCoaching(req, res) {
  try {
    const tenantId = getTenantId(req)
    if (!tenantId) {
      return res.status(401).json({ success: false, error: "Unauthorized: Missing tenant context" })
    }

    const { callId } = req.params
    if (!mongoose.Types.ObjectId.isValid(callId)) {
      return res.status(400).json({ success: false, error: "Invalid callId parameter" })
    }

    const call = await Call.findOne({ _id: new mongoose.Types.ObjectId(callId), tenantId })
      .setOptions({ skipTenantFilter: true })

    if (!call) {
      return res.status(404).json({ success: false, error: "Call not found for current tenant" })
    }

    // Role check: agents can only inspect calls assigned to them
    const isManager = checkManagerOrAdmin(req)
    const isOwner = call.agentId?.toString() === req.user?._id?.toString()
    if (!isManager && !isOwner) {
      return res.status(403).json({ success: false, error: "Forbidden: You are not authorized to view coaching for this call" })
    }

    const coaching = await generateCallCoachingReport({ call, tenantId })
    return res.status(200).json({ success: true, data: { callId, coaching } })
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message || "Failed to generate call coaching report" })
  }
}

/**
 * 4. GET /api/ai-sales-intelligence/scorecards
 * Lists all agent scorecards for the tenant in the specified period.
 */
async function listScorecards(req, res) {
  try {
    const tenantId = getTenantId(req)
    if (!tenantId) {
      return res.status(401).json({ success: false, error: "Unauthorized: Missing tenant context" })
    }

    const { period = "monthly" } = req.query
    const scorecards = await listAgentScorecards({ tenantId, period })
    return res.status(200).json({ success: true, data: { scorecards } })
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message || "Failed to list scorecards" })
  }
}

/**
 * 5. GET /api/ai-sales-intelligence/scorecards/:agentId
 * Gets or computes an individual agent's performance scorecard.
 */
async function getAgentScorecard(req, res) {
  try {
    const tenantId = getTenantId(req)
    if (!tenantId) {
      return res.status(401).json({ success: false, error: "Unauthorized: Missing tenant context" })
    }

    const { agentId } = req.params
    if (!mongoose.Types.ObjectId.isValid(agentId)) {
      return res.status(400).json({ success: false, error: "Invalid agentId parameter" })
    }

    // Role check: agents can only view their own scorecard
    const isManager = checkManagerOrAdmin(req)
    const isSelf = agentId === req.user?._id?.toString()
    if (!isManager && !isSelf) {
      return res.status(403).json({ success: false, error: "Forbidden: You can only view your own scorecard" })
    }

    const { period = "monthly" } = req.query
    const scorecard = await computeAgentScorecard({ tenantId, agentId, period })
    return res.status(200).json({ success: true, data: { scorecard } })
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message || "Failed to compute agent scorecard" })
  }
}

/**
 * 6. POST /api/ai-sales-intelligence/scorecards/:agentId/recompute
 * Recomputes scorecard (Manager / Admin only).
 */
async function recomputeScorecard(req, res) {
  try {
    const tenantId = getTenantId(req)
    if (!tenantId) {
      return res.status(401).json({ success: false, error: "Unauthorized: Missing tenant context" })
    }

    if (!checkManagerOrAdmin(req)) {
      return res.status(403).json({ success: false, error: "Forbidden: Manager or Administrator role required" })
    }

    const { agentId } = req.params
    const { period = "monthly" } = req.body || {}
    const scorecard = await computeAgentScorecard({ tenantId, agentId, period })
    return res.status(200).json({ success: true, message: "Scorecard recomputed successfully", data: { scorecard } })
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message || "Failed to recompute scorecard" })
  }
}

/**
 * 7. GET /api/ai-sales-intelligence/lead-priorities
 * Lists lead priority recommendations.
 */
async function getLeadPriorities(req, res) {
  try {
    const tenantId = getTenantId(req)
    if (!tenantId) {
      return res.status(401).json({ success: false, error: "Unauthorized: Missing tenant context" })
    }

    const { priorityCategory = "all", status = "all", page = 1, limit = 20 } = req.query
    const data = await listLeadPriorities({ tenantId, priorityCategory, status, page, limit })
    return res.status(200).json({ success: true, data })
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message || "Failed to list lead priorities" })
  }
}

/**
 * 8. POST /api/ai-sales-intelligence/lead-priorities/:leadId/evaluate
 * Evaluates priority for a specific lead.
 */
async function evaluateLead(req, res) {
  try {
    const tenantId = getTenantId(req)
    if (!tenantId) {
      return res.status(401).json({ success: false, error: "Unauthorized: Missing tenant context" })
    }

    const { leadId } = req.params
    if (!mongoose.Types.ObjectId.isValid(leadId)) {
      return res.status(400).json({ success: false, error: "Invalid leadId parameter" })
    }

    const priority = await evaluateLeadPriority({ tenantId, leadId })
    return res.status(200).json({ success: true, data: { priority } })
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message || "Failed to evaluate lead priority" })
  }
}

/**
 * 9. POST /api/ai-sales-intelligence/lead-priorities/:leadId/accept
 * Marks priority recommendation as ACCEPTED.
 */
async function acceptPriority(req, res) {
  try {
    const tenantId = getTenantId(req)
    if (!tenantId) {
      return res.status(401).json({ success: false, error: "Unauthorized: Missing tenant context" })
    }

    const { leadId } = req.params
    const { actionTaken, notes } = req.body || {}
    const priority = await acceptLeadPriority({
      tenantId,
      leadId,
      userId: req.user?._id,
      actionTaken,
      notes,
    })

    return res.status(200).json({ success: true, message: "Lead priority recommendation accepted", data: { priority } })
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message || "Failed to accept lead priority" })
  }
}

/**
 * 10. POST /api/ai-sales-intelligence/lead-priorities/:leadId/dismiss
 * Marks priority recommendation as DISMISSED.
 */
async function dismissPriority(req, res) {
  try {
    const tenantId = getTenantId(req)
    if (!tenantId) {
      return res.status(401).json({ success: false, error: "Unauthorized: Missing tenant context" })
    }

    const { leadId } = req.params
    const { notes } = req.body || {}
    const priority = await dismissLeadPriority({
      tenantId,
      leadId,
      userId: req.user?._id,
      notes,
    })

    return res.status(200).json({ success: true, message: "Lead priority recommendation dismissed", data: { priority } })
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message || "Failed to dismiss lead priority" })
  }
}

/**
 * 11. GET /api/ai-sales-intelligence/recommendations
 * Lists manager alerts and recommendations.
 */
async function getRecommendations(req, res) {
  try {
    const tenantId = getTenantId(req)
    if (!tenantId) {
      return res.status(401).json({ success: false, error: "Unauthorized: Missing tenant context" })
    }

    if (!checkManagerOrAdmin(req)) {
      return res.status(403).json({ success: false, error: "Forbidden: Manager or Administrator role required" })
    }

    const { status = "all", priority = "all", type = "all", page = 1, limit = 20 } = req.query
    const data = await listManagerRecommendations({ tenantId, status, priority, type, page, limit })
    return res.status(200).json({ success: true, data })
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message || "Failed to list manager recommendations" })
  }
}

/**
 * 12. PATCH /api/ai-sales-intelligence/recommendations/:id/status
 * Updates recommendation status (Manager / Admin only).
 */
async function patchRecommendationStatus(req, res) {
  try {
    const tenantId = getTenantId(req)
    if (!tenantId) {
      return res.status(401).json({ success: false, error: "Unauthorized: Missing tenant context" })
    }

    if (!checkManagerOrAdmin(req)) {
      return res.status(403).json({ success: false, error: "Forbidden: Manager or Administrator role required" })
    }

    const { id } = req.params
    const { status, managerNotes } = req.body || {}

    const rec = await updateRecommendationStatus({
      tenantId,
      id,
      status,
      userId: req.user?._id,
      managerNotes,
    })

    return res.status(200).json({ success: true, message: `Recommendation marked as ${status}`, data: { recommendation: rec } })
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message || "Failed to update recommendation status" })
  }
}

/**
 * 13. GET /api/ai-sales-intelligence/coaching-reviews
 * Lists formal coaching reviews.
 */
async function getCoachingReviews(req, res) {
  try {
    const tenantId = getTenantId(req)
    if (!tenantId) {
      return res.status(401).json({ success: false, error: "Unauthorized: Missing tenant context" })
    }

    const isManager = checkManagerOrAdmin(req)
    let agentId = req.query.agentId || null

    // If regular agent, restrict to only their own coaching reviews
    if (!isManager) {
      agentId = req.user?._id?.toString()
    }

    const { page = 1, limit = 20 } = req.query
    const data = await listCoachingReviews({ tenantId, agentId, page, limit })
    return res.status(200).json({ success: true, data })
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message || "Failed to list coaching reviews" })
  }
}

/**
 * 14. POST /api/ai-sales-intelligence/coaching-reviews
 * Creates a formal coaching review (Manager / Admin only).
 */
async function postCoachingReview(req, res) {
  try {
    const tenantId = getTenantId(req)
    if (!tenantId) {
      return res.status(401).json({ success: false, error: "Unauthorized: Missing tenant context" })
    }

    if (!checkManagerOrAdmin(req)) {
      return res.status(403).json({ success: false, error: "Forbidden: Manager or Administrator role required" })
    }

    const {
      agentId,
      callId,
      scorecardId,
      managerNotes,
      strengthsAcknowledged = [],
      improvementCommitments = [],
      agreedActionItems = [],
    } = req.body || {}

    if (!agentId || !managerNotes) {
      return res.status(400).json({ success: false, error: "agentId and managerNotes are required" })
    }

    const review = await createCoachingReview({
      tenantId,
      agentId,
      managerId: req.user._id,
      callId,
      scorecardId,
      managerNotes,
      strengthsAcknowledged,
      improvementCommitments,
      agreedActionItems,
    })

    return res.status(201).json({ success: true, message: "Coaching review created successfully", data: { review } })
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message || "Failed to create coaching review" })
  }
}

/**
 * 15. PATCH /api/ai-sales-intelligence/coaching-reviews/:id/complete
 * Marks coaching review as completed (Manager / Admin only).
 */
async function patchCompleteReview(req, res) {
  try {
    const tenantId = getTenantId(req)
    if (!tenantId) {
      return res.status(401).json({ success: false, error: "Unauthorized: Missing tenant context" })
    }

    if (!checkManagerOrAdmin(req)) {
      return res.status(403).json({ success: false, error: "Forbidden: Manager or Administrator role required" })
    }

    const { id } = req.params
    const review = await completeCoachingReview({ tenantId, reviewId: id })
    return res.status(200).json({ success: true, message: "Coaching review action marked completed", data: { review } })
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message || "Failed to complete coaching review" })
  }
}

module.exports = {
  getDashboard,
  getTopics,
  getCallCoaching,
  listScorecards,
  getAgentScorecard,
  recomputeScorecard,
  getLeadPriorities,
  evaluateLead,
  acceptPriority,
  dismissPriority,
  getRecommendations,
  patchRecommendationStatus,
  getCoachingReviews,
  postCoachingReview,
  patchCompleteReview,
}
