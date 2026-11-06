const mongoose = require("mongoose")
const Lead = require("../models/Lead")
const Call = require("../models/Call")
const { activity } = require("./activityService")
const { normalizePhoneE164 } = require("../utils/phoneNormalizer")
const audit = require("./auditService")

/**
 * AI Call Intelligence to CRM Lead Pipeline Synchronization Service
 * 
 * Synchronizes AI Call Intelligence classifications and call outcomes
 * to CRM Lead pipeline stages:
 * 
 * Pipeline Stage Mapping:
 * - INTERESTED, POSITIVE, CALL_BACK_LATER, FOLLOW_UP_REQUIRED -> Engaged (Active)
 * - NOT_INTERESTED, DECLINED                                    -> Closed-Lost (Lost)
 * - DEAL_CLOSED                                                -> Closed-Won (Order Placed)
 * 
 * Non-Updating / Ambiguous Outcomes:
 * - NO_ANSWER, UNKNOWN, VOICEMAIL, INVALID, WRONG_NUMBER, UNRESOLVED, ESCALATED -> Lead status unchanged
 * 
 * Transition Protection Rules:
 * - Closed-Won leads CANNOT be downgraded automatically by AI
 * - Closed-Lost leads CANNOT be reopened automatically by AI
 * - Proposal Sent stage is preserved against downgrade to Engaged (only moves to Closed-Won or explicit Closed-Lost)
 * - Idempotent execution (skips updates if status is already matching, no duplicate status history or activities)
 * - Lead resolution strictly respects tenant isolation boundaries
 * - Ambiguous phone matches within tenant abort update with diagnostic logs
 */

const OUTCOME_TO_PIPELINE_MAP = Object.freeze({
  INTERESTED: "Engaged",
  POSITIVE: "Engaged",
  CALL_BACK_LATER: "Engaged",
  CALLBACK_LATER: "Engaged",
  FOLLOW_UP_REQUIRED: "Engaged",
  FOLLOWUP_REQUIRED: "Engaged",
  DEAL_CLOSED: "Closed-Won",
  NOT_INTERESTED: "Closed-Lost",
  NOTINTERESTED: "Closed-Lost",
  DECLINED: "Closed-Lost",
})

const NON_UPDATING_OUTCOMES = new Set([
  "NO_ANSWER",
  "NO_REPLY",
  "BUSY",
  "VOICEMAIL",
  "UNKNOWN",
  "INVALID",
  "WRONG_NUMBER",
  "UNRESOLVED",
  "ESCALATED",
  "CONNECTED",
  "NONE",
])

/**
 * Maps raw or normalized AI Call outcome string to canonical CRM Lead status.
 * Returns null if outcome is non-updating, ambiguous, or invalid.
 * 
 * @param {string} callOutcome - Raw outcome string from AI Call Analysis
 * @returns {string|null} Canonical Lead status ('Engaged', 'Closed-Lost', 'Closed-Won') or null
 */
function mapAiOutlineToLeadStatus(callOutcome) {
  if (!callOutcome || typeof callOutcome !== "string") {
    return null
  }

  const normalized = callOutcome
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_")

  if (NON_UPDATING_OUTCOMES.has(normalized)) {
    return null
  }

  return OUTCOME_TO_PIPELINE_MAP[normalized] || null
}

/**
 * Evaluates whether a status transition is permitted under CRM business rules.
 * 
 * @param {string} currentStatus - Existing lead status
 * @param {string} targetStatus - Proposed target status
 * @returns {{ allowed: boolean, idempotent?: boolean, protected?: boolean, reason: string }}
 */
function evaluateStatusTransition(currentStatus, targetStatus) {
  if (!targetStatus) {
    return {
      allowed: false,
      reason: "No target pipeline status determined",
    }
  }

  // Idempotency: status already matches target
  if (currentStatus === targetStatus) {
    return {
      allowed: false,
      idempotent: true,
      reason: `Lead already has status '${currentStatus}'`,
    }
  }

  // Rule 4: Closed-Won cannot be downgraded automatically by AI
  if (currentStatus === "Closed-Won") {
    return {
      allowed: false,
      protected: true,
      reason: "Closed-Won leads cannot be downgraded automatically by AI",
    }
  }

  // Rule 5: Closed-Lost cannot be reopened automatically by AI
  if (currentStatus === "Closed-Lost") {
    return {
      allowed: false,
      protected: true,
      reason: "Closed-Lost leads cannot be reopened automatically by AI",
    }
  }

  // Rule 3: Proposal Sent stage is preserved against downgrade to Engaged
  if (currentStatus === "Proposal Sent") {
    if (targetStatus === "Engaged") {
      return {
        allowed: false,
        protected: true,
        reason: "Proposal Sent stage is preserved against downgrade to Engaged",
      }
    }
    // Explicit negative (Closed-Lost) or won (Closed-Won) is allowed
    if (targetStatus === "Closed-Won" || targetStatus === "Closed-Lost") {
      return {
        allowed: true,
        reason: `Allowed transition from Proposal Sent to ${targetStatus}`,
      }
    }
    return {
      allowed: false,
      reason: `Invalid transition from Proposal Sent to ${targetStatus}`,
    }
  }

  // Rule 1 & 2: New leads can transition to Engaged, Closed-Lost, or Closed-Won
  if (currentStatus === "New") {
    return {
      allowed: true,
      reason: `Allowed transition from New to ${targetStatus}`,
    }
  }

  // Engaged leads can transition to Closed-Lost or Closed-Won
  if (currentStatus === "Engaged") {
    if (targetStatus === "Closed-Lost" || targetStatus === "Closed-Won") {
      return {
        allowed: true,
        reason: `Allowed transition from Engaged to ${targetStatus}`,
      }
    }
    return {
      allowed: false,
      reason: `Transition from Engaged to ${targetStatus} is not supported`,
    }
  }

  // Fallback for any other valid status transition
  return {
    allowed: true,
    reason: `Allowed transition from ${currentStatus} to ${targetStatus}`,
  }
}

/**
 * Resolves the target Lead for a given Call within strict tenant boundaries.
 * Priority:
 * 1. Existing call.leadId
 * 2. Exact normalized phone match within the SAME tenant (single unique match only)
 * 3. Aborts automatic update if multiple leads match the phone number
 * 
 * @param {object} params
 * @param {object} params.call - Call document or plain object
 * @param {string} params.tenantId - Tenant identifier
 * @returns {Promise<{ lead: object|null, matchMethod?: string, ambiguous?: boolean, matchCount?: number, reason?: string, shouldLinkCall?: boolean }>}
 */
async function resolveLeadForCall({ call, tenantId }) {
  if (!tenantId || typeof tenantId !== "string" || !tenantId.trim()) {
    throw new Error("Tenant ID is required for lead resolution")
  }
  const cleanTenantId = tenantId.trim()

  if (!call) {
    return { lead: null, reason: "Call object is missing" }
  }

  // 1. Canonical leadId association
  const rawLeadId = call.leadId ? (call.leadId._id || call.leadId) : null
  if (rawLeadId && mongoose.Types.ObjectId.isValid(rawLeadId)) {
    const canonicalLead = await Lead.findOne({
      _id: rawLeadId,
      tenantId: cleanTenantId,
      deletedAt: null,
    }).setOptions({ skipTenantFilter: true })

    if (canonicalLead) {
      return {
        lead: canonicalLead,
        matchMethod: "canonical_leadId",
        shouldLinkCall: false,
      }
    }

    // LeadId is present on call but not found in this tenant
    console.warn(`[LeadPipelineSync] Call ${call._id} references lead ${rawLeadId} which does not exist in tenant ${cleanTenantId}. Cross-tenant matching prohibited.`)
    return {
      lead: null,
      reason: `Lead ${rawLeadId} not found in tenant ${cleanTenantId}`,
    }
  }

  // 2. Phone Number Matching Fallback
  const phoneCandidates = [
    call.phoneNormalized,
    call.number,
    call.phoneNumber,
  ].filter((p) => typeof p === "string" && p.trim())

  if (phoneCandidates.length === 0) {
    return {
      lead: null,
      reason: "Call has no phone number or leadId to associate with a CRM Lead",
    }
  }

  const phoneConditions = []
  const seenValues = new Set()

  for (const raw of phoneCandidates) {
    const clean = raw.trim()
    const normalized = normalizePhoneE164(clean, "+91")
    if (normalized && !seenValues.has(normalized)) {
      phoneConditions.push({ phoneNormalized: normalized })
      seenValues.add(normalized)
    }
    if (clean && !seenValues.has(clean)) {
      phoneConditions.push({ phone: clean })
      phoneConditions.push({ alternatePhone: clean })
      seenValues.add(clean)
    }
  }

  if (phoneConditions.length === 0) {
    return {
      lead: null,
      reason: "No valid phone numbers found for matching",
    }
  }

  const matchingLeads = await Lead.find({
    tenantId: cleanTenantId,
    $or: phoneConditions,
    deletedAt: null,
  }).setOptions({ skipTenantFilter: true })

  if (matchingLeads.length === 1) {
    return {
      lead: matchingLeads[0],
      matchMethod: "phone_exact_unique",
      shouldLinkCall: true,
    }
  }

  if (matchingLeads.length > 1) {
    console.warn(`[LeadPipelineSync] Ambiguous match: ${matchingLeads.length} leads matched phone candidates in tenant '${cleanTenantId}'. Aborting automatic status update.`)
    return {
      lead: null,
      ambiguous: true,
      matchCount: matchingLeads.length,
      reason: `Ambiguous match: ${matchingLeads.length} leads found for phone in tenant`,
    }
  }

  return {
    lead: null,
    reason: `No lead found matching phone in tenant ${cleanTenantId}`,
  }
}

/**
 * Synchronizes AI Call Intelligence analysis results to CRM Lead pipeline status.
 * Centralized, reusable service invoked by worker pipeline, manual analyze controller, and background jobs.
 * 
 * @param {object} params
 * @param {object} params.call - Call document or plain object
 * @param {object} params.analysis - AICallAnalysis document or plain object
 * @param {string} [params.tenantId] - Optional override tenantId
 * @param {object} [params.actor] - Optional actor ({ name, email, role, id })
 * @returns {Promise<object>} Sync summary
 */
async function syncLeadPipelineStatusFromAiCall({
  call,
  analysis,
  tenantId = null,
  actor = null,
} = {}) {
  const effectiveTenantId = (
    tenantId ||
    analysis?.tenantId ||
    call?.tenantId ||
    ""
  ).toString().trim()

  if (!effectiveTenantId) {
    return {
      success: false,
      skipped: true,
      reason: "Missing tenantId for AI pipeline sync",
    }
  }

  if (!analysis) {
    return {
      success: false,
      skipped: true,
      reason: "Missing AI Call Analysis object",
    }
  }

  // Weak-confidence or incomplete AI analysis check
  if (analysis.status !== "COMPLETED") {
    return {
      success: false,
      skipped: true,
      reason: `Analysis status is '${analysis.status}', requires 'COMPLETED' for automatic status sync`,
    }
  }

  const rawOutcome = analysis.callOutcome
  const targetStatus = mapAiOutlineToLeadStatus(rawOutcome)

  if (!targetStatus) {
    return {
      success: false,
      skipped: true,
      callOutcome: rawOutcome,
      reason: `Outcome '${rawOutcome}' does not trigger an automatic CRM pipeline update`,
    }
  }

  // Resolve associated Lead
  const resolution = await resolveLeadForCall({ call, tenantId: effectiveTenantId })
  if (!resolution.lead) {
    return {
      success: false,
      skipped: true,
      ambiguous: Boolean(resolution.ambiguous),
      callOutcome: rawOutcome,
      targetStatus,
      reason: resolution.reason || "No associated lead found for call",
    }
  }

  const lead = resolution.lead
  const currentStatus = lead.status || "New"

  // Evaluate transition protection rules
  const transition = evaluateStatusTransition(currentStatus, targetStatus)
  if (!transition.allowed) {
    return {
      success: false,
      skipped: true,
      leadId: lead._id,
      fromStatus: currentStatus,
      targetStatus,
      callOutcome: rawOutcome,
      idempotent: Boolean(transition.idempotent),
      protected: Boolean(transition.protected),
      reason: transition.reason,
    }
  }

  // Perform atomic update on Lead document
  const fromStatus = currentStatus
  lead.status = targetStatus
  lead.metadata = lead.metadata || {}

  const historyEntry = {
    fromStatus,
    toStatus: targetStatus,
    transitionedAt: new Date(),
    transitionedBy: actor?.name || "AI Call Intelligence",
    reason: `AI Call Intelligence Outcome: ${rawOutcome}`,
    callId: call?._id || null,
    aiAnalysisId: analysis?._id || null,
  }

  lead.metadata.statusHistory = Array.isArray(lead.metadata.statusHistory)
    ? [...lead.metadata.statusHistory, historyEntry]
    : [historyEntry]

  lead.metadata.lastCallOutcome = rawOutcome
  lead.metadata.lastAiAnalyzedAt = new Date()
  lead.markModified("metadata")
  await lead.save()

  // Record discrete Activity Timeline event
  try {
    await activity.record({
      tenantId: effectiveTenantId,
      leadId: lead._id,
      type: "lead.status_changed",
      actor: {
        name: actor?.name || "AI Call Intelligence",
        role: actor?.role || "system",
        email: actor?.email || "",
        id: actor?.id || null,
      },
      payload: {
        fromStatus,
        toStatus: targetStatus,
        reason: `AI Call Intelligence classified outcome as ${rawOutcome}`,
        callOutcome: rawOutcome,
        callId: call?._id ? call._id.toString() : null,
        aiAnalysisId: analysis?._id ? analysis._id.toString() : null,
      },
    })
  } catch (actErr) {
    console.warn("[LeadPipelineSync] Warning recording status_changed activity:", actErr.message)
  }

  // If call was matched by phone and lacked leadId, link call to lead
  let callLinked = false
  if (resolution.shouldLinkCall && call && (!call.leadId || String(call.leadId) !== String(lead._id))) {
    try {
      call.leadId = lead._id
      call.markModified("leadId")
      await call.save().catch(() => {})
      callLinked = true
    } catch (_) {}
  }

  // Audit logging
  if (audit && typeof audit.log === "function") {
    audit.log({
      tenantId: effectiveTenantId,
      action: "lead.status_synced_ai",
      category: "ai_call_intelligence",
      entity: "Lead",
      entityId: lead._id,
      summary: `Lead status updated from ${fromStatus} to ${targetStatus} via AI Call Intelligence (${rawOutcome})`,
      details: {
        leadId: lead._id,
        callId: call?._id || null,
        aiAnalysisId: analysis?._id || null,
        fromStatus,
        toStatus: targetStatus,
        callOutcome: rawOutcome,
        matchMethod: resolution.matchMethod,
        callLinked,
      },
    }).catch(() => {})
  }

  return {
    success: true,
    leadId: lead._id,
    linkedLeadId: lead._id,
    fromStatus,
    toStatus: targetStatus,
    callOutcome: rawOutcome,
    matchMethod: resolution.matchMethod,
    callLinked,
  }
}

/**
 * Confirms proposal dispatch and synchronizes Lead pipeline status to 'Proposal Sent'.
 * Idempotent against duplicate dispatches.
 * 
 * @param {object} params
 * @param {string|mongoose.Types.ObjectId} params.leadId - Target Lead ID
 * @param {string} params.tenantId - Tenant identifier
 * @param {object} [params.user] - Dispatching user context
 * @param {object} [params.details] - Additional proposal metadata (e.g. quoteId, proposalName)
 * @returns {Promise<object>} Status update result
 */
async function markProposalSent({ leadId, tenantId, user = null, details = {} } = {}) {
  if (!leadId || !tenantId) {
    throw new Error("leadId and tenantId are required to mark proposal sent")
  }

  const cleanTenantId = String(tenantId).trim()
  const lead = await Lead.findOne({
    _id: leadId,
    tenantId: cleanTenantId,
    deletedAt: null,
  }).setOptions({ skipTenantFilter: true })

  if (!lead) {
    throw new Error(`Lead ${leadId} not found in tenant ${cleanTenantId}`)
  }

  const fromStatus = lead.status || "New"

  // Idempotency: already Proposal Sent
  if (fromStatus === "Proposal Sent") {
    return {
      success: true,
      skipped: true,
      idempotent: true,
      leadId: lead._id,
      status: "Proposal Sent",
      message: "Lead is already in 'Proposal Sent' stage",
    }
  }

  // Protection: Closed-Won cannot be moved backwards to Proposal Sent
  if (fromStatus === "Closed-Won") {
    return {
      success: false,
      skipped: true,
      protected: true,
      leadId: lead._id,
      status: fromStatus,
      message: "Closed-Won lead cannot be reverted to Proposal Sent",
    }
  }

  lead.status = "Proposal Sent"
  lead.metadata = lead.metadata || {}

  const historyEntry = {
    fromStatus,
    toStatus: "Proposal Sent",
    transitionedAt: new Date(),
    transitionedBy: user?.name || user?.email || "User",
    reason: details.reason || "Proposal dispatched to customer",
    proposalDetails: details,
  }

  lead.metadata.statusHistory = Array.isArray(lead.metadata.statusHistory)
    ? [...lead.metadata.statusHistory, historyEntry]
    : [historyEntry]

  lead.markModified("metadata")
  await lead.save()

  // Record discrete activity
  try {
    await activity.record({
      tenantId: cleanTenantId,
      leadId: lead._id,
      type: "lead.status_changed",
      actor: user || { name: "System", role: "system" },
      payload: {
        fromStatus,
        toStatus: "Proposal Sent",
        reason: details.reason || "Proposal dispatched to customer",
        proposalDetails: details,
      },
    })
  } catch (actErr) {
    console.warn("[LeadPipelineSync] Warning recording proposal sent activity:", actErr.message)
  }

  return {
    success: true,
    leadId: lead._id,
    fromStatus,
    toStatus: "Proposal Sent",
  }
}

/**
 * Confirms order placement and synchronizes Lead pipeline status to 'Closed-Won'.
 * 
 * @param {object} params
 * @param {string|mongoose.Types.ObjectId} params.leadId - Target Lead ID
 * @param {string} params.tenantId - Tenant identifier
 * @param {object} [params.user] - User context
 * @param {object} [params.details] - Order details (orderNumber, amount, etc.)
 * @returns {Promise<object>} Status update result
 */
async function markClosedWon({ leadId, tenantId, user = null, details = {} } = {}) {
  if (!leadId || !tenantId) {
    throw new Error("leadId and tenantId are required to mark closed won")
  }

  const cleanTenantId = String(tenantId).trim()
  const lead = await Lead.findOne({
    _id: leadId,
    tenantId: cleanTenantId,
    deletedAt: null,
  }).setOptions({ skipTenantFilter: true })

  if (!lead) {
    throw new Error(`Lead ${leadId} not found in tenant ${cleanTenantId}`)
  }

  const fromStatus = lead.status || "New"

  if (fromStatus === "Closed-Won") {
    return {
      success: true,
      skipped: true,
      idempotent: true,
      leadId: lead._id,
      status: "Closed-Won",
      message: "Lead is already in 'Closed-Won' stage",
    }
  }

  lead.status = "Closed-Won"
  lead.metadata = lead.metadata || {}

  const historyEntry = {
    fromStatus,
    toStatus: "Closed-Won",
    transitionedAt: new Date(),
    transitionedBy: user?.name || user?.email || "User",
    reason: details.reason || "Order placed / Deal closed",
    orderDetails: details,
  }

  lead.metadata.statusHistory = Array.isArray(lead.metadata.statusHistory)
    ? [...lead.metadata.statusHistory, historyEntry]
    : [historyEntry]

  lead.markModified("metadata")
  await lead.save()

  // Record discrete activity
  try {
    await activity.record({
      tenantId: cleanTenantId,
      leadId: lead._id,
      type: "lead.status_changed",
      actor: user || { name: "System", role: "system" },
      payload: {
        fromStatus,
        toStatus: "Closed-Won",
        reason: details.reason || "Order placed / Deal closed",
        orderDetails: details,
      },
    })
  } catch (actErr) {
    console.warn("[LeadPipelineSync] Warning recording closed-won activity:", actErr.message)
  }

  return {
    success: true,
    leadId: lead._id,
    fromStatus,
    toStatus: "Closed-Won",
  }
}

module.exports = {
  OUTCOME_TO_PIPELINE_MAP,
  NON_UPDATING_OUTCOMES,
  mapAiOutlineToLeadStatus,
  evaluateStatusTransition,
  resolveLeadForCall,
  syncLeadPipelineStatusFromAiCall,
  markProposalSent,
  markClosedWon,
}

