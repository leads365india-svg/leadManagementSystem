const mongoose = require("mongoose")
const tenantIsolationPlugin = require("../plugins/tenantIsolationPlugin")
const {
  DEFAULT_ACCOUNT_ADMIN_PERMISSIONS,
  getSuperAdminCeiling,
} = require("./RolePermission")

/**
 * Role Model - Phase 5: RBAC v2
 * 
 * Supports tenant-scoped custom roles with granular permission keys and
 * own / team / all scopes. Provides immutable system roles (Account Admin,
 * Manager, Agent, Viewer) seeded per tenant.
 */

const SYSTEM_ROLES = [
  {
    name: "Account Admin",
    slug: "account_admin",
    description: "Full administrative access to all leads, team records, call recordings, and settings.",
    isSystem: true,
    permissions: DEFAULT_ACCOUNT_ADMIN_PERMISSIONS,
  },
  {
    name: "Manager",
    slug: "manager",
    description: "Team-scoped access to manage team leads, follow-ups, calls, recordings, and assignments.",
    isSystem: true,
    permissions: [
      "dashboard.view",
      "leads.view.team",
      "leads.create",
      "leads.edit.team",
      "leads.delete.team",
      "leads.assign",
      "leads.export",
      "leads.bulkUpdate",
      "followups.view.team",
      "followups.manage.team",
      "calls.view.team",
      "calls.log",
      "recordings.listen",
      "staff.view",
      "teams.manage",
    ],
  },
  {
    name: "Agent",
    slug: "agent",
    description: "Own-scoped access to work leads, complete follow-ups, and log calls directly assigned to the user.",
    isSystem: true,
    permissions: [
      "dashboard.view",
      "leads.view.own",
      "leads.create",
      "leads.edit.own",
      "followups.view.own",
      "followups.manage.own",
      "calls.view.own",
      "calls.log",
    ],
  },
  {
    name: "Viewer",
    slug: "viewer",
    description: "Read-only access to view team leads, follow-ups, and calls without edit or delete privileges.",
    isSystem: true,
    permissions: [
      "dashboard.view",
      "leads.view.team",
      "followups.view.team",
      "calls.view.team",
      "staff.view",
    ],
  },
]

const roleSchema = new mongoose.Schema(
  {
    tenantId: {
      type: String,
      required: [true, "Tenant ID is required"],
      trim: true,
      index: true,
    },
    name: {
      type: String,
      required: [true, "Role name is required"],
      trim: true,
      minlength: [2, "Role name must be at least 2 characters"],
      maxlength: [100, "Role name cannot exceed 100 characters"],
    },
    slug: {
      type: String,
      required: [true, "Role slug is required"],
      trim: true,
      lowercase: true,
      match: [/^[a-z0-9_-]+$/, "Slug can only contain lowercase letters, numbers, underscores, and hyphens"],
      maxlength: [50, "Role slug cannot exceed 50 characters"],
    },
    description: {
      type: String,
      trim: true,
      default: "",
      maxlength: [500, "Description cannot exceed 500 characters"],
    },
    permissions: {
      type: [String],
      default: [],
    },
    isSystem: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform: (_doc, ret) => {
        ret.id = ret._id ? ret._id.toString() : null
        delete ret._id
        delete ret.__v
        return ret
      },
    },
  },
)

roleSchema.index({ tenantId: 1, slug: 1 }, { unique: true })
roleSchema.index({ tenantId: 1, name: 1 })

// Prevent mutating slug or deleting system roles
roleSchema.pre("validate", function () {
  if (this.isModified("slug") && !this.isNew && this.isSystem) {
    throw new Error("System role slug cannot be modified")
  }
})

roleSchema.pre("findOneAndDelete", async function () {
  const query = this.getQuery()
  const doc = await this.model.findOne(query).lean()
  if (doc && doc.isSystem) {
    throw new Error("System roles cannot be deleted")
  }
})

roleSchema.plugin(tenantIsolationPlugin)

const Role = mongoose.model("Role", roleSchema)

/**
 * Ensure default system roles (Account Admin, Manager, Agent, Viewer) exist for a tenant.
 * Uses Super Admin ceiling to ensure tenant roles don't exceed allowed privileges.
 */
const ensureTenantRoles = async (tenantId) => {
  if (!tenantId || typeof tenantId !== "string") return []

  const ceiling = await getSuperAdminCeiling()
  const { isPermissionCoveredByCeiling } = require("../utils/rbacScope")
  const existingRoles = await Role.find({ tenantId })
    .setOptions({ skipTenantFilter: true })
    .lean()

  const rolesToCreate = []

  for (const sysRole of SYSTEM_ROLES) {
    const existingDoc = existingRoles.find((r) => r.slug === sysRole.slug)
    const grantedPermissions = sysRole.permissions.filter((p) =>
      isPermissionCoveredByCeiling(p, ceiling),
    )

    if (!existingDoc) {
      rolesToCreate.push({
        tenantId,
        name: sysRole.name,
        slug: sysRole.slug,
        description: sysRole.description,
        isSystem: true,
        permissions: grantedPermissions,
      })
    } else if (existingDoc.isSystem) {
      const currentPerms = new Set(existingDoc.permissions || [])
      const hasMissing = grantedPermissions.some((p) => !currentPerms.has(p))
      if (hasMissing) {
        await Role.updateOne(
          { _id: existingDoc._id },
          { permissions: grantedPermissions },
        ).setOptions({ skipTenantFilter: true })
      }
    }
  }

  if (rolesToCreate.length > 0) {
    await Role.insertMany(rolesToCreate, { ordered: false }).catch(() => {
      // Ignore concurrent race duplicate key errors
    })
  }

  return Role.find({ tenantId }).setOptions({ skipTenantFilter: true }).lean()
}

module.exports = Role
module.exports.Role = Role
module.exports.SYSTEM_ROLES = SYSTEM_ROLES
module.exports.ensureTenantRoles = ensureTenantRoles
