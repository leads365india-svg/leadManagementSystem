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

// Timezone-aware calendar day helper for accurate follow-up metrics and status
function getTenantDayBounds(timeZone = "Asia/Kolkata") {
  const now = new Date()
  let dateStr, offsetStr = "+05:30"
  try {
    dateStr = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now)
    const parts = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "shortOffset" }).formatToParts(now)
    const tzPart = parts.find((p) => p.type === "timeZoneName")?.value || "+05:30"
    const match = tzPart.match(/GMT([+-]\d{1,2}(?::\d{2})?)/)
    if (match) {
      let raw = match[1]
      if (!raw.includes(":")) raw += ":00"
      if (raw.length === 5) raw = raw[0] + "0" + raw.slice(1)
      offsetStr = raw
    }
  } catch (_) {
    dateStr = now.toISOString().slice(0, 10)
    offsetStr = "+05:30"
  }
  const start = new Date(`${dateStr}T00:00:00.000${offsetStr}`)
  const end = new Date(`${dateStr}T23:59:59.999${offsetStr}`)
  return { start, end, now }
}

// Consistent transformation helper for follow-up responses
const ACTIVE_INCOMPLETE_STATUSES = ["pending", "due", "rescheduled", "missed"]

// Canonical time query helper: checks scheduledAt or fallback callbackAt
const buildTimeQuery = (condObj) => ({
  $or: [
    { scheduledAt: condObj },
    { scheduledAt: null, callbackAt: condObj },
  ],
})

const formatFollowUp = (f, tenantTimezone = "Asia/Kolkata") => {
  if (!f) return null
  const { start: startOfToday, end: endOfToday, now } = getTenantDayBounds(tenantTimezone)
  const scheduledDate = f.scheduledAt || f.callbackAt
  const scheduledTime = scheduledDate ? new Date(scheduledDate).getTime() : 0

  const isActive = ACTIVE_INCOMPLETE_STATUSES.includes(f.status)

  const isOverdue = isActive && scheduledTime > 0 && scheduledTime < now.getTime()
  const isToday =
    isActive &&
    scheduledTime >= startOfToday.getTime() &&
    scheduledTime <= endOfToday.getTime()

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
    callbackAt: f.callbackAt || f.scheduledAt,
    status: f.status,
    priority: f.priority,
    notes: f.notes || "",
    assignedTo: f.assignedTo || "Unassigned",
    assignedStaffId: f.assignedStaffId || "unassigned",
    callbackDirection: f.callbackDirection || null,
    direction: f.direction || null,
    taskAction: f.taskAction || null,
    directionDescription: f.directionDescription || null,
    productContext: f.productContext || "",
    customerName: f.customerName || (leadObj ? leadObj.name : ""),
    customerPhone: f.customerPhone || (leadObj ? leadObj.phone : ""),
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
      status,
      tab,
      filter,
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

    // Super Admin without tenant context: return empty data gracefully (HTTP 200) instead of throwing 400
    if (isSuperAdmin && !effectiveTenantId) {
      res.status(200).json({
        success: true,
        data: {
          followUps: [],
          total: 0,
          page: Math.max(1, Number(page) || 1),
          limit: Math.max(1, Math.min(100, Number(limit) || 10)),
          totalPages: 0,
        },
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

    // Use andConditions array to ensure tenant isolation, RBAC, timeline queries, and search never conflict
    const andConditions = []
    if (effectiveTenantId) {
      andConditions.push({ tenantId: effectiveTenantId })
    }

    // Apply RBAC scope filter (own / team / all)
    const rbacQuery = await scopeFilter(req.user, "followups", "view")
    if (rbacQuery._id !== undefined) {
      andConditions.push({ _id: rbacQuery._id }) // Fails closed if unauthorized
    } else if (rbacQuery.$or) {
      andConditions.push({ $or: rbacQuery.$or })
    }

    // Specific lead filter
    if (leadId && mongoose.Types.ObjectId.isValid(leadId)) {
      andConditions.push({ leadId: new mongoose.Types.ObjectId(leadId) })
    }

    // Status filtering with timezone-aware timeline definitions
    const { start: startOfToday, end: endOfToday, now } = getTenantDayBounds("Asia/Kolkata")
    const activeStatusQuery = { $in: ACTIVE_INCOMPLETE_STATUSES }

    let normalizedStatus = (status || tab || filter || "all").toLowerCase().trim()
    if (normalizedStatus === "due_today" || normalizedStatus === "due-today") {
      normalizedStatus = "today"
    } else if (normalizedStatus === "total_pending" || normalizedStatus === "total-pending") {
      normalizedStatus = "pending"
    }

    if (normalizedStatus === "upcoming") {
      andConditions.push({ status: activeStatusQuery })
      andConditions.push(buildTimeQuery({ $gt: endOfToday }))
    } else if (normalizedStatus === "overdue") {
      andConditions.push({ status: activeStatusQuery })
      andConditions.push(buildTimeQuery({ $lt: now }))
    } else if (normalizedStatus === "today") {
      andConditions.push({ status: activeStatusQuery })
      andConditions.push(buildTimeQuery({ $gte: startOfToday, $lte: endOfToday }))
    } else if (normalizedStatus === "completed") {
      andConditions.push({ status: "completed" })
    } else if (normalizedStatus === "pending") {
      andConditions.push({ status: activeStatusQuery })
    } else if (normalizedStatus === "cancelled") {
      andConditions.push({ status: "cancelled" })
    }

    // Type filter
    if (type && type !== "all") {
      andConditions.push({ type: type.toLowerCase().trim() })
    }

    // Priority filter
    if (priority && priority !== "all") {
      andConditions.push({ priority: priority.toLowerCase().trim() })
    }

    // Date range filter
    if (fromDate || toDate) {
      const dateCond = {}
      if (fromDate) {
        const fromD = new Date(fromDate)
        if (!isNaN(fromD.getTime())) dateCond.$gte = fromD
      }
      if (toDate) {
        const toD = new Date(toDate)
        if (!isNaN(toD.getTime())) {
          toD.setHours(23, 59, 59, 999)
          dateCond.$lte = toD
        }
      }
      if (Object.keys(dateCond).length > 0) {
        andConditions.push(buildTimeQuery(dateCond))
      }
    }

    // Search filter across title, notes, assignedTo, customerName, customerPhone, and populated lead properties
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
        { customerName: { $regex: sanitized, $options: "i" } },
        { customerPhone: { $regex: sanitized, $options: "i" } },
      ]
      if (matchingLeadIds.length > 0) {
        searchConditions.push({ leadId: { $in: matchingLeadIds } })
      }
      andConditions.push({ $or: searchConditions })
    }

    const query = andConditions.length === 0 ? {} : andConditions.length === 1 ? andConditions[0] : { $and: andConditions }

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

    // Super Admin without tenant context: return empty statistics gracefully (HTTP 200) instead of throwing 400
    if (isSuperAdmin && !effectiveTenantId) {
      res.status(200).json({
        success: true,
        data: {
          total: 0,
          upcoming: 0,
          overdue: 0,
          today: 0,
          completed: 0,
          pending: 0,
          completionRate: 0,
        },
      })
      return
    }

    const andConditions = []
    if (effectiveTenantId) {
      andConditions.push({ tenantId: effectiveTenantId })
    }

    const rbacQuery = await scopeFilter(req.user, "followups", "view")
    if (rbacQuery._id !== undefined) {
      andConditions.push({ _id: rbacQuery._id })
    } else if (rbacQuery.$or) {
      andConditions.push({ $or: rbacQuery.$or })
    }

    const combine = (extra) => {
      const merged = [...andConditions]
      if (Array.isArray(extra)) {
        merged.push(...extra)
      } else if (extra) {
        merged.push(extra)
      }
      return merged.length === 0 ? {} : merged.length === 1 ? merged[0] : { $and: merged }
    }

    // Timezone-aware day boundaries for today/upcoming/overdue
    const { start: startOfToday, end: endOfToday, now } = getTenantDayBounds("Asia/Kolkata")
    const activeStatusQuery = { $in: ACTIVE_INCOMPLETE_STATUSES }

    const [total, upcoming, overdue, today, completed, pending] = await Promise.all([
      FollowUp.countDocuments(combine()),
      FollowUp.countDocuments(combine([{ status: activeStatusQuery }, buildTimeQuery({ $gt: endOfToday })])),
      FollowUp.countDocuments(combine([{ status: activeStatusQuery }, buildTimeQuery({ $lt: now })])),
      FollowUp.countDocuments(combine([{ status: activeStatusQuery }, buildTimeQuery({ $gte: startOfToday, $lte: endOfToday })])),
      FollowUp.countDocuments(combine({ status: "completed" })),
      FollowUp.countDocuments(combine({ status: activeStatusQuery })),
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
        pending,
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
      const ALLOWED_STATUSES = ["pending", "due", "completed", "cancelled", "rescheduled", "missed"]
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

    if (scheduledAt !== undefined) {
      updates.reminderSentAt = null
      updates.dueNotificationSentAt = null
      updates.callbackAt = updates.scheduledAt
    }

    if (notes !== undefined) updates.notes = typeof notes === "string" ? notes.trim() : ""
    if (assignedTo !== undefined) updates.assignedTo = typeof assignedTo === "string" ? assignedTo.trim() : "Unassigned"
    if (req.body.completionNotes !== undefined) {
      updates.completionNotes = typeof req.body.completionNotes === "string" ? req.body.completionNotes.trim() : ""
    }

    const updated = await FollowUp.findOneAndUpdate(query, updates, { new: true, runValidators: true })
      .populate("leadId", "name email phone status metadata source assignedTo")
      .lean()

    // Sync Lead nextFollowUpDate & status
    try {
      if (updated?.leadId?._id) {
        const remainingPending = await FollowUp.findOne({
          tenantId: updated.tenantId,
          leadId: updated.leadId._id,
          status: { $in: ["pending", "due"] },
          deletedAt: null,
        }).sort({ scheduledAt: 1 }).setOptions({ skipTenantFilter: true })

        const leadUpdates = remainingPending
          ? { nextFollowUpDate: remainingPending.scheduledAt, followUpStatus: remainingPending.status === "due" ? "due" : "scheduled" }
          : { nextFollowUpDate: null, followUpStatus: updated.status === "completed" ? "completed" : null }

        await Lead.findByIdAndUpdate(updated.leadId._id, leadUpdates)
      }
    } catch (_) {}

    // Send push notification if rescheduled
    if (scheduledAt !== undefined && updated?.assignedTo && updated.assignedTo !== "Unassigned") {
      try {
        const pushNotificationService = require("../services/pushNotificationService")
        pushNotificationService.sendCallbackRescheduledNotification({
          followUp: updated,
          lead: updated.leadId,
          agentId: String(updated.assignedTo),
          tenantId: updated.tenantId,
        }).catch(() => {})
      } catch (_) {}
    }

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

    // Sync lead metadata & nextFollowUpDate
    try {
      if (completed.leadId?._id) {
        const lead = await Lead.findById(completed.leadId._id)
        if (lead) {
          const nextMeta = { ...(lead.metadata || {}), lastFollowUpCompleted: new Date() }
          const remainingPending = await FollowUp.findOne({
            tenantId: lead.tenantId,
            leadId: lead._id,
            status: { $in: ["pending", "due"] },
            deletedAt: null,
          }).sort({ scheduledAt: 1 }).setOptions({ skipTenantFilter: true })

          const leadUpdates = remainingPending
            ? { metadata: nextMeta, nextFollowUpDate: remainingPending.scheduledAt, followUpStatus: remainingPending.status === "due" ? "due" : "scheduled" }
            : { metadata: nextMeta, nextFollowUpDate: null, followUpStatus: "completed" }

          await Lead.findByIdAndUpdate(lead._id, leadUpdates)

          // Record discrete activity
          const { activity } = require("../services/activityService")
          await activity.record({
            tenantId: lead.tenantId,
            leadId: lead._id,
            type: "lead.followup_completed",
            actor: {
              name: req.user.name || "User",
              role: req.user.role || "user",
              email: req.user.email || "",
              id: req.user._id || req.user.id || null,
            },
            payload: {
              followUpId: completed._id.toString(),
              title: completed.title,
              completionNotes: completed.completionNotes,
              completedAt: completed.completedAt,
            },
          }).catch(() => {})
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
  getTenantDayBounds,
  formatFollowUp,
  ACTIVE_INCOMPLETE_STATUSES,
  buildTimeQuery,
}
