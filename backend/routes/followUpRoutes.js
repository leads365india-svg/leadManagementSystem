const { Router } = require("express")
const {
  getFollowUps,
  getFollowUpStats,
  getFollowUpById,
  createFollowUp,
  updateFollowUp,
  completeFollowUp,
  deleteFollowUp,
} = require("../controllers/followUpController")
const { authenticate, checkPermission } = require("../middleware/authMiddleware")

const router = Router()

// Enforce authentication on all follow-up routes
router.use(authenticate)

// GET /api/follow-ups/stats - Pipeline follow-up statistics
router.get("/stats", checkPermission("followups.view"), getFollowUpStats)

// GET /api/follow-ups - List follow-ups with filtering, search, and pagination
router.get("/", checkPermission("followups.view"), getFollowUps)

// GET /api/follow-ups/:id - Single follow-up details
router.get("/:id", checkPermission("followups.view"), getFollowUpById)

// POST /api/follow-ups - Create / Schedule a new follow-up
router.post("/", checkPermission("followups.manage"), createFollowUp)

// PUT /api/follow-ups/:id - Full follow-up update
router.put("/:id", checkPermission("followups.manage"), updateFollowUp)

// PATCH /api/follow-ups/:id - Partial follow-up update
router.patch("/:id", checkPermission("followups.manage"), updateFollowUp)

// PATCH /api/follow-ups/:id/complete - Mark follow-up as completed
router.patch("/:id/complete", checkPermission("followups.manage"), completeFollowUp)

// DELETE /api/follow-ups/:id - Delete follow-up
router.delete("/:id", checkPermission("followups.manage"), deleteFollowUp)

module.exports = router
