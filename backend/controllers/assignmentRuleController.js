const mongoose = require("mongoose")
const AssignmentRule = require("../models/AssignmentRule")
const User = require("../models/User")
const Team = require("../models/Team")
const { getEffectiveTenant } = require("../middleware/tenantContext")

/**
 * Assignment Rules Controller - Phase 7: Lead Ownership & Assignment
 * 
 * Manages tenant-scoped automated lead routing policies.
 */

/**
 * GET /api/assignment-rules
 * List all assignment rules for the tenant sorted by priority
 */
const getAssignmentRules = async (req, res) => {
  try {
    const { tenantId, isSuperAdmin } = getEffectiveTenant(req)
    if (!req.user || (!tenantId && !isSuperAdmin)) {
      return res.status(401).json({ success: false, error: "Authentication required" })
    }

    const query = {}
    if (tenantId) {
      query.tenantId = tenantId
    }

    const rules = await AssignmentRule.find(query)
      .populate("targetUserId", "name email role isActive")
      .populate("teamId", "name description")
      .populate("targetUserIds", "name email role isActive")
      .sort({ priority: 1, createdAt: 1 })
      .lean()

    res.status(200).json({
      success: true,
      data: rules,
    })
  } catch (error) {
    console.error("Error fetching assignment rules:", error)
    res.status(500).json({ success: false, error: "Failed to load assignment rules" })
  }
}

/**
 * POST /api/assignment-rules
 * Create a new assignment rule
 */
const createAssignmentRule = async (req, res) => {
  try {
    const { tenantId, isSuperAdmin } = getEffectiveTenant(req)
    if (!req.user || (!tenantId && !isSuperAdmin)) {
      return res.status(401).json({ success: false, error: "Authentication required" })
    }

    const assignedTenant = isSuperAdmin ? (req.body.tenantId || "default-tenant") : tenantId
    const {
      name,
      description = "",
      priority,
      isActive = true,
      conditions = {},
      routingType = "round_robin",
      targetUserId = null,
      teamId = null,
      targetUserIds = [],
    } = req.body

    if (!name || typeof name !== "string" || name.trim().length < 2) {
      return res.status(400).json({ success: false, error: "Valid rule name is required (minimum 2 characters)" })
    }

    const validRoutingTypes = ["direct", "round_robin", "fewest_open_leads", "pool"]
    if (!validRoutingTypes.includes(routingType)) {
      return res.status(400).json({
        success: false,
        error: `Invalid routing type. Must be one of: ${validRoutingTypes.join(", ")}`,
      })
    }

    // Target validation
    let resolvedTargetUserId = null
    if (targetUserId) {
      if (!mongoose.Types.ObjectId.isValid(targetUserId)) {
        return res.status(400).json({ success: false, error: "Invalid target user ID" })
      }
      const targetUser = await User.findOne({ _id: targetUserId, tenantId: assignedTenant })
      if (!targetUser) {
        return res.status(400).json({ success: false, error: "Target staff member not found in this account" })
      }
      resolvedTargetUserId = targetUser._id
    }

    let resolvedTeamId = null
    if (teamId) {
      if (!mongoose.Types.ObjectId.isValid(teamId)) {
        return res.status(400).json({ success: false, error: "Invalid team ID" })
      }
      const targetTeam = await Team.findOne({ _id: teamId, tenantId: assignedTenant })
      if (!targetTeam) {
        return res.status(400).json({ success: false, error: "Specified team not found in this account" })
      }
      resolvedTeamId = targetTeam._id
    }

    const cleanTargetUserIds = []
    if (Array.isArray(targetUserIds)) {
      for (const uid of targetUserIds) {
        if (mongoose.Types.ObjectId.isValid(uid)) {
          cleanTargetUserIds.push(new mongoose.Types.ObjectId(uid))
        }
      }
    }

    // Determine priority if not specified
    let resolvedPriority = typeof priority === "number" && priority > 0 ? priority : 1
    if (priority === undefined) {
      const highestRule = await AssignmentRule.findOne({ tenantId: assignedTenant }).sort({ priority: -1 })
      resolvedPriority = highestRule ? highestRule.priority + 1 : 1
    }

    const rule = new AssignmentRule({
      tenantId: assignedTenant,
      name: name.trim(),
      description: typeof description === "string" ? description.trim() : "",
      priority: resolvedPriority,
      isActive: Boolean(isActive),
      conditions: {
        sources: Array.isArray(conditions.sources)
          ? conditions.sources.map((s) => String(s).trim()).filter(Boolean)
          : [],
        tags: Array.isArray(conditions.tags)
          ? conditions.tags.map((t) => String(t).trim().toLowerCase()).filter(Boolean)
          : [],
        city: typeof conditions.city === "string" ? conditions.city.trim() : "",
      },
      routingType,
      targetUserId: resolvedTargetUserId,
      teamId: resolvedTeamId,
      targetUserIds: cleanTargetUserIds,
    })

    const savedRule = await rule.save()

    res.status(201).json({
      success: true,
      message: "Assignment rule created successfully",
      data: savedRule,
    })
  } catch (error) {
    console.error("Error creating assignment rule:", error)
    res.status(500).json({ success: false, error: error.message || "Failed to create assignment rule" })
  }
}

/**
 * PUT /api/assignment-rules/:id
 * Update an existing assignment rule
 */
const updateAssignmentRule = async (req, res) => {
  try {
    const { id } = req.params
    const { tenantId, isSuperAdmin } = getEffectiveTenant(req)
    if (!req.user || (!tenantId && !isSuperAdmin)) {
      return res.status(401).json({ success: false, error: "Authentication required" })
    }

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, error: "Invalid rule ID format" })
    }

    const query = { _id: id }
    if (tenantId) {
      query.tenantId = tenantId
    }

    const rule = await AssignmentRule.findOne(query)
    if (!rule) {
      return res.status(404).json({ success: false, error: "Assignment rule not found" })
    }

    const {
      name,
      description,
      priority,
      isActive,
      conditions,
      routingType,
      targetUserId,
      teamId,
      targetUserIds,
    } = req.body

    if (name !== undefined) {
      if (typeof name !== "string" || name.trim().length < 2) {
        return res.status(400).json({ success: false, error: "Rule name must be at least 2 characters" })
      }
      rule.name = name.trim()
    }

    if (description !== undefined) {
      rule.description = typeof description === "string" ? description.trim() : ""
    }

    if (typeof priority === "number" && priority > 0) {
      rule.priority = priority
    }

    if (typeof isActive === "boolean") {
      rule.isActive = isActive
    }

    if (routingType !== undefined) {
      const validRoutingTypes = ["direct", "round_robin", "fewest_open_leads", "pool"]
      if (!validRoutingTypes.includes(routingType)) {
        return res.status(400).json({ success: false, error: "Invalid routing type" })
      }
      rule.routingType = routingType
    }

    if (targetUserId !== undefined) {
      if (targetUserId === null || targetUserId === "") {
        rule.targetUserId = null
      } else if (mongoose.Types.ObjectId.isValid(targetUserId)) {
        const user = await User.findOne({ _id: targetUserId, tenantId: rule.tenantId })
        if (!user) {
          return res.status(400).json({ success: false, error: "Target staff member not found in this account" })
        }
        rule.targetUserId = user._id
      }
    }

    if (teamId !== undefined) {
      if (teamId === null || teamId === "") {
        rule.teamId = null
      } else if (mongoose.Types.ObjectId.isValid(teamId)) {
        const team = await Team.findOne({ _id: teamId, tenantId: rule.tenantId })
        if (!team) {
          return res.status(400).json({ success: false, error: "Specified team not found in this account" })
        }
        rule.teamId = team._id
      }
    }

    if (targetUserIds !== undefined && Array.isArray(targetUserIds)) {
      rule.targetUserIds = targetUserIds.filter((uid) => mongoose.Types.ObjectId.isValid(uid))
    }

    if (conditions !== undefined && typeof conditions === "object") {
      if (Array.isArray(conditions.sources)) {
        rule.conditions.sources = conditions.sources.map((s) => String(s).trim()).filter(Boolean)
      }
      if (Array.isArray(conditions.tags)) {
        rule.conditions.tags = conditions.tags.map((t) => String(t).trim().toLowerCase()).filter(Boolean)
      }
      if (typeof conditions.city === "string") {
        rule.conditions.city = conditions.city.trim()
      }
    }

    await rule.save()

    res.status(200).json({
      success: true,
      message: "Assignment rule updated successfully",
      data: rule,
    })
  } catch (error) {
    console.error("Error updating assignment rule:", error)
    res.status(500).json({ success: false, error: error.message || "Failed to update assignment rule" })
  }
}

/**
 * DELETE /api/assignment-rules/:id
 * Delete an assignment rule
 */
const deleteAssignmentRule = async (req, res) => {
  try {
    const { id } = req.params
    const { tenantId, isSuperAdmin } = getEffectiveTenant(req)
    if (!req.user || (!tenantId && !isSuperAdmin)) {
      return res.status(401).json({ success: false, error: "Authentication required" })
    }

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, error: "Invalid rule ID format" })
    }

    const query = { _id: id }
    if (tenantId) {
      query.tenantId = tenantId
    }

    const deletedRule = await AssignmentRule.findOneAndDelete(query)
    if (!deletedRule) {
      return res.status(404).json({ success: false, error: "Assignment rule not found" })
    }

    res.status(200).json({
      success: true,
      message: `Assignment rule '${deletedRule.name}' deleted successfully.`,
    })
  } catch (error) {
    console.error("Error deleting assignment rule:", error)
    res.status(500).json({ success: false, error: "Failed to delete assignment rule" })
  }
}

/**
 * POST /api/assignment-rules/reorder
 * Reorder priorities for a set of rules
 */
const reorderAssignmentRules = async (req, res) => {
  try {
    const { tenantId, isSuperAdmin } = getEffectiveTenant(req)
    const { ruleIds } = req.body

    if (!req.user || (!tenantId && !isSuperAdmin)) {
      return res.status(401).json({ success: false, error: "Authentication required" })
    }

    if (!Array.isArray(ruleIds) || ruleIds.length === 0) {
      return res.status(400).json({ success: false, error: "Array of rule IDs is required" })
    }

    const assignedTenant = tenantId

    for (let i = 0; i < ruleIds.length; i++) {
      const ruleId = ruleIds[i]
      if (mongoose.Types.ObjectId.isValid(ruleId)) {
        await AssignmentRule.updateOne(
          { _id: ruleId, ...(assignedTenant ? { tenantId: assignedTenant } : {}) },
          { $set: { priority: i + 1 } },
        )
      }
    }

    res.status(200).json({
      success: true,
      message: "Assignment rules priority reordered successfully",
    })
  } catch (error) {
    console.error("Error reordering assignment rules:", error)
    res.status(500).json({ success: false, error: "Failed to reorder assignment rules" })
  }
}

module.exports = {
  getAssignmentRules,
  createAssignmentRule,
  updateAssignmentRule,
  deleteAssignmentRule,
  reorderAssignmentRules,
}
