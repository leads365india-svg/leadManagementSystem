const mongoose = require("mongoose")
const FollowUp = require("../models/FollowUp")
const Lead = require("../models/Lead")

// Escape special regex characters
const escapeRegex = (str) => {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

const ALLOWED_SORT_FIELDS = ["scheduledAt", "createdAt", "updatedAt", "priority", "status", "type"]
const { getEffectiveTenant } = require("../middleware/tenantContext")
const { scopeFilter, checkDirectObjectAccess } = require("../utils/rbacScope")

// Consistent transformation helper for follow-up responses
const formatFollowUp = (f) => {
  if (!f) return null
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0)
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999)

  const isOverdue = f.status === "pending" && new Date(f.scheduledAt) < now
  const isToday =
    f.status === "pending" &&
    new Date(f.scheduledAt) >= now &&
    new Date(f.scheduledAt) <= endOfToday

  const leadObj = f.leadId && typeof f.leadId === "object" ? f.leadId : null
  const leadIdStr = leadObj
    ? (leadObj._id || leadObj.id || "").toString()
    : f.leadId
    ? f.leadId.toString()
    : null

  const idStr = (f._id || f.id).toString()

  return {
    ...f,
    _id: idStr,
    id: idStr,
    leadId: leadIdStr,
    lead: leadObj
      ? {
          _id: (leadObj._id || leadObj.id).toString(),
          id: (leadObj._id || leadObj.id).toString(),
          name: leadObj.name,
          email: leadObj.email || "",
          phone: leadObj.phone || "",
          company: leadObj.company || leadObj.metadata?.company || "",
          status: leadObj.status || "New",
          source: leadObj.source || "Website",
          assignedTo: leadObj.assignedTo || "Unassigned",
        }
      : null,
    title: f.title,
    type: f.type,
    scheduledAt: f.scheduledAt,
    status: f.status,
    priority: f.priority,
    notes: f.notes || "",
    assignedTo: f.assignedTo || "Unassigned",
    assignedStaffId: f.assignedStaffId || "unassigned",
    completedAt: f.completedAt,
    completedBy: f.completedBy,
    completionNotes: f.completionNotes || "",
    createdBy: f.createdBy,
    isOverdue,
    isToday,
    tenantId: f.tenantId,
    createdAt: f.createdAt,
    updatedAt: f.updatedAt,
  }
}

/**
 * GET /api/follow-ups
 * Retrieve paginated, filtered follow-ups with populated lead details
 */
const getFollowUps = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      search = "",
      status = "all",
      type = "all",
      priority = "all",
      leadId,
      fromDate,
      toDate,
      sortBy = "scheduledAt",
      sortOrder = "asc",
      tenantId: requestedTenantId,
    } = req.query

    const { tenantId: effectiveTenantId, isSuperAdmin } = getEffectiveTenant(req)

    if (!req.user || (!effectiveTenantId && !isSuperAdmin)) {
      res.status(401).json({
        success: false,
        error: "Authentication required to access follow-ups.",
      })
      return
    }

    // Cross-tenant security check
    if (!isSuperAdmin && requestedTenantId && requestedTenantId !== effectiveTenantId) {
      res.status(403).json({
        success: false,
        error: "Access denied. Cross-tenant access is prohibited.",
      })
      return
    }

    const pageNum = Math.max(1, Number(page) || 1)
    const limitNum = Math.max(1, Math.min(100, Number(limit) || 10))
    const skip = (pageNum - 1) * limitNum

    // Base query with tenant isolation
    const query = {}
    if (effectiveTenantId) {
      query.tenantId = effectiveTenantId
    }

    // Apply RBAC scope filter (own / team / all)
    const rbacQuery = await scopeFilter(req.user, "followups", "view")
    if (rbacQuery._id !== undefined) {
      query._id = rbacQuery._id // Fails closed if unauthorized
    } else if (rbacQuery.$or) {
      query.$or = rbacQuery.$or
    }

    // Specific lead filter
    if (leadId && mongoose.Types.ObjectId.isValid(leadId)) {
      query.leadId = leadId
    }

    // Status filtering with timeline definitions
    const now = new Date()
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0)
    const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999)

    const normalizedStatus = (status || "all").toLowerCase().trim()
    if (normalizedStatus === "upcoming") {
      query.status = "pending"
      query.scheduledAt = { $gte: now }
    } else if (normalizedStatus === "overdue") {
      query.status = "pending"
      query.scheduledAt = { $lt: now }
    } else if (normalizedStatus === "today") {
      query.status = "pending"
      query.scheduledAt = { $gte: startOfToday, $lte: endOfToday }
    } else if (normalizedStatus === "completed") {
      query.status = "completed"
    } else if (normalizedStatus === "pending") {
      query.status = "pending"
    } else if (normalizedStatus === "cancelled") {
      query.status = "cancelled"
    }

    // Type filter
    if (type && type !== "all") {
      query.type = type.toLowerCase().trim()
    }

    // Priority filter
    if (priority && priority !== "all") {
      query.priority = priority.toLowerCase().trim()
    }

    // Date range filter
    if (fromDate || toDate) {
      query.scheduledAt = query.scheduledAt || {}
      if (fromDate) {
        const fromD = new Date(fromDate)
        if (!isNaN(fromD.getTime())) query.scheduledAt.$gte = fromD
      }
      if (toDate) {
        const toD = new Date(toDate)
        if (!isNaN(toD.getTime())) {
          toD.setHours(23, 59, 59, 999)
          query.scheduledAt.$lte = toD
        }
      }
    }

    // Search filter across title, notes, and populated lead properties
    if (typeof search === "string" && search.trim()) {
      const sanitized = escapeRegex(search.trim())
      const leadSearchQuery = {
        $or: [
          { name: { $regex: sanitized, $options: "i" } },
          { email: { $regex: sanitized, $options: "i" } },
          { phone: { $regex: sanitized, $options: "i" } },
          { "metadata.company": { $regex: sanitized, $options: "i" } },
        ],
      }
      if (effectiveTenantId) {
        leadSearchQuery.tenantId = effectiveTenantId
      }

      const matchingLeads = await Lead.find(leadSearchQuery).select("_id").lean()
      const matchingLeadIds = matchingLeads.map((l) => l._id)

      const searchConditions = [
        { title: { $regex: sanitized, $options: "i" } },
        { notes: { $regex: sanitized, $options: "i" } },
        { assignedTo: { $regex: sanitized, $options: "i" } },
        { leadId: { $in: matchingLeadIds } },
      ]

      if (query.$or) {
        query.$and = [{ $or: query.$or }, { $or: searchConditions }]
        delete query.$or
      } else {
        query.$or = searchConditions
      }
    }

    // Sorting
    const sortField = ALLOWED_SORT_FIELDS.includes(sortBy) ? sortBy : "scheduledAt"
    const sortConfig = {}
    sortConfig[sortField] = sortOrder === "desc" ? -1 : 1

    const [followUps, total] = await Promise.all([
      FollowUp.find(query)
        .sort(sortConfig)
        .skip(skip)
        .limit(limitNum)
        .populate("leadId", "name email phone status metadata source assignedTo")
        .lean(),
      FollowUp.countDocuments(query),
    ])

    const totalPages = Math.ceil(total / limitNum) || 1

    // Transform follow-ups with computed flags and flattened lead details
    const transformed = followUps.map(formatFollowUp)

    res.status(200).json({
      success: true,
      data: {
        followUps: transformed,
        total,
        page: pageNum,
        limit: limitNum,
        totalPages,
      },
    })
  } catch (error) {
    console.error("Error fetching follow-ups:", error)
    res.status(500).json({
      success: false,
      error: "Internal server error fetching follow-ups",
    })
  }
}

/**
 * GET /api/follow-ups/stats
 * Real-time counts for upcoming, overdue, today, and completed follow-ups
 */
const getFollowUpStats = async (req, res) => {
  try {
    const { tenantId: effectiveTenantId, isSuperAdmin } = getEffectiveTenant(req)

    if (!req.user || (!effectiveTenantId && !isSuperAdmin)) {
      res.status(401).json({
        success: false,
        error: "Authentication required to view follow-up statistics.",
      })
      return
    }

    const baseQuery = {}
    if (!isSuperAdmin && effectiveTenantId) {
      baseQuery.tenantId = effectiveTenantId
    } else if (isSuperAdmin && typeof req.query?.tenantId === "string") {
      baseQuery.tenantId = req.query.tenantId.trim()
    }

    const rbacQuery = await scopeFilter(req.user, "followups", "view")
    if (rbacQuery._id !== undefined) {
      baseQuery._id = rbacQuery._id
    } else if (rbacQuery.$or) {
      baseQuery.$or = rbacQuery.$or
    }

    const now = new Date()
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0)
    const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999)

    const [total, upcoming, overdue, today, completed] = await Promise.all([
      FollowUp.countDocuments(baseQuery),
      FollowUp.countDocuments({ ...baseQuery, status: "pending", scheduledAt: { $gt: endOfToday } }),
      FollowUp.countDocuments({ ...baseQuery, status: "pending", scheduledAt: { $lt: now } }),
      FollowUp.countDocuments({
        ...baseQuery,
        status: "pending",
        scheduledAt: { $gte: now, $lte: endOfToday },
      }),
      FollowUp.countDocuments({ ...baseQuery, status: "completed" }),
    ])

    const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0

    res.status(200).json({
      success: true,
      data: {
        total,
        upcoming,
        overdue,
        today,
        completed,
        completionRate,
      },
    })
  } catch (error) {
    console.error("Error fetching follow-up stats:", error)
    res.status(500).json({
      success: false,
      error: "Internal server error fetching follow-up statistics",
    })
  }
}

/**
 * GET /api/follow-ups/:id
 * Retrieve a single follow-up by ID with full linked lead details
 */
const getFollowUpById = async (req, res) => {
  try {
    const { id } = req.params

    if (!mongoose.Types.ObjectId.isValid(id)) {
      res.status(400).json({
        success: false,
        error: "Invalid follow-up ID format",
      })
      return
    }

    const { tenantId: effectiveTenantId, isSuperAdmin } = getEffectiveTenant(req)

    if (!req.user || (!effectiveTenantId && !isSuperAdmin)) {
      res.status(401).json({
        success: false,
        error: "Authentication required to view follow-up.",
      })
      return
    }

    const query = { _id: id }
    if (!isSuperAdmin && effectiveTenantId) {
      query.tenantId = effectiveTenantId
    }

    const followUp = await FollowUp.findOne(query)
      .populate("leadId", "name email phone status metadata source assignedTo")
      .lean()

    if (!followUp) {
      res.status(404).json({
        success: false,
        error: "Follow-up not found",
      })
      return
    }

    const access = await checkDirectObjectAccess(req.user, followUp, "followups", "view")
    if (!access.allowed) {
      res.status(403).json({
        success: false,
        error: access.reason || "Access denied. Outside assigned scope.",
      })
      return
    }

    const now = new Date()
    const isOverdue = followUp.status === "pending" && new Date(followUp.scheduledAt) < now

    res.status(200).json({
      success: true,
      data: formatFollowUp(followUp),
    })
  } catch (error) {
    console.error("Error fetching follow-up by ID:", error)
    res.status(500).json({
      success: false,
      error: "Internal server error",
    })
  }
}

/**
 * POST /api/follow-ups
 * Create a new follow-up linked to an existing lead within the tenant
 */
const createFollowUp = async (req, res) => {
  try {
    const {
      leadId,
      title,
      type = "call",
      scheduledAt,
      priority = "medium",
      notes = "",
      assignedTo,
      tenantId: bodyTenantId,
    } = req.body

    const { tenantId: effectiveTenantId, isSuperAdmin } = getEffectiveTenant(req)

    if (!req.user || (!effectiveTenantId && !isSuperAdmin)) {
      res.status(401).json({
        success: false,
        error: "Authentication required to create follow-ups.",
      })
      return
    }

    // Determine target tenant
    let assignedTenant = effectiveTenantId || req.user.tenantId
    if (isSuperAdmin) {
      assignedTenant = bodyTenantId || effectiveTenantId || req.user.tenantId || "default-tenant"
    } else if (bodyTenantId && bodyTenantId !== effectiveTenantId) {
      res.status(403).json({
        success: false,
        error: "Access denied. Cross-tenant follow-up creation is forbidden.",
      })
      return
    }

    // Validate Lead ID
    if (!leadId || !mongoose.Types.ObjectId.isValid(leadId)) {
      res.status(400).json({
        success: false,
        error: "A valid existing lead ID is required to schedule a follow-up.",
      })
      return
    }

    // Validate that the linked Lead exists within the caller's tenant
    const leadQuery = { _id: leadId }
    if (!isSuperAdmin) {
      leadQuery.tenantId = assignedTenant
    }
    const lead = await Lead.findOne(leadQuery)
    if (!lead) {
      res.status(404).json({
        success: false,
        error: "Linked lead not found or does not belong to your account.",
      })
      return
    }

    if (lead.tenantId) {
      assignedTenant = lead.tenantId
    }

    const leadAccess = await checkDirectObjectAccess(req.user, lead, "leads", "view")
    if (!leadAccess.allowed) {
      res.status(403).json({
        success: false,
        error: leadAccess.reason || "Cannot create follow-up for a lead outside your assigned scope.",
      })
      return
    }

    // Validate scheduledAt
    if (!scheduledAt) {
      res.status(400).json({
        success: false,
        error: "Follow-up date and time is required.",
      })
      return
    }
    const scheduledDate = new Date(scheduledAt)
    if (isNaN(scheduledDate.getTime())) {
      res.status(400).json({
        success: false,
        error: "Invalid scheduled date and time format.",
      })
      return
    }

    // Validate type
    const ALLOWED_TYPES = ["call", "email", "meeting", "task", "other"]
    const normalizedType = (type || "call").toLowerCase().trim()
    if (!ALLOWED_TYPES.includes(normalizedType)) {
      res.status(400).json({
        success: false,
        error: `Invalid follow-up type. Must be one of: ${ALLOWED_TYPES.join(", ")}`,
      })
      return
    }

    // Validate priority
    const ALLOWED_PRIORITIES = ["low", "medium", "high"]
    const normalizedPriority = (priority || "medium").toLowerCase().trim()
    if (!ALLOWED_PRIORITIES.includes(normalizedPriority)) {
      res.status(400).json({
        success: false,
        error: `Invalid priority. Must be one of: ${ALLOWED_PRIORITIES.join(", ")}`,
      })
      return
    }

    const defaultAssignedTo = (assignedTo || lead.assignedTo || req.user.name || "Unassigned").trim()
    const defaultAssignedStaffId = req.body.assignedStaffId || (req.user?.role === "agent" ? req.user.id : "unassigned")

    // Deduplication & Idempotency check:
    // Only call-generated follow-ups (with sourceCallId or explicit idempotencyKey) are deduplicated.
    // Never deduplicate independent manual reminders using scheduled time alone.
    let existingFollowUp = null
    const sourceCallIdTrimmed = typeof req.body.sourceCallId === "string" && req.body.sourceCallId.trim()
      ? req.body.sourceCallId.trim()
      : null
    const idempotencyKeyTrimmed = typeof req.body.idempotencyKey === "string" && req.body.idempotencyKey.trim()
      ? req.body.idempotencyKey.trim()
      : null

    if (sourceCallIdTrimmed) {
      existingFollowUp = await FollowUp.findOne({
        tenantId: assignedTenant,
        sourceCallId: sourceCallIdTrimmed,
      })
    }

    if (!existingFollowUp && idempotencyKeyTrimmed) {
      existingFollowUp = await FollowUp.findOne({
        tenantId: assignedTenant,
        idempotencyKey: idempotencyKeyTrimmed,
      })
    }

    if (existingFollowUp) {
      // If already completed, preserve completed status and return existing record
      if (existingFollowUp.status === "completed") {
        const populated = await FollowUp.findById(existingFollowUp._id)
          .populate("leadId", "name email phone status metadata source assignedTo")
          .lean()
        return res.status(200).json({
          success: true,
          data: formatFollowUp(populated),
          message: "Follow-up was already completed (idempotent)",
          isDuplicate: true,
        })
      }

      // Update/reuse existing pending record instead of inserting another
      if (title && title.trim()) {
        existingFollowUp.title = title.trim()
      }
      if (typeof notes === "string" && notes.trim() && !existingFollowUp.notes.includes(notes.trim())) {
        existingFollowUp.notes = existingFollowUp.notes ? `${existingFollowUp.notes}\n${notes.trim()}` : notes.trim()
      }
      if (priority) {
        existingFollowUp.priority = normalizedPriority
      }
      if (sourceCallIdTrimmed && !existingFollowUp.sourceCallId) {
        existingFollowUp.sourceCallId = sourceCallIdTrimmed
      }
      existingFollowUp.scheduledAt = scheduledDate
      await existingFollowUp.save()

      const populated = await FollowUp.findById(existingFollowUp._id)
        .populate("leadId", "name email phone status metadata source assignedTo")
        .lean()

      return res.status(200).json({
        success: true,
        data: formatFollowUp(populated),
        message: "Existing follow-up reused and updated (idempotent)",
        isDuplicate: true,
      })
    }

    const followUp = new FollowUp({
      leadId: lead._id,
      tenantId: assignedTenant,
      title: (title || `${normalizedType.charAt(0).toUpperCase() + normalizedType.slice(1)} with ${lead.name}`).trim(),
      type: normalizedType,
      scheduledAt: scheduledDate,
      status: "pending",
      priority: normalizedPriority,
      notes: typeof notes === "string" ? notes.trim() : "",
      assignedTo: defaultAssignedTo,
      assignedStaffId: defaultAssignedStaffId,
      createdBy: req.user.name || req.user.email || "User",
      sourceCallId: sourceCallIdTrimmed || null,
      idempotencyKey: idempotencyKeyTrimmed || null,
    })

    let saved
    try {
      saved = await followUp.save()
    } catch (saveErr) {
      // Concurrency race protection: another request created the follow-up with same unique key
      if (saveErr.code === 11000 && (sourceCallIdTrimmed || idempotencyKeyTrimmed)) {
        const raceExisting = await FollowUp.findOne({
          tenantId: assignedTenant,
          $or: [
            ...(sourceCallIdTrimmed ? [{ sourceCallId: sourceCallIdTrimmed }] : []),
            ...(idempotencyKeyTrimmed ? [{ idempotencyKey: idempotencyKeyTrimmed }] : []),
          ],
        })
        if (raceExisting) {
          const populated = await FollowUp.findById(raceExisting._id)
            .populate("leadId", "name email phone status metadata source assignedTo")
            .lean()
          return res.status(200).json({
            success: true,
            data: formatFollowUp(populated),
            message: "Existing follow-up returned (concurrency safe)",
            isDuplicate: true,
          })
        }
      }
      throw saveErr
    }

    // Update lead metadata tracking
    try {
      const nextMeta = { ...(lead.metadata || {}), lastFollowUpScheduled: new Date() }
      await Lead.findByIdAndUpdate(lead._id, { metadata: nextMeta })
    } catch (_) {}

    const populated = await FollowUp.findById(saved._id)
      .populate("leadId", "name email phone status metadata source assignedTo")
      .lean()

    res.status(201).json({
      success: true,
      data: formatFollowUp(populated),
      message: "Follow-up scheduled successfully",
    })
  } catch (error) {
    console.error("Error creating follow-up:", error)
    if (error.name === "ValidationError") {
      const errors = Object.values(error.errors).map((e) => e.message)
      res.status(400).json({ success: false, error: errors.join(", ") })
    } else {
      res.status(500).json({ success: false, error: "Internal server error scheduling follow-up" })
    }
  }
}

/**
 * PUT /api/follow-ups/:id
 * Update an existing follow-up
 */
const updateFollowUp = async (req, res) => {
  try {
    const { id } = req.params
    const { title, type, scheduledAt, priority, notes, assignedTo, status } = req.body

    if (!mongoose.Types.ObjectId.isValid(id)) {
      res.status(400).json({ success: false, error: "Invalid follow-up ID format" })
      return
    }

    const { tenantId: effectiveTenantId, isSuperAdmin } = getEffectiveTenant(req)

    if (!req.user || (!effectiveTenantId && !isSuperAdmin)) {
      res.status(401).json({ success: false, error: "Authentication required to update follow-up." })
      return
    }

    const query = { _id: id }
    if (!isSuperAdmin && effectiveTenantId) {
      query.tenantId = effectiveTenantId
    }

    const followUp = await FollowUp.findOne(query)
    if (!followUp) {
      res.status(404).json({ success: false, error: "Follow-up not found" })
      return
    }

    const access = await checkDirectObjectAccess(req.user, followUp, "followups", "manage")
    if (!access.allowed) {
      res.status(403).json({
        success: false,
        error: access.reason || "Access denied. Outside assigned scope.",
      })
      return
    }

    const updates = {}

    if (title && typeof title === "string" && title.trim()) {
      updates.title = title.trim()
    }

    if (type !== undefined) {
      const ALLOWED_TYPES = ["call", "email", "meeting", "task", "other"]
      const normalizedType = type.toLowerCase().trim()
      if (!ALLOWED_TYPES.includes(normalizedType)) {
        res.status(400).json({
          success: false,
          error: `Invalid type. Allowed: ${ALLOWED_TYPES.join(", ")}`,
        })
        return
      }
      updates.type = normalizedType
    }

    if (scheduledAt !== undefined) {
      const sDate = new Date(scheduledAt)
      if (isNaN(sDate.getTime())) {
        res.status(400).json({ success: false, error: "Invalid scheduled date and time format" })
        return
      }
      updates.scheduledAt = sDate
    }

    if (priority !== undefined) {
      const ALLOWED_PRIORITIES = ["low", "medium", "high"]
      const normalizedPriority = priority.toLowerCase().trim()
      if (!ALLOWED_PRIORITIES.includes(normalizedPriority)) {
        res.status(400).json({
          success: false,
          error: `Invalid priority. Allowed: ${ALLOWED_PRIORITIES.join(", ")}`,
        })
        return
      }
      updates.priority = normalizedPriority
    }

    if (status !== undefined) {
      const ALLOWED_STATUSES = ["pending", "completed", "cancelled"]
      const normalizedStatus = status.toLowerCase().trim()
      if (!ALLOWED_STATUSES.includes(normalizedStatus)) {
        res.status(400).json({
          success: false,
          error: `Invalid status. Allowed: ${ALLOWED_STATUSES.join(", ")}`,
        })
        return
      }
      updates.status = normalizedStatus
      if (normalizedStatus === "completed" && followUp.status !== "completed") {
        updates.completedAt = new Date()
        updates.completedBy = req.user.name || req.user.email || "User"
      }
    }

    if (notes !== undefined) updates.notes = typeof notes === "string" ? notes.trim() : ""
    if (assignedTo !== undefined) updates.assignedTo = typeof assignedTo === "string" ? assignedTo.trim() : "Unassigned"
    if (req.body.completionNotes !== undefined) {
      updates.completionNotes = typeof req.body.completionNotes === "string" ? req.body.completionNotes.trim() : ""
    }

    const updated = await FollowUp.findOneAndUpdate(query, updates, { new: true, runValidators: true })
      .populate("leadId", "name email phone status metadata source assignedTo")
      .lean()

    res.status(200).json({
      success: true,
      data: formatFollowUp(updated),
      message: "Follow-up updated successfully",
    })
  } catch (error) {
    console.error("Error updating follow-up:", error)
    res.status(500).json({ success: false, error: "Internal server error updating follow-up" })
  }
}

/**
 * PATCH /api/follow-ups/:id/complete
 * Dedicated endpoint to complete a follow-up with optional outcome notes
 */
const completeFollowUp = async (req, res) => {
  try {
    const { id } = req.params
    const { completionNotes = "" } = req.body

    if (!mongoose.Types.ObjectId.isValid(id)) {
      res.status(400).json({ success: false, error: "Invalid follow-up ID format" })
      return
    }

    const { tenantId: effectiveTenantId, isSuperAdmin } = getEffectiveTenant(req)

    if (!req.user || (!effectiveTenantId && !isSuperAdmin)) {
      res.status(401).json({ success: false, error: "Authentication required to complete follow-up." })
      return
    }

    const query = { _id: id }
    if (!isSuperAdmin && effectiveTenantId) {
      query.tenantId = effectiveTenantId
    }

    const followUp = await FollowUp.findOne(query)
    if (!followUp) {
      res.status(404).json({ success: false, error: "Follow-up not found" })
      return
    }

    const access = await checkDirectObjectAccess(req.user, followUp, "followups", "manage")
    if (!access.allowed) {
      res.status(403).json({
        success: false,
        error: access.reason || "Access denied. Outside assigned scope.",
      })
      return
    }

    const completed = await FollowUp.findOneAndUpdate(
      query,
      {
        status: "completed",
        completedAt: new Date(),
        completedBy: req.user.name || req.user.email || "User",
        completionNotes: typeof completionNotes === "string" ? completionNotes.trim() : "",
      },
      { new: true },
    )
      .populate("leadId", "name email phone status metadata source assignedTo")
      .lean()

    // Sync lead metadata
    try {
      if (completed.leadId?._id) {
        const lead = await Lead.findById(completed.leadId._id)
        if (lead) {
          const nextMeta = { ...(lead.metadata || {}), lastFollowUpCompleted: new Date() }
          await Lead.findByIdAndUpdate(lead._id, { metadata: nextMeta })
        }
      }
    } catch (_) {}

    res.status(200).json({
      success: true,
      data: formatFollowUp(completed),
      message: "Follow-up marked as completed",
    })
  } catch (error) {
    console.error("Error completing follow-up:", error)
    res.status(500).json({ success: false, error: "Internal server error completing follow-up" })
  }
}

/**
 * DELETE /api/follow-ups/:id
 * Delete follow-up record strictly scoped to tenant
 */
const deleteFollowUp = async (req, res) => {
  try {
    const { id } = req.params

    if (!mongoose.Types.ObjectId.isValid(id)) {
      res.status(400).json({ success: false, error: "Invalid follow-up ID format" })
      return
    }

    const { tenantId: effectiveTenantId, isSuperAdmin } = getEffectiveTenant(req)

    if (!req.user || (!effectiveTenantId && !isSuperAdmin)) {
      res.status(401).json({ success: false, error: "Authentication required to delete follow-ups." })
      return
    }

    const query = { _id: id }
    if (!isSuperAdmin && effectiveTenantId) {
      query.tenantId = effectiveTenantId
    }

    const followUp = await FollowUp.findOne(query)
    if (!followUp) {
      res.status(404).json({ success: false, error: "Follow-up not found" })
      return
    }

    const access = await checkDirectObjectAccess(req.user, followUp, "followups", "manage")
    if (!access.allowed) {
      res.status(403).json({
        success: false,
        error: access.reason || "Access denied. Outside assigned scope.",
      })
      return
    }

    await FollowUp.findOneAndDelete({ _id: followUp._id })

    res.status(200).json({
      success: true,
      message: "Follow-up deleted successfully",
    })
  } catch (error) {
    console.error("Error deleting follow-up:", error)
    res.status(500).json({ success: false, error: "Internal server error deleting follow-up" })
  }
}

module.exports = {
  getFollowUps,
  getFollowUpStats,
  getFollowUpById,
  createFollowUp,
  updateFollowUp,
  completeFollowUp,
  deleteFollowUp,
}
