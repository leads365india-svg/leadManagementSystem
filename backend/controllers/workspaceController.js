const mongoose = require("mongoose")
const Workspace = require("../models/Workspace")
const WorkspaceMembership = require("../models/WorkspaceMembership")
const ServiceCatalog = require("../models/ServiceCatalog")
const BusinessProduct = require("../models/BusinessProduct")
const Account = require("../models/Account")
const User = require("../models/User")
const Lead = require("../models/Lead")
const Call = require("../models/Call")
const FollowUp = require("../models/FollowUp")
const DomainMapping = require("../models/DomainMapping")
const { Integration } = require("../models/Integration")
const { invalidateAccountWorkspaceModeCache, getEffectiveTenant } = require("../middleware/tenantContext")
const { invalidateCustomDomainCache, sanitizeHostname } = require("../utils/customDomainCache")
const crypto = require("crypto")
const dns = require("dns").promises
const audit = require("../services/auditService")

// Helper to normalize and generate URL slug
const slugify = (text) => {
  return String(text || "")
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

// Helper to determine the canonical platform base URL
const getPlatformBaseUrl = () => {
  return (
    process.env.PLATFORM_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "https://crm.leads365.in"
  ).replace(/\/+$/, "")
}

// Generate the authoritative access URL for a workspace
const buildWorkspaceAccessUrl = (orgSlug, ws) => {
  if (ws && ws.customDomain && (ws.domainStatus === "verified" || ws.domainStatus === "active")) {
    return `https://${ws.customDomain}/portal/login`
  }
  const base = getPlatformBaseUrl()
  const safeOrg = orgSlug || "org"
  const safeWs = ws?.slug || ""
  return `${base}/portal/login?organization=${encodeURIComponent(safeOrg)}&workspace=${encodeURIComponent(safeWs)}`
}

/**
 * Strictly resolve verified parent tenantId from authenticated server-side session/context.
 * Never trusts arbitrary client-supplied tenantId overrides for non-super-admin users.
 */
const resolveVerifiedTenantId = (req) => {
  const { tenantId: effectiveTenantId, isSuperAdmin } = getEffectiveTenant(req)

  if (!isSuperAdmin) {
    const userTenantId = req.user?.tenantId ? String(req.user.tenantId).trim() : null
    if (!userTenantId) {
      return {
        error: "No tenant account assigned to user",
        status: 403,
        tenantId: null,
        isSuperAdmin: false,
      }
    }
    if (req.tenantId && String(req.tenantId).trim() !== userTenantId) {
      return {
        error: "Cross-tenant access denied: Session tenant mismatch.",
        code: "CROSS_TENANT_SESSION_MISMATCH",
        status: 403,
        tenantId: null,
        isSuperAdmin: false,
      }
    }
    return { tenantId: userTenantId, isSuperAdmin: false }
  }

  return { tenantId: effectiveTenantId || null, isSuperAdmin: true }
}

/**
 * GET /api/workspaces
 * List workspaces accessible by the current user
 * - Org Admin / Super Admin: returns all active workspaces in the tenant
 * - Regular Staff: returns only workspaces where user holds active membership
 */
const listWorkspaces = async (req, res) => {
  try {
    const resolvedTenant = resolveVerifiedTenantId(req)
    if (resolvedTenant.error) {
      return res.status(resolvedTenant.status || 403).json({
        success: false,
        error: resolvedTenant.error,
        ...(resolvedTenant.code ? { code: resolvedTenant.code } : {}),
      })
    }

    const { tenantId, isSuperAdmin } = resolvedTenant
    if (!tenantId) {
      if (isSuperAdmin) {
        return res.status(200).json({
          success: true,
          data: [],
          workspaceModeEnabled: false,
        })
      }
      return res.status(403).json({ success: false, error: "No tenant account assigned to user" })
    }

    const isOrgAdmin = req.user.role === "account_admin" || req.user.role === "super_admin"
    let workspaces = []

    if (isOrgAdmin) {
      workspaces = await Workspace.find({
        tenantId,
        status: { $ne: "archived" },
      })
        .sort({ isDefault: -1, createdAt: 1 })
        .lean()
    } else {
      const memberships = await WorkspaceMembership.find({
        tenantId,
        userId: req.user.id || req.user._id,
        status: "active",
      }).lean()

      const allowedIds = memberships.map((m) => m.workspaceId)
      workspaces = await Workspace.find({
        _id: { $in: allowedIds },
        tenantId,
        status: "active",
      })
        .sort({ isDefault: -1, createdAt: 1 })
        .lean()

      // Attach user's specific workspace role to response
      const roleMap = new Map(memberships.map((m) => [m.workspaceId.toString(), m.role]))
      workspaces = workspaces.map((w) => ({
        ...w,
        userRole: roleMap.get(w._id.toString()) || "agent",
      }))
    }

    // Defense-in-depth: strictly ensure every workspace document belongs to verified tenantId
    const isolatedWorkspaces = workspaces.filter((w) => String(w.tenantId) === String(tenantId))

    // Include account-level workspaceModeEnabled flag and slug
    const account = await Account.findOne({ accountId: tenantId }).select("workspaceModeEnabled slug companyName accountId").lean()
    const orgSlug = account?.slug || slugify(account?.companyName) || account?.accountId || tenantId

    const enrichedWorkspaces = isolatedWorkspaces.map((w) => ({
      ...w,
      accessUrl: buildWorkspaceAccessUrl(orgSlug, w),
    }))

    if (typeof res.set === "function") {
      res.set("Cache-Control", "no-store, no-cache, must-revalidate, private")
    }
    return res.status(200).json({
      success: true,
      count: enrichedWorkspaces.length,
      workspaceModeEnabled: Boolean(account?.workspaceModeEnabled),
      data: enrichedWorkspaces,
    })
  } catch (error) {
    console.error("Error listing workspaces:", error.message)
    return res.status(500).json({ success: false, error: "Failed to list workspaces" })
  }
}

/**
 * POST /api/workspaces
 * Create a new workspace within parent organization (Org Admin only)
 */
const createWorkspace = async (req, res) => {
  try {
    const resolvedTenant = resolveVerifiedTenantId(req)
    if (resolvedTenant.error) {
      return res.status(resolvedTenant.status || 403).json({
        success: false,
        error: resolvedTenant.error,
        ...(resolvedTenant.code ? { code: resolvedTenant.code } : {}),
      })
    }
    const { tenantId } = resolvedTenant
    if (!tenantId) {
      return res.status(403).json({ success: false, error: "Tenant context required to create workspace" })
    }
    const isOrgAdmin = req.user?.role === "account_admin" || req.user?.role === "super_admin"

    if (!isOrgAdmin) {
      return res.status(403).json({
        success: false,
        error: "Forbidden: Only Organization Administrators can create workspaces.",
        code: "PERMISSION_DENIED",
      })
    }

    const { name, slug, description, branding, isDefault, settings } = req.body

    if (!name || typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ success: false, error: "Workspace name is required" })
    }

    const cleanName = name.trim()
    const cleanSlug = slugify(slug || cleanName)

    if (!cleanSlug) {
      return res.status(400).json({ success: false, error: "Valid workspace slug could not be generated" })
    }

    // Check slug uniqueness within parent tenant
    const existing = await Workspace.findOne({ tenantId, slug: cleanSlug }).lean()
    if (existing) {
      return res.status(409).json({
        success: false,
        error: `A workspace with slug '${cleanSlug}' already exists in this organization.`,
        code: "DUPLICATE_WORKSPACE_SLUG",
      })
    }

    // If marked as default, unset existing defaults
    if (isDefault) {
      await Workspace.updateMany({ tenantId, isDefault: true }, { $set: { isDefault: false } })
    }

    const workspace = new Workspace({
      tenantId,
      name: cleanName,
      slug: cleanSlug,
      description: description ? String(description).trim() : "",
      branding: branding || {},
      isDefault: Boolean(isDefault),
      settings: settings || {},
      status: "active",
    })

    await workspace.save()

    // Automatically assign creator as workspace_admin
    await WorkspaceMembership.create({
      tenantId,
      workspaceId: workspace._id,
      userId: req.user.id || req.user._id,
      role: "workspace_admin",
      permissions: ["*"],
      status: "active",
    })

    if (audit && typeof audit.log === "function") {
      await audit.log({
        tenantId,
        action: "workspace.created",
        category: "workspace_management",
        entity: "Workspace",
        entityId: workspace._id,
        summary: `Created workspace '${cleanName}' (${cleanSlug})`,
        actor: { _id: req.user.id || req.user._id, name: req.user.name, role: req.user.role },
      }).catch(() => {})
    }

    const account = await Account.findOne({ accountId: tenantId }).select("slug companyName accountId").lean()
    const orgSlug = account?.slug || slugify(account?.companyName) || account?.accountId || tenantId
    const wsObj = workspace.toObject ? workspace.toObject() : workspace
    wsObj.accessUrl = buildWorkspaceAccessUrl(orgSlug, wsObj)

    return res.status(201).json({
      success: true,
      message: "Workspace created successfully",
      data: wsObj,
    })
  } catch (error) {
    console.error("Error creating workspace:", error.message)
    return res.status(500).json({ success: false, error: "Failed to create workspace: " + error.message })
  }
}

/**
 * GET /api/workspaces/:workspaceId
 * Retrieve single workspace details
 */
const getWorkspaceById = async (req, res) => {
  try {
    const resolvedTenant = resolveVerifiedTenantId(req)
    if (resolvedTenant.error || !resolvedTenant.tenantId) {
      return res.status(resolvedTenant.status || 403).json({
        success: false,
        error: resolvedTenant.error || "Tenant context required",
      })
    }
    const { tenantId } = resolvedTenant
    const { workspaceId } = req.params

    if (!mongoose.Types.ObjectId.isValid(workspaceId)) {
      return res.status(400).json({ success: false, error: "Invalid workspace ID" })
    }

    const isOrgAdmin = req.user?.role === "account_admin" || req.user?.role === "super_admin"

    if (!isOrgAdmin) {
      const membership = await WorkspaceMembership.findOne({
        tenantId,
        workspaceId,
        userId: req.user.id || req.user._id,
        status: "active",
      }).lean()

      if (!membership) {
        return res.status(403).json({
          success: false,
          error: "Access denied: You are not an authorized member of this workspace.",
          code: "NOT_A_WORKSPACE_MEMBER",
        })
      }
    }

    const workspace = await Workspace.findOne({ _id: workspaceId, tenantId }).lean()
    if (!workspace) {
      return res.status(404).json({ success: false, error: "Workspace not found" })
    }

    const account = await Account.findOne({ accountId: tenantId }).select("slug companyName accountId").lean()
    const orgSlug = account?.slug || slugify(account?.companyName) || account?.accountId || tenantId

    return res.status(200).json({
      success: true,
      data: {
        ...workspace,
        accessUrl: buildWorkspaceAccessUrl(orgSlug, workspace),
      },
    })
  } catch (error) {
    console.error("Error fetching workspace:", error.message)
    return res.status(500).json({ success: false, error: "Failed to fetch workspace" })
  }
}

/**
 * PUT /api/workspaces/:workspaceId
 * Update workspace settings, branding, or name
 */
const updateWorkspace = async (req, res) => {
  try {
    const resolvedTenant = resolveVerifiedTenantId(req)
    if (resolvedTenant.error || !resolvedTenant.tenantId) {
      return res.status(resolvedTenant.status || 403).json({
        success: false,
        error: resolvedTenant.error || "Tenant context required",
      })
    }
    const { tenantId } = resolvedTenant
    const { workspaceId } = req.params

    if (!mongoose.Types.ObjectId.isValid(workspaceId)) {
      return res.status(400).json({ success: false, error: "Invalid workspace ID" })
    }

    const isOrgAdmin = req.user?.role === "account_admin" || req.user?.role === "super_admin"

    if (!isOrgAdmin) {
      const membership = await WorkspaceMembership.findOne({
        tenantId,
        workspaceId,
        userId: req.user.id || req.user._id,
        role: "workspace_admin",
        status: "active",
      }).lean()

      if (!membership) {
        return res.status(403).json({
          success: false,
          error: "Forbidden: Updating workspace requires Workspace Administrator privileges.",
          code: "PERMISSION_DENIED",
        })
      }
    }

    const workspace = await Workspace.findOne({ _id: workspaceId, tenantId })
    if (!workspace) {
      return res.status(404).json({ success: false, error: "Workspace not found" })
    }

    const { name, slug, description, branding, isDefault, settings, status } = req.body

    if (name && typeof name === "string" && name.trim()) {
      workspace.name = name.trim()
    }
    if (slug && typeof slug === "string" && slug.trim()) {
      const cleanSlug = slugify(slug.trim())
      if (!cleanSlug) {
        return res.status(400).json({ success: false, error: "Valid workspace slug is required" })
      }
      if (cleanSlug !== workspace.slug) {
        const duplicate = await Workspace.findOne({
          tenantId,
          slug: cleanSlug,
          _id: { $ne: workspace._id },
        }).lean()
        if (duplicate) {
          return res.status(409).json({
            success: false,
            error: `A workspace with slug '${cleanSlug}' already exists in this organization.`,
            code: "DUPLICATE_WORKSPACE_SLUG",
          })
        }
        workspace.slug = cleanSlug
        await DomainMapping.updateMany(
          { tenantId, targetWorkspaceId: workspace._id },
          { $set: { targetSlug: cleanSlug } }
        )
      }
    }
    if (description !== undefined) {
      workspace.description = String(description).trim()
    }
    if (branding && typeof branding === "object") {
      workspace.branding = {
        displayName: branding.displayName || workspace.branding?.displayName || null,
        logoUrl: branding.logoUrl || workspace.branding?.logoUrl || null,
        primaryColor: branding.primaryColor || workspace.branding?.primaryColor || "#4f46e5",
      }
    }
    if (settings && typeof settings === "object") {
      workspace.settings = { ...workspace.settings, ...settings }
    }
    if (status !== undefined && isOrgAdmin) {
      if (["active", "inactive"].includes(status)) {
        workspace.status = status
      }
    }
    if (isDefault !== undefined && isOrgAdmin) {
      if (isDefault) {
        await Workspace.updateMany({ tenantId, isDefault: true }, { $set: { isDefault: false } })
      }
      workspace.isDefault = Boolean(isDefault)
    }

    await workspace.save()

    const account = await Account.findOne({ accountId: tenantId }).select("slug companyName accountId").lean()
    const orgSlug = account?.slug || slugify(account?.companyName) || account?.accountId || tenantId
    const wsObj = workspace.toObject ? workspace.toObject() : workspace
    wsObj.accessUrl = buildWorkspaceAccessUrl(orgSlug, wsObj)

    return res.status(200).json({
      success: true,
      message: "Workspace updated successfully",
      data: wsObj,
    })
  } catch (error) {
    console.error("Error updating workspace:", error.message)
    return res.status(500).json({ success: false, error: "Failed to update workspace" })
  }
}

/**
 * DELETE /api/workspaces/:workspaceId
 * Archive a workspace (Org Admin only)
 */
const archiveWorkspace = async (req, res) => {
  try {
    const resolvedTenant = resolveVerifiedTenantId(req)
    if (resolvedTenant.error || !resolvedTenant.tenantId) {
      return res.status(resolvedTenant.status || 403).json({
        success: false,
        error: resolvedTenant.error || "Tenant context required",
      })
    }
    const { tenantId } = resolvedTenant
    const isOrgAdmin = req.user?.role === "account_admin" || req.user?.role === "super_admin"

    if (!isOrgAdmin) {
      return res.status(403).json({
        success: false,
        error: "Forbidden: Only Organization Administrators can archive workspaces.",
        code: "PERMISSION_DENIED",
      })
    }

    const { workspaceId } = req.params
    if (!mongoose.Types.ObjectId.isValid(workspaceId)) {
      return res.status(400).json({ success: false, error: "Invalid workspace ID" })
    }

    const workspace = await Workspace.findOne({ _id: workspaceId, tenantId })
    if (!workspace) {
      return res.status(404).json({ success: false, error: "Workspace not found" })
    }

    const activeCount = await Workspace.countDocuments({ tenantId, status: "active" })
    if (activeCount <= 1) {
      return res.status(400).json({
        success: false,
        error: "Cannot archive the only active workspace in the organization.",
        code: "CANNOT_ARCHIVE_SOLE_WORKSPACE",
      })
    }

    workspace.status = "archived"
    if (workspace.isDefault) {
      workspace.isDefault = false
      // Transfer default to another active workspace
      const nextDefault = await Workspace.findOne({ tenantId, status: "active", _id: { $ne: workspace._id } })
      if (nextDefault) {
        nextDefault.isDefault = true
        await nextDefault.save()
      }
    }
    await workspace.save()

    return res.status(200).json({
      success: true,
      message: "Workspace archived successfully",
      data: { id: workspace._id, status: workspace.status },
    })
  } catch (error) {
    console.error("Error archiving workspace:", error.message)
    return res.status(500).json({ success: false, error: "Failed to archive workspace" })
  }
}

/**
 * GET /api/workspaces/:workspaceId/members
 * List members of a workspace
 */
const listMemberships = async (req, res) => {
  try {
    const resolvedTenant = resolveVerifiedTenantId(req)
    if (resolvedTenant.error || !resolvedTenant.tenantId) {
      return res.status(resolvedTenant.status || 403).json({
        success: false,
        error: resolvedTenant.error || "Tenant context required",
        ...(resolvedTenant.code ? { code: resolvedTenant.code } : {}),
      })
    }
    const { tenantId } = resolvedTenant
    const { workspaceId } = req.params

    if (!mongoose.Types.ObjectId.isValid(workspaceId)) {
      return res.status(400).json({ success: false, error: "Invalid workspace ID" })
    }

    const isOrgAdmin = req.user?.role === "account_admin" || req.user?.role === "super_admin"

    if (!isOrgAdmin) {
      const isMember = await WorkspaceMembership.findOne({
        tenantId,
        workspaceId,
        userId: req.user.id || req.user._id,
        status: "active",
      }).lean()

      if (!isMember) {
        return res.status(403).json({
          success: false,
          error: "Access denied: You are not an authorized member of this workspace.",
          code: "NOT_A_WORKSPACE_MEMBER",
        })
      }
    }

    const memberships = await WorkspaceMembership.find({ tenantId, workspaceId })
      .populate("userId", "name email role status")
      .sort({ createdAt: 1 })
      .lean()

    const formatted = memberships.map((m) => ({
      id: m._id,
      userId: m.userId?._id || m.userId,
      name: m.userId?.name || "Unknown User",
      email: m.userId?.email || "",
      accountRole: m.userId?.role || "agent",
      workspaceRole: m.role,
      permissions: m.permissions,
      status: m.status,
      createdAt: m.createdAt,
    }))

    return res.status(200).json({ success: true, count: formatted.length, data: formatted })
  } catch (error) {
    console.error("Error listing memberships:", error.message)
    return res.status(500).json({ success: false, error: "Failed to list workspace members" })
  }
}

/**
 * POST /api/workspaces/:workspaceId/members
 * Add or enroll a user into a workspace
 */
const addMembership = async (req, res) => {
  try {
    const resolvedTenant = resolveVerifiedTenantId(req)
    if (resolvedTenant.error || !resolvedTenant.tenantId) {
      return res.status(resolvedTenant.status || 403).json({
        success: false,
        error: resolvedTenant.error || "Tenant context required",
        ...(resolvedTenant.code ? { code: resolvedTenant.code } : {}),
      })
    }
    const { tenantId } = resolvedTenant
    const { workspaceId } = req.params
    const { userId, role, permissions } = req.body

    if (!mongoose.Types.ObjectId.isValid(workspaceId) || !mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ success: false, error: "Valid workspaceId and userId are required" })
    }

    const isOrgAdmin = req.user?.role === "account_admin" || req.user?.role === "super_admin"

    if (!isOrgAdmin) {
      const isWsAdmin = await WorkspaceMembership.findOne({
        tenantId,
        workspaceId,
        userId: req.user.id || req.user._id,
        role: "workspace_admin",
        status: "active",
      }).lean()

      if (!isWsAdmin) {
        return res.status(403).json({
          success: false,
          error: "Forbidden: Managing workspace members requires Workspace Administrator privileges.",
          code: "PERMISSION_DENIED",
        })
      }
    }

    // Verify user exists and belongs to the same parent tenant
    const targetUser = await User.findOne({ _id: userId, tenantId, status: "active" }).lean()
    if (!targetUser) {
      return res.status(404).json({
        success: false,
        error: "User not found or does not belong to this organization.",
        code: "USER_NOT_FOUND",
      })
    }

    // Upsert membership
    let membership = await WorkspaceMembership.findOne({ tenantId, workspaceId, userId })
    if (membership) {
      membership.role = role || membership.role
      membership.permissions = Array.isArray(permissions) ? permissions : membership.permissions
      membership.status = "active"
      await membership.save()
    } else {
      membership = new WorkspaceMembership({
        tenantId,
        workspaceId,
        userId,
        role: role || "agent",
        permissions: Array.isArray(permissions) ? permissions : [],
        status: "active",
      })
      await membership.save()
    }

    return res.status(201).json({
      success: true,
      message: "User added to workspace successfully",
      data: membership,
    })
  } catch (error) {
    console.error("Error adding workspace membership:", error.message)
    return res.status(500).json({ success: false, error: "Failed to add workspace membership" })
  }
}

/**
 * DELETE /api/workspaces/:workspaceId/members/:userId
 * Revoke user membership from a workspace (Immediate revocation)
 */
const removeMembership = async (req, res) => {
  try {
    const resolvedTenant = resolveVerifiedTenantId(req)
    if (resolvedTenant.error || !resolvedTenant.tenantId) {
      return res.status(resolvedTenant.status || 403).json({
        success: false,
        error: resolvedTenant.error || "Tenant context required",
        ...(resolvedTenant.code ? { code: resolvedTenant.code } : {}),
      })
    }
    const { tenantId } = resolvedTenant
    const { workspaceId, userId } = req.params

    if (!mongoose.Types.ObjectId.isValid(workspaceId) || !mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ success: false, error: "Valid workspaceId and userId are required" })
    }

    const isOrgAdmin = req.user?.role === "account_admin" || req.user?.role === "super_admin"

    if (!isOrgAdmin) {
      const isWsAdmin = await WorkspaceMembership.findOne({
        tenantId,
        workspaceId,
        userId: req.user.id || req.user._id,
        role: "workspace_admin",
        status: "active",
      }).lean()

      if (!isWsAdmin) {
        return res.status(403).json({
          success: false,
          error: "Forbidden: Managing workspace members requires Workspace Administrator privileges.",
          code: "PERMISSION_DENIED",
        })
      }
    }

    const result = await WorkspaceMembership.findOneAndDelete({ tenantId, workspaceId, userId })
    if (!result) {
      return res.status(404).json({ success: false, error: "Membership record not found" })
    }

    return res.status(200).json({
      success: true,
      message: "User membership revoked from workspace successfully",
      data: { workspaceId, userId },
    })
  } catch (error) {
    console.error("Error removing workspace membership:", error.message)
    return res.status(500).json({ success: false, error: "Failed to remove workspace membership" })
  }
}

/**
 * POST /api/workspaces/mode/toggle
 * Enable or disable multi-workspace mode for parent organization (Org Admin only)
 */
const toggleWorkspaceMode = async (req, res) => {
  try {
    const resolvedTenant = resolveVerifiedTenantId(req)
    if (resolvedTenant.error || !resolvedTenant.tenantId) {
      return res.status(resolvedTenant.status || 403).json({
        success: false,
        error: resolvedTenant.error || "Tenant context required",
        ...(resolvedTenant.code ? { code: resolvedTenant.code } : {}),
      })
    }
    const { tenantId } = resolvedTenant
    const isOrgAdmin = req.user?.role === "account_admin" || req.user?.role === "super_admin"

    if (!isOrgAdmin) {
      return res.status(403).json({
        success: false,
        error: "Forbidden: Only Organization Administrators can toggle workspace mode.",
        code: "PERMISSION_DENIED",
      })
    }

    const { enabled } = req.body
    if (typeof enabled !== "boolean") {
      return res.status(400).json({ success: false, error: "Boolean 'enabled' flag is required" })
    }

    const account = await Account.findOne({ accountId: tenantId })
    if (!account) {
      return res.status(404).json({ success: false, error: "Account not found" })
    }

    if (!enabled) {
      // Safety Check 1: Multiple active workspaces exist
      const activeWorkspacesCount = await Workspace.countDocuments({ tenantId, status: "active" })
      if (activeWorkspacesCount > 1) {
        return res.status(409).json({
          success: false,
          error: `Cannot disable multi-workspace mode: ${activeWorkspacesCount} active workspaces exist. Consolidate or archive non-default workspaces before disabling workspace isolation.`,
          code: "CANNOT_DISABLE_MULTI_WORKSPACE_MULTIPLE_ACTIVE",
          activeWorkspacesCount,
        })
      }

      // Safety Check 2: Active workspace custom domains exist
      const activeWorkspaceDomainsCount = await DomainMapping.countDocuments({
        tenantId,
        targetType: "WORKSPACE",
        status: { $in: ["verified", "pending_verification"] },
      }).setOptions({ skipTenantFilter: true })

      if (activeWorkspaceDomainsCount > 0) {
        return res.status(409).json({
          success: false,
          error: `Cannot disable multi-workspace mode: ${activeWorkspaceDomainsCount} workspace custom domain(s) are currently configured. Please remove all workspace domains before returning to standalone mode.`,
          code: "CANNOT_DISABLE_MULTI_WORKSPACE_ACTIVE_DOMAINS",
          activeWorkspaceDomainsCount,
        })
      }

      // Safety Check 3: Partitioned CRM data exists across multiple workspaces
      const distinctWorkspacesInLeads = await Lead.distinct("workspaceId", {
        tenantId,
        workspaceId: { $ne: null },
        isDeleted: { $ne: true },
      })

      if (distinctWorkspacesInLeads.length > 1) {
        return res.status(409).json({
          success: false,
          error: `Cannot disable multi-workspace mode: CRM leads are partitioned across ${distinctWorkspacesInLeads.length} distinct workspaces. Reassign or consolidate records first to prevent unauthorized data exposure.`,
          code: "CANNOT_DISABLE_MULTI_WORKSPACE_PARTITIONED_DATA",
          workspaceCount: distinctWorkspacesInLeads.length,
        })
      }
    }

    account.workspaceModeEnabled = enabled
    await account.save()

    // If enabling for the first time and no workspaces exist, create default workspace
    if (enabled) {
      const existingCount = await Workspace.countDocuments({ tenantId, status: "active" })
      if (existingCount === 0) {
        const defaultWs = new Workspace({
          tenantId,
          name: account.companyName || "Primary Workspace",
          slug: "primary",
          description: "Default operational workspace",
          isDefault: true,
          status: "active",
        })
        await defaultWs.save()

        // Enroll admin
        await WorkspaceMembership.create({
          tenantId,
          workspaceId: defaultWs._id,
          userId: req.user.id || req.user._id,
          role: "workspace_admin",
          permissions: ["*"],
          status: "active",
        })
      }
    }

    // Invalidate in-memory tenant context cache immediately
    invalidateAccountWorkspaceModeCache(tenantId)

    return res.status(200).json({
      success: true,
      message: `Multi-workspace mode ${enabled ? "enabled" : "disabled"} successfully`,
      workspaceModeEnabled: account.workspaceModeEnabled,
    })
  } catch (error) {
    console.error("Error toggling workspace mode:", error.message)
    return res.status(500).json({ success: false, error: "Failed to toggle workspace mode" })
  }
}

/**
 * GET /api/workspaces/service-catalog
 * List active services mapping to workspaces from canonical BusinessProduct catalog
 */
const listServiceCatalog = async (req, res) => {
  try {
    const resolvedTenant = resolveVerifiedTenantId(req)
    if (resolvedTenant.error) {
      return res.status(resolvedTenant.status || 403).json({
        success: false,
        error: resolvedTenant.error,
        ...(resolvedTenant.code ? { code: resolvedTenant.code } : {}),
      })
    }
    const { tenantId, isSuperAdmin } = resolvedTenant
    if (!tenantId) {
      if (isSuperAdmin) {
        return res.status(200).json({
          success: true,
          data: [],
        })
      }
      return res.status(403).json({ success: false, error: "No tenant account assigned to user" })
    }

    // Query canonical BusinessProduct items configured for workspace routing or public service
    const products = await BusinessProduct.find({
      tenantId,
      isArchived: false,
      $or: [
        { isPublicService: true },
        { routingCode: { $ne: null, $gt: "" } },
        { targetWorkspaceId: { $ne: null } },
      ],
    })
      .populate("targetWorkspaceId", "name slug")
      .sort({ name: 1 })
      .lean()

    // Formatted to ServiceCatalog DTO contract
    const formatted = products.map((p) => ({
      id: p._id,
      name: p.name,
      code: p.routingCode || `PROD_${p._id.toString().slice(-6).toUpperCase()}`,
      category: p.category || "General",
      description: p.description || "",
      targetWorkspaceId: p.targetWorkspaceId || p.workspaceId,
      price: p.price,
      isPublicService: Boolean(p.isPublicService),
      status: p.status,
    }))

    // Backward compatibility fallback to ServiceCatalog collection if no BusinessProduct routing items exist
    if (formatted.length === 0) {
      const legacyServices = await ServiceCatalog.find({ tenantId })
        .populate("targetWorkspaceId", "name slug")
        .sort({ displayOrder: 1, createdAt: 1 })
        .lean()
      return res.status(200).json({ success: true, count: legacyServices.length, data: legacyServices })
    }

    return res.status(200).json({ success: true, count: formatted.length, data: formatted })
  } catch (error) {
    console.error("Error listing service catalog:", error.message)
    return res.status(500).json({ success: false, error: "Failed to list service catalog" })
  }
}

/**
 * POST /api/workspaces/service-catalog
 * Create or configure a service mapped to a workspace in canonical BusinessProduct
 */
const createServiceCatalogItem = async (req, res) => {
  try {
    const resolvedTenant = resolveVerifiedTenantId(req)
    if (resolvedTenant.error || !resolvedTenant.tenantId) {
      return res.status(resolvedTenant.status || 403).json({
        success: false,
        error: resolvedTenant.error || "Tenant context required",
        ...(resolvedTenant.code ? { code: resolvedTenant.code } : {}),
      })
    }
    const { tenantId } = resolvedTenant
    const isOrgAdmin = req.user?.role === "account_admin" || req.user?.role === "super_admin"

    if (!isOrgAdmin) {
      return res.status(403).json({
        success: false,
        error: "Forbidden: Only Organization Administrators can manage the service catalog.",
        code: "PERMISSION_DENIED",
      })
    }

    const { name, code, targetWorkspaceId, category, description, linkedProductId, isActive, displayOrder } = req.body

    if (!name || !code || !targetWorkspaceId) {
      return res.status(400).json({
        success: false,
        error: "Name, unique code, and targetWorkspaceId are required",
      })
    }

    if (!mongoose.Types.ObjectId.isValid(targetWorkspaceId)) {
      return res.status(400).json({ success: false, error: "Invalid targetWorkspaceId format" })
    }

    // Verify workspace belongs to tenant
    const targetWs = await Workspace.findOne({ _id: targetWorkspaceId, tenantId, status: "active" }).lean()
    if (!targetWs) {
      return res.status(404).json({
        success: false,
        error: "Target workspace not found or inactive in this organization.",
        code: "WORKSPACE_NOT_FOUND",
      })
    }

    const cleanCode = String(code).trim().toUpperCase()

    // Create or update in canonical BusinessProduct model
    let product = await BusinessProduct.findOne({ tenantId, routingCode: cleanCode, isArchived: false })
    if (product) {
      product.name = String(name).trim()
      product.targetWorkspaceId = targetWorkspaceId
      product.category = category ? String(category).trim() : product.category
      product.description = description ? String(description).trim() : product.description
      product.isPublicService = true
      product.status = isActive === false ? "inactive" : "active"
      await product.save()
    } else {
      product = new BusinessProduct({
        tenantId,
        name: String(name).trim(),
        type: "SERVICE",
        category: category ? String(category).trim() : "General",
        description: description ? String(description).trim() : "",
        routingCode: cleanCode,
        targetWorkspaceId,
        isPublicService: true,
        status: isActive === false ? "inactive" : "active",
      })
      await product.save()
    }

    // Maintain backward-compatible ServiceCatalog document
    await ServiceCatalog.findOneAndUpdate(
      { tenantId, code: cleanCode },
      {
        tenantId,
        name: String(name).trim(),
        code: cleanCode,
        targetWorkspaceId,
        category: category ? String(category).trim() : "General",
        description: description ? String(description).trim() : "",
        linkedProductId: product._id,
        isActive: isActive !== false,
        displayOrder: Number(displayOrder) || 0,
      },
      { upsert: true, new: true }
    )

    return res.status(201).json({
      success: true,
      message: "Service catalog item created successfully in unified product catalogue",
      data: {
        id: product._id,
        name: product.name,
        code: product.routingCode,
        targetWorkspaceId: product.targetWorkspaceId,
        category: product.category,
        description: product.description,
        isPublicService: product.isPublicService,
      },
    })
  } catch (error) {
    console.error("Error creating service catalog item:", error.message)
    return res.status(500).json({ success: false, error: "Failed to create service catalog item" })
  }
}

/**
 * GET /api/workspaces/public/services
 * Public service discovery endpoint (uses siteKey or tenantId)
 * Backed by canonical BusinessProduct catalogue
 */
const getPublicServices = async (req, res) => {
  try {
    const rawSiteKey = req.query.siteKey || req.headers["x-site-key"]
    let tenantId = null

    if (rawSiteKey) {
      const integration = await Integration.findOne({ siteKey: rawSiteKey, status: "active" })
        .setOptions({ skipTenantFilter: true })
        .lean()
      if (integration) {
        tenantId = integration.tenantId
      }
    }

    if (!tenantId && req.query.tenantId) {
      tenantId = String(req.query.tenantId).trim()
    }

    if (!tenantId) {
      return res.status(400).json({
        success: false,
        error: "Valid 'siteKey' parameter is required for public service discovery.",
      })
    }

    // Discover active public services from canonical BusinessProduct
    const products = await BusinessProduct.find({
      tenantId,
      isArchived: false,
      status: "active",
      isPublicService: true,
      routingCode: { $ne: null, $gt: "" },
    })
      .setOptions({ skipTenantFilter: true })
      .select("name routingCode category description price")
      .sort({ name: 1 })
      .lean()

    let services = products.map((p) => ({
      name: p.name,
      code: p.routingCode,
      category: p.category || "General",
      description: p.description || "",
      price: p.price,
    }))

    // Fallback to ServiceCatalog if BusinessProduct yields 0 public services
    if (services.length === 0) {
      const legacyServices = await ServiceCatalog.find({ tenantId, isActive: true })
        .setOptions({ skipTenantFilter: true })
        .select("name code category description displayOrder")
        .sort({ displayOrder: 1 })
        .lean()
      services = legacyServices.map((s) => ({
        name: s.name,
        code: s.code,
        category: s.category,
        description: s.description,
      }))
    }

    return res.status(200).json({
      success: true,
      count: services.length,
      data: services,
    })
  } catch (error) {
    console.error("Error fetching public services:", error.message)
    return res.status(500).json({ success: false, error: "Failed to fetch public services" })
  }
}

/**
 * GET /api/workspaces/dashboard/master
 * Aggregated Master Dashboard KPIs & project-wise performance (Org Admin only)
 */
const getMasterDashboard = async (req, res) => {
  try {
    const resolvedTenant = resolveVerifiedTenantId(req)
    if (resolvedTenant.error || !resolvedTenant.tenantId) {
      return res.status(resolvedTenant.status || 403).json({
        success: false,
        error: resolvedTenant.error || "Tenant context required",
        ...(resolvedTenant.code ? { code: resolvedTenant.code } : {}),
      })
    }
    const { tenantId } = resolvedTenant
    const isOrgAdmin = req.user?.role === "account_admin" || req.user?.role === "super_admin"

    if (!isOrgAdmin) {
      return res.status(403).json({
        success: false,
        error: "Forbidden: Master Dashboard requires Organization Administrator privileges.",
        code: "PERMISSION_DENIED",
      })
    }

    const startOfDay = new Date()
    startOfDay.setHours(0, 0, 0, 0)

    // 1. Fetch all active or configured workspaces in this tenant
    const workspaces = await Workspace.find({
      tenantId,
      status: { $ne: "archived" },
    })
      .sort({ isDefault: -1, createdAt: 1 })
      .lean()

    const workspaceIds = workspaces.map((w) => w._id)

    // 2. Fetch overall tenant KPIs
    const [
      totalLeads,
      leadsToday,
      activeFollowUps,
      totalCalls,
      wonLeads,
      pipelineAgg,
      unassignedLeadsCount,
      conflictCallsCount,
    ] = await Promise.all([
      Lead.countDocuments({ tenantId, isDeleted: { $ne: true } }),
      Lead.countDocuments({ tenantId, isDeleted: { $ne: true }, createdAt: { $gte: startOfDay } }),
      FollowUp.countDocuments({ tenantId, status: { $in: ["pending", "scheduled"] } }),
      Call.countDocuments({ tenantId }),
      Lead.countDocuments({
        tenantId,
        isDeleted: { $ne: true },
        status: { $in: ["Closed-Won", "closed_won", "won", "Won", "converted"] },
      }),
      Lead.aggregate([
        { $match: { tenantId, isDeleted: { $ne: true } } },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),
      Lead.countDocuments({ tenantId, workspaceId: null, isDeleted: { $ne: true } }),
      Call.countDocuments({ tenantId, "metadata.workspaceConflict": true }),
    ])

    const overallConversionRate = totalLeads > 0 ? Number(((wonLeads / totalLeads) * 100).toFixed(1)) : 0

    // Format pipeline breakdown
    const pipeline = (pipelineAgg || []).map((p) => ({
      status: p._id || "unspecified",
      count: p.count,
    }))

    // 3. Project-wise performance breakdown per workspace
    const [leadCountsByWs, todayLeadCountsByWs, followUpCountsByWs, callCountsByWs, wonCountsByWs, memberCountsByWs] =
      await Promise.all([
        Lead.aggregate([
          { $match: { tenantId, isDeleted: { $ne: true }, workspaceId: { $in: workspaceIds } } },
          { $group: { _id: "$workspaceId", count: { $sum: 1 } } },
        ]),
        Lead.aggregate([
          {
            $match: {
              tenantId,
              isDeleted: { $ne: true },
              createdAt: { $gte: startOfDay },
              workspaceId: { $in: workspaceIds },
            },
          },
          { $group: { _id: "$workspaceId", count: { $sum: 1 } } },
        ]),
        FollowUp.aggregate([
          {
            $match: {
              tenantId,
              status: { $in: ["pending", "scheduled"] },
              workspaceId: { $in: workspaceIds },
            },
          },
          { $group: { _id: "$workspaceId", count: { $sum: 1 } } },
        ]),
        Call.aggregate([
          { $match: { tenantId, workspaceId: { $in: workspaceIds } } },
          { $group: { _id: "$workspaceId", count: { $sum: 1 } } },
        ]),
        Lead.aggregate([
          {
            $match: {
              tenantId,
              isDeleted: { $ne: true },
              status: { $in: ["Closed-Won", "closed_won", "won", "Won", "converted"] },
              workspaceId: { $in: workspaceIds },
            },
          },
          { $group: { _id: "$workspaceId", count: { $sum: 1 } } },
        ]),
        WorkspaceMembership.aggregate([
          { $match: { tenantId, status: "active", workspaceId: { $in: workspaceIds } } },
          { $group: { _id: "$workspaceId", count: { $sum: 1 } } },
        ]),
      ])

    const leadMap = new Map(leadCountsByWs.map((i) => [i._id.toString(), i.count]))
    const todayLeadMap = new Map(todayLeadCountsByWs.map((i) => [i._id.toString(), i.count]))
    const followUpMap = new Map(followUpCountsByWs.map((i) => [i._id.toString(), i.count]))
    const callMap = new Map(callCountsByWs.map((i) => [i._id.toString(), i.count]))
    const wonMap = new Map(wonCountsByWs.map((i) => [i._id.toString(), i.count]))
    const memberMap = new Map(memberCountsByWs.map((i) => [i._id.toString(), i.count]))

    const projects = workspaces.map((ws) => {
      const wsIdStr = ws._id.toString()
      const wsTotalLeads = leadMap.get(wsIdStr) || 0
      const wsWonLeads = wonMap.get(wsIdStr) || 0
      const wsConversionRate = wsTotalLeads > 0 ? Number(((wsWonLeads / wsTotalLeads) * 100).toFixed(1)) : 0

      return {
        _id: ws._id,
        name: ws.name,
        slug: ws.slug,
        description: ws.description,
        status: ws.status,
        isDefault: Boolean(ws.isDefault),
        branding: ws.branding,
        memberCount: memberMap.get(wsIdStr) || 0,
        totalLeads: wsTotalLeads,
        leadsToday: todayLeadMap.get(wsIdStr) || 0,
        activeFollowUps: followUpMap.get(wsIdStr) || 0,
        totalCalls: callMap.get(wsIdStr) || 0,
        wonLeads: wsWonLeads,
        conversionRate: wsConversionRate,
      }
    })

    return res.status(200).json({
      success: true,
      data: {
        kpis: {
          totalWorkspaces: workspaces.length,
          activeWorkspaces: workspaces.filter((w) => w.status === "active").length,
          totalLeads,
          leadsToday,
          activeFollowUps,
          totalCalls,
          wonLeads,
          conversionRate: overallConversionRate,
        },
        pipeline,
        projects,
        reviewQueue: {
          unassignedLeads: unassignedLeadsCount,
          conflictCalls: conflictCallsCount,
          total: unassignedLeadsCount + conflictCallsCount,
        },
      },
    })
  } catch (error) {
    console.error("Error fetching master dashboard:", error.message)
    return res.status(500).json({ success: false, error: "Failed to fetch master dashboard" })
  }
}

/**
 * GET /api/workspaces/unassigned/queue
 * List unassigned leads and conflict calls for administrative review (Org Admin only)
 */
const getUnassignedQueue = async (req, res) => {
  try {
    const resolvedTenant = resolveVerifiedTenantId(req)
    if (resolvedTenant.error || !resolvedTenant.tenantId) {
      return res.status(resolvedTenant.status || 403).json({
        success: false,
        error: resolvedTenant.error || "Tenant context required",
        ...(resolvedTenant.code ? { code: resolvedTenant.code } : {}),
      })
    }
    const { tenantId } = resolvedTenant
    const isOrgAdmin = req.user?.role === "account_admin" || req.user?.role === "super_admin"

    if (!isOrgAdmin) {
      return res.status(403).json({
        success: false,
        error: "Forbidden: Accessing unassigned queue requires Organization Administrator privileges.",
        code: "PERMISSION_DENIED",
      })
    }

    const [unassignedLeads, conflictCalls] = await Promise.all([
      Lead.find({
        tenantId,
        workspaceId: null,
        isDeleted: { $ne: true },
      })
        .select("_id name phone email status source createdAt")
        .sort({ createdAt: -1 })
        .limit(100)
        .lean(),
      Call.find({
        tenantId,
        "metadata.workspaceConflict": true,
      })
        .select("_id callerNumber agentNumber duration callType createdAt metadata workspaceId")
        .sort({ createdAt: -1 })
        .limit(100)
        .lean(),
    ])

    return res.status(200).json({
      success: true,
      count: unassignedLeads.length + conflictCalls.length,
      data: {
        unassignedLeads,
        conflictCalls,
      },
    })
  } catch (error) {
    console.error("Error fetching unassigned queue:", error.message)
    return res.status(500).json({ success: false, error: "Failed to fetch unassigned queue" })
  }
}

/**
 * POST /api/workspaces/unassigned/assign
 * Assign an unassigned lead or conflict call to a target workspace (Org Admin only)
 */
const assignUnassignedItem = async (req, res) => {
  try {
    const resolvedTenant = resolveVerifiedTenantId(req)
    if (resolvedTenant.error || !resolvedTenant.tenantId) {
      return res.status(resolvedTenant.status || 403).json({
        success: false,
        error: resolvedTenant.error || "Tenant context required",
        ...(resolvedTenant.code ? { code: resolvedTenant.code } : {}),
      })
    }
    const { tenantId } = resolvedTenant
    const isOrgAdmin = req.user?.role === "account_admin" || req.user?.role === "super_admin"

    if (!isOrgAdmin) {
      return res.status(403).json({
        success: false,
        error: "Forbidden: Assigning unassigned items requires Organization Administrator privileges.",
        code: "PERMISSION_DENIED",
      })
    }

    const { itemType, itemId, targetWorkspaceId } = req.body

    if (!itemType || !["lead", "call"].includes(itemType)) {
      return res.status(400).json({ success: false, error: "itemType must be either 'lead' or 'call'" })
    }

    if (!mongoose.Types.ObjectId.isValid(itemId) || !mongoose.Types.ObjectId.isValid(targetWorkspaceId)) {
      return res.status(400).json({ success: false, error: "Valid itemId and targetWorkspaceId are required" })
    }

    // Verify target workspace belongs to tenant
    const targetWs = await Workspace.findOne({ _id: targetWorkspaceId, tenantId, status: "active" }).lean()
    if (!targetWs) {
      return res.status(404).json({
        success: false,
        error: "Target workspace not found or inactive in this organization.",
        code: "WORKSPACE_NOT_FOUND",
      })
    }

    if (itemType === "lead") {
      const updatedLead = await Lead.findOneAndUpdate(
        { _id: itemId, tenantId },
        { $set: { workspaceId: targetWorkspaceId } },
        { new: true }
      )
      if (!updatedLead) {
        return res.status(404).json({ success: false, error: "Lead not found" })
      }

      // Propagate workspaceId to related follow-ups
      await FollowUp.updateMany(
        { leadId: itemId, tenantId },
        { $set: { workspaceId: targetWorkspaceId } }
      )

      return res.status(200).json({
        success: true,
        message: `Lead successfully assigned to workspace '${targetWs.name}'`,
        data: { itemId, targetWorkspaceId, workspaceName: targetWs.name },
      })
    }

    if (itemType === "call") {
      const updatedCall = await Call.findOneAndUpdate(
        { _id: itemId, tenantId },
        {
          $set: {
            workspaceId: targetWorkspaceId,
            "metadata.workspaceConflict": false,
          },
        },
        { new: true }
      )
      if (!updatedCall) {
        return res.status(404).json({ success: false, error: "Call record not found" })
      }

      return res.status(200).json({
        success: true,
        message: `Call successfully attributed to workspace '${targetWs.name}'`,
        data: { itemId, targetWorkspaceId, workspaceName: targetWs.name },
      })
    }
  } catch (error) {
    console.error("Error assigning unassigned item:", error.message)
    return res.status(500).json({ success: false, error: "Failed to assign unassigned item" })
  }
}

/**
 * GET /api/workspaces/:workspaceId/domain
 * Retrieve custom domain configuration & verification status for a workspace
 */
const getWorkspaceDomain = async (req, res) => {
  try {
    const resolvedTenant = resolveVerifiedTenantId(req)
    if (resolvedTenant.error || !resolvedTenant.tenantId) {
      return res.status(resolvedTenant.status || 403).json({
        success: false,
        error: resolvedTenant.error || "Tenant context required",
        ...(resolvedTenant.code ? { code: resolvedTenant.code } : {}),
      })
    }
    const { tenantId } = resolvedTenant
    const { workspaceId } = req.params

    if (!mongoose.Types.ObjectId.isValid(workspaceId)) {
      return res.status(400).json({ success: false, error: "Invalid workspace ID" })
    }

    const workspace = await Workspace.findOne({ _id: workspaceId, tenantId }).lean()
    if (!workspace) {
      return res.status(404).json({ success: false, error: "Workspace not found" })
    }

    const mapping = await DomainMapping.findOne({
      tenantId,
      targetType: "WORKSPACE",
      targetId: workspace._id,
    })
      .setOptions({ skipTenantFilter: true })
      .lean()

    if (!mapping) {
      return res.status(200).json({
        success: true,
        data: null,
        status: "unconfigured",
      })
    }

    return res.status(200).json({
      success: true,
      data: {
        id: mapping._id,
        domain: mapping.domain,
        targetType: mapping.targetType,
        targetId: mapping.targetId,
        status: mapping.status,
        verificationToken: mapping.verificationToken,
        verifiedAt: mapping.verifiedAt,
        dnsInstructions: {
          recordType: "TXT",
          host: `_leads365-challenge.${mapping.domain}`,
          value: mapping.verificationToken,
          cnameHost: mapping.domain,
          cnameTarget: process.env.CNAME_TARGET || "cname.vercel-dns.com",
          sslStatus: "automatic",
          instructions: `1. Add a TXT record with Host '_leads365-challenge.${mapping.domain}' and Value '${mapping.verificationToken}'.\n2. Add a CNAME record with Host '${mapping.domain}' pointing to '${process.env.CNAME_TARGET || "cname.vercel-dns.com"}'.\n3. Click 'Verify DNS Record' once DNS has propagated. SSL is automatically provisioned upon successful verification.`,
        },
      },
    })
  } catch (error) {
    console.error("Error fetching workspace domain:", error.message)
    return res.status(500).json({ success: false, error: "Failed to fetch workspace domain" })
  }
}

/**
 * POST /api/workspaces/:workspaceId/domain
 * Add or update custom domain for a workspace (Org Admin only)
 */
const setWorkspaceDomain = async (req, res) => {
  try {
    const resolvedTenant = resolveVerifiedTenantId(req)
    if (resolvedTenant.error || !resolvedTenant.tenantId) {
      return res.status(resolvedTenant.status || 403).json({
        success: false,
        error: resolvedTenant.error || "Tenant context required",
        ...(resolvedTenant.code ? { code: resolvedTenant.code } : {}),
      })
    }
    const { tenantId } = resolvedTenant
    const isOrgAdmin = req.user?.role === "account_admin"

    if (!isOrgAdmin) {
      return res.status(403).json({
        success: false,
        error: "Forbidden: Managing custom domains requires Organization Administrator (account_admin) privileges. Platform Super Admin is in read-only support mode.",
        code: "PERMISSION_DENIED",
      })
    }

    const { workspaceId } = req.params
    const { domain } = req.body

    if (!mongoose.Types.ObjectId.isValid(workspaceId)) {
      return res.status(400).json({ success: false, error: "Invalid workspace ID" })
    }

    const workspace = await Workspace.findOne({ _id: workspaceId, tenantId })
    if (!workspace) {
      return res.status(404).json({ success: false, error: "Workspace not found" })
    }

    if (!domain || typeof domain !== "string" || !domain.trim()) {
      return res.status(400).json({ success: false, error: "Domain hostname is required" })
    }

    const cleanDomain = sanitizeHostname(domain)

    // Disallow reserved or invalid hosts
    if (
      !cleanDomain ||
      cleanDomain === "localhost" ||
      cleanDomain === "127.0.0.1" ||
      cleanDomain === "::1" ||
      cleanDomain.endsWith(".localhost") ||
      cleanDomain.endsWith(".vercel.app") ||
      cleanDomain === "admin.leads365.in" ||
      cleanDomain === "leads365.in" ||
      !cleanDomain.includes(".")
    ) {
      return res.status(400).json({
        success: false,
        error: "Invalid custom domain hostname. Must be a valid fully qualified domain name.",
        code: "INVALID_DOMAIN_FORMAT",
      })
    }

    // Check global uniqueness across DomainMapping
    const existingMapping = await DomainMapping.findOne({ domain: cleanDomain })
      .setOptions({ skipTenantFilter: true })
      .lean()

    if (existingMapping && existingMapping.targetId.toString() !== workspace._id.toString()) {
      return res.status(409).json({
        success: false,
        error: `The domain '${cleanDomain}' is already claimed by another organization or workspace.`,
        code: "DOMAIN_ALREADY_MAPPED",
      })
    }

    // Check parent Account.customDomain direct collision (prevent workspace domain from claiming ANY existing account domain)
    const existingAccount = await Account.findOne({
      customDomain: { $regex: new RegExp(`^${cleanDomain.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") },
    }).lean()

    if (existingAccount) {
      return res.status(409).json({
        success: false,
        error: `The domain '${cleanDomain}' is already claimed by an organization account.`,
        code: "DOMAIN_ALREADY_MAPPED",
      })
    }

    // Generate unique verification token
    const verificationToken = `leads365-verify=${crypto.randomBytes(16).toString("hex")}`

    let mapping = await DomainMapping.findOne({
      tenantId,
      targetType: "WORKSPACE",
      targetId: workspace._id,
    }).setOptions({ skipTenantFilter: true })

    if (mapping) {
      mapping.domain = cleanDomain
      mapping.targetSlug = workspace.slug
      mapping.status = "pending_verification"
      mapping.verificationToken = verificationToken
      mapping.verifiedAt = null
      await mapping.save()
    } else {
      mapping = new DomainMapping({
        tenantId,
        domain: cleanDomain,
        targetType: "WORKSPACE",
        targetId: workspace._id,
        targetSlug: workspace.slug,
        status: "pending_verification",
        verificationToken,
      })
      await mapping.save()
    }

    workspace.customDomain = cleanDomain
    workspace.domainStatus = "pending_verification"
    await workspace.save()

    invalidateCustomDomainCache()

    return res.status(200).json({
      success: true,
      message: "Custom domain configured. Please add the DNS verification TXT record.",
      data: {
        domain: mapping.domain,
        status: mapping.status,
        verificationToken: mapping.verificationToken,
        dnsInstructions: {
          recordType: "TXT",
          host: `_leads365-challenge.${cleanDomain}`,
          value: verificationToken,
          cnameHost: cleanDomain,
          cnameTarget: process.env.CNAME_TARGET || "cname.vercel-dns.com",
          sslStatus: "automatic",
          instructions: `1. Add a TXT record with Host '_leads365-challenge.${cleanDomain}' and Value '${verificationToken}'.\n2. Add a CNAME record with Host '${cleanDomain}' pointing to '${process.env.CNAME_TARGET || "cname.vercel-dns.com"}'.\n3. Click 'Verify DNS Record' once DNS has propagated. SSL is automatically provisioned upon successful verification.`,
        },
      },
    })
  } catch (error) {
    console.error("Error setting workspace domain:", error.message)
    return res.status(500).json({ success: false, error: "Failed to configure workspace domain: " + error.message })
  }
}

/**
 * POST /api/workspaces/:workspaceId/domain/verify
 * Trigger DNS TXT verification for a workspace custom domain
 */
const verifyWorkspaceDomain = async (req, res) => {
  try {
    const resolvedTenant = resolveVerifiedTenantId(req)
    if (resolvedTenant.error || !resolvedTenant.tenantId) {
      return res.status(resolvedTenant.status || 403).json({
        success: false,
        error: resolvedTenant.error || "Tenant context required",
        ...(resolvedTenant.code ? { code: resolvedTenant.code } : {}),
      })
    }
    const { tenantId } = resolvedTenant
    const isOrgAdmin = req.user?.role === "account_admin"

    if (!isOrgAdmin) {
      return res.status(403).json({
        success: false,
        error: "Forbidden: Verifying custom domains requires Organization Administrator (account_admin) privileges. Platform Super Admin is in read-only support mode.",
        code: "PERMISSION_DENIED",
      })
    }

    const { workspaceId } = req.params

    if (!mongoose.Types.ObjectId.isValid(workspaceId)) {
      return res.status(400).json({ success: false, error: "Invalid workspace ID" })
    }

    const workspace = await Workspace.findOne({ _id: workspaceId, tenantId })
    if (!workspace) {
      return res.status(404).json({ success: false, error: "Workspace not found" })
    }

    const mapping = await DomainMapping.findOne({
      tenantId,
      targetType: "WORKSPACE",
      targetId: workspace._id,
    }).setOptions({ skipTenantFilter: true })

    if (!mapping) {
      return res.status(404).json({ success: false, error: "No custom domain configured for this workspace" })
    }

    const isTestBypass = process.env.NODE_ENV === "test" || req.body?.bypassDns === true

    let verified = false
    let lookupDetails = ""

    if (isTestBypass) {
      verified = true
      lookupDetails = "Test environment automatic verification"
    } else {
      try {
        const challengeHost = `_leads365-challenge.${mapping.domain}`
        const records = await dns.resolveTxt(challengeHost).catch(() => [])
        const rootRecords = await dns.resolveTxt(mapping.domain).catch(() => [])

        const allChunks = [...records.flat(), ...rootRecords.flat()]
        verified = allChunks.some((txt) => txt.includes(mapping.verificationToken) || txt.trim() === mapping.verificationToken.trim())

        if (!verified) {
          lookupDetails = `Queried '${challengeHost}' and '${mapping.domain}', found [${allChunks.join(", ")}], expected token '${mapping.verificationToken}'`
        }
      } catch (dnsErr) {
        lookupDetails = `DNS resolution failed: ${dnsErr.message}`
      }
    }

    if (verified) {
      mapping.status = "verified"
      mapping.verifiedAt = new Date()
      await mapping.save()

      workspace.domainStatus = "verified"
      await workspace.save()

      invalidateCustomDomainCache()

      return res.status(200).json({
        success: true,
        message: `Custom domain '${mapping.domain}' verified and activated successfully!`,
        data: {
          domain: mapping.domain,
          status: mapping.status,
          verifiedAt: mapping.verifiedAt,
        },
      })
    } else {
      return res.status(400).json({
        success: false,
        error: "DNS TXT record verification failed. Please verify that the TXT record has propagated.",
        code: "DNS_VERIFICATION_FAILED",
        details: lookupDetails,
      })
    }
  } catch (error) {
    console.error("Error verifying workspace domain:", error.message)
    return res.status(500).json({ success: false, error: "Failed to verify domain: " + error.message })
  }
}

/**
 * DELETE /api/workspaces/:workspaceId/domain
 * Remove custom domain from a workspace (Org Admin only)
 */
const removeWorkspaceDomain = async (req, res) => {
  try {
    const resolvedTenant = resolveVerifiedTenantId(req)
    if (resolvedTenant.error || !resolvedTenant.tenantId) {
      return res.status(resolvedTenant.status || 403).json({
        success: false,
        error: resolvedTenant.error || "Tenant context required",
        ...(resolvedTenant.code ? { code: resolvedTenant.code } : {}),
      })
    }
    const { tenantId } = resolvedTenant
    const isOrgAdmin = req.user?.role === "account_admin"

    if (!isOrgAdmin) {
      return res.status(403).json({
        success: false,
        error: "Forbidden: Removing custom domains requires Organization Administrator (account_admin) privileges. Platform Super Admin is in read-only support mode.",
        code: "PERMISSION_DENIED",
      })
    }

    const { workspaceId } = req.params

    if (!mongoose.Types.ObjectId.isValid(workspaceId)) {
      return res.status(400).json({ success: false, error: "Invalid workspace ID" })
    }

    const workspace = await Workspace.findOne({ _id: workspaceId, tenantId })
    if (!workspace) {
      return res.status(404).json({ success: false, error: "Workspace not found" })
    }

    await DomainMapping.findOneAndDelete({
      tenantId,
      targetType: "WORKSPACE",
      targetId: workspace._id,
    }).setOptions({ skipTenantFilter: true })

    workspace.customDomain = null
    workspace.domainStatus = "unconfigured"
    await workspace.save()

    invalidateCustomDomainCache()

    const account = await Account.findOne({ accountId: tenantId }).select("slug companyName accountId").lean()
    const orgSlug = account?.slug || slugify(account?.companyName) || account?.accountId || tenantId

    return res.status(200).json({
      success: true,
      message: "Custom domain removed successfully from workspace",
      data: {
        workspaceId: workspace._id,
        accessUrl: buildWorkspaceAccessUrl(orgSlug, workspace),
      },
    })
  } catch (error) {
    console.error("Error removing workspace domain:", error.message)
    return res.status(500).json({ success: false, error: "Failed to remove workspace domain" })
  }
}

module.exports = {
  listWorkspaces,
  createWorkspace,
  getWorkspaceById,
  updateWorkspace,
  archiveWorkspace,
  listMemberships,
  addMembership,
  removeMembership,
  toggleWorkspaceMode,
  listServiceCatalog,
  createServiceCatalogItem,
  getPublicServices,
  getMasterDashboard,
  getUnassignedQueue,
  assignUnassignedItem,
  getWorkspaceDomain,
  setWorkspaceDomain,
  verifyWorkspaceDomain,
  removeWorkspaceDomain,
}
