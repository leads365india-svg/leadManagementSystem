const { Router } = require("express")
const {
  getAuditLogs,
  getAuditFilterOptions,
  getAuditLogById,
} = require("../controllers/auditController")
const { authenticate, checkPermission } = require("../middleware/authMiddleware")

const router = Router()

// All audit routes require authentication and audit.view permission
router.use(authenticate)
router.use(checkPermission("audit.view"))

// GET /api/audit-logs - Query audit log records with filters and pagination
router.get("/", getAuditLogs)

// GET /api/audit-logs/filters - Fetch distinct actions and entities for filters
router.get("/filters", getAuditFilterOptions)

// GET /api/audit-logs/:id - Fetch single audit log detail record
router.get("/:id", getAuditLogById)

module.exports = router
