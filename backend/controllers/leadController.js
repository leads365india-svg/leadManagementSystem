const mongoose = require("mongoose")
const Lead = require("../models/Lead")

// Helper to escape regex special characters and prevent ReDoS
const escapeRegex = (str) => {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

// Strict whitelist for sortable fields to prevent injection
const ALLOWED_SORT_FIELDS = ["name", "email", "phone", "source", "status", "assignedTo", "createdAt", "updatedAt"]

// Determine effective tenant partition based on authentication context
const getEffectiveTenant = (req) => {
  if (req.user?.role === "super_admin") {
    // Super Admin can view all or filter by specific tenant if requested
    const requestedTenant = typeof req.query?.tenantId === "string" ? req.query.tenantId.trim() : null
    return { tenantId: requestedTenant, isSuperAdmin: true }
  }

  if (req.user?.tenantId) {
    // Leads Account Admin is strictly locked to their tenant
    return { tenantId: req.user.tenantId, isSuperAdmin: false }
  }

  // Unauthenticated requests have no tenant access
  return { tenantId: null, isSuperAdmin: false }
}

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
    if (effectiveTenantId) {
      query.tenantId = effectiveTenantId
    }

    // Search functionality across name, email, phone, and company with sanitized regex
    if (typeof search === "string" && search.trim()) {
      const sanitizedSearch = escapeRegex(search.trim())
      query.$or = [
        { name: { $regex: sanitizedSearch, $options: "i" } },
        { email: { $regex: sanitizedSearch, $options: "i" } },
        { phone: { $regex: sanitizedSearch, $options: "i" } },
        { "metadata.company": { $regex: sanitizedSearch, $options: "i" } },
      ]
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

    // AssignedTo filter
    if (assignedTo && assignedTo !== "all") {
      query.assignedTo = assignedTo
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
      company: lead.metadata?.company || lead.metadata?.companyName || "",
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

    // Check if email already exists within this tenant partition
    const existingLead = await Lead.findOne({
      email: email.toLowerCase().trim(),
      tenantId: assignedTenant,
    })
    if (existingLead) {
      res.status(400).json({
        success: false,
        error: "A lead with this email already exists in this account",
      })
      return
    }

    const leadMetadata = typeof req.body.metadata === "object" && req.body.metadata !== null ? { ...req.body.metadata } : {}
    if (typeof req.body.company === "string" && req.body.company.trim()) {
      leadMetadata.company = req.body.company.trim()
    }

    const lead = new Lead({
      name: name.trim(),
      email: email.toLowerCase().trim(),
      phone: (phone || "").trim(),
      source: (source || "Manual Entry").trim(),
      assignedTo: (assignedTo || "Unassigned").trim(),
      status: status || "New",
      message: typeof req.body.message === "string" ? req.body.message.trim() : "",
      metadata: leadMetadata,
      tenantId: assignedTenant,
    })

    const savedLead = await lead.save()

    res.status(201).json({
      success: true,
      data: savedLead,
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
        error: "Internal server error",
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
    if (phone !== undefined) updates.phone = typeof phone === "string" ? phone.trim() : ""

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
    if (message !== undefined) updates.message = typeof message === "string" ? message.trim() : ""
    if (req.body.company !== undefined) {
      const meta = getMetadataObject()
      meta.company = typeof req.body.company === "string" ? req.body.company.trim() : ""
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

    // Enforce tenant scoping on deletion
    const query = { _id: id }
    if (!isSuperAdmin && effectiveTenantId) {
      query.tenantId = effectiveTenantId
    }

    const lead = await Lead.findOneAndDelete(query)

    if (!lead) {
      res.status(404).json({
        success: false,
        error: "Lead not found",
      })
      return
    }

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

    const total = await Lead.countDocuments(matchQuery)

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

module.exports = {
  getLeads,
  createLead,
  getLeadById,
  updateLead,
  deleteLead,
  getLeadStats,
}
