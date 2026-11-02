const express = require("express")
const {
  triggerCallAnalysis,
  getCallStatus,
  getCallTranscript,
  getCallAnalysis,
  reprocessCall,
  listAnalyzedCalls,
  getDashboardMetrics,
  getUsageMetrics,
} = require("../controllers/aiCallController")
const { authenticate, requireAccountAdmin } = require("../middleware/authMiddleware")

const router = express.Router()

// Dashboard & Usage Analytics
router.get("/dashboard", authenticate, getDashboardMetrics)
router.get("/usage", authenticate, getUsageMetrics)

// Analyzed Calls Listing with Pagination & Filters
router.get("/", authenticate, listAnalyzedCalls)

// Call-Specific Intelligence Operations
router.post("/:callId/analyze", authenticate, triggerCallAnalysis)
router.get("/:callId/status", authenticate, getCallStatus)
router.get("/:callId/transcript", authenticate, getCallTranscript)
router.get("/:callId/analysis", authenticate, getCallAnalysis)
router.post("/:callId/reprocess", authenticate, requireAccountAdmin, reprocessCall)

module.exports = router
