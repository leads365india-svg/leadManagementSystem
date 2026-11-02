const express = require("express")
const {
  getDashboard,
  getTopics,
  getCallCoaching,
  listScorecards,
  getAgentScorecard,
  recomputeScorecard,
  getLeadPriorities,
  evaluateLead,
  acceptPriority,
  dismissPriority,
  getRecommendations,
  patchRecommendationStatus,
  getCoachingReviews,
  postCoachingReview,
  patchCompleteReview,
} = require("../controllers/aiSalesIntelligenceController")
const { authenticate } = require("../middleware/authMiddleware")

const router = express.Router()

// 1. Dashboard & Business Intelligence
router.get("/dashboard", authenticate, getDashboard)
router.get("/topics", authenticate, getTopics)

// 2. Call Coaching Report
router.get("/coaching/:callId", authenticate, getCallCoaching)

// 3. Agent Performance Scorecards
router.get("/scorecards", authenticate, listScorecards)
router.get("/scorecards/:agentId", authenticate, getAgentScorecard)
router.post("/scorecards/:agentId/recompute", authenticate, recomputeScorecard)

// 4. Lead Priority Intelligence
router.get("/lead-priorities", authenticate, getLeadPriorities)
router.post("/lead-priorities/:leadId/evaluate", authenticate, evaluateLead)
router.post("/lead-priorities/:leadId/accept", authenticate, acceptPriority)
router.post("/lead-priorities/:leadId/dismiss", authenticate, dismissPriority)

// 5. Manager Recommendations & Alerts Center
router.get("/recommendations", authenticate, getRecommendations)
router.patch("/recommendations/:id/status", authenticate, patchRecommendationStatus)

// 6. Manager Coaching 1-on-1 Reviews
router.get("/coaching-reviews", authenticate, getCoachingReviews)
router.post("/coaching-reviews", authenticate, postCoachingReview)
router.patch("/coaching-reviews/:id/complete", authenticate, patchCompleteReview)

module.exports = router
