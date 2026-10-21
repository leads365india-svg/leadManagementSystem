const express = require("express")
const rateLimit = require("express-rate-limit")
const {
  getWebsiteConfig,
  updateWebsiteConfig,
  rotateApiKey,
  sendTestLead,
  receiveWebsiteLead,
} = require("../controllers/integrationController")
const { authenticate, requireAccountAdmin } = require("../middleware/authMiddleware")

const router = express.Router()

// Dedicated rate limiter for public webhook endpoint
const webhookLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60, // 60 requests per minute per IP
  message: {
    success: false,
    error: "Too many requests to integration webhook. Please try again shortly.",
  },
  standardHeaders: true,
  legacyHeaders: false,
})

// Public integration webhook route (authenticated via integration API key in header)
router.post("/leads/website", webhookLimiter, receiveWebsiteLead)

// Authenticated Lead Feeds Settings routes
router.get("/settings/website", authenticate, getWebsiteConfig)
router.put("/settings/website", authenticate, requireAccountAdmin, updateWebsiteConfig)
router.post("/settings/website/rotate-key", authenticate, requireAccountAdmin, rotateApiKey)
router.post("/settings/website/test", authenticate, requireAccountAdmin, sendTestLead)

module.exports = router
