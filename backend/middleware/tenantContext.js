const { AsyncLocalStorage } = require("async_hooks")
const mongoose = require("mongoose")

/**
 * Tenant & Workspace Context Manager using Node.js AsyncLocalStorage
 *
 * Provides ambient, execution-scoped tenant and workspace isolation context across all async operations.
 * Supports four explicit scope modes:
 * - standalone: Standard Mode A tenant (workspaceModeEnabled = false)
 * - single_workspace: Explicitly scoped to an authorized workspace (workspaceModeEnabled = true)
 * - authorized_all_workspaces: Organization Admin viewing cross-workspace "All Projects"
 * - unassigned_review: Staged or ambiguous records awaiting workspace assignment
 */

const tenantStorage = new AsyncLocalStorage()

// In-memory cache for account workspace mode status: Map<tenantId, { workspaceModeEnabled: boolean, timestamp: number }>
const accountWorkspaceModeCache = new Map()
const CACHE_TTL_MS = 30000 // 30 seconds

const getAccountWorkspaceModeCached = async (tenantId) => {
  if (!tenantId || typeof tenantId !== "string") return false
  const now = Date.now()
  const cached = accountWorkspaceModeCache.get(tenantId)
  if (cached && now - cached.timestamp < CACHE_TTL_MS) {
    return cached.workspaceModeEnabled
  }

  try {
    const Account = mongoose.models.Account || require("../models/Account")
    const acc = await Account.findOne({ accountId: tenantId }).select("workspaceModeEnabled status").lean()
    const isEnabled = Boolean(acc && acc.workspaceModeEnabled === true)
    accountWorkspaceModeCache.set(tenantId, {
      workspaceModeEnabled: isEnabled,
      timestamp: now,
    })
    return isEnabled
  } catch (err) {
    console.error("Error reading account workspaceModeEnabled:", err.message)
    return false
  }
}

const invalidateAccountWorkspaceModeCache = (tenantId = null) => {
  if (tenantId) {
    accountWorkspaceModeCache.delete(tenantId)
  } else {
    accountWorkspaceModeCache.clear()
  }
}

/**
 * Run an async function within a specific tenant and workspace context
 */
const runWithTenantContext = (context, fn) => {
  let store
  if (typeof context === "string") {
    store = {
      tenantId: context,
      workspaceId: null,
      mode: "standalone",
      isSuperAdmin: false,
    }
  } else if (context && typeof context === "object") {
    store = {
      tenantId: context.tenantId || null,
      workspaceId: context.workspaceId ? (context.workspaceId._id || context.workspaceId) : null,
      mode: context.mode || (context.workspaceId ? "single_workspace" : (context.isSuperAdmin ? "authorized_all_workspaces" : "standalone")),
      isSuperAdmin: Boolean(context.isSuperAdmin),
      userId: context.userId || null,
      userRole: context.userRole || null,
      userEmail: context.userEmail || null,
      isBackgroundJob: Boolean(context.isBackgroundJob),
      jobId: context.jobId || null,
    }
  } else {
    store = { tenantId: null, workspaceId: null, mode: "anonymous", isSuperAdmin: false }
  }

  return tenantStorage.run(store, fn)
}

/**
 * Retrieve the current ambient tenant and workspace context
 */
const getTenantContext = () => {
  return tenantStorage.getStore() || null
}

/**
 * Determine effective tenant partition from an Express request
 */
const getEffectiveTenant = (req) => {
  if (!req || !req.user) {
    return { tenantId: null, isSuperAdmin: false }
  }

  const isSuperAdmin = req.user.role === "super_admin"

  if (isSuperAdmin) {
    if (req.tenantId) {
      return { tenantId: req.tenantId, isSuperAdmin: true }
    }

    // Super admin can explicitly scope to an authorized tenant via header, cookie, query, or body
    const requestedTenant =
      (typeof req.headers?.["x-tenant-id"] === "string" ? req.headers["x-tenant-id"].trim() : null) ||
      (typeof req.cookies?.active_tenant_id === "string" ? req.cookies.active_tenant_id.trim() : null) ||
      (typeof req.query?.tenantId === "string" ? req.query.tenantId.trim() : null) ||
      (typeof req.body?.tenantId === "string" ? req.body.tenantId.trim() : null) ||
      (req.user.tenantId || null)

    return { tenantId: requestedTenant, isSuperAdmin: true }
  }

  // Normal tenant user: strictly bound to authenticated tenantId
  return {
    tenantId: req.user.tenantId || null,
    isSuperAdmin: false,
  }
}

/**
 * Express middleware that initializes ambient AsyncLocalStorage tenant and workspace context
 */
const tenantContextMiddleware = async (req, res, next) => {
  if (!req.user) {
    const context = {
      tenantId: null,
      workspaceId: null,
      mode: "anonymous",
      isSuperAdmin: false,
    }
    req.tenantContext = context
    return tenantStorage.run(context, () => next())
  }

  const { tenantId, isSuperAdmin } = getEffectiveTenant(req)
  if (!tenantId && !isSuperAdmin) {
    return res.status(401).json({
      success: false,
      error: "Tenant context resolution failed: authenticated user has no associated tenantId.",
      code: "TENANT_RESOLUTION_FAILED",
    })
  }

  // 1. Check if organization has enabled multi-workspace mode
  const workspaceModeEnabled = tenantId ? await getAccountWorkspaceModeCached(tenantId) : false

  // Mode A: Standalone Account (Default)
  if (!workspaceModeEnabled) {
    const context = {
      tenantId: tenantId || null,
      workspaceId: null,
      mode: "standalone",
      isSuperAdmin,
      userId: req.user?.id || req.user?._id || null,
      userRole: req.user?.role || null,
      userEmail: req.user?.email || null,
    }
    req.tenantContext = context
    return tenantStorage.run(context, () => next())
  }

  // Mode B: Organization with Workspaces
  const isOrgAdmin = req.user.role === "account_admin"
  const rawWorkspaceHeader =
    (typeof req.headers?.["x-workspace-id"] === "string" ? req.headers["x-workspace-id"].trim() : null) ||
    (typeof req.query?.workspaceId === "string" ? req.query.workspaceId.trim() : null) ||
    (typeof req.cookies?.active_workspace_id === "string" ? req.cookies.active_workspace_id.trim() : null)

  const Workspace = mongoose.models.Workspace || require("../models/Workspace")
  const WorkspaceMembership = mongoose.models.WorkspaceMembership || require("../models/WorkspaceMembership")

  // Case B0: Request is bound to a workspace custom domain
  const domainBoundWs = req.domainBoundWorkspace
  if (domainBoundWs) {
    const boundWsIdStr = domainBoundWs._id.toString()
    // Anti-spoofing: if client requested a conflicting workspace header, reject immediately
    if (rawWorkspaceHeader && rawWorkspaceHeader !== boundWsIdStr) {
      return res.status(403).json({
        success: false,
        error: `Domain boundary violation: Dedicated to workspace '${domainBoundWs.name}'. Conflicting workspace selection rejected.`,
        code: "DOMAIN_WORKSPACE_CONFLICT",
      })
    }

    // Super Admin on a child workspace domain gets read-only viewer role, never workspace_admin
    let workspaceRole = isOrgAdmin ? "workspace_admin" : (isSuperAdmin ? "viewer" : null)
    let workspacePermissions = isSuperAdmin ? ["leads.view", "calls.view", "workspaces.view"] : []

    if (!isOrgAdmin && !isSuperAdmin) {
      const membership = await WorkspaceMembership.findOne({
        tenantId,
        workspaceId: domainBoundWs._id,
        userId: req.user.id || req.user._id,
        status: "active",
      })
        .setOptions({ skipTenantFilter: true })
        .lean()

      if (!membership) {
        return res.status(403).json({
          success: false,
          error: "Access denied: You are not an authorized member of this workspace.",
          code: "NOT_A_WORKSPACE_MEMBER",
        })
      }
      workspaceRole = membership.role
      workspacePermissions = membership.permissions || []
    }

    // Super Admin cannot silently gain write access on child workspace domains
    if (isSuperAdmin && ["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
      return res.status(403).json({
        success: false,
        error: "Access denied: Platform Super Admin is in audited read-only support mode and cannot modify workspace resources.",
        code: "SUPERADMIN_READONLY_SUPPORT_MODE",
      })
    }

    const context = {
      tenantId,
      workspaceId: domainBoundWs._id,
      mode: "single_workspace",
      workspaceName: domainBoundWs.name,
      workspaceRole,
      workspacePermissions,
      isSuperAdmin,
      isOrgAdmin,
      userId: req.user?.id || req.user?._id || null,
      userRole: req.user?.role || null,
      userEmail: req.user?.email || null,
    }
    req.tenantContext = context
    return tenantStorage.run(context, () => next())
  }

  // Case B1: Explicit "all" requested
  if (rawWorkspaceHeader === "all") {
    // Only account_admin gets normal organization-wide All Projects access; Super Admin gets read-only support audit
    if (!isOrgAdmin && !isSuperAdmin) {
      return res.status(403).json({
        success: false,
        error: "Cross-workspace access requires Organization Administrator privileges.",
        code: "CROSS_WORKSPACE_DENIED",
      })
    }

    if (isSuperAdmin && ["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
      return res.status(403).json({
        success: false,
        error: "Access denied: Platform Super Admin is in audited read-only support mode and cannot modify organization resources.",
        code: "SUPERADMIN_READONLY_SUPPORT_MODE",
      })
    }

    const context = {
      tenantId,
      workspaceId: null,
      mode: "authorized_all_workspaces",
      isSuperAdmin,
      isOrgAdmin,
      userId: req.user?.id || req.user?._id || null,
      userRole: req.user?.role || null,
      userEmail: req.user?.email || null,
    }
    req.tenantContext = context
    return tenantStorage.run(context, () => next())
  }

  // Case B2: Explicit "unassigned" requested
  if (rawWorkspaceHeader === "unassigned") {
    if (isSuperAdmin && ["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
      return res.status(403).json({
        success: false,
        error: "Access denied: Platform Super Admin is in audited read-only support mode.",
        code: "SUPERADMIN_READONLY_SUPPORT_MODE",
      })
    }

    const context = {
      tenantId,
      workspaceId: null,
      mode: "unassigned_review",
      isSuperAdmin,
      isOrgAdmin,
      userId: req.user?.id || req.user?._id || null,
      userRole: req.user?.role || null,
      userEmail: req.user?.email || null,
    }
    req.tenantContext = context
    return tenantStorage.run(context, () => next())
  }

  // Case B3: Specific workspace ID provided
  if (rawWorkspaceHeader) {
    if (!mongoose.Types.ObjectId.isValid(rawWorkspaceHeader)) {
      return res.status(400).json({
        success: false,
        error: "Invalid workspace identifier format.",
        code: "INVALID_WORKSPACE_ID",
      })
    }

    const workspace = await Workspace.findOne({
      _id: rawWorkspaceHeader,
      tenantId,
      status: "active",
    })
      .setOptions({ skipTenantFilter: true })
      .lean()

    if (!workspace) {
      return res.status(404).json({
        success: false,
        error: "Workspace not found, archived, or does not belong to this organization.",
        code: "WORKSPACE_NOT_FOUND",
      })
    }

    let workspaceRole = isOrgAdmin ? "workspace_admin" : (isSuperAdmin ? "viewer" : null)
    let workspacePermissions = isSuperAdmin ? ["leads.view", "calls.view", "workspaces.view"] : []

    if (!isOrgAdmin && !isSuperAdmin) {
      const membership = await WorkspaceMembership.findOne({
        tenantId,
        workspaceId: workspace._id,
        userId: req.user.id || req.user._id,
        status: "active",
      })
        .setOptions({ skipTenantFilter: true })
        .lean()

      if (!membership) {
        return res.status(403).json({
          success: false,
          error: "Access denied: You are not an authorized member of this workspace.",
          code: "NOT_A_WORKSPACE_MEMBER",
        })
      }
      workspaceRole = membership.role
      workspacePermissions = membership.permissions || []
    }

    if (isSuperAdmin && ["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
      return res.status(403).json({
        success: false,
        error: "Access denied: Platform Super Admin is in audited read-only support mode and cannot modify workspace resources.",
        code: "SUPERADMIN_READONLY_SUPPORT_MODE",
      })
    }

    const context = {
      tenantId,
      workspaceId: workspace._id,
      mode: "single_workspace",
      workspaceName: workspace.name,
      workspaceRole,
      workspacePermissions,
      isSuperAdmin,
      isOrgAdmin,
      userId: req.user?.id || req.user?._id || null,
      userRole: req.user?.role || null,
      userEmail: req.user?.email || null,
    }
    req.tenantContext = context
    return tenantStorage.run(context, () => next())
  }

  // Case B4: Workspace header omitted in workspaceModeEnabled account
  if (isOrgAdmin || isSuperAdmin) {
    if (isSuperAdmin && ["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
      return res.status(403).json({
        success: false,
        error: "Access denied: Platform Super Admin is in audited read-only support mode and cannot modify organization resources.",
        code: "SUPERADMIN_READONLY_SUPPORT_MODE",
      })
    }

    // Org admins default to All Projects oversight when no workspace specified; Super Admin gets read-only support view
    const context = {
      tenantId,
      workspaceId: null,
      mode: "authorized_all_workspaces",
      isSuperAdmin,
      isOrgAdmin,
      userId: req.user?.id || req.user?._id || null,
      userRole: req.user?.role || null,
      userEmail: req.user?.email || null,
    }
    req.tenantContext = context
    return tenantStorage.run(context, () => next())
  }

  // For regular staff: inspect authorized memberships
  const memberships = await WorkspaceMembership.find({
    tenantId,
    userId: req.user.id || req.user._id,
    status: "active",
  })
    .setOptions({ skipTenantFilter: true })
    .lean()

  if (memberships.length === 1) {
    // Exactly 1 workspace: auto-bind
    const singleWs = await Workspace.findOne({
      _id: memberships[0].workspaceId,
      tenantId,
      status: "active",
    })
      .setOptions({ skipTenantFilter: true })
      .lean()

    if (!singleWs) {
      return res.status(403).json({
        success: false,
        error: "Your assigned workspace is no longer active.",
        code: "WORKSPACE_INACTIVE",
      })
    }

    const context = {
      tenantId,
      workspaceId: singleWs._id,
      mode: "single_workspace",
      workspaceName: singleWs.name,
      workspaceRole: memberships[0].role,
      workspacePermissions: memberships[0].permissions || [],
      isSuperAdmin: false,
      isOrgAdmin: false,
      userId: req.user?.id || req.user?._id || null,
      userRole: req.user?.role || null,
      userEmail: req.user?.email || null,
    }
    req.tenantContext = context
    return tenantStorage.run(context, () => next())
  }

  if (memberships.length > 1) {
    return res.status(400).json({
      success: false,
      error: "Workspace selection required: You belong to multiple workspaces. Please provide 'X-Workspace-Id' header.",
      code: "WORKSPACE_SELECTION_REQUIRED",
      workspaces: memberships.map((m) => m.workspaceId.toString()),
    })
  }

  // Zero memberships: explicit refusal
  return res.status(403).json({
    success: false,
    error: "Access denied: You have not been assigned to any workspaces in this organization.",
    code: "NO_AUTHORIZED_WORKSPACES",
  })
}

module.exports = {
  tenantStorage,
  runWithTenantContext,
  getTenantContext,
  getEffectiveTenant,
  tenantContextMiddleware,
  getAccountWorkspaceModeCached,
  invalidateAccountWorkspaceModeCache,
}
