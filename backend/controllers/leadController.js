const Lead = require("../models/Lead")

// Helper to escape regex special characters and prevent ReDoS
const escapeRegex = (str) => {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

// Strict whitelist for sortable fields to prevent injection
const ALLOWED_SORT_FIELDS = ["name", "email", "createdAt", "updatedAt", "status"]

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

  // Unauthenticated requests are strictly locked to legacy default-tenant
  return { tenantId: "default-tenant", isSuperAdmin: false }
}

const getLeads = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      search = "",
      status = "all",
      sortBy = "createdAt",
      sortOrder = "desc",
      tenantId: requestedTenantId,
    } = req.query

    const { tenantId: effectiveTenantId, isSuperAdmin } = getEffectiveTenant(req)

    // Security check: Unauthenticated or Account Admin attempting to access another tenant
    if (!isSuperAdmin && requestedTenantId && requestedTenantId !== effectiveTenantId) {
      res.status(403).json({
        success: false,
        error: "Access denied. Cross-tenant access is prohibited.",
      })
      return
    }

    const pageNum = Math.max(1, Number(page) || 1)
    const limitNum = Math.max(1, Math.min(50, Number(limit) || 10))
    const skip = (pageNum - 1) * limitNum

    // Build query with tenant isolation
    const query = {}
    if (effectiveTenantId) {
      query.tenantId = effectiveTenantId
    }

    // Search functionality with sanitized regex
    if (typeof search === "string" && search.trim()) {
      const sanitizedSearch = escapeRegex(search.trim())
      query.$or = [
        { name: { $regex: sanitizedSearch, $options: "i" } },
        { email: { $regex: sanitizedSearch, $options: "i" } },
      ]
    }

    // Status filter
    if (status && status !== "all") {
      query.status = status
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
      name: lead.name,
      email: lead.email,
      status: lead.status,
      tenantId: lead.tenantId,
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
    const { name, email, status, tenantId: bodyTenantId } = req.body

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

    // Security check: Prevent tampering with tenantId
    if (!isSuperAdmin && bodyTenantId && bodyTenantId !== effectiveTenantId) {
      res.status(403).json({
        success: false,
        error: "Cross-tenant lead creation is prohibited",
      })
      return
    }

    const assignedTenant = effectiveTenantId || bodyTenantId || "default-tenant"

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

    const lead = new Lead({
      name: name.trim(),
      email: email.toLowerCase().trim(),
      status: status || "New",
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
    const { tenantId: effectiveTenantId, isSuperAdmin } = getEffectiveTenant(req)

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
    const { name, email, status } = req.body
    const { tenantId: effectiveTenantId, isSuperAdmin } = getEffectiveTenant(req)

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

    // Check if email is being changed and if it already exists within the tenant
    if (email && email.toLowerCase().trim() !== lead.email) {
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

    const updatedLead = await Lead.findByIdAndUpdate(
      id,
      {
        ...(name && typeof name === "string" && { name: name.trim() }),
        ...(email && typeof email === "string" && { email: email.toLowerCase().trim() }),
        ...(status && { status }),
      },
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
    const { tenantId: effectiveTenantId, isSuperAdmin } = getEffectiveTenant(req)

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

    const matchQuery = {}
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
