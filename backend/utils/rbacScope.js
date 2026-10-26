const mongoose = require("mongoose")
const Team = require("../models/Team")
const User = require("../models/User")

/**
 * RBAC Scopes & Permission Utilities - Phase 5: RBAC v2
 * 
 * Centralized authorization helpers for own / team / all permissions,
 * query filtering, direct-object security, and backward compatibility.
 */

const SCOPE_RANKS = {
  own: 1,
  team: 2,
  all: 3,
}

// Maps legacy permission strings to modern action keys
const LEGACY_PERMISSION_MAP = {
  "leads.view": "leads.view",
  "leads.edit": "leads.edit",
  "leads.delete": "leads.delete",
  "followups.view": "followups.view",
  "followups.manage": "followups.manage",
  "calls.view": "calls.view",
  "calls.manage": "calls.log",
  "users.view": "staff.view",
  "users.manage": "staff.manage",
}

/**
 * Checks if a specific permission key is covered by the Super Admin ceiling.
 * Considers scope hierarchy: .all in ceiling covers .team and .own.
 */
const isPermissionCoveredByCeiling = (permission, ceiling) => {
  if (!ceiling || !Array.isArray(ceiling)) return true
  const ceilingSet = new Set(ceiling)
  if (ceilingSet.has(permission)) return true

  const parts = permission.split(".")
  if (parts.length === 3) {
    const [resource, action, scope] = parts
    if (ceilingSet.has(`${resource}.${action}.all`) || ceilingSet.has(`${resource}.${action}`)) {
      return true
    }
    if (scope === "own" && ceilingSet.has(`${resource}.${action}.team`)) {
      return true
    }
  }

  if (LEGACY_PERMISSION_MAP[permission] && ceilingSet.has(LEGACY_PERMISSION_MAP[permission])) {
    return true
  }

  return false
}

/**
 * Resolves highest scope held by a user for a given resource and action
 * @param {Array<string>} permissions
 * @param {string} resource e.g. "leads", "followups", "calls"
 * @param {string} action e.g. "view", "edit", "delete", "manage"
 * @returns {"all" | "team" | "own" | null}
 */
const getUserScope = (permissions = [], resource, action) => {
  if (!Array.isArray(permissions)) return null

  const permSet = new Set(permissions)
  const prefix = `${resource}.${action}`

  if (permSet.has(`${prefix}.all`) || permSet.has(`${resource}.*.all`)) {
    return "all"
  }
  if (permSet.has(`${prefix}.team`) || permSet.has(`${resource}.*.team`)) {
    return "team"
  }
  if (permSet.has(`${prefix}.own`) || permSet.has(`${resource}.*.own`)) {
    return "own"
  }

  // Backward compatibility: if user has un-scoped key (e.g. leads.view)
  if (permSet.has(prefix) || permSet.has(LEGACY_PERMISSION_MAP[prefix])) {
    return "all"
  }

  return null
}

/**
 * Check if a user possesses a required permission key with optional scope requirement.
 * @param {Object} user req.user
 * @param {string} requiredPermission e.g. "leads.view.own" or "leads.create"
 * @param {string} [requiredScope] optional minimum scope ("own", "team", "all")
 * @returns {boolean}
 */
const hasPermission = (user, requiredPermission, requiredScope = null) => {
  if (!user) return false
  if (user.role === "super_admin") return true

  const userPerms = Array.isArray(user.permissions) ? user.permissions : []
  const permSet = new Set(userPerms)

  // Direct match
  if (permSet.has(requiredPermission)) return true

  // Check legacy alias
  if (LEGACY_PERMISSION_MAP[requiredPermission] && permSet.has(LEGACY_PERMISSION_MAP[requiredPermission])) {
    return true
  }

  // Parse resource, action, and scope if key has format "resource.action.scope"
  const parts = requiredPermission.split(".")
  if (parts.length === 3) {
    const [resource, action, requestedScope] = parts
    const currentScope = getUserScope(userPerms, resource, action)
    if (!currentScope) return false

    const minScope = requiredScope || requestedScope
    const minRank = SCOPE_RANKS[minScope] || 1
    const currentRank = SCOPE_RANKS[currentScope] || 0

    return currentRank >= minRank
  }

  if (parts.length === 2) {
    const [resource, action] = parts
    const currentScope = getUserScope(userPerms, resource, action)
    if (currentScope) {
      if (requiredScope) {
        return (SCOPE_RANKS[currentScope] || 0) >= (SCOPE_RANKS[requiredScope] || 1)
      }
      return true
    }
  }

  return false
}

/**
 * Helper to fetch all user IDs and names belonging to the same team(s) as the caller.
 * Looks up user's assigned teamId and any teams where the user is a manager.
 */
const getTeamMemberContext = async (user) => {
  if (!user || !user.id) {
    return { memberIds: [], memberNames: [] }
  }

  const teamQueries = []
  if (user.teamId && mongoose.Types.ObjectId.isValid(user.teamId)) {
    teamQueries.push({ _id: user.teamId })
  }
  if (mongoose.Types.ObjectId.isValid(user.id)) {
    teamQueries.push({ managerId: user.id })
  }

  if (teamQueries.length === 0) {
    return {
      memberIds: [user.id.toString()],
      memberNames: [user.name || ""].filter(Boolean),
    }
  }

  const teams = await Team.find({
    tenantId: user.tenantId,
    $or: teamQueries,
  })
    .setOptions({ skipTenantFilter: true })
    .lean()

  const memberIdSet = new Set([user.id.toString()])
  for (const t of teams) {
    if (t.managerId) {
      memberIdSet.add(t.managerId.toString())
    }
    if (Array.isArray(t.members)) {
      t.members.forEach((m) => {
        if (m) memberIdSet.add(m.toString())
      })
    }
  }

  const memberIds = Array.from(memberIdSet)

  // Retrieve user names for string-based assignedTo field matching
  const memberUsers = await User.find({
    _id: { $in: memberIds },
  })
    .setOptions({ skipTenantFilter: true })
    .select("name email")
    .lean()

  const memberNames = memberUsers.map((u) => u.name).filter(Boolean)
  const memberEmails = memberUsers.map((u) => u.email).filter(Boolean)

  return { memberIds, memberNames, memberEmails }
}

/**
 * Builds a database query filter for own / team / all scoped endpoints.
 * @param {Object} user req.user
 * @param {string} resourceType e.g. "leads", "followups", "calls"
 * @param {string} action e.g. "view", "edit", "delete", "manage"
 * @returns {Promise<Object>} MongoDB query object
 */
const scopeFilter = async (user, resourceType, action = "view") => {
  if (!user) {
    return { _id: null } // Fail closed: unauthenticated
  }

  if (user.role === "super_admin") {
    return {} // Super admin has global scope
  }

  const scope = getUserScope(user.permissions || [], resourceType, action)

  if (!scope) {
    // If checking "manage" on follow-ups, also fallback to checking "view"
    if (action === "manage") {
      const viewScope = getUserScope(user.permissions || [], resourceType, "view")
      if (viewScope) {
        return scopeFilter(user, resourceType, "view")
      }
    }
    return { _id: null } // Fail closed: unauthorized
  }

  if (scope === "all") {
    return {} // No assignee filter constraint
  }

  const userIdStr = user.id ? user.id.toString() : ""
  const userName = user.name || ""
  const userEmail = user.email || ""

  if (scope === "team") {
    const { memberIds, memberNames, memberEmails } = await getTeamMemberContext(user)

    const conditions = []
    if (memberIds.length > 0) {
      conditions.push({ assignedStaffId: { $in: memberIds } })
      conditions.push({ ownerId: { $in: memberIds } })
      conditions.push({ managerId: { $in: memberIds } })
    }
    if (memberNames.length > 0) {
      conditions.push({ assignedTo: { $in: memberNames } })
    }
    if (memberEmails.length > 0) {
      conditions.push({ createdBy: { $in: memberEmails } })
    }

    // Always include user's own items
    conditions.push({ assignedStaffId: userIdStr })
    if (userName) conditions.push({ assignedTo: userName })
    if (userEmail) conditions.push({ createdBy: userEmail })

    return { $or: conditions }
  }

  // scope === "own"
  const ownConditions = []
  if (userIdStr) {
    ownConditions.push({ assignedStaffId: userIdStr })
    ownConditions.push({ ownerId: userIdStr })
  }
  if (userName) {
    ownConditions.push({ assignedTo: userName })
  }
  if (userEmail) {
    ownConditions.push({ createdBy: userEmail })
  }

  return ownConditions.length > 0 ? { $or: ownConditions } : { _id: null }
}

/**
 * Verifies if a specific document is accessible to a user under RBAC scopes.
 * Used for direct object access (GET /:id, PUT /:id, DELETE /:id).
 * @param {Object} user req.user
 * @param {Object} doc Mongoose document or plain object
 * @param {string} resourceType "leads" | "followups" | "calls"
 * @param {string} action "view" | "edit" | "delete" | "manage"
 * @returns {Promise<{ allowed: boolean, reason?: string }>}
 */
const checkDirectObjectAccess = async (user, doc, resourceType, action = "view") => {
  if (!user) {
    return { allowed: false, reason: "Authentication required" }
  }

  if (user.role === "super_admin") {
    return { allowed: true }
  }

  if (!doc) {
    return { allowed: false, reason: "Record not found" }
  }

  // Strict tenant boundary check
  if (user.tenantId && doc.tenantId && user.tenantId !== doc.tenantId) {
    return { allowed: false, reason: "Cross-tenant access prohibited" }
  }

  // Resolve user scope for this action
  let scope = getUserScope(user.permissions || [], resourceType, action)
  if (!scope && (action === "edit" || action === "delete" || action === "manage")) {
    // If no specific edit/delete scope, check if general permission exists
    scope = getUserScope(user.permissions || [], resourceType, "view")
  }

  if (!scope) {
    return { allowed: false, reason: `Insufficient permission for ${resourceType}.${action}` }
  }

  if (scope === "all") {
    return { allowed: true }
  }

  const userIdStr = (user.id || user._id || "").toString()
  const docAssignedStaffId = (doc.assignedStaffId || "").toString()
  const docOwnerId = (doc.ownerId || "").toString()
  const docAssignedTo = (doc.assignedTo || "").trim().toLowerCase()
  const docCreatedBy = (doc.createdBy || "").trim().toLowerCase()

  const isDirectOwner =
    (docAssignedStaffId && docAssignedStaffId === userIdStr) ||
    (docOwnerId && docOwnerId === userIdStr) ||
    (user.name && docAssignedTo === user.name.trim().toLowerCase()) ||
    (user.email && docCreatedBy === user.email.trim().toLowerCase())

  if (scope === "own") {
    if (isDirectOwner) {
      return { allowed: true }
    }
    return { allowed: false, reason: "Access denied. Record is outside your assigned personal scope" }
  }

  if (scope === "team") {
    if (isDirectOwner) {
      return { allowed: true }
    }

    const { memberIds, memberNames, memberEmails } = await getTeamMemberContext(user)

    const isTeamRecord =
      (docAssignedStaffId && memberIds.includes(docAssignedStaffId)) ||
      (docOwnerId && memberIds.includes(docOwnerId)) ||
      (docAssignedTo && memberNames.map((n) => n.toLowerCase()).includes(docAssignedTo)) ||
      (docCreatedBy && memberEmails.map((e) => e.toLowerCase()).includes(docCreatedBy))

    if (isTeamRecord) {
      return { allowed: true }
    }

    return { allowed: false, reason: "Access denied. Record is outside your assigned team scope" }
  }

  return { allowed: false, reason: "Scope verification failed" }
}

module.exports = {
  SCOPE_RANKS,
  LEGACY_PERMISSION_MAP,
  isPermissionCoveredByCeiling,
  getUserScope,
  hasPermission,
  getTeamMemberContext,
  scopeFilter,
  checkDirectObjectAccess,
}
