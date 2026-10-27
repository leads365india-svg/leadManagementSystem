const { Router } = require("express")
const {
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
} = require("../controllers/leadController")
const { authenticate, checkPermission } = require("../middleware/authMiddleware")

const router = Router()

// Enforce authentication on all CRM lead management routes
router.use(authenticate)

// GET /api/leads - View leads list
router.get("/", checkPermission("leads.view"), getLeads)

// GET /api/leads/stats - View lead statistics
router.get("/stats", checkPermission("dashboard.view"), getLeadStats)

// GET /api/leads/pool/stats - View unassigned pool statistics
router.get("/pool/stats", checkPermission("leads.view"), getUnassignedPoolStats)

// POST /api/leads/assign & /api/leads/bulk-assign - Bulk assign leads
router.post("/assign", checkPermission("leads.assign"), bulkAssignLeads)
router.post("/bulk-assign", checkPermission("leads.assign"), bulkAssignLeads)

// GET /api/leads/:id/activities - View lead timeline activities
router.get("/:id/activities", checkPermission("leads.view"), getLeadActivities)

// GET /api/leads/:id - View single lead by ID
router.get("/:id", checkPermission("leads.view"), getLeadById)

// GET /api/leads/:id/calls - View calls and recordings for lead
router.get("/:id/calls", checkPermission("leads.view"), getLeadCalls)

// POST /api/leads - Create new lead
router.post("/", checkPermission("leads.create"), createLead)

// PATCH /api/leads/:id/assign - Assign / reassign single lead
router.patch("/:id/assign", checkPermission("leads.assign"), assignSingleLead)

// PUT /api/leads/:id - Edit lead
router.put("/:id", checkPermission("leads.edit"), updateLead)

// PATCH /api/leads/:id - Quick update / status change
router.patch("/:id", checkPermission("leads.edit"), updateLead)

// PATCH /api/leads/:id/status - Dedicated status transition endpoint
router.patch("/:id/status", checkPermission("leads.edit"), updateLead)

// DELETE /api/leads/:id - Delete lead
router.delete("/:id", checkPermission("leads.delete"), deleteLead)

module.exports = router
