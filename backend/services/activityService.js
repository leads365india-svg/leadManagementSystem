const mongoose = require("mongoose")
const { Activity, ALLOWED_ACTIVITY_TYPES } = require("../models/Activity")
const Lead = require("../models/Lead")
const { getTenantContext, runWithTenantContext } = require("../middleware/tenantContext")
const { sanitizeAuditDetails } = require("../utils/auditSanitizer")

/**
 * Activity Service - Roadmap Phase 10: Lead Detail Drawer & Activity Timeline
 * 
 * Centralized service for recording and retrieving lead timeline activity events.
 * Strictly enforces tenant boundaries and validates that the referenced lead
 * exists and belongs to the caller's tenant.
 */

class ActivityService {
  /**
   * Record a new activity event for a lead.
   * 
   * @param {Object} params
   * @param {string} [params.tenantId] - Target tenant identifier (falls back to ambient context/req)
   * @param {string|mongoose.Types.ObjectId} params.leadId - Target lead ObjectId
   * @param {string} params.type - Activity type (e.g. 'lead.created', 'lead.status_changed')
   * @param {Object} [params.actor] - Actor details ({ id, name, email, role })
   * @param {Object} [params.payload] - Event payload / metadata diffs
   * @param {Object} [params.req] - Express request for contextual actor derivation
   * @returns {Promise<Object>} Created Activity document
   */
  async record({ tenantId, leadId, type, actor, payload = {}, req } = {}) {
    // 1. Resolve Effective Tenant ID
    let effectiveTenantId = tenantId
    if (!effectiveTenantId && req) {
      effectiveTenantId = req.user?.tenantId || req.tenantId
    }
    if (!effectiveTenantId) {
      const ambientContext = getTenantContext()
      if (ambientContext?.tenantId) {
        effectiveTenantId = ambientContext.tenantId
      }
    }

    if (!effectiveTenantId || typeof effectiveTenantId !== "string" || !effectiveTenantId.trim()) {
      throw new Error("Tenant context is required to record activity")
    }
    effectiveTenantId = effectiveTenantId.trim()

    // 2. Validate Lead ID Format
    if (!leadId || !mongoose.Types.ObjectId.isValid(leadId)) {
      throw new Error("Valid leadId is required to record activity")
    }

    // 3. Validate Type
    if (!type || typeof type !== "string" || !type.trim()) {
      throw new Error("Valid activity type is required")
    }
    const normalizedType = type.trim()
    if (!ALLOWED_ACTIVITY_TYPES.includes(normalizedType)) {
      throw new Error(`Invalid activity type: '${normalizedType}'`)
    }

    // 4. Validate Lead Existence and Tenant Matching (Strict Tenant Boundary Enforcement)
    // Query directly with tenant filter to prevent cross-tenant activity injection
    const targetLead = await Lead.findOne({
      _id: leadId,
      tenantId: effectiveTenantId,
    }).lean()

    if (!targetLead) {
      throw new Error(`Lead ${leadId} not found or tenant mismatch in tenant ${effectiveTenantId}`)
    }

    // 5. Derive Actor Context
    let resolvedActor = {
      name: "System",
      email: "",
      role: "system",
      id: null,
    }

    if (actor && typeof actor === "object") {
      const rawActorId = actor.id || actor._id
      resolvedActor = {
        name: actor.name || "System",
        email: actor.email || "",
        role: actor.role || "system",
        id: rawActorId && mongoose.Types.ObjectId.isValid(rawActorId) ? rawActorId : null,
      }
    } else if (req?.user) {
      resolvedActor = {
        name: req.user.name || "User",
        email: req.user.email || "",
        role: req.user.role || "user",
        id: req.user._id || req.user.id || null,
      }
    }

    // 6. Sanitize Payload (strip sensitive tokens, passwords, keys)
    const sanitizedPayload = sanitizeAuditDetails(payload || {})

    // 7. Persist Activity
    const activityDoc = new Activity({
      tenantId: effectiveTenantId,
      leadId: targetLead._id,
      type: normalizedType,
      actor: resolvedActor,
      payload: sanitizedPayload,
      createdAt: new Date(),
    })

    const savedActivity = await activityDoc.save()
    return savedActivity
  }

  /**
   * Retrieve timeline activities for a lead within tenant boundaries.
   * 
   * @param {string|mongoose.Types.ObjectId} leadId - Lead ID
   * @param {Object} [options]
   * @param {string} [options.tenantId] - Explicit tenant filter
   * @param {string} [options.type] - Filter by specific activity type
   * @param {number} [options.limit=50] - Number of items
   * @param {number} [options.page=1] - Page number
   * @returns {Promise<Array>} List of activity items
   */
  async getLeadActivities(leadId, options = {}) {
    if (!leadId || !mongoose.Types.ObjectId.isValid(leadId)) {
      throw new Error("Valid leadId is required to fetch activities")
    }

    let effectiveTenantId = options.tenantId
    if (!effectiveTenantId) {
      const ambient = getTenantContext()
      if (ambient?.tenantId) {
        effectiveTenantId = ambient.tenantId
      }
    }

    const query = { leadId }
    if (effectiveTenantId) {
      query.tenantId = effectiveTenantId
    }

    if (options.type && typeof options.type === "string" && options.type.trim()) {
      query.type = options.type.trim()
    }

    const limit = Math.max(1, Math.min(100, Number(options.limit) || 50))
    const page = Math.max(1, Number(options.page) || 1)
    const skip = (page - 1) * limit

    const activities = await Activity.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean()

    return activities
  }
}

const activityService = new ActivityService()

// Centralized helper export pattern: activity.record(...)
const activity = {
  record: activityService.record.bind(activityService),
  getLeadActivities: activityService.getLeadActivities.bind(activityService),
}

module.exports = {
  activityService,
  activity,
  ALLOWED_ACTIVITY_TYPES,
}
