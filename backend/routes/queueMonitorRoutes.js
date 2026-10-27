const { Router } = require("express")
const {
  getMetrics,
  listJobs,
  listDeadLetterJobs,
  retryDeadLetter,
  triggerSchedule,
} = require("../controllers/queueMonitorController")
const { authenticate, requireSuperAdmin } = require("../middleware/authMiddleware")

const router = Router()

// All queue monitor routes require Super Admin authorization
router.use(authenticate)
router.use(requireSuperAdmin)

// GET /api/admin/queues/metrics
router.get("/metrics", getMetrics)

// GET /api/admin/queues/jobs
router.get("/jobs", listJobs)

// GET /api/admin/queues/dead-letter
router.get("/dead-letter", listDeadLetterJobs)

// POST /api/admin/queues/dead-letter/:id/retry
router.post("/dead-letter/:id/retry", retryDeadLetter)

// POST /api/admin/queues/schedules/:id/trigger
router.post("/schedules/:id/trigger", triggerSchedule)

module.exports = router
