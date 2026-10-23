const mongoose = require("mongoose")
const FollowUp = require("../models/FollowUp")
const Lead = require("../models/Lead")

// Escape special regex characters
const escapeRegex = (str) => {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

// Allowed sort fields
const ALLOWED_SORT_FIELDS = ["scheduledAt", "createdAt", "updatedAt", "priority", "status", "type"]

// Determine effective tenant partition
const getEffectiveTenant = (req) => {
  if (req.user?.role === "super_admin") {
    const requestedTenant = typeof req.query?.tenantId === "string" ? req.query.tenantId.trim() : null
    return { tenantId: requestedTenant, isSuperAdmin: true }
  }

  if (req.user?.tenantId) {
    return { tenantId: req.user.tenantId, isSuperAdmin: false }
  }

  return { tenantId: null, isSuperAdmin: false }
}

// Consistent transformation helper for follow-up responses
const formatFollowUp = (f) => {
  if (!f) return null
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0)
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999)

  const isOverdue = f.status === "pending" && new Date(f.scheduledAt) < now
  const isToday =
    f.status === "pending" &&
    new Date(f.scheduledAt) >= startOfToday &&
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

      query.$or = [
        { title: { $regex: sanitized, $options: "i" } },
        { notes: { $regex: sanitized, $options: "i" } },
        { assignedTo: { $regex: sanitized, $options: "i" } },
        { leadId: { $in: matchingLeadIds } },
      ]
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

    const now = new Date()
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0)
    const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999)

    const [total, upcoming, overdue, today, completed] = await Promise.all([
      FollowUp.countDocuments(baseQuery),
      FollowUp.countDocuments({ ...baseQuery, status: "pending", scheduledAt: { $gte: now } }),
      FollowUp.countDocuments({ ...baseQuery, status: "pending", scheduledAt: { $lt: now } }),
      FollowUp.countDocuments({
        ...baseQuery,
        status: "pending",
        scheduledAt: { $gte: startOfToday, $lte: endOfToday },
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
    let assignedTenant = effectiveTenantId
    if (isSuperAdmin) {
      assignedTenant = bodyTenantId || effectiveTenantId || "default-tenant"
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

    const followUp = new FollowUp({
      leadId: lead._id,
      tenantId: assignedTenant,
      title: (title || `${normalizedType.charAt(0).toUpperCase() + normalizedType.slice(1)} with ${lead.name}`).trim(),
      type: normalizedType,
      scheduledAt: scheduledDate,
      status: "pending",
      priority: normalizedPriority,
      notes: typeof notes === "string" ? notes.trim() : "",
      assignedTo: (assignedTo || lead.assignedTo || req.user.name || "Unassigned").trim(),
      createdBy: req.user.name || req.user.email || "User",
    })

    const saved = await followUp.save()

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

    const deleted = await FollowUp.findOneAndDelete(query)
    if (!deleted) {
      res.status(404).json({ success: false, error: "Follow-up not found" })
      return
    }

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
