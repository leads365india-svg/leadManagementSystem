const RolePermission = require("../models/RolePermission")
const {
  PERMISSION_MODULES,
  ALLOWED_PERMISSIONS,
  DEFAULT_ACCOUNT_ADMIN_PERMISSIONS,
} = RolePermission

// GET /api/super-admin/permissions - Get available modules, allowlist, and active permissions
const getPermissions = async (_req, res) => {
  try {
    let roleConfig = await RolePermission.findOne({ targetRole: "account_admin" })

    // If not seeded yet, seed defaults in database
    if (!roleConfig) {
      roleConfig = await RolePermission.create({
        targetRole: "account_admin",
        permissions: DEFAULT_ACCOUNT_ADMIN_PERMISSIONS,
        updatedBy: "system_bootstrap",
      })
    }

    res.status(200).json({
      success: true,
      data: {
        modules: PERMISSION_MODULES,
        allowedPermissions: ALLOWED_PERMISSIONS,
        activePermissions: roleConfig.permissions,
        updatedAt: roleConfig.updatedAt,
        updatedBy: roleConfig.updatedBy,
      },
    })
  } catch (error) {
    console.error("Error fetching permissions:", error)
    res.status(500).json({
      success: false,
      error: "Failed to fetch roles and permissions configuration",
    })
  }
}

// PUT /api/super-admin/permissions - Update permissions granted to Leads Account Admins
const updatePermissions = async (req, res) => {
  try {
    const { permissions } = req.body

    // Validate array of strings
    if (!Array.isArray(permissions) || !permissions.every((p) => typeof p === "string")) {
      res.status(400).json({
        success: false,
        error: "Permissions must be an array of string permission keys",
      })
      return
    }

    // Strict allowlist validation: Reject any unknown or invalid keys
    const invalidKeys = permissions.filter((key) => !ALLOWED_PERMISSIONS.includes(key))
    if (invalidKeys.length > 0) {
      res.status(400).json({
        success: false,
        error: `Invalid permission keys detected: ${invalidKeys.join(", ")}`,
      })
      return
    }

    // Deduplicate keys
    const uniquePermissions = Array.from(new Set(permissions))

    // Upsert role configuration
    const updated = await RolePermission.findOneAndUpdate(
      { targetRole: "account_admin" },
      {
        permissions: uniquePermissions,
        updatedBy: req.user?.email || "super_admin",
      },
      { new: true, upsert: true, runValidators: true },
    )

    res.status(200).json({
      success: true,
      message: "Permissions for Leads Account Admins updated successfully",
      data: {
        activePermissions: updated.permissions,
        updatedAt: updated.updatedAt,
        updatedBy: updated.updatedBy,
      },
    })
  } catch (error) {
    console.error("Error saving permissions:", error)
    res.status(500).json({
      success: false,
      error: "Failed to save permissions configuration",
    })
  }
}

module.exports = {
  getPermissions,
  updatePermissions,
}
