const { Router } = require("express")
const {
  getLeads,
  createLead,
  getLeadById,
  updateLead,
  deleteLead,
  getLeadStats,
} = require("../controllers/leadController")
const { optionalAuthenticate, checkPermission } = require("../middleware/authMiddleware")

const router = Router()

// Attach user session if token/cookie is present
router.use(optionalAuthenticate)

// GET /api/leads - View leads list
router.get("/", checkPermission("leads.view"), getLeads)

// GET /api/leads/stats - View lead statistics
router.get("/stats", checkPermission("dashboard.view"), getLeadStats)

// GET /api/leads/:id - View single lead by ID
router.get("/:id", checkPermission("leads.view"), getLeadById)

// POST /api/leads - Create new lead
router.post("/", checkPermission("leads.create"), createLead)

// PUT /api/leads/:id - Edit lead
router.put("/:id", checkPermission("leads.edit"), updateLead)

// DELETE /api/leads/:id - Delete lead
router.delete("/:id", checkPermission("leads.delete"), deleteLead)

module.exports = router
