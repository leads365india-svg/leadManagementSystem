const mongoose = require("mongoose")
const Lead = require("../models/Lead")
const User = require("../models/User")
const Team = require("../models/Team")
const FollowUp = require("../models/FollowUp")
const AssignmentRule = require("../models/AssignmentRule")
const { checkDirectObjectAccess } = require("../utils/rbacScope")
const audit = require("./auditService")

/**
 * Shared Lead Assignment Service - Phase 7: Lead Ownership & Assignment
 * 
 * Provides centralized logic for:
 * 1. Automatic rule-based routing on lead creation (Direct, Round-Robin, Fewest Open Leads, Pool)
 * 2. Manual and bulk lead assignment/reassignment with full audit trajectory (assignmentHistory)
 * 3. Cascade reassignment to pending follow-ups
 * 4. Staff deactivation lead reassignment wizard/handler
 * 5. Strict multi-tenant validation and RBAC scope protection
 */

/**
 * Evaluates active assignment rules for a tenant to determine automated routing.
 * 
 * @param {Object} leadData Incoming lead attributes (source, tags, city, etc.)
 * @param {string} tenantId Tenant context ID
 * @returns {Promise<{ ownerId: ObjectId|null, assignedTo: string, assignedStaffId: string, teamId: ObjectId|null, reason: string }>}
 */
async function resolveLeadAssignment(leadData = {}, tenantId) {
  if (!tenantId) {
    return {
      ownerId: null,
      assignedTo: "Unassigned",
      assignedStaffId: "unassigned",
      teamId: null,
      reason: "Default unassigned pool (No tenant)",
    }
  }

  const cleanTenantId = tenantId.trim()
  const source = leadData.source || "Website"
  const tags = Array.isArray(leadData.tags)
    ? leadData.tags.map((t) => String(t).trim().toLowerCase())
    : []
  const city = (leadData.city || "").trim().toLowerCase()

  // 1. Fetch active rules for this tenant sorted by priority (1 = highest)
  const rules = await AssignmentRule.find({
    tenantId: cleanTenantId,
    isActive: true,
  }).sort({ priority: 1 })

  for (const rule of rules) {
    // Check matching conditions
    let matches = true

    // Source matching (case-insensitive)
    if (Array.isArray(rule.conditions?.sources) && rule.conditions.sources.length > 0) {
      const allowedSources = rule.conditions.sources.map((s) => s.trim().toLowerCase())
      if (!allowedSources.includes(source.toLowerCase())) {
        matches = false
      }
    }

    // Tag matching (at least one tag must match if specified)
    if (matches && Array.isArray(rule.conditions?.tags) && rule.conditions.tags.length > 0) {
      const ruleTags = rule.conditions.tags.map((t) => t.trim().toLowerCase())
      const hasTagMatch = ruleTags.some((rt) => tags.includes(rt))
      if (!hasTagMatch) {
        matches = false
      }
    }

    // City matching
    if (matches && rule.conditions?.city && rule.conditions.city.trim()) {
      if (city !== rule.conditions.city.trim().toLowerCase()) {
        matches = false
      }
    }

    if (!matches) continue

    // Rule matched! Execute strategy
    if (rule.routingType === "direct") {
      if (rule.targetUserId) {
        const targetUser = await User.findOne({
          _id: rule.targetUserId,
          tenantId: cleanTenantId,
          isActive: { $ne: false },
          status: "active",
        })
        if (targetUser) {
          return {
            ownerId: targetUser._id,
            targetOwnerId: targetUser._id,
            assignedTo: targetUser.name,
            assignedStaffId: targetUser._id.toString(),
            teamId: targetUser.teamId || rule.teamId || null,
            ruleId: rule._id,
            reason: `Rule: ${rule.name} (Direct)`,
          }
        }
      }
    } else if (rule.routingType === "round_robin") {
      let candidateIds = []
      if (Array.isArray(rule.targetUserIds) && rule.targetUserIds.length > 0) {
        candidateIds = rule.targetUserIds
      } else if (rule.teamId) {
        const teamDoc = await Team.findOne({ _id: rule.teamId, tenantId: cleanTenantId, isActive: { $ne: false } })
        if (teamDoc && Array.isArray(teamDoc.members)) {
          candidateIds = teamDoc.members
        }
      }

      if (candidateIds.length > 0) {
        const eligibleUsers = await User.find({
          _id: { $in: candidateIds },
          tenantId: cleanTenantId,
          isActive: { $ne: false },
          status: "active",
        }).sort({ _id: 1 })

        if (eligibleUsers.length > 0) {
          const currentIndex = (rule.lastAssignedIndex || 0) % eligibleUsers.length
          const chosenUser = eligibleUsers[currentIndex]
          const nextIndex = (currentIndex + 1) % eligibleUsers.length

          // Persist rotated index
          await AssignmentRule.updateOne({ _id: rule._id }, { $set: { lastAssignedIndex: nextIndex } })

          return {
            ownerId: chosenUser._id,
            targetOwnerId: chosenUser._id,
            assignedTo: chosenUser.name,
            assignedStaffId: chosenUser._id.toString(),
            teamId: chosenUser.teamId || rule.teamId || null,
            ruleId: rule._id,
            reason: `Rule: ${rule.name} (Round-Robin)`,
          }
        }
      }
    } else if (rule.routingType === "fewest_open_leads") {
      let candidateIds = []
      if (Array.isArray(rule.targetUserIds) && rule.targetUserIds.length > 0) {
        candidateIds = rule.targetUserIds
      } else if (rule.teamId) {
        const teamDoc = await Team.findOne({ _id: rule.teamId, tenantId: cleanTenantId, isActive: { $ne: false } })
        if (teamDoc && Array.isArray(teamDoc.members)) {
          candidateIds = teamDoc.members
        }
      } else {
        // All active agents in tenant
        const allAgents = await User.find({
          tenantId: cleanTenantId,
          role: "agent",
          isActive: { $ne: false },
          status: "active",
        }).select("_id")
        candidateIds = allAgents.map((a) => a._id)
      }

      if (candidateIds.length > 0) {
        const eligibleUsers = await User.find({
          _id: { $in: candidateIds },
          tenantId: cleanTenantId,
          isActive: { $ne: false },
          status: "active",
        })

        let bestUser = null
        let minOpenCount = Infinity

        for (const user of eligibleUsers) {
          const openCount = await Lead.countDocuments({
            tenantId: cleanTenantId,
            ownerId: user._id,
            status: { $nin: ["Closed-Won", "Closed-Lost"] },
            deletedAt: null,
          })

          const maxCapacity = typeof user.maxOpenLeads === "number" ? user.maxOpenLeads : 50

          // Respect maxOpenLeads ceiling
          if (openCount < maxCapacity && openCount < minOpenCount) {
            minOpenCount = openCount
            bestUser = user
          }
        }

        if (bestUser) {
          return {
            ownerId: bestUser._id,
            targetOwnerId: bestUser._id,
            assignedTo: bestUser.name,
            assignedStaffId: bestUser._id.toString(),
            teamId: bestUser.teamId || rule.teamId || null,
            ruleId: rule._id,
            reason: `Rule: ${rule.name} (Fewest Open Leads: ${minOpenCount})`,
          }
        }
      }
    } else if (rule.routingType === "pool") {
      return {
        ownerId: null,
        targetOwnerId: null,
        assignedTo: "Unassigned",
        assignedStaffId: "unassigned",
        teamId: null,
        ruleId: rule._id,
        reason: `Rule: ${rule.name} (Unassigned Pool)`,
      }
    }
  }

  // Fallback: unassigned pool
  return {
    ownerId: null,
    targetOwnerId: null,
    assignedTo: "Unassigned",
    assignedStaffId: "unassigned",
    teamId: null,
    ruleId: null,
    reason: "Unassigned pool (No rule matched)",
  }
}

/**
 * Assigns or reassigns a single lead to a target agent or unassigned pool.
 */
async function assignLead(leadId, targetOwnerId, { teamId = null, actor = null, reason = "Manual assignment", tenantId } = {}) {
  if (!leadId || !mongoose.Types.ObjectId.isValid(leadId)) {
    throw new Error("Invalid lead ID format")
  }
  if (!tenantId) {
    throw new Error("Tenant context is required for lead assignment")
  }

  const cleanTenantId = tenantId.trim()
  const lead = await Lead.findOne({ _id: leadId, tenantId: cleanTenantId })
  if (!lead) {
    const error = new Error("Lead not found")
    error.status = 404
    throw error
  }

  let resolvedOwnerId = null
  let resolvedAssignedTo = "Unassigned"
  let resolvedStaffId = "unassigned"
  let resolvedTeamId = teamId && mongoose.Types.ObjectId.isValid(teamId) ? new mongoose.Types.ObjectId(teamId) : lead.teamId

  if (targetOwnerId) {
    if (!mongoose.Types.ObjectId.isValid(targetOwnerId)) {
      const error = new Error("Invalid target agent ID format")
      error.status = 400
      throw error
    }

    const targetUser = await User.findOne({ _id: targetOwnerId, tenantId: cleanTenantId })
    if (!targetUser) {
      const error = new Error("Target staff member not found in this account")
      error.status = 404
      throw error
    }

    if (targetUser.isActive === false || targetUser.status === "suspended") {
      const error = new Error("Cannot assign lead to deactivated or inactive staff member")
      error.status = 400
      throw error
    }

    resolvedOwnerId = targetUser._id
    resolvedAssignedTo = targetUser.name
    resolvedStaffId = targetUser._id.toString()
    if (!teamId && targetUser.teamId) {
      resolvedTeamId = targetUser.teamId
    }
  }

  if (teamId) {
    const teamDoc = await Team.findOne({ _id: teamId, tenantId: cleanTenantId, isActive: { $ne: false } })
    if (!teamDoc) {
      const error = new Error("Specified team not found in this account")
      error.status = 400
      throw error
    }
  }

  const prevOwnerId = lead.ownerId
  const prevOwnerName = lead.assignedTo || "Unassigned"

  // Build assignment history entry
  const historyEntry = {
    fromOwnerId: prevOwnerId,
    fromOwnerName: prevOwnerName,
    toOwnerId: resolvedOwnerId,
    toOwnerName: resolvedAssignedTo,
    teamId: resolvedTeamId,
    assignedBy: actor?._id || actor?.id || null,
    assignedByName: actor?.name || "System",
    assignedAt: new Date(),
    reason: reason || "Manual assignment",
  }

  lead.ownerId = resolvedOwnerId
  lead.assignedStaffId = resolvedStaffId
  lead.assignedTo = resolvedAssignedTo
  lead.teamId = resolvedTeamId
  if (!Array.isArray(lead.assignmentHistory)) {
    lead.assignmentHistory = []
  }
  lead.assignmentHistory.push(historyEntry)

  await lead.save()

  // Cascade to pending follow-ups: "Follow-ups follow the lead's owner unless explicitly assigned"
  await FollowUp.updateMany(
    {
      tenantId: cleanTenantId,
      leadId: lead._id,
      status: "pending",
    },
    {
      $set: {
        assignedTo: resolvedAssignedTo,
        assignedStaffId: resolvedStaffId,
      },
    },
  )

  return {
    lead,
    historyEntry,
  }
}

/**
 * Reassigns multiple leads in bulk, honoring actor scope restrictions.
 */
async function bulkAssignLeads({ leadIds = [], targetOwnerId = null, teamId = null, ruleId = null, actor = null, reason = "Bulk reassignment", tenantId } = {}) {
  if (!Array.isArray(leadIds) || leadIds.length === 0) {
    throw new Error("At least one lead ID is required for bulk assignment")
  }
  if (!tenantId) {
    throw new Error("Tenant context is required for bulk assignment")
  }

  const cleanTenantId = tenantId.trim()
  const validIds = leadIds.filter((id) => mongoose.Types.ObjectId.isValid(id))

  let targetUser = null
  if (targetOwnerId) {
    if (!mongoose.Types.ObjectId.isValid(targetOwnerId)) {
      const error = new Error("Invalid target agent ID format")
      error.status = 400
      throw error
    }
    targetUser = await User.findOne({ _id: targetOwnerId, tenantId: cleanTenantId })
    if (!targetUser) {
      const error = new Error("Target staff member not found in this account")
      error.status = 404
      throw error
    }
    if (targetUser.isActive === false || targetUser.status === "suspended") {
      const error = new Error("Cannot assign lead to deactivated or inactive staff member")
      error.status = 400
      throw error
    }
  }

  let targetTeam = null
  if (teamId) {
    if (!mongoose.Types.ObjectId.isValid(teamId)) {
      const error = new Error("Invalid team ID format")
      error.status = 400
      throw error
    }
    targetTeam = await Team.findOne({ _id: teamId, tenantId: cleanTenantId, isActive: { $ne: false } })
    if (!targetTeam) {
      const error = new Error("Specified team not found in this account")
      error.status = 400
      throw error
    }
  }

  const leads = await Lead.find({
    _id: { $in: validIds },
    tenantId: cleanTenantId,
  })

  let updatedCount = 0
  const updatedLeadIds = []

  for (const lead of leads) {
    // RBAC Scope Check on each lead: ensure actor is authorized to modify this lead
    if (actor) {
      const access = await checkDirectObjectAccess(actor, lead, "leads", "edit")
      if (!access.allowed) {
        continue // Skip out-of-scope lead
      }
    }

    let finalOwnerId = targetOwnerId ? targetUser._id : null
    let finalAssignedTo = targetOwnerId ? targetUser.name : "Unassigned"
    let finalStaffId = targetOwnerId ? targetUser._id.toString() : "unassigned"
    let finalTeamId = teamId || targetUser?.teamId || lead.teamId || null
    let finalReason = reason

    if (ruleId) {
      const routing = await resolveLeadAssignment(lead, cleanTenantId)
      finalOwnerId = routing.ownerId
      finalAssignedTo = routing.assignedTo
      finalStaffId = routing.assignedStaffId
      finalTeamId = routing.teamId || lead.teamId || null
      finalReason = routing.reason
    }

    const prevOwnerId = lead.ownerId
    const prevOwnerName = lead.assignedTo || "Unassigned"

    const historyEntry = {
      fromOwnerId: prevOwnerId,
      fromOwnerName: prevOwnerName,
      toOwnerId: finalOwnerId,
      toOwnerName: finalAssignedTo,
      teamId: finalTeamId,
      assignedBy: actor?._id || actor?.id || null,
      assignedByName: actor?.name || "System",
      assignedAt: new Date(),
      reason: finalReason,
    }

    lead.ownerId = finalOwnerId
    lead.assignedStaffId = finalStaffId
    lead.assignedTo = finalAssignedTo
    lead.teamId = finalTeamId
    if (!Array.isArray(lead.assignmentHistory)) {
      lead.assignmentHistory = []
    }
    lead.assignmentHistory.push(historyEntry)

    await lead.save()

    // Cascade follow-ups
    await FollowUp.updateMany(
      {
        tenantId: cleanTenantId,
        leadId: lead._id,
        status: "pending",
      },
      {
        $set: {
          assignedTo: finalAssignedTo,
          assignedStaffId: finalStaffId,
        },
      },
    )

    updatedCount++
    updatedLeadIds.push(lead._id.toString())
  }

  if (updatedCount > 0) {
    await audit.log({
      tenantId: cleanTenantId,
      actor,
      action: audit.AUDIT_ACTIONS.LEAD_BULK_ASSIGN,
      entity: "lead",
      summary: `Bulk reassigned ${updatedCount} leads (${targetUser ? targetUser.name : (ruleId ? "Rule-based" : "Unassigned Pool")})`,
      details: {
        totalRequested: validIds.length,
        updatedCount,
        targetOwnerId,
        teamId,
        ruleId,
        reason,
        updatedLeadIds,
      },
    })
  }

  return {
    totalRequested: validIds.length,
    updatedCount,
    successCount: updatedCount,
    failedCount: validIds.length - updatedCount,
    updatedLeadIds,
  }
}

/**
 * Reassigns all open leads owned by a deactivated staff member to a new agent or unassigned pool.
 */
async function reassignDeactivatedStaffLeads(staffId, { targetOwnerId = null, sendToPool = false, actor = null, tenantId } = {}) {
  if (!staffId || !tenantId) return { count: 0 }
  const cleanTenantId = tenantId.trim()

  let targetUser = null
  if (!sendToPool && targetOwnerId) {
    targetUser = await User.findOne({
      _id: targetOwnerId,
      tenantId: cleanTenantId,
      isActive: { $ne: false },
      status: "active",
    })
  }

  const finalOwnerId = targetUser ? targetUser._id : null
  const finalAssignedTo = targetUser ? targetUser.name : "Unassigned"
  const finalStaffId = targetUser ? targetUser._id.toString() : "unassigned"

  const staffDoc = await User.findOne({ _id: staffId, tenantId: cleanTenantId })
  const staffName = staffDoc ? staffDoc.name : "Deactivated Agent"

  const openLeads = await Lead.find({
    tenantId: cleanTenantId,
    ownerId: staffId,
    status: { $nin: ["Closed-Won", "Closed-Lost"] },
    deletedAt: null,
  })

  let count = 0
  for (const lead of openLeads) {
    const historyEntry = {
      fromOwnerId: staffId,
      fromOwnerName: staffName,
      toOwnerId: finalOwnerId,
      toOwnerName: finalAssignedTo,
      teamId: targetUser?.teamId || lead.teamId || null,
      assignedBy: actor?._id || actor?.id || null,
      assignedByName: actor?.name || "System",
      assignedAt: new Date(),
      reason: `Staff member deactivated (${staffName}): leads reassigned`,
    }

    lead.ownerId = finalOwnerId
    lead.assignedStaffId = finalStaffId
    lead.assignedTo = finalAssignedTo
    if (targetUser?.teamId) {
      lead.teamId = targetUser.teamId
    }
    if (!Array.isArray(lead.assignmentHistory)) {
      lead.assignmentHistory = []
    }
    lead.assignmentHistory.push(historyEntry)

    await lead.save()

    await FollowUp.updateMany(
      {
        tenantId: cleanTenantId,
        leadId: lead._id,
        status: "pending",
      },
      {
        $set: {
          assignedTo: finalAssignedTo,
          assignedStaffId: finalStaffId,
        },
      },
    )

    count++
  }

  if (count > 0) {
    await audit.log({
      tenantId: cleanTenantId,
      actor,
      action: audit.AUDIT_ACTIONS.LEAD_REASSIGN_OFFBOARD,
      entity: "staff",
      entityId: staffId,
      summary: `Offboarding wizard reassigned ${count} open leads from deactivated staff '${staffName}' to ${targetUser ? targetUser.name : "Unassigned pool"}`,
      details: {
        staffId,
        staffName,
        reassignedCount: count,
        reassignedTo: targetUser ? targetUser.name : "Unassigned Pool",
        targetOwnerId,
        sendToPool,
      },
    })
  }

  return {
    reassignedCount: count,
    reassignedTo: targetUser ? targetUser.name : "Unassigned Pool",
  }
}

/**
 * Returns statistics about the unassigned pool and agent workload
 */
async function getUnassignedPoolStats(tenantId) {
  if (!tenantId) return { unassignedCount: 0, openLeadsCount: 0 }
  const cleanTenantId = tenantId.trim()

  const [unassignedCount, totalOpenCount] = await Promise.all([
    Lead.countDocuments({
      tenantId: cleanTenantId,
      $or: [{ ownerId: null }, { assignedStaffId: "unassigned" }],
      deletedAt: null,
    }),
    Lead.countDocuments({
      tenantId: cleanTenantId,
      status: { $nin: ["Closed-Won", "Closed-Lost"] },
      deletedAt: null,
    }),
  ])

  return {
    unassignedCount,
    totalOpenCount,
    totalOpenLeadsCount: totalOpenCount,
  }
}

module.exports = {
  resolveLeadAssignment,
  assignLead,
  bulkAssignLeads,
  reassignDeactivatedStaffLeads,
  getUnassignedPoolStats,
}
