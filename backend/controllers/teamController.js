const mongoose = require("mongoose")
const Team = require("../models/Team")
const User = require("../models/User")
const audit = require("../services/auditService")
const { getEffectiveTenant } = require("../middleware/tenantContext")

/**
 * Team Controller
 * Complies with Roadmap Phase 4: Staff and agent accounts.
 */

const getTeams = async (req, res) => {
  try {
    const { tenantId, isSuperAdmin } = getEffectiveTenant(req)
    if (!tenantId && !isSuperAdmin) {
      return res.status(403).json({ success: false, error: "Tenant context required" })
    }

    const query = { isActive: true }
    if (tenantId) {
      query.tenantId = tenantId
    }

    const teams = await Team.find(query)
      .populate("managerId", "name email role")
      .populate("members", "name email role isActive")
      .sort({ name: 1 })
      .lean()

    const formattedTeams = teams.map((team) => ({
      id: team._id.toString(),
      _id: team._id.toString(),
      name: team.name,
      description: team.description,
      managerId: team.managerId?._id ? team.managerId._id.toString() : (team.managerId || null),
      managerName: team.managerId?.name || "No Manager Assigned",
      memberCount: Array.isArray(team.members) ? team.members.length : 0,
      members: Array.isArray(team.members)
        ? team.members.map((m) => ({
            id: m._id ? m._id.toString() : m.toString(),
            name: m.name || "Unknown",
            email: m.email || "",
            role: m.role || "agent",
            isActive: m.isActive !== false,
          }))
        : [],
      createdAt: team.createdAt,
    }))

    res.status(200).json({
      success: true,
      data: formattedTeams,
    })
  } catch (error) {
    console.error("Error fetching teams:", error)
    res.status(500).json({ success: false, error: "Failed to load teams" })
  }
}

const createTeam = async (req, res) => {
  try {
    const { tenantId, isSuperAdmin } = getEffectiveTenant(req)
    if (!tenantId && !isSuperAdmin) {
      return res.status(403).json({ success: false, error: "Tenant context missing" })
    }

    const { name, description = "", managerId = null, members = [] } = req.body

    if (!name || typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ success: false, error: "Team name is required" })
    }

    const cleanName = name.trim()
    const targetTenantId = tenantId || req.body.tenantId

    // Check duplicate team name in this tenant
    const existing = await Team.findOne({ tenantId: targetTenantId, name: cleanName, isActive: true })
    if (existing) {
      return res.status(400).json({ success: false, error: `Team '${cleanName}' already exists` })
    }

    const validMembers = Array.isArray(members)
      ? members.filter((m) => mongoose.Types.ObjectId.isValid(m))
      : []

    const team = new Team({
      tenantId: targetTenantId,
      name: cleanName,
      description: typeof description === "string" ? description.trim() : "",
      managerId: managerId && mongoose.Types.ObjectId.isValid(managerId) ? managerId : null,
      members: validMembers,
      isActive: true,
    })

    await team.save()

    // Assign teamId on members
    if (validMembers.length > 0) {
      await User.updateMany(
        { _id: { $in: validMembers }, tenantId: targetTenantId },
        { teamId: team._id }
      )
    }

    await audit.log({
      tenantId: targetTenantId,
      actor: req.user,
      action: audit.AUDIT_ACTIONS.TEAM_CREATE,
      entity: "team",
      entityId: team._id,
      summary: `Created team '${team.name}' with ${validMembers.length} member(s)`,
      details: {
        name: team.name,
        managerId: team.managerId,
        memberCount: validMembers.length,
      },
      req,
    })

    res.status(201).json({
      success: true,
      message: "Team created successfully",
      data: {
        id: team._id.toString(),
        name: team.name,
        description: team.description,
        managerId: team.managerId,
        memberCount: team.members.length,
      },
    })
  } catch (error) {
    console.error("Error creating team:", error)
    res.status(500).json({ success: false, error: error.message || "Failed to create team" })
  }
}

const updateTeam = async (req, res) => {
  try {
    const { tenantId } = getEffectiveTenant(req)
    const { id } = req.params

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, error: "Invalid team ID" })
    }

    const query = { _id: id }
    if (tenantId) query.tenantId = tenantId

    const team = await Team.findOne(query)
    if (!team) {
      return res.status(404).json({ success: false, error: "Team not found" })
    }

    const { name, description, managerId, members } = req.body

    if (name && typeof name === "string") {
      team.name = name.trim()
    }
    if (description !== undefined) {
      team.description = typeof description === "string" ? description.trim() : ""
    }
    if (managerId !== undefined) {
      team.managerId = managerId && mongoose.Types.ObjectId.isValid(managerId) ? managerId : null
    }

    if (Array.isArray(members)) {
      const validMembers = members.filter((m) => mongoose.Types.ObjectId.isValid(m))
      const oldMembers = team.members.map((m) => m.toString())
      const removedMembers = oldMembers.filter((m) => !validMembers.map(String).includes(m))

      team.members = validMembers

      // Remove teamId on dropped members
      if (removedMembers.length > 0) {
        await User.updateMany({ _id: { $in: removedMembers } }, { teamId: null })
      }
      // Set teamId on new members
      if (validMembers.length > 0) {
        await User.updateMany({ _id: { $in: validMembers } }, { teamId: team._id })
      }
    }

    await team.save()

    await audit.log({
      tenantId: team.tenantId,
      actor: req.user,
      action: audit.AUDIT_ACTIONS.TEAM_UPDATE,
      entity: "team",
      entityId: team._id,
      summary: `Updated team '${team.name}'`,
      details: {
        name: team.name,
        managerId: team.managerId,
        memberCount: team.members.length,
      },
      req,
    })

    res.status(200).json({
      success: true,
      message: "Team updated successfully",
      data: {
        id: team._id.toString(),
        name: team.name,
        description: team.description,
        managerId: team.managerId,
        memberCount: team.members.length,
      },
    })
  } catch (error) {
    console.error("Error updating team:", error)
    res.status(500).json({ success: false, error: "Failed to update team" })
  }
}

const deleteTeam = async (req, res) => {
  try {
    const { tenantId } = getEffectiveTenant(req)
    const { id } = req.params

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, error: "Invalid team ID" })
    }

    const query = { _id: id }
    if (tenantId) query.tenantId = tenantId

    const team = await Team.findOne(query)
    if (!team) {
      return res.status(404).json({ success: false, error: "Team not found" })
    }

    // Soft delete team and unassign teamId from members
    team.isActive = false
    await team.save()

    await User.updateMany({ teamId: team._id }, { teamId: null })

    await audit.log({
      tenantId: team.tenantId,
      actor: req.user,
      action: audit.AUDIT_ACTIONS.TEAM_DELETE,
      entity: "team",
      entityId: team._id,
      summary: `Deactivated team '${team.name}' and unassigned member associations`,
      req,
    })

    res.status(200).json({
      success: true,
      message: `Team '${team.name}' deactivated successfully.`,
    })
  } catch (error) {
    console.error("Error deleting team:", error)
    res.status(500).json({ success: false, error: "Failed to delete team" })
  }
}

module.exports = {
  getTeams,
  createTeam,
  updateTeam,
  deleteTeam,
}
