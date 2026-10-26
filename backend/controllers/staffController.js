const crypto = require("crypto")
const mongoose = require("mongoose")
const User = require("../models/User")
const Team = require("../models/Team")
const Role = require("../models/Role")
const Account = require("../models/Account")
const Lead = require("../models/Lead")
const assignmentService = require("../services/assignmentService")
const audit = require("../services/auditService")
const { getEffectiveTenant } = require("../middleware/tenantContext")

/**
 * Staff Controller
 * Complies with Roadmap Phase 4: Staff and agent accounts.
 * 
 * Supports full lifecycle: list, create with invite token, edit, deactivate (soft block),
 * reset password, team assignment, and seat limit verification.
 */

// Helper to escape regex special characters
const escapeRegex = (str) => {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/**
 * GET /api/staff
 * Retrieve staff members for current tenant with search, filtering, and team info
 */
const getStaff = async (req, res) => {
  try {
    const { tenantId, isSuperAdmin } = getEffectiveTenant(req)
    if (!tenantId && !isSuperAdmin) {
      return res.status(403).json({ success: false, error: "Tenant context required to access staff records" })
    }

    const {
      search = "",
      role = "all",
      teamId = "all",
      status = "all",
      page = 1,
      limit = 20,
    } = req.query

    const pageNum = Math.max(1, Number(page) || 1)
    const limitNum = Math.max(1, Math.min(100, Number(limit) || 20))
    const skip = (pageNum - 1) * limitNum

    const query = {}

    // In tenant context, Mongoose plugin auto-injects tenantId.
    // If super admin passes specific tenant, filter on it.
    if (tenantId) {
      query.tenantId = tenantId
    }

    // Role filter (exclude super_admin from staff list)
    if (role && role !== "all") {
      query.role = role
    } else {
      query.role = { $ne: "super_admin" }
    }

    // Team filter
    if (teamId && teamId !== "all") {
      query.teamId = teamId === "unassigned" ? null : teamId
    }

    // Status filter
    if (status && status !== "all") {
      if (status === "active") {
        query.isActive = true
        query.status = "active"
      } else if (status === "suspended" || status === "inactive") {
        query.$or = [{ isActive: false }, { status: "suspended" }]
      }
    }

    // Search query
    if (typeof search === "string" && search.trim()) {
      const sanitized = escapeRegex(search.trim())
      query.$or = [
        { name: { $regex: sanitized, $options: "i" } },
        { email: { $regex: sanitized, $options: "i" } },
        { phone: { $regex: sanitized, $options: "i" } },
        { contactNumber: { $regex: sanitized, $options: "i" } },
      ]
    }

    const [staffMembers, totalCount, statsAgg] = await Promise.all([
      User.find(query)
        .populate("teamId", "name")
        .populate("managerId", "name email")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      User.countDocuments(query),
      User.aggregate([
        { $match: tenantId ? { tenantId, role: { $ne: "super_admin" } } : { role: { $ne: "super_admin" } } },
        {
          $group: {
            _id: null,
            totalStaff: { $sum: 1 },
            activeCount: {
              $sum: { $cond: [{ $and: [{ $eq: ["$isActive", true] }, { $eq: ["$status", "active"] }] }, 1, 0] },
            },
            agentsCount: { $sum: { $cond: [{ $eq: ["$role", "agent"] }, 1, 0] } },
            managersCount: { $sum: { $cond: [{ $eq: ["$role", "manager"] }, 1, 0] } },
          },
        },
      ]),
    ])

    const stats = statsAgg[0] || {
      totalStaff: 0,
      activeCount: 0,
      agentsCount: 0,
      managersCount: 0,
    }

    const formattedStaff = staffMembers.map((member) => ({
      id: member._id.toString(),
      _id: member._id.toString(),
      name: member.name,
      email: member.email,
      phone: member.phone || member.contactNumber || "",
      role: member.role,
      status: member.status,
      isActive: member.isActive !== false && member.status !== "suspended",
      teamId: member.teamId?._id ? member.teamId._id.toString() : (member.teamId || null),
      teamName: member.teamId?.name || "Unassigned",
      managerId: member.managerId?._id ? member.managerId._id.toString() : (member.managerId || null),
      managerName: member.managerId?.name || null,
      maxOpenLeads: member.maxOpenLeads ?? 50,
      lastLoginAt: member.lastLoginAt,
      createdAt: member.createdAt,
    }))

    res.status(200).json({
      success: true,
      data: {
        staff: formattedStaff,
        pagination: {
          total: totalCount,
          page: pageNum,
          limit: limitNum,
          totalPages: Math.ceil(totalCount / limitNum) || 1,
        },
        stats,
      },
    })
  } catch (error) {
    console.error("Error fetching staff:", error)
    res.status(500).json({ success: false, error: "Failed to load staff list" })
  }
}

/**
 * POST /api/staff
 * Create a new staff member (Agent or Manager) with invite token
 */
const createStaff = async (req, res) => {
  try {
    const { tenantId, isSuperAdmin } = getEffectiveTenant(req)
    if (!tenantId && !isSuperAdmin) {
      return res.status(403).json({ success: false, error: "Tenant context missing" })
    }

    const {
      name,
      email,
      phone = "",
      role = "agent",
      teamId = null,
      managerId = null,
      maxOpenLeads = 50,
      temporaryPassword = null,
    } = req.body

    if (!name || typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ success: false, error: "Staff member name is required" })
    }
    if (!email || typeof email !== "string" || !email.includes("@")) {
      return res.status(400).json({ success: false, error: "Valid email address is required" })
    }

    const targetTenantId = tenantId || req.body.tenantId
    const tenantRoles = targetTenantId ? await Role.find({ tenantId: targetTenantId }).lean() : []
    const allowedRoleSlugs = new Set([
      "manager",
      "agent",
      "account_admin",
      "viewer",
      ...tenantRoles.map((r) => r.slug),
    ])

    if (!allowedRoleSlugs.has(role)) {
      return res.status(400).json({
        success: false,
        error: `Invalid role '${role}'. Allowed roles: ${Array.from(allowedRoleSlugs).join(", ")}`,
      })
    }

    const matchedRole = tenantRoles.find((r) => r.slug === role)
    const roleIdToAssign = matchedRole ? matchedRole._id : null

    const cleanEmail = email.toLowerCase().trim()

    // 1. Check seat limit for tenant
    if (targetTenantId) {
      const existingCount = await User.countDocuments({
        tenantId: targetTenantId,
        role: { $ne: "super_admin" },
      })
      const account = await Account.findOne({ accountId: targetTenantId }).lean()
      const seatLimit = account?.maxUsers || 50
      if (existingCount >= seatLimit) {
        return res.status(403).json({
          success: false,
          error: `Seat limit reached for this account (${seatLimit} users). Please contact support to increase your seat tier.`,
        })
      }
    }

    // 2. Check if user with same email already exists in THIS tenant
    const existingUser = await User.findOne({
      tenantId: targetTenantId,
      email: cleanEmail,
    })
    if (existingUser) {
      return res.status(400).json({
        success: false,
        error: `A staff member with email '${cleanEmail}' already exists in your account.`,
      })
    }

    // 3. Generate cryptographic invite token
    const rawInviteToken = crypto.randomBytes(32).toString("hex")
    const inviteTokenHash = crypto.createHash("sha256").update(rawInviteToken).digest("hex")
    const inviteTokenExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days

    // If temporary password was not supplied, generate secure random password
    const passwordToSet = temporaryPassword && temporaryPassword.length >= 6
      ? temporaryPassword
      : `TmpPass_${crypto.randomBytes(8).toString("hex")}!`

    const newStaff = new User({
      name: name.trim(),
      email: cleanEmail,
      phone: phone ? phone.trim() : "",
      contactNumber: phone ? phone.trim() : "",
      role,
      roleId: roleIdToAssign,
      tenantId: targetTenantId,
      teamId: teamId || null,
      managerId: managerId || null,
      maxOpenLeads: Math.max(0, Number(maxOpenLeads) || 50),
      isActive: true,
      status: "active",
      password: passwordToSet,
      tokenVersion: 1,
      inviteTokenHash,
      inviteTokenExpiresAt,
    })

    await newStaff.save()

    // 4. If assigned to team, update Team.members
    if (teamId) {
      await Team.findByIdAndUpdate(teamId, {
        $addToSet: { members: newStaff._id },
      })
    }

    // 5. Construct invite URL
    const protocol = req.headers["x-forwarded-proto"] || req.protocol || "http"
    const host = req.get("host") || "localhost:3000"
    const inviteUrl = `${protocol}://${host}/invite/accept?token=${rawInviteToken}&email=${encodeURIComponent(cleanEmail)}`

    // Log staff creation event to audit trail
    await audit.log({
      tenantId: targetTenantId,
      actor: req.user,
      action: audit.AUDIT_ACTIONS.STAFF_CREATE,
      entity: "staff",
      entityId: newStaff._id,
      summary: `Created staff member ${newStaff.name} (${newStaff.email}) with role '${newStaff.role}'`,
      details: {
        role: newStaff.role,
        teamId: newStaff.teamId,
        managerId: newStaff.managerId,
        maxOpenLeads: newStaff.maxOpenLeads,
      },
      req,
    })

    res.status(201).json({
      success: true,
      message: "Staff member created successfully",
      data: {
        staff: {
          id: newStaff._id.toString(),
          name: newStaff.name,
          email: newStaff.email,
          phone: newStaff.phone,
          role: newStaff.role,
          teamId: newStaff.teamId,
          managerId: newStaff.managerId,
          maxOpenLeads: newStaff.maxOpenLeads,
          isActive: newStaff.isActive,
          status: newStaff.status,
          createdAt: newStaff.createdAt,
        },
        inviteToken: rawInviteToken,
        inviteUrl,
      },
    })
  } catch (error) {
    console.error("Error creating staff member:", error)
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        error: "A staff member with this email already exists in this account.",
      })
    }
    res.status(500).json({ success: false, error: error.message || "Failed to create staff member" })
  }
}

/**
 * GET /api/staff/:id
 * Retrieve single staff member details
 */
const getStaffById = async (req, res) => {
  try {
    const { tenantId, isSuperAdmin } = getEffectiveTenant(req)
    const { id } = req.params

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, error: "Invalid staff ID format" })
    }

    const query = { _id: id }
    if (tenantId) {
      query.tenantId = tenantId
    }

    const staff = await User.findOne(query)
      .populate("teamId", "name description")
      .populate("managerId", "name email")
      .lean()

    if (!staff) {
      return res.status(404).json({ success: false, error: "Staff member not found" })
    }

    res.status(200).json({
      success: true,
      data: {
        id: staff._id.toString(),
        name: staff.name,
        email: staff.email,
        phone: staff.phone || staff.contactNumber || "",
        role: staff.role,
        status: staff.status,
        isActive: staff.isActive !== false && staff.status !== "suspended",
        teamId: staff.teamId?._id ? staff.teamId._id.toString() : (staff.teamId || null),
        teamName: staff.teamId?.name || "Unassigned",
        managerId: staff.managerId?._id ? staff.managerId._id.toString() : (staff.managerId || null),
        managerName: staff.managerId?.name || null,
        maxOpenLeads: staff.maxOpenLeads ?? 50,
        lastLoginAt: staff.lastLoginAt,
        createdAt: staff.createdAt,
      },
    })
  } catch (error) {
    console.error("Error fetching staff member:", error)
    res.status(500).json({ success: false, error: "Failed to retrieve staff member" })
  }
}

/**
 * PUT /api/staff/:id
 * Update staff member details
 */
const updateStaff = async (req, res) => {
  try {
    const { tenantId, isSuperAdmin } = getEffectiveTenant(req)
    const { id } = req.params

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, error: "Invalid staff ID format" })
    }

    const query = { _id: id }
    if (tenantId) {
      query.tenantId = tenantId
    }

    const staff = await User.findOne(query)
    if (!staff) {
      return res.status(404).json({ success: false, error: "Staff member not found" })
    }

    const { name, phone, role, teamId, managerId, maxOpenLeads } = req.body

    if (name && typeof name === "string") {
      staff.name = name.trim()
    }
    if (phone !== undefined) {
      staff.phone = typeof phone === "string" ? phone.trim() : ""
      staff.contactNumber = staff.phone
    }
    const targetTenant = staff.tenantId || tenantId
    const tenantRoles = targetTenant ? await Role.find({ tenantId: targetTenant }).lean() : []
    const allowedRoleSlugs = new Set([
      "manager",
      "agent",
      "account_admin",
      "viewer",
      ...tenantRoles.map((r) => r.slug),
    ])

    const previousRole = staff.role
    if (role && allowedRoleSlugs.has(role)) {
      if (role !== staff.role) {
        staff.role = role
        const matchedRole = tenantRoles.find((r) => r.slug === role)
        staff.roleId = matchedRole ? matchedRole._id : null
        // Invalidate active session tokens on role change
        staff.tokenVersion = (staff.tokenVersion || 1) + 1
      }
    }
    if (maxOpenLeads !== undefined) {
      staff.maxOpenLeads = Math.max(0, Number(maxOpenLeads) || 0)
    }

    const previousTeamId = staff.teamId ? staff.teamId.toString() : null
    const newTeamId = teamId === null || teamId === "unassigned" ? null : teamId

    if (newTeamId !== undefined) {
      staff.teamId = newTeamId
    }
    if (managerId !== undefined) {
      staff.managerId = managerId === null || managerId === "none" ? null : managerId
    }

    await staff.save()

    // If team changed, update Team membership lists
    if (newTeamId !== undefined && previousTeamId !== newTeamId) {
      if (previousTeamId) {
        await Team.findByIdAndUpdate(previousTeamId, {
          $pull: { members: staff._id },
        })
      }
      if (newTeamId) {
        await Team.findByIdAndUpdate(newTeamId, {
          $addToSet: { members: staff._id },
        })
      }
    }

    // Log staff update event to audit trail
    await audit.log({
      tenantId: staff.tenantId,
      actor: req.user,
      action: previousRole && previousRole !== staff.role ? audit.AUDIT_ACTIONS.STAFF_ROLE_CHANGE : audit.AUDIT_ACTIONS.STAFF_UPDATE,
      entity: "staff",
      entityId: staff._id,
      summary: `Updated staff member ${staff.name} (${staff.email})`,
      details: {
        role: staff.role,
        teamId: staff.teamId,
        managerId: staff.managerId,
        maxOpenLeads: staff.maxOpenLeads,
      },
      req,
    })

    res.status(200).json({
      success: true,
      message: "Staff member updated successfully",
      data: {
        id: staff._id.toString(),
        name: staff.name,
        email: staff.email,
        phone: staff.phone,
        role: staff.role,
        teamId: staff.teamId,
        managerId: staff.managerId,
        maxOpenLeads: staff.maxOpenLeads,
        isActive: staff.isActive,
        status: staff.status,
      },
    })
  } catch (error) {
    console.error("Error updating staff member:", error)
    res.status(500).json({ success: false, error: "Failed to update staff member" })
  }
}

/**
 * PATCH /api/staff/:id/deactivate
 * Soft deactivate / reactivate staff member (Never hard delete)
 * Increments tokenVersion on deactivation to invalidate all active sessions immediately
 */
const toggleStaffStatus = async (req, res) => {
  try {
    const { tenantId, isSuperAdmin } = getEffectiveTenant(req)
    const { id } = req.params

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, error: "Invalid staff ID format" })
    }

    const query = { _id: id }
    if (tenantId) {
      query.tenantId = tenantId
    }

    const staff = await User.findOne(query)
    if (!staff) {
      return res.status(404).json({ success: false, error: "Staff member not found" })
    }

    // Prevent admin from deactivating their own currently logged in account
    if (req.user && req.user.id === staff._id.toString()) {
      return res.status(400).json({
        success: false,
        error: "You cannot deactivate your own active session.",
      })
    }

    const currentActive = staff.isActive !== false && staff.status !== "suspended"
    const nextActive = !currentActive

    staff.isActive = nextActive
    staff.status = nextActive ? "active" : "suspended"

    // Increment token version to immediately invalidate any cached JWT tokens across all devices
    if (!nextActive) {
      staff.tokenVersion = (staff.tokenVersion || 1) + 1
    }

    await staff.save()

    let reassignSummary = null
    if (!nextActive && (req.body.reassignTo || req.body.sendToPool)) {
      reassignSummary = await assignmentService.reassignDeactivatedStaffLeads(staff._id, {
        targetOwnerId: req.body.reassignTo || null,
        sendToPool: Boolean(req.body.sendToPool),
        actor: req.user,
        tenantId: staff.tenantId,
      })
    }

    // Log status toggle event to audit trail
    await audit.log({
      tenantId: staff.tenantId,
      actor: req.user,
      action: nextActive ? audit.AUDIT_ACTIONS.STAFF_REACTIVATE : audit.AUDIT_ACTIONS.STAFF_DEACTIVATE,
      entity: "staff",
      entityId: staff._id,
      summary: nextActive
        ? `Reactivated staff member ${staff.name} (${staff.email})`
        : `Deactivated staff member ${staff.name} (${staff.email}). Sessions terminated.`,
      details: {
        status: staff.status,
        isActive: staff.isActive,
        reassignSummary,
      },
      req,
    })

    res.status(200).json({
      success: true,
      message: nextActive
        ? `Staff member '${staff.name}' reactivated successfully.`
        : `Staff member '${staff.name}' deactivated. All active sessions have been terminated.`,
      data: {
        id: staff._id.toString(),
        name: staff.name,
        email: staff.email,
        isActive: staff.isActive,
        status: staff.status,
      },
      reassignSummary,
    })
  } catch (error) {
    console.error("Error toggling staff status:", error)
    res.status(500).json({ success: false, error: "Failed to toggle staff status" })
  }
}

/**
 * GET /api/staff/:id/open-leads
 * Counts and previews open leads currently assigned to this staff member (for deactivation wizard)
 */
const getStaffOpenLeads = async (req, res) => {
  try {
    const { tenantId } = getEffectiveTenant(req)
    const { id } = req.params

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, error: "Invalid staff ID format" })
    }

    const openCount = await Lead.countDocuments({
      tenantId,
      ownerId: id,
      status: { $nin: ["Closed-Won", "Closed-Lost"] },
      deletedAt: null,
    })

    const sampleLeads = await Lead.find({
      tenantId,
      ownerId: id,
      status: { $nin: ["Closed-Won", "Closed-Lost"] },
      deletedAt: null,
    })
      .select("name email phone status source createdAt")
      .limit(5)
      .lean()

    res.status(200).json({
      success: true,
      data: {
        staffId: id,
        openLeadsCount: openCount,
        sampleLeads,
      },
    })
  } catch (error) {
    console.error("Error fetching staff open leads:", error)
    res.status(500).json({ success: false, error: "Failed to fetch staff open leads" })
  }
}

/**
 * POST /api/staff/:id/reset-password
 * Admin triggers password reset for staff member, generating a one-time token link
 */
const adminResetPassword = async (req, res) => {
  try {
    const { tenantId, isSuperAdmin } = getEffectiveTenant(req)
    const { id } = req.params

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, error: "Invalid staff ID format" })
    }

    const query = { _id: id }
    if (tenantId) {
      query.tenantId = tenantId
    }

    const staff = await User.findOne(query)
    if (!staff) {
      return res.status(404).json({ success: false, error: "Staff member not found" })
    }

    const { newPassword } = req.body || {}

    // Option A: Admin explicitly set new password directly
    if (newPassword && typeof newPassword === "string" && newPassword.length >= 6) {
      staff.password = newPassword
      staff.tokenVersion = (staff.tokenVersion || 1) + 1
      await staff.save()

      return res.status(200).json({
        success: true,
        message: `Password for ${staff.name} has been updated directly. Prior sessions invalidated.`,
      })
    }

    // Option B: Generate one-time reset token link
    const rawResetToken = crypto.randomBytes(32).toString("hex")
    const resetTokenHash = crypto.createHash("sha256").update(rawResetToken).digest("hex")
    const resetTokenExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours

    staff.resetPasswordTokenHash = resetTokenHash
    staff.resetPasswordTokenExpiresAt = resetTokenExpiresAt
    await staff.save()

    const protocol = req.headers["x-forwarded-proto"] || req.protocol || "http"
    const host = req.get("host") || "localhost:3000"
    const resetUrl = `${protocol}://${host}/reset-password?token=${rawResetToken}&email=${encodeURIComponent(staff.email)}`

    await audit.log({
      tenantId: staff.tenantId,
      actor: req.user,
      action: audit.AUDIT_ACTIONS.STAFF_PASSWORD_RESET,
      entity: "staff",
      entityId: staff._id,
      summary: `Generated password reset token for staff member ${staff.name}`,
      req,
    })

    res.status(200).json({
      success: true,
      message: `Password reset link generated for ${staff.name}.`,
      data: {
        resetToken: rawResetToken,
        resetUrl,
      },
    })
  } catch (error) {
    console.error("Error generating password reset:", error)
    res.status(500).json({ success: false, error: "Failed to generate password reset" })
  }
}

module.exports = {
  getStaff,
  createStaff,
  getStaffById,
  updateStaff,
  toggleStaffStatus,
  getStaffOpenLeads,
  adminResetPassword,
}
