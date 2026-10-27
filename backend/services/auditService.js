const mongoose = require("mongoose")
const AuditLog = require("../models/AuditLog")
const { sanitizeAuditDetails, computeAuditDiff } = require("../utils/auditSanitizer")
const { getTenantContext, runWithTenantContext } = require("../middleware/tenantContext")

/**
 * Shared Audit Service - Phase 8: Audit Log
 * 
 * Provides centralized helper functions to record immutable audit events,
 * query audit logs with tenant scoping, and perform retention management.
 */

// Canonical audit action constants
const AUDIT_ACTIONS = {
  // Authentication & Security
  AUTH_LOGIN: "auth.login",
  AUTH_LOGOUT: "auth.logout",
  AUTH_INVITE_ACCEPTED: "auth.invite_accepted",
  AUTH_PASSWORD_RESET: "auth.password_reset",

  // Staff & Team Management
  STAFF_CREATE: "staff.create",
  STAFF_UPDATE: "staff.update",
  STAFF_DEACTIVATE: "staff.deactivate",
  STAFF_REACTIVATE: "staff.reactivate",
  STAFF_PASSWORD_RESET: "staff.password_reset",
  STAFF_ROLE_CHANGE: "staff.role_change",
  STAFF_TEAM_CHANGE: "staff.team_change",
  TEAM_CREATE: "team.create",
  TEAM_UPDATE: "team.update",
  TEAM_DELETE: "team.delete",

  // Role & Permission Management
  ROLE_CREATE: "role.create",
  ROLE_UPDATE: "role.update",
  ROLE_DELETE: "role.delete",

  // Lead Lifecycle & Assignments
  LEAD_CREATE: "lead.create",
  LEAD_UPDATE: "lead.update",
  LEAD_DELETE: "lead.delete",
  LEAD_ASSIGN: "lead.assign",
  LEAD_BULK_ASSIGN: "lead.bulk_assign",
  LEAD_REASSIGN_OFFBOARD: "staff.leads_reassigned",

  // Integrations & API Keys
  INTEGRATION_KEY_ROTATE: "integration.key_rotate",
  INTEGRATION_CONFIG_UPDATE: "integration.config_update",

  // Calling & Device Management (Phases 14, 15, 16)
  DEVICE_REGISTER: "device.register",
  DEVICE_REVOKE: "device.revoke",
  RECORDING_LISTEN: "recording.listen",
  RECORDING_DOWNLOAD: "recording.download",
  RECORDING_DELETE: "recording.delete",
}

/**
 * Extracts and normalizes client IP from request.
 */
function extractClientIp(req) {
  if (!req) return "unknown"
  const forwarded = req.headers ? req.headers["x-forwarded-for"] : null
  if (forwarded && typeof forwarded === "string") {
    return forwarded.split(",")[0].trim()
  }
  return req.ip || req.socket?.remoteAddress || "unknown"
}

/**
 * Extracts and normalizes user agent string from request.
 */
function extractUserAgent(req) {
  if (!req || !req.headers) return "unknown"
  return req.headers["user-agent"] || "unknown"
}

/**
 * Resolves the authenticated tenant ID from context, request, or actor.
 */
function resolveTenantId({ tenantId, req, actor }) {
  if (tenantId && typeof tenantId === "string" && tenantId.trim()) {
    return tenantId.trim()
  }
  const alsTenant = getTenantContext()
  if (alsTenant && typeof alsTenant === "string" && alsTenant.trim()) {
    return alsTenant.trim()
  }
  if (req?.user?.tenantId) {
    return req.user.tenantId.trim()
  }
  if (req?.tenantId) {
    return req.tenantId.trim()
  }
  if (actor?.tenantId) {
    return actor.tenantId.trim()
  }
  if (actor?.role === "super_admin" || req?.user?.role === "super_admin") {
    return "super_admin"
  }
  return "system"
}

/**
 * Resolves normalized actor details from actor parameter or request user.
 */
function resolveActor({ actor, req }) {
  const source = actor || req?.user
  if (!source) {
    return {
      id: null,
      name: "System",
      email: "system@leads365.internal",
      role: "system",
    }
  }

  const rawId = source._id || source.id || null
  const actorId = rawId && mongoose.Types.ObjectId.isValid(rawId) ? new mongoose.Types.ObjectId(rawId) : null

  return {
    id: actorId,
    name: source.name || "System",
    email: (source.email || "system@leads365.internal").toLowerCase().trim(),
    role: source.role || "unknown",
  }
}

/**
 * Central audit logging helper.
 * Strictly derives context from server state, sanitizes details, and saves immutably.
 * Fails safely without breaking parent business transaction.
 * 
 * @param {Object} params
 * @param {string} [params.tenantId] - Tenant ID
 * @param {Object} [params.actor] - Authenticated user object
 * @param {string} params.action - Audit action identifier
 * @param {string} params.entity - Target entity type (e.g. "lead", "staff", "role")
 * @param {any} [params.entityId] - Target entity identifier
 * @param {string} params.summary - Human-readable summary of the action
 * @param {Object} [params.details] - Additional metadata or before/after diff
 * @param {string} [params.ip] - Client IP
 * @param {string} [params.userAgent] - Client User-Agent
 * @param {Object} [params.req] - Express request object for automatic IP, UA, and actor resolution
 * @returns {Promise<AuditLog|null>} Created audit log document
 */
async function log({
  tenantId,
  actor,
  action,
  entity,
  entityId = null,
  summary,
  details = null,
  ip = null,
  userAgent = null,
  req = null,
} = {}) {
  try {
    if (!action || !entity || !summary) {
      console.warn("Audit log call missing required action, entity, or summary. Payload:", { action, entity })
      return null
    }

    const resolvedTenant = resolveTenantId({ tenantId, req, actor })
    const resolvedActor = resolveActor({ actor, req })
    const resolvedIp = ip || extractClientIp(req)
    const resolvedUserAgent = userAgent || extractUserAgent(req)
    const sanitizedDetails = details ? sanitizeAuditDetails(details) : null

    let normalizedEntityId = entityId
    if (entityId && typeof entityId === "object" && entityId._id) {
      normalizedEntityId = entityId._id.toString()
    } else if (entityId && typeof entityId.toString === "function") {
      normalizedEntityId = entityId.toString()
    }

    // Persist log entry within the target tenant's ambient context
    const auditRecord = await runWithTenantContext(resolvedTenant, async () => {
      const entry = new AuditLog({
        tenantId: resolvedTenant,
        actor: resolvedActor,
        action,
        entity,
        entityId: normalizedEntityId,
        summary,
        details: sanitizedDetails,
        ip: resolvedIp,
        userAgent: resolvedUserAgent,
        timestamp: new Date(),
      })
      return entry.save()
    })

    return auditRecord
  } catch (err) {
    // Fail-safe: Primary business operation must not crash, but emit high-priority security alert
    console.error("🚨 [CRITICAL_SECURITY_AUDIT_FAILURE] Failed to write immutable audit record:", {
      timestamp: new Date().toISOString(),
      action,
      entity,
      entityId,
      summary,
      error: err.message,
      stack: err.stack,
    })
    return null
  }
}

/**
 * Queries audit logs with tenant isolation, search, filtering, and pagination.
 */
async function queryLogs({
  tenantId,
  action,
  entity,
  actorId,
  search,
  startDate,
  endDate,
  page = 1,
  limit = 25,
  isSuperAdmin = false,
} = {}) {
  if (!tenantId && !isSuperAdmin) {
    throw new Error("Tenant context is required to query audit logs")
  }

  const pageNum = Math.max(1, Number(page) || 1)
  const limitNum = Math.max(1, Math.min(100, Number(limit) || 25))
  const skip = (pageNum - 1) * limitNum

  const query = {}

  if (tenantId) {
    query.tenantId = tenantId.trim()
  }

  if (entity && entity !== "all") {
    query.entity = entity.trim()
  }

  if (action && action !== "all") {
    query.action = action.trim()
  }

  if (actorId && actorId !== "all") {
    if (mongoose.Types.ObjectId.isValid(actorId)) {
      query["actor.id"] = new mongoose.Types.ObjectId(actorId)
    } else {
      query["actor.email"] = actorId.toLowerCase().trim()
    }
  }

  if (startDate || endDate) {
    query.timestamp = {}
    if (startDate) {
      const start = new Date(startDate)
      if (!isNaN(start.getTime())) {
        query.timestamp.$gte = start
      }
    }
    if (endDate) {
      const end = new Date(endDate)
      if (!isNaN(end.getTime())) {
        // Include full day if only date is passed
        if (endDate.length <= 10) {
          end.setHours(23, 59, 59, 999)
        }
        query.timestamp.$lte = end
      }
    }
  }

  if (search && typeof search === "string" && search.trim()) {
    const escaped = search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    const regex = new RegExp(escaped, "i")
    query.$or = [
      { summary: regex },
      { "actor.name": regex },
      { "actor.email": regex },
      { action: regex },
      { entity: regex },
      { ip: regex },
    ]
  }

  const [logs, total] = await Promise.all([
    AuditLog.find(query)
      .sort({ timestamp: -1 })
      .skip(skip)
      .limit(limitNum)
      .lean(),
    AuditLog.countDocuments(query),
  ])

  const totalPages = Math.ceil(total / limitNum) || 1

  return {
    logs,
    total,
    page: pageNum,
    totalPages,
    limit: limitNum,
  }
}

/**
 * Retrieves a single audit log entry by ID, strictly verifying tenant ownership.
 */
async function getLogById(logId, tenantId, isSuperAdmin = false) {
  if (!mongoose.Types.ObjectId.isValid(logId)) {
    return null
  }

  const query = { _id: logId }
  if (!isSuperAdmin && tenantId) {
    query.tenantId = tenantId.trim()
  }

  return AuditLog.findOne(query).lean()
}

/**
 * Fetches distinct actions and entities available for a tenant for UI filters.
 */
async function getDistinctActionsAndEntities(tenantId, isSuperAdmin = false) {
  const query = {}
  if (!isSuperAdmin && tenantId) {
    query.tenantId = tenantId.trim()
  }

  const [actions, entities] = await Promise.all([
    AuditLog.distinct("action", query),
    AuditLog.distinct("entity", query),
  ])

  return {
    actions: actions.sort(),
    entities: entities.sort(),
  }
}

/**
 * Cleans up audit logs older than the tenant retention window (supports Phase 9 scheduler).
 * Default retention is 90 days.
 */
async function cleanupExpiredLogs(tenantId, retentionDays = 90) {
  if (!tenantId) throw new Error("Tenant ID required for retention cleanup")

  const days = Math.max(30, Number(retentionDays) || 90)
  const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

  // Direct collection deletion bypassing immutability middleware for retention maintenance
  const result = await AuditLog.collection.deleteMany({
    tenantId,
    timestamp: { $lt: cutoffDate },
  })

  return {
    deletedCount: result.deletedCount || 0,
    cutoffDate,
    retentionDays: days,
  }
}

module.exports = {
  log,
  queryLogs,
  getLogById,
  getDistinctActionsAndEntities,
  cleanupExpiredLogs,
  computeAuditDiff,
  AUDIT_ACTIONS,
}
