const mongoose = require("mongoose")
const auditService = require("../services/auditService")
const { getEffectiveTenant } = require("../middleware/tenantContext")

/**
 * Audit Log Controller - Phase 8: Audit Log
 * 
 * Provides read-only API access to tenant audit logs with strict
 * tenant isolation, RBAC permission verification, and flexible filtering.
 * Does NOT expose any update or delete endpoints.
 */

/**
 * GET /api/audit-logs
 * List audit logs with pagination, search, action/entity filters, and date range
 */
const getAuditLogs = async (req, res) => {
  try {
    const { tenantId, isSuperAdmin } = getEffectiveTenant(req)

    if (!tenantId && !isSuperAdmin) {
      return res.status(403).json({
        success: false,
        error: "Tenant context required to access audit logs",
      })
    }

    const targetTenantId = isSuperAdmin ? req.query.tenantId || tenantId : tenantId

    const {
      page = 1,
      limit = 25,
      entity,
      action,
      actorId,
      search,
      startDate,
      endDate,
    } = req.query

    const result = await auditService.queryLogs({
      tenantId: targetTenantId,
      entity,
      action,
      actorId,
      search,
      startDate,
      endDate,
      page,
      limit,
      isSuperAdmin,
    })

    res.status(200).json({
      success: true,
      data: result.logs,
      pagination: {
        total: result.total,
        page: result.page,
        totalPages: result.totalPages,
        limit: result.limit,
      },
    })
  } catch (error) {
    console.error("Error fetching audit logs:", error)
    res.status(500).json({
      success: false,
      error: "Failed to load audit logs",
    })
  }
}

/**
 * GET /api/audit-logs/filters
 * Returns distinct actions and entity types for UI filter dropdowns
 */
const getAuditFilterOptions = async (req, res) => {
  try {
    const { tenantId, isSuperAdmin } = getEffectiveTenant(req)

    if (!tenantId && !isSuperAdmin) {
      return res.status(403).json({
        success: false,
        error: "Tenant context required to fetch filter options",
      })
    }

    const targetTenantId = isSuperAdmin ? req.query.tenantId || tenantId : tenantId
    const options = await auditService.getDistinctActionsAndEntities(targetTenantId, isSuperAdmin)

    res.status(200).json({
      success: true,
      data: options,
    })
  } catch (error) {
    console.error("Error fetching audit filter options:", error)
    res.status(500).json({
      success: false,
      error: "Failed to load audit filter options",
    })
  }
}

/**
 * GET /api/audit-logs/:id
 * Retrieve single detailed audit log record with sanitized before/after details
 */
const getAuditLogById = async (req, res) => {
  try {
    const { id } = req.params
    const { tenantId, isSuperAdmin } = getEffectiveTenant(req)

    if (!tenantId && !isSuperAdmin) {
      return res.status(403).json({
        success: false,
        error: "Tenant context required to view audit log details",
      })
    }

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        error: "Invalid audit log ID format",
      })
    }

    const logEntry = await auditService.getLogById(id, tenantId, isSuperAdmin)

    if (!logEntry) {
      return res.status(404).json({
        success: false,
        error: "Audit log entry not found or outside authorized tenant scope",
      })
    }

    res.status(200).json({
      success: true,
      data: logEntry,
    })
  } catch (error) {
    console.error("Error fetching audit log detail:", error)
    res.status(500).json({
      success: false,
      error: "Failed to retrieve audit log record",
    })
  }
}

module.exports = {
  getAuditLogs,
  getAuditFilterOptions,
  getAuditLogById,
}
