const mongoose = require("mongoose")
const Lead = require("../models/Lead")
const Call = require("../models/Call")
const MobileSyncTombstone = require("../models/MobileSyncTombstone")
const {
  sendLeadAssignedNotification,
  sendLeadReassignedAwayNotification,
} = require("../services/pushNotificationService")

// Helper to escape regex special characters and prevent ReDoS
const escapeRegex = (str) => {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

const ALLOWED_SORT_FIELDS = ["name", "email", "phone", "source", "status", "assignedTo", "createdAt", "updatedAt"]
const { getEffectiveTenant } = require("../middleware/tenantContext")
const { scopeFilter, checkDirectObjectAccess } = require("../utils/rbacScope")
const leadService = require("../services/leadService")
const { normalizePhoneE164 } = require("../utils/phoneNormalizer")
const assignmentService = require("../services/assignmentService")
const audit = require("../services/auditService")

const getLeads = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      search = "",
      status = "all",
      source = "all",
      assignedTo = "all",
      sortBy = "createdAt",
      sortOrder = "desc",
      tenantId: requestedTenantId,
    } = req.query

    const { tenantId: effectiveTenantId, isSuperAdmin } = getEffectiveTenant(req)

    // Security check: Unauthenticated requests cannot access private CRM leads
    if (!req.user || (!effectiveTenantId && !isSuperAdmin)) {
      res.status(401).json({
        success: false,
        error: "Authentication required to access CRM leads.",
      })
      return
    }

    // Security check: Unauthenticated or Account Admin attempting to access another tenant
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

    // Build query with tenant isolation
    const query = {}
    if (req.query?.includeTest !== "true") {
      query.isTest = { $ne: true }
    }
    if (req.query?.includeDeleted !== "true") {
      query.deletedAt = null
    }
    if (effectiveTenantId) {
      query.tenantId = effectiveTenantId
    }

    // Apply RBAC scope filter (own / team / all)
    const rbacQuery = await scopeFilter(req.user, "leads", "view")
    if (rbacQuery._id !== undefined) {
      query._id = rbacQuery._id // Fails closed if unauthorized
    } else if (rbacQuery.$or) {
      query.$or = rbacQuery.$or
    }

    // Search functionality across name, email, phone, and company with sanitized regex
    if (typeof search === "string" && search.trim()) {
      const sanitizedSearch = escapeRegex(search.trim())
      const searchConditions = [
        { name: { $regex: sanitizedSearch, $options: "i" } },
        { email: { $regex: sanitizedSearch, $options: "i" } },
        { phone: { $regex: sanitizedSearch, $options: "i" } },
        { "metadata.company": { $regex: sanitizedSearch, $options: "i" } },
      ]

      if (query.$or) {
        // Combine scope $or and search $or with $and
        query.$and = [{ $or: query.$or }, { $or: searchConditions }]
        delete query.$or
      } else {
        query.$or = searchConditions
      }
    }

    // Direct phone filter
    if (typeof req.query?.phone === "string" && req.query.phone.trim()) {
      query.phone = { $regex: escapeRegex(req.query.phone.trim()), $options: "i" }
    }

    // Direct email filter
    if (typeof req.query?.email === "string" && req.query.email.trim()) {
      query.email = { $regex: escapeRegex(req.query.email.trim()), $options: "i" }
    }

    // Status filter with alias normalization
    if (status && status !== "all") {
      const normalizedStatus = status.trim().toLowerCase()
      if (normalizedStatus === "active" || normalizedStatus === "active leads" || normalizedStatus === "active-leads" || normalizedStatus === "engaged") {
        query.status = "Engaged"
      } else if (normalizedStatus === "order-placed" || normalizedStatus === "order placed" || normalizedStatus === "closed-won" || normalizedStatus === "closed won" || normalizedStatus === "won") {
        query.status = "Closed-Won"
      } else if (normalizedStatus === "lost" || normalizedStatus === "lost leads" || normalizedStatus === "lost-leads" || normalizedStatus === "closed-lost" || normalizedStatus === "closed lost") {
        query.status = "Closed-Lost"
      } else if (normalizedStatus === "new" || normalizedStatus === "new leads" || normalizedStatus === "new-leads") {
        query.status = "New"
      } else if (normalizedStatus === "proposal sent" || normalizedStatus === "proposal-sent") {
        query.status = "Proposal Sent"
      } else {
        query.status = status.trim()
      }
    } else if (req.query?.leadType === "Fresh") {
      query.status = "New"
    } else if (req.query?.leadType === "Existing") {
      query.status = { $ne: "New" }
    }

    // Source filter
    if (source && source !== "all") {
      query.source = source
    }

    // AssignedTo filter (supports unassigned pool)
    if (assignedTo && assignedTo !== "all") {
      if (assignedTo.toLowerCase() === "unassigned") {
        query.$or = [{ ownerId: null }, { assignedStaffId: "unassigned" }, { assignedTo: "Unassigned" }]
      } else {
        query.assignedTo = assignedTo
      }
    }

    if (req.query?.ownerId && req.query.ownerId !== "all") {
      if (req.query.ownerId === "unassigned" || req.query.ownerId === "null") {
        query.ownerId = null
      } else if (mongoose.Types.ObjectId.isValid(req.query.ownerId)) {
        query.ownerId = new mongoose.Types.ObjectId(req.query.ownerId)
      }
    }

    if (req.query?.teamId && req.query.teamId !== "all" && mongoose.Types.ObjectId.isValid(req.query.teamId)) {
      query.teamId = new mongoose.Types.ObjectId(req.query.teamId)
    }

    // Date range filter
    if (req.query?.fromDate || req.query?.toDate) {
      query.createdAt = {}
      if (req.query.fromDate) {
        const from = new Date(req.query.fromDate)
        if (!isNaN(from.getTime())) {
          query.createdAt.$gte = from
        }
      }
      if (req.query.toDate) {
        const to = new Date(req.query.toDate)
        if (!isNaN(to.getTime())) {
          to.setHours(23, 59, 59, 999)
          query.createdAt.$lte = to
        }
      }
      if (Object.keys(query.createdAt).length === 0) {
        delete query.createdAt
      }
    }

    // Sort configuration with allowlist validation
    const sortField = ALLOWED_SORT_FIELDS.includes(sortBy) ? sortBy : "createdAt"
    const sortConfig = {}
    sortConfig[sortField] = sortOrder === "asc" ? 1 : -1

    // Execute queries
    const [leads, total] = await Promise.all([
      Lead.find(query).sort(sortConfig).skip(skip).limit(limitNum).lean(),
      Lead.countDocuments(query),
    ])

    const totalPages = Math.ceil(total / limitNum)

    const transformedLeads = leads.map((lead) => ({
      _id: lead._id.toString(),
      id: lead._id.toString(),
      name: lead.name,
      email: lead.email || "",
      phone: lead.phone || "",
      phoneNormalized: lead.phoneNormalized || "",
      company: lead.company || lead.metadata?.company || lead.metadata?.companyName || "",
      city: lead.city || "",
      alternatePhone: lead.alternatePhone || "",
      ownerId: lead.ownerId ? lead.ownerId.toString() : null,
      teamId: lead.teamId ? lead.teamId.toString() : null,
      tags: lead.tags || [],
      attribution: lead.attribution || null,
      assignmentHistory: Array.isArray(lead.assignmentHistory) ? lead.assignmentHistory : [],
      lastContactedAt: lead.lastContactedAt || null,
      deletedAt: lead.deletedAt || null,
      source: lead.source || "Website Form",
      assignedTo: lead.assignedTo || "Unassigned",
      assignedStaffId: lead.assignedStaffId || "unassigned",
      status: lead.status || "New",
      message: lead.message || "",
      formId: lead.formId || "",
      landingPage: lead.landingPage || "",
      isEmailVerified: Boolean(lead.isEmailVerified),
      verificationStatus: lead.verificationStatus || "unverified",
      tenantId: lead.tenantId,
      metadata: lead.metadata || {},
      createdAt: lead.createdAt,
      updatedAt: lead.updatedAt,
    }))

    res.status(200).json({
      success: true,
      data: {
        leads: transformedLeads,
        total,
        page: pageNum,
        limit: limitNum,
        totalPages,
      },
    })
  } catch (error) {
    console.error("Error fetching leads:", error)
    res.status(500).json({
      success: false,
      error: "Internal server error",
    })
  }
}

const createLead = async (req, res) => {
  try {
    const { name, email, phone, source, assignedTo, status, tenantId: bodyTenantId } = req.body

    // Validation
    if (!name || typeof name !== "string" || !name.trim()) {
      res.status(400).json({
        success: false,
        error: "Valid lead name is required",
      })
      return
    }

    if (!email || typeof email !== "string" || !email.trim()) {
      res.status(400).json({
        success: false,
        error: "Valid lead email is required",
      })
      return
    }

    const { tenantId: effectiveTenantId, isSuperAdmin } = getEffectiveTenant(req)

    if (!req.user || (!effectiveTenantId && !isSuperAdmin)) {
      res.status(401).json({
        success: false,
        error: "Authentication required to create CRM leads.",
      })
      return
    }

    // Security check: Prevent tampering with tenantId
    if (!isSuperAdmin && bodyTenantId && bodyTenantId !== effectiveTenantId) {
      res.status(403).json({
        success: false,
        error: "Cross-tenant lead creation is prohibited",
      })
      return
    }

    const assignedTenant = isSuperAdmin ? (bodyTenantId || "default-tenant") : effectiveTenantId

    const result = await leadService.createOrMergeLead({
      tenantId: assignedTenant,
      source: source || "Manual Entry",
      payload: req.body,
      options: {
        duplicateHandling: "reject",
      },
      actor: req.user,
    })

    if (result.action === "duplicate_rejected") {
      res.status(400).json({
        success: false,
        error: result.reason || "A lead with this email already exists in this account",
      })
      return
    }

    // Phase 10: Dispatch push notification if assigned to an agent
    if (result.lead && ((result.lead.assignedStaffId && result.lead.assignedStaffId !== "unassigned") || result.lead.ownerId)) {
      try {
        await sendLeadAssignedNotification({
          lead: result.lead,
          agentId: result.lead.assignedStaffId || (result.lead.ownerId ? result.lead.ownerId.toString() : null),
          tenantId: result.lead.tenantId,
        })
      } catch (pushErr) {
        console.warn("Failed to dispatch lead assigned push:", pushErr.message)
      }
    }
    res.status(201).json({
      success: true,
      data: result.lead,
      message: "Lead created successfully",
    })
  } catch (error) {
    console.error("Error creating lead:", error)

    if (error.name === "ValidationError") {
      const validationErrors = Object.values(error.errors).map((err) => err.message)
      res.status(400).json({
        success: false,
        error: validationErrors.join(", "),
      })
    } else if (error.code === 11000) {
      res.status(400).json({
        success: false,
        error: "A lead with this email already exists",
      })
    } else {
      res.status(500).json({
        success: false,
        error: error.message || "Internal server error",
      })
    }
  }
}

const getLeadById = async (req, res) => {
  try {
    const { id } = req.params

    if (!mongoose.Types.ObjectId.isValid(id)) {
      res.status(400).json({
        success: false,
        error: "Invalid lead ID format",
      })
      return
    }

    const { tenantId: effectiveTenantId, isSuperAdmin } = getEffectiveTenant(req)

    if (!req.user || (!effectiveTenantId && !isSuperAdmin)) {
      res.status(401).json({
        success: false,
        error: "Authentication required to access lead details.",
      })
      return
    }

    // Query must be scoped to the caller's tenant
    const query = { _id: id }
    if (!isSuperAdmin && effectiveTenantId) {
      query.tenantId = effectiveTenantId
    }

    const lead = await Lead.findOne(query)

    if (!lead) {
      res.status(404).json({
        success: false,
        error: "Lead not found",
      })
      return
    }

    const access = await checkDirectObjectAccess(req.user, lead, "leads", "view")
    if (!access.allowed) {
      res.status(403).json({
        success: false,
        error: access.reason || "Access denied. Outside assigned scope.",
      })
      return
    }

    res.status(200).json({
      success: true,
      data: lead,
    })
  } catch (error) {
    console.error("Error fetching lead:", error)
    res.status(500).json({
      success: false,
      error: "Internal server error",
    })
  }
}

const updateLead = async (req, res) => {
  try {
    const { id } = req.params
    const { name, email, phone, status, source, assignedTo, message } = req.body

    if (!mongoose.Types.ObjectId.isValid(id)) {
      res.status(400).json({
        success: false,
        error: "Invalid lead ID format",
      })
      return
    }

    const { tenantId: effectiveTenantId, isSuperAdmin } = getEffectiveTenant(req)

    if (!req.user || (!effectiveTenantId && !isSuperAdmin)) {
      res.status(401).json({
        success: false,
        error: "Authentication required to update leads.",
      })
      return
    }

    // Tenant isolation: only find lead belonging to caller's tenant
    const query = { _id: id }
    if (!isSuperAdmin && effectiveTenantId) {
      query.tenantId = effectiveTenantId
    }

    const lead = await Lead.findOne(query)

    if (!lead) {
      res.status(404).json({
        success: false,
        error: "Lead not found",
      })
      return
    }

    const access = await checkDirectObjectAccess(req.user, lead, "leads", "edit")
    if (!access.allowed) {
      res.status(403).json({
        success: false,
        error: access.reason || "Access denied. Outside assigned scope.",
      })
      return
    }

    // If status is provided, validate against allowed enum and map aliases
    let targetStatus = undefined
    if (status !== undefined) {
      const STATUS_MAP = {
        new: "New",
        "new leads": "New",
        "new-leads": "New",
        engaged: "Engaged",
        active: "Engaged",
        "active leads": "Engaged",
        "active-leads": "Engaged",
        "proposal sent": "Proposal Sent",
        "proposal-sent": "Proposal Sent",
        "closed-won": "Closed-Won",
        "closed won": "Closed-Won",
        won: "Closed-Won",
        "order placed": "Closed-Won",
        "order-placed": "Closed-Won",
        "closed-lost": "Closed-Lost",
        "closed lost": "Closed-Lost",
        lost: "Closed-Lost",
        "lost leads": "Closed-Lost",
        "lost-leads": "Closed-Lost",
      }
      const canonical = typeof status === "string" ? STATUS_MAP[status.toLowerCase().trim()] || status : status
      const ALLOWED_STATUSES = ["New", "Engaged", "Proposal Sent", "Closed-Won", "Closed-Lost"]
      if (!ALLOWED_STATUSES.includes(canonical)) {
        res.status(400).json({
          success: false,
          error: `Invalid status. Must be one of: ${ALLOWED_STATUSES.join(", ")}`,
        })
        return
      }
      targetStatus = canonical
    }

    // Check if email is being changed and if it already exists within the tenant
    if (email && email.toLowerCase().trim() !== lead.email) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/
      if (!emailRegex.test(email.trim())) {
        res.status(400).json({
          success: false,
          error: "Please enter a valid email address",
        })
        return
      }

      const existingLead = await Lead.findOne({
        email: email.toLowerCase().trim(),
        tenantId: lead.tenantId,
        _id: { $ne: id },
      })

      if (existingLead) {
        res.status(400).json({
          success: false,
          error: "A lead with this email already exists in this account",
        })
        return
      }
    }

    const updates = {}
    if (name && typeof name === "string" && name.trim()) updates.name = name.trim()
    if (email && typeof email === "string" && email.trim()) updates.email = email.toLowerCase().trim()
    if (phone !== undefined) {
      updates.phone = typeof phone === "string" ? phone.trim() : ""
      updates.phoneNormalized = updates.phone ? normalizePhoneE164(updates.phone) : ""
    }

    let newMetadata = null
    const getMetadataObject = () => {
      if (!newMetadata) {
        newMetadata = { ...(lead.metadata || {}) }
      }
      return newMetadata
    }

    if (targetStatus !== undefined) {
      updates.status = targetStatus
      // Track status transition history if the status changed
      if (targetStatus !== lead.status) {
        const transitionRecord = {
          fromStatus: lead.status,
          toStatus: targetStatus,
          transitionedAt: new Date(),
          transitionedBy: req.user?.email || req.user?.name || "User",
        }
        const existingHistory = Array.isArray(lead.metadata?.statusHistory) ? lead.metadata.statusHistory : []
        const meta = getMetadataObject()
        meta.statusHistory = [...existingHistory, transitionRecord]
      }
    }
    if (source !== undefined) updates.source = typeof source === "string" && source.trim() ? source.trim() : "Website"
    if (assignedTo !== undefined) updates.assignedTo = typeof assignedTo === "string" && assignedTo.trim() ? assignedTo.trim() : "Unassigned"
    if (req.body.assignedStaffId !== undefined) updates.assignedStaffId = typeof req.body.assignedStaffId === "string" ? req.body.assignedStaffId.trim() : "unassigned"
    if (message !== undefined) updates.message = typeof message === "string" ? message.trim() : ""
    if (req.body.company !== undefined) {
      const companyVal = typeof req.body.company === "string" ? req.body.company.trim() : ""
      updates.company = companyVal
      const meta = getMetadataObject()
      meta.company = companyVal
    }
    if (req.body.city !== undefined) {
      updates.city = typeof req.body.city === "string" ? req.body.city.trim() : ""
    }
    if (req.body.alternatePhone !== undefined) {
      updates.alternatePhone = typeof req.body.alternatePhone === "string" ? req.body.alternatePhone.trim() : ""
    }
    if (req.body.tags !== undefined && Array.isArray(req.body.tags)) {
      updates.tags = req.body.tags.map((t) => String(t).trim().toLowerCase()).filter(Boolean)
    }
    if (req.body.ownerId !== undefined) {
      if (req.body.ownerId && mongoose.Types.ObjectId.isValid(req.body.ownerId)) {
        updates.ownerId = new mongoose.Types.ObjectId(req.body.ownerId)
        updates.assignedStaffId = updates.ownerId.toString()
      } else {
        updates.ownerId = null
      }
    }
    if (req.body.teamId !== undefined) {
      if (req.body.teamId && mongoose.Types.ObjectId.isValid(req.body.teamId)) {
        updates.teamId = new mongoose.Types.ObjectId(req.body.teamId)
      } else {
        updates.teamId = null
      }
    }
    if (req.body.lastContactedAt !== undefined) {
      updates.lastContactedAt = req.body.lastContactedAt ? new Date(req.body.lastContactedAt) : null
    }
    if (req.body.metadata !== undefined && typeof req.body.metadata === "object" && req.body.metadata !== null) {
      const meta = getMetadataObject()
      Object.assign(meta, req.body.metadata)
    }

    if (newMetadata) {
      updates.metadata = newMetadata
    }

    const updatedLead = await Lead.findOneAndUpdate(
      query,
      updates,
      { new: true, runValidators: true },
    )

    // Record tombstone if lead was reassigned away from previous staff/agent
    try {
      const oldAssignedStaffId = lead.assignedStaffId
      const oldAssignedTo = lead.assignedTo

      if (
        updates.assignedStaffId !== undefined &&
        oldAssignedStaffId &&
        oldAssignedStaffId !== "unassigned" &&
        updates.assignedStaffId !== oldAssignedStaffId
      ) {
        await MobileSyncTombstone.create({
          leadId: lead._id.toString(),
          tenantId: lead.tenantId,
          assignedStaffId: oldAssignedStaffId,
          action: "reassigned",
          timestamp: new Date(),
        })

        // Phase 10: Dispatch push to previous agent
        try {
          await sendLeadReassignedAwayNotification({
            leadId: lead._id.toString(),
            previousAgentId: oldAssignedStaffId,
            tenantId: lead.tenantId,
          })
        } catch (pushErr) {
          console.warn("Failed to dispatch reassigned-away push:", pushErr.message)
        }
      }

      // Phase 10: Dispatch push to newly assigned agent
      if (
        updates.assignedStaffId !== undefined &&
        updates.assignedStaffId &&
        updates.assignedStaffId !== "unassigned" &&
        updates.assignedStaffId !== oldAssignedStaffId
      ) {
        try {
          await sendLeadAssignedNotification({
            lead: updatedLead,
            agentId: updates.assignedStaffId,
            tenantId: lead.tenantId,
          })
        } catch (pushErr) {
          console.warn("Failed to dispatch lead assigned push:", pushErr.message)
        }
      }

      if (
        updates.assignedTo !== undefined &&
        oldAssignedTo &&
        oldAssignedTo !== "Unassigned" &&
        updates.assignedTo !== oldAssignedTo
      ) {
        await MobileSyncTombstone.create({
          leadId: lead._id.toString(),
          tenantId: lead.tenantId,
          assignedStaffId: oldAssignedTo,
          action: "reassigned",
          timestamp: new Date(),
        })
      }
    } catch (tombstoneErr) {
      console.warn("Could not record mobile sync tombstone on lead reassignment:", tombstoneErr.message)
    }

    // Phase 10: Record Activity Events for status changes, notes, and direct reassignments
    const { activity } = require("../services/activityService")
    const statusChanged = targetStatus !== undefined && targetStatus !== lead.status
    const noteAdded = typeof message === "string" && message.trim() && message.trim() !== (lead.message || "").trim()
    const directOwnerChanged = req.body.ownerId !== undefined && String(updates.ownerId || "") !== String(lead.ownerId || "")

    if (statusChanged) {
      try {
        await activity.record({
          tenantId: lead.tenantId,
          leadId: lead._id,
          type: "lead.status_changed",
          actor: req.user,
          payload: {
            fromStatus: lead.status,
            toStatus: targetStatus,
          },
          req,
        })
      } catch (actErr) {
        console.error("Failed to record status_changed activity:", actErr.message)
      }
    }

    if (noteAdded) {
      try {
        await activity.record({
          tenantId: lead.tenantId,
          leadId: lead._id,
          type: "lead.note_added",
          actor: req.user,
          payload: {
            note: message.trim(),
          },
          req,
        })
      } catch (actErr) {
        console.error("Failed to record note_added activity:", actErr.message)
      }
    }

    if (directOwnerChanged) {
      try {
        await activity.record({
          tenantId: lead.tenantId,
          leadId: lead._id,
          type: "lead.owner_changed",
          actor: req.user,
          payload: {
            fromOwnerId: lead.ownerId,
            fromOwnerName: lead.assignedTo || "Unassigned",
            toOwnerId: updates.ownerId || null,
            toOwnerName: updates.assignedTo || "Unassigned",
            reason: "Lead record update",
          },
          req,
        })
      } catch (actErr) {
        console.error("Failed to record owner_changed activity:", actErr.message)
      }
    }

    res.status(200).json({
      success: true,
      data: updatedLead,
      message: "Lead updated successfully",
    })
  } catch (error) {
    console.error("Error updating lead:", error)

    if (error.name === "ValidationError") {
      const validationErrors = Object.values(error.errors).map((err) => err.message)
      res.status(400).json({
        success: false,
        error: validationErrors.join(", "),
      })
    } else {
      res.status(500).json({
        success: false,
        error: "Internal server error",
      })
    }
  }
}

const deleteLead = async (req, res) => {
  try {
    const { id } = req.params

    if (!mongoose.Types.ObjectId.isValid(id)) {
      res.status(400).json({
        success: false,
        error: "Invalid lead ID format",
      })
      return
    }

    const { tenantId: effectiveTenantId, isSuperAdmin } = getEffectiveTenant(req)

    if (!req.user || (!effectiveTenantId && !isSuperAdmin)) {
      res.status(401).json({
        success: false,
        error: "Authentication required to delete leads.",
      })
      return
    }

    // Enforce tenant scoping and RBAC authorization on deletion
    const query = { _id: id }
    if (!isSuperAdmin && effectiveTenantId) {
      query.tenantId = effectiveTenantId
    }

    const lead = await Lead.findOne(query)

    if (!lead) {
      res.status(404).json({
        success: false,
        error: "Lead not found",
      })
      return
    }

    const access = await checkDirectObjectAccess(req.user, lead, "leads", "delete")
    if (!access.allowed) {
      res.status(403).json({
        success: false,
        error: access.reason || "Access denied. Outside assigned scope.",
      })
      return
    }

    // Record tombstone so mobile agents sync lead deletion
    try {
      const tombstoneStaffIds = []
      if (lead.assignedStaffId && lead.assignedStaffId !== "unassigned") {
        tombstoneStaffIds.push(lead.assignedStaffId)
      }
      if (lead.assignedTo && lead.assignedTo !== "Unassigned") {
        tombstoneStaffIds.push(lead.assignedTo)
      }
      if (tombstoneStaffIds.length === 0) {
        tombstoneStaffIds.push("all")
      }
      for (const staffId of tombstoneStaffIds) {
        await MobileSyncTombstone.create({
          leadId: lead._id.toString(),
          tenantId: lead.tenantId,
          assignedStaffId: staffId,
          action: "deleted",
          timestamp: new Date(),
        })
      }
    } catch (tombstoneErr) {
      console.warn("Could not record mobile sync tombstone on lead deletion:", tombstoneErr.message)
    }

    await Lead.findOneAndDelete({ _id: lead._id })

    const maskedPhone = lead.phone
      ? (lead.phone.length > 5 ? `${lead.phone.slice(0, 3)}••••${lead.phone.slice(-4)}` : "••••")
      : null

    await audit.log({
      tenantId: lead.tenantId,
      actor: req.user,
      action: audit.AUDIT_ACTIONS.LEAD_DELETE,
      entity: "lead",
      entityId: lead._id,
      summary: `Deleted lead '${lead.name}' (${lead.email || maskedPhone || "No contact"})`,
      details: {
        name: lead.name,
        email: lead.email || undefined,
        phoneMasked: maskedPhone || undefined,
        status: lead.status,
        ownerId: lead.ownerId,
        assignedTo: lead.assignedTo,
      },
      req,
    })
    res.status(200).json({
      success: true,
      message: "Lead deleted successfully",
    })
  } catch (error) {
    console.error("Error deleting lead:", error)
    res.status(500).json({
      success: false,
      error: "Internal server error",
    })
  }
}

const getLeadStats = async (req, res) => {
  try {
    const { tenantId: effectiveTenantId, isSuperAdmin } = getEffectiveTenant(req)

    if (!req.user || (!effectiveTenantId && !isSuperAdmin)) {
      res.status(401).json({
        success: false,
        error: "Authentication required to view lead statistics.",
      })
      return
    }

    const matchQuery = {}
    if (req.query?.includeTest !== "true") {
      matchQuery.isTest = { $ne: true }
    }
    if (!isSuperAdmin && effectiveTenantId) {
      matchQuery.tenantId = effectiveTenantId
    } else if (isSuperAdmin && typeof req.query?.tenantId === "string") {
      matchQuery.tenantId = req.query.tenantId.trim()
    }

    const rbacQuery = await scopeFilter(req.user, "leads", "view")
    if (rbacQuery._id !== undefined) {
      matchQuery._id = rbacQuery._id
    } else if (rbacQuery.$or) {
      matchQuery.$or = rbacQuery.$or
    }

    const matchStage = Object.keys(matchQuery).length > 0 ? [{ $match: matchQuery }] : []

    const stats = await Lead.aggregate([
      ...matchStage,
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
        },
      },
    ])

    const total = stats.reduce((sum, stat) => sum + (stat.count || 0), 0)

    const statusCounts = {
      New: 0,
      Engaged: 0,
      "Proposal Sent": 0,
      "Closed-Won": 0,
      "Closed-Lost": 0,
    }

    stats.forEach((stat) => {
      if (stat._id in statusCounts) {
        statusCounts[stat._id] = stat.count
      }
    })

    const conversionRate = total > 0 ? Math.round((statusCounts["Closed-Won"] / total) * 100) : 0

    res.status(200).json({
      success: true,
      data: {
        total,
        statusCounts,
        conversionRate,
      },
    })
  } catch (error) {
    console.error("Error fetching lead stats:", error)
    res.status(500).json({
      success: false,
      error: "Internal server error",
    })
  }
}

/**
 * GET /api/leads/:id/calls
 * Retrieve call history and recording metadata for a specific lead
 */
const getLeadCalls = async (req, res) => {
  try {
    const { id } = req.params
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, error: "Valid lead id is required" })
    }

    const lead = await Lead.findById(id).lean()
    if (!lead) {
      return res.status(404).json({ success: false, error: "Lead not found" })
    }

    // Tenant boundary check
    if (req.user.role !== "super_admin" && lead.tenantId !== req.user.tenantId) {
      return res.status(403).json({ success: false, error: "Access denied. Cross-tenant access is prohibited." })
    }

    const calls = await Call.find({ leadId: id })
      .sort({ startTimeMs: -1 })
      .lean()

    return res.status(200).json({
      success: true,
      data: calls,
    })
  } catch (error) {
    console.error("Error in getLeadCalls:", error)
    return res.status(500).json({
      success: false,
      error: "Internal server error fetching lead calls",
    })
  }
}

/**
 * PATCH /api/leads/:id/assign
 * Assign or reassign single lead with audit history
 */
const assignSingleLead = async (req, res) => {
  try {
    const { id } = req.params
    const { targetOwnerId, teamId, reason } = req.body
    const { tenantId: effectiveTenantId, isSuperAdmin } = getEffectiveTenant(req)

    if (!req.user || (!effectiveTenantId && !isSuperAdmin)) {
      return res.status(401).json({ success: false, error: "Authentication required to assign leads." })
    }

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, error: "Invalid lead ID format" })
    }

    const lead = await Lead.findOne({ _id: id, ...(effectiveTenantId ? { tenantId: effectiveTenantId } : {}) })
    if (!lead) {
      return res.status(404).json({ success: false, error: "Lead not found" })
    }

    // Direct object check: user can only assign leads they have access to modify
    const access = await checkDirectObjectAccess(req.user, lead, "leads", "edit")
    if (!access.allowed) {
      return res.status(403).json({ success: false, error: access.reason || "Access denied. Outside assigned scope." })
    }

    const assignedTenant = lead.tenantId

    const result = await assignmentService.assignLead(lead._id, targetOwnerId || null, {
      teamId: teamId || null,
      actor: req.user,
      reason: reason || "Manual assignment",
      tenantId: assignedTenant,
    })

    await audit.log({
      tenantId: assignedTenant,
      actor: req.user,
      action: audit.AUDIT_ACTIONS.LEAD_ASSIGN,
      entity: "lead",
      entityId: lead._id,
      summary: targetOwnerId
        ? `Assigned lead '${lead.name}' to ${result.lead.assignedTo}`
        : `Moved lead '${lead.name}' to unassigned pool`,
      details: {
        leadId: lead._id,
        leadName: lead.name,
        fromOwner: result.historyEntry?.fromOwnerName,
        toOwner: result.historyEntry?.toOwnerName,
        reason: result.historyEntry?.reason,
      },
      req,
    })

    res.status(200).json({
      success: true,
      message: targetOwnerId ? `Lead assigned to ${result.lead.assignedTo}` : "Lead moved to unassigned pool",
      data: result.lead,
      historyEntry: result.historyEntry,
    })
  } catch (error) {
    console.error("Error assigning lead:", error)
    const statusCode = error.status || 500
    res.status(statusCode).json({
      success: false,
      error: error.message || "Failed to assign lead",
    })
  }
}

/**
 * POST /api/leads/bulk-assign
 * Reassign multiple leads in bulk
 */
const bulkAssignLeads = async (req, res) => {
  try {
    const { leadIds, targetOwnerId, teamId, ruleId, reason } = req.body
    const { tenantId: effectiveTenantId, isSuperAdmin } = getEffectiveTenant(req)

    if (!req.user || (!effectiveTenantId && !isSuperAdmin)) {
      return res.status(401).json({ success: false, error: "Authentication required to bulk assign leads." })
    }

    if (!Array.isArray(leadIds) || leadIds.length === 0) {
      return res.status(400).json({ success: false, error: "At least one lead ID is required for bulk assignment" })
    }

    const assignedTenant = isSuperAdmin ? (req.body.tenantId || effectiveTenantId) : effectiveTenantId
    if (!assignedTenant) {
      return res.status(400).json({ success: false, error: "Tenant context is required" })
    }

    // Offload heavy batch assignment to background queue when requested
    if (req.query.async === "true" || req.body.async === true) {
      const queue = require("../services/queueService")
      const queued = await queue.addJob({
        name: "lead.bulk_assign",
        tenantId: assignedTenant,
        payload: {
          leadIds,
          targetOwnerId: targetOwnerId || null,
          teamId: teamId || null,
          ruleId: ruleId || null,
          actor: req.user,
          reason: reason || "Bulk reassignment",
          tenantId: assignedTenant,
        },
        priority: 1,
      })
      return res.status(202).json({
        success: true,
        queued: true,
        jobId: queued.job.jobId,
        message: `Bulk assignment queued in background for ${leadIds.length} lead(s)`,
      })
    }

    const result = await assignmentService.bulkAssignLeads({
      leadIds,
      targetOwnerId: targetOwnerId || null,
      teamId: teamId || null,
      ruleId: ruleId || null,
      actor: req.user,
      reason: reason || "Bulk reassignment",
      tenantId: assignedTenant,
    })

    res.status(200).json({
      success: true,
      message: `Successfully processed bulk assignment for ${result.updatedCount} lead(s)`,
      data: result,
    })
  } catch (error) {
    console.error("Error bulk assigning leads:", error)
    const statusCode = error.status || 500
    res.status(statusCode).json({
      success: false,
      error: error.message || "Failed to bulk assign leads",
    })
  }
}

/**
 * GET /api/leads/pool/stats
 * Get counts for unassigned pool
 */
const getUnassignedPoolStats = async (req, res) => {
  try {
    const { tenantId: effectiveTenantId, isSuperAdmin } = getEffectiveTenant(req)

    if (!req.user || (!effectiveTenantId && !isSuperAdmin)) {
      return res.status(401).json({ success: false, error: "Authentication required to view pool statistics." })
    }

    const stats = await assignmentService.getUnassignedPoolStats(effectiveTenantId)

    res.status(200).json({
      success: true,
      data: stats,
    })
  } catch (error) {
    console.error("Error fetching unassigned pool stats:", error)
    res.status(500).json({
      success: false,
      error: "Failed to load unassigned pool statistics",
    })
  }
}

/**
 * GET /api/leads/:id/activities
 * Roadmap Phase 10: Lead Detail Drawer & Activity Timeline API
 * Fetches chronological timeline activities for a lead within tenant boundaries.
 */
const getLeadActivities = async (req, res) => {
  try {
    const { id } = req.params

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        error: "Invalid lead ID format",
      })
    }

    const { tenantId: effectiveTenantId, isSuperAdmin } = getEffectiveTenant(req)

    if (!req.user || (!effectiveTenantId && !isSuperAdmin)) {
      return res.status(401).json({
        success: false,
        error: "Authentication required to access lead activities.",
      })
    }

    // Verify lead existence and tenant scope
    const query = { _id: id }
    if (!isSuperAdmin && effectiveTenantId) {
      query.tenantId = effectiveTenantId
    }

    const lead = await Lead.findOne(query)
    if (!lead) {
      return res.status(404).json({
        success: false,
        error: "Lead not found",
      })
    }

    // RBAC Direct object access check: user can only view activities of leads in their view scope
    const access = await checkDirectObjectAccess(req.user, lead, "leads", "view")
    if (!access.allowed) {
      return res.status(403).json({
        success: false,
        error: access.reason || "Access denied. Outside assigned scope.",
      })
    }

    const { activityService } = require("../services/activityService")
    const { Activity } = require("../models/Activity")

    const limitNum = Math.max(1, Math.min(100, Number(req.query.limit) || 50))
    const pageNum = Math.max(1, Number(req.query.page) || 1)
    const typeFilter = req.query.type && typeof req.query.type === "string" ? req.query.type.trim() : null

    const activities = await activityService.getLeadActivities(id, {
      tenantId: effectiveTenantId,
      type: typeFilter,
      limit: limitNum,
      page: pageNum,
    })

    const countQuery = {
      tenantId: effectiveTenantId,
      leadId: id,
      ...(typeFilter ? { type: typeFilter } : {}),
    }
    const total = await Activity.countDocuments(countQuery)
    const totalPages = Math.ceil(total / limitNum)

    res.status(200).json({
      success: true,
      data: {
        activities,
        total,
        page: pageNum,
        limit: limitNum,
        totalPages,
      },
      activities,
      total,
      page: pageNum,
      limit: limitNum,
      totalPages,
    })
  } catch (error) {
    console.error("Error fetching lead activities:", error)
    res.status(500).json({
      success: false,
      error: "Internal server error",
    })
  }
}

module.exports = {
  getLeads,
  createLead,
  getLeadById,
  getLeadCalls,
  getLeadActivities,
  updateLead,
  deleteLead,
  getLeadStats,
  assignSingleLead,
  bulkAssignLeads,
  getUnassignedPoolStats,
}

