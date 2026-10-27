const mongoose = require("mongoose")
const Role = require("../models/Role")
const User = require("../models/User")
const { ensureTenantRoles, SYSTEM_ROLES } = require("../models/Role")
const {
  PERMISSION_MODULES,
  getSuperAdminCeiling,
} = require("../models/RolePermission")
const { getEffectiveTenant } = require("../middleware/tenantContext")
const { invalidateTenantRoleCache } = require("../middleware/authMiddleware")
const { isPermissionCoveredByCeiling } = require("../utils/rbacScope")
const audit = require("../services/auditService")

/**
 * Role Controller - Phase 5: RBAC v2
 * 
 * Manages tenant-scoped roles and permissions with strict tenant isolation,
 * Super Admin ceiling enforcement, and privilege escalation prevention.
 */

// Helper to sanitize slug
const slugify = (text) => {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^\w-]+/g, "")
    .replace(/--+/g, "-")
}

/**
 * GET /api/roles
 * List all roles for caller's tenant with assigned staff count
 */
const getRoles = async (req, res) => {
  try {
    const { tenantId, isSuperAdmin } = getEffectiveTenant(req)
    if (!tenantId && !isSuperAdmin) {
      return res.status(403).json({
        success: false,
        error: "Tenant context required to access roles",
      })
    }

    const targetTenantId = tenantId || req.query.tenantId
    if (!targetTenantId) {
      return res.status(400).json({
        success: false,
        error: "Tenant ID is required",
      })
    }

    // Ensure system roles are seeded
    await ensureTenantRoles(targetTenantId)

    const roles = await Role.find({ tenantId: targetTenantId })
      .sort({ isSystem: -1, createdAt: 1 })
      .lean()

    // Aggregate staff counts per role for this tenant
    const staffCounts = await User.aggregate([
      { $match: { tenantId: targetTenantId, isActive: { $ne: false }, status: { $ne: "suspended" } } },
      { $group: { _id: "$role", count: { $sum: 1 } } },
    ])

    const countMap = {}
    staffCounts.forEach((item) => {
      countMap[item._id] = item.count
    })

    const rolesWithCounts = roles.map((r) => ({
      ...r,
      id: r._id.toString(),
      _id: r._id.toString(),
      assignedStaffCount: countMap[r.slug] || 0,
      permissionCount: Array.isArray(r.permissions) ? r.permissions.length : 0,
    }))

    res.status(200).json({
      success: true,
      data: {
        roles: rolesWithCounts,
        total: rolesWithCounts.length,
      },
    })
  } catch (error) {
    console.error("Error fetching roles:", error)
    res.status(500).json({ success: false, error: "Failed to load roles" })
  }
}

/**
 * GET /api/roles/permissions/available
 * List available permission modules and keys within Super Admin ceiling
 */
const getAvailablePermissions = async (req, res) => {
  try {
    const ceiling = await getSuperAdminCeiling()
    const ceilingSet = new Set(ceiling)

    // Filter modules and permissions according to Super Admin ceiling
    const availableModules = PERMISSION_MODULES.map((mod) => {
      const allowedInMod = mod.permissions.filter((p) => ceilingSet.has(p.key))
      return {
        ...mod,
        permissions: allowedInMod,
      }
    }).filter((mod) => mod.permissions.length > 0)

    res.status(200).json({
      success: true,
      data: {
        modules: availableModules,
        allowedKeys: Array.from(ceilingSet),
      },
    })
  } catch (error) {
    console.error("Error fetching available permissions:", error)
    res.status(500).json({ success: false, error: "Failed to load available permissions" })
  }
}

/**
 * GET /api/roles/:id
 * Retrieve single role details
 */
const getRoleById = async (req, res) => {
  try {
    const { tenantId, isSuperAdmin } = getEffectiveTenant(req)
    const { id } = req.params

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, error: "Invalid role ID format" })
    }

    const query = { _id: id }
    if (!isSuperAdmin && tenantId) {
      query.tenantId = tenantId
    }

    const role = await Role.findOne(query).lean()
    if (!role) {
      return res.status(404).json({ success: false, error: "Role not found" })
    }

    const staffCount = await User.countDocuments({
      tenantId: role.tenantId,
      role: role.slug,
      isActive: { $ne: false },
    })

    res.status(200).json({
      success: true,
      data: {
        ...role,
        id: role._id.toString(),
        _id: role._id.toString(),
        assignedStaffCount: staffCount,
      },
    })
  } catch (error) {
    console.error("Error fetching role:", error)
    res.status(500).json({ success: false, error: "Failed to retrieve role" })
  }
}

/**
 * POST /api/roles
 * Create custom role within caller's tenant
 * Validates permissions against Super Admin ceiling to prevent privilege escalation
 */
const createRole = async (req, res) => {
  try {
    const { tenantId, isSuperAdmin } = getEffectiveTenant(req)
    if (!tenantId && !isSuperAdmin) {
      return res.status(403).json({ success: false, error: "Tenant context required" })
    }

    const targetTenantId = tenantId || req.body.tenantId
    const { name, slug, description = "", permissions = [] } = req.body

    if (!name || typeof name !== "string" || name.trim().length < 2) {
      return res.status(400).json({
        success: false,
        error: "Role name is required (minimum 2 characters)",
      })
    }

    const roleSlug = slug ? slugify(slug) : slugify(name)
    if (!roleSlug || roleSlug.length < 2) {
      return res.status(400).json({
        success: false,
        error: "A valid role slug is required",
      })
    }

    // Disallow overriding system role slugs
    const systemSlugs = SYSTEM_ROLES.map((r) => r.slug)
    if (systemSlugs.includes(roleSlug)) {
      return res.status(400).json({
        success: false,
        error: `Cannot create custom role with reserved system slug '${roleSlug}'`,
      })
    }

    // Check duplicate slug or name in tenant
    const existing = await Role.findOne({
      tenantId: targetTenantId,
      $or: [{ slug: roleSlug }, { name: name.trim() }],
    })
      .setOptions({ skipTenantFilter: true })
      .lean()

    if (existing) {
      return res.status(400).json({
        success: false,
        error: `A role with name '${name}' or slug '${roleSlug}' already exists in this account`,
      })
    }

    // Privilege escalation check: Validate requested permissions against Super Admin ceiling
    if (!Array.isArray(permissions)) {
      return res.status(400).json({
        success: false,
        error: "Permissions must be an array of permission keys",
      })
    }

    const ceiling = await getSuperAdminCeiling()
    const unauthorizedPermissions = permissions.filter((p) => !isPermissionCoveredByCeiling(p, ceiling))

    if (unauthorizedPermissions.length > 0) {
      return res.status(403).json({
        success: false,
        error: `Privilege escalation blocked. Permissions exceed system ceiling: ${unauthorizedPermissions.join(", ")}`,
      })
    }

    const newRole = await Role.create({
      tenantId: targetTenantId,
      name: name.trim(),
      slug: roleSlug,
      description: typeof description === "string" ? description.trim() : "",
      permissions: Array.from(new Set(permissions)),
      isSystem: false,
    })

    invalidateTenantRoleCache(targetTenantId)

    await audit.log({
      tenantId: targetTenantId,
      actor: req.user,
      action: audit.AUDIT_ACTIONS.ROLE_CREATE,
      entity: "role",
      entityId: newRole._id,
      summary: `Created custom role '${newRole.name}' (${newRole.slug})`,
      details: {
        permissions: newRole.permissions,
        isSystem: false,
      },
      req,
    })

    res.status(201).json({
      success: true,
      message: "Custom role created successfully",
      data: {
        ...newRole.toJSON(),
        assignedStaffCount: 0,
      },
    })
  } catch (error) {
    console.error("Error creating role:", error)
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        error: "A role with this name or slug already exists in this account",
      })
    }
    res.status(500).json({ success: false, error: error.message || "Failed to create role" })
  }
}

/**
 * PUT /api/roles/:id
 * Update role permissions, name, or description
 * Enforces ceiling and protects system role slugs
 */
const updateRole = async (req, res) => {
  try {
    const { tenantId, isSuperAdmin } = getEffectiveTenant(req)
    const { id } = req.params

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, error: "Invalid role ID format" })
    }

    const query = { _id: id }
    if (!isSuperAdmin && tenantId) {
      query.tenantId = tenantId
    }

    const role = await Role.findOne(query)
    if (!role) {
      return res.status(404).json({ success: false, error: "Role not found" })
    }

    const { name, description, permissions } = req.body || {}
    const prevPermissions = [...(role.permissions || [])]
    const prevName = role.name
    const prevDescription = role.description

    if (name && typeof name === "string" && name.trim()) {
      if (role.isSystem && name.trim() !== role.name) {
        // System role names are fixed
        return res.status(400).json({
          success: false,
          error: "System role name cannot be modified",
        })
      }
      role.name = name.trim()
    }

    if (description !== undefined && typeof description === "string") {
      role.description = description.trim()
    }

    if (permissions !== undefined) {
      if (!Array.isArray(permissions)) {
        return res.status(400).json({
          success: false,
          error: "Permissions must be an array of permission keys",
        })
      }

      // Check ceiling
      const ceiling = await getSuperAdminCeiling()
      const unauthorizedPermissions = permissions.filter((p) => !isPermissionCoveredByCeiling(p, ceiling))

      if (unauthorizedPermissions.length > 0) {
        return res.status(403).json({
          success: false,
          error: `Privilege escalation blocked. Permissions exceed system ceiling: ${unauthorizedPermissions.join(", ")}`,
        })
      }

      role.permissions = Array.from(new Set(permissions))
    }

    await role.save()

    // Invalidate cached permissions for this tenant so updates take effect immediately
    invalidateTenantRoleCache(role.tenantId)

    const diff = audit.computeAuditDiff(
      { name: prevName, description: prevDescription, permissions: prevPermissions },
      { name: role.name, description: role.description, permissions: role.permissions }
    )

    await audit.log({
      tenantId: role.tenantId,
      actor: req.user,
      action: audit.AUDIT_ACTIONS.ROLE_UPDATE,
      entity: "role",
      entityId: role._id,
      summary: `Updated role '${role.name}'`,
      details: diff || { permissions: role.permissions },
      req,
    })

    res.status(200).json({
      success: true,
      message: "Role updated successfully",
      data: role.toJSON(),
    })
  } catch (error) {
    console.error("Error updating role:", error)
    res.status(500).json({ success: false, error: error.message || "Failed to update role" })
  }
}

/**
 * DELETE /api/roles/:id
 * Delete custom role (cannot delete system roles or roles with assigned staff)
 */
const deleteRole = async (req, res) => {
  try {
    const { tenantId, isSuperAdmin } = getEffectiveTenant(req)
    const { id } = req.params

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, error: "Invalid role ID format" })
    }

    const query = { _id: id }
    if (!isSuperAdmin && tenantId) {
      query.tenantId = tenantId
    }

    const role = await Role.findOne(query)
    if (!role) {
      return res.status(404).json({ success: false, error: "Role not found" })
    }

    if (role.isSystem) {
      return res.status(400).json({
        success: false,
        error: "System roles (Account Admin, Manager, Agent, Viewer) cannot be deleted",
      })
    }

    // Check if any active staff are assigned to this role
    const assignedCount = await User.countDocuments({
      tenantId: role.tenantId,
      $or: [{ role: role.slug }, { roleId: role._id }],
      isActive: { $ne: false },
    })

    if (assignedCount > 0) {
      return res.status(400).json({
        success: false,
        error: `Cannot delete role '${role.name}'. There are ${assignedCount} active staff member(s) assigned to this role. Please reassign them first.`,
      })
    }

    await Role.findByIdAndDelete(role._id).setOptions({ skipTenantFilter: true })

    invalidateTenantRoleCache(role.tenantId)

    await audit.log({
      tenantId: role.tenantId,
      actor: req.user,
      action: audit.AUDIT_ACTIONS.ROLE_DELETE,
      entity: "role",
      entityId: role._id,
      summary: `Deleted custom role '${role.name}' (${role.slug})`,
      details: {
        name: role.name,
        slug: role.slug,
        permissionsCount: role.permissions?.length || 0,
      },
      req,
    })

    res.status(200).json({
      success: true,
      message: `Role '${role.name}' deleted successfully`,
    })
  } catch (error) {
    console.error("Error deleting role:", error)
    res.status(500).json({ success: false, error: "Failed to delete role" })
  }
}

module.exports = {
  getRoles,
  getAvailablePermissions,
  getRoleById,
  createRole,
  updateRole,
  deleteRole,
}
