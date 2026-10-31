const express = require("express")
const rateLimit = require("express-rate-limit")
const {
  getWebsiteConfig,
  updateWebsiteConfig,
  rotateApiKey,
  rotateSiteKey,
  serveWebsiteSnippet,
  sendTestLead,
  receiveWebsiteLead,
  listIntegrations,
  createIntegration,
  getIntegrationById,
  updateIntegration,
  rotateIntegrationKey,
  deleteIntegration,
  listSources,
  upsertSource,
  listEvents,
  replayIntegrationEvent,
  syncLegacyIntegrations,
  getIntegrationSnippets,
  testIntegrationById,
} = require("../controllers/integrationController")
const {
  handleMetaWebhookHandshake,
  handleMetaWebhookNotification,
  connectMetaIntegration,
  getMetaAuthUrl,
  triggerMetaBackfill,
} = require("../controllers/metaController")
const {
  connectIndiaMartIntegration,
  getIndiaMartStatus,
  triggerIndiaMartSync,
  handleIndiaMartWebhook,
} = require("../controllers/indiamartController")
const {
  handleGoogleWebhook,
  getGoogleConfig,
  connectGoogleIntegration,
  rotateGoogleKey,
  sendGoogleTestLead,
} = require("../controllers/googleAdsController")
const {
  handleGenericWebhook,
  getGenericConfig,
  connectGenericIntegration,
  rotateGenericKey,
  sendGenericTestLead,
} = require("../controllers/genericConnectorController")
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

// 0. Public Embeddable Website Snippet (Phase 22)
router.get("/snippet.js", serveWebsiteSnippet)

// 1. Public Integration Webhook Route (Preserves exact URL, headers, and response contract)
router.post("/leads/website", webhookLimiter, receiveWebsiteLead)

// 2. Backward-Compatible Lead Feeds Settings routes
router.get("/settings/website", authenticate, getWebsiteConfig)
router.put("/settings/website", authenticate, requireAccountAdmin, updateWebsiteConfig)
router.post("/settings/website/rotate-key", authenticate, requireAccountAdmin, rotateApiKey)
router.post("/settings/website/rotate-site-key", authenticate, requireAccountAdmin, rotateSiteKey)
router.post("/settings/website/test", authenticate, requireAccountAdmin, sendTestLead)

// 3. Phase 11 Canonical Lead Source Registry
router.get("/sources", authenticate, listSources)
router.post("/sources", authenticate, requireAccountAdmin, upsertSource)

// 4. Phase 11 Integration Event Ledger & Replay
router.get("/events", authenticate, listEvents)
router.post("/events/:id/replay", authenticate, requireAccountAdmin, replayIntegrationEvent)

// 5. Phase 11 Legacy Sync Trigger
router.post("/sync-legacy", authenticate, requireAccountAdmin, syncLegacyIntegrations)

// 6. Phase 12 Meta Lead Ads Webhooks & Connect Endpoints
router.get("/webhooks/meta", handleMetaWebhookHandshake)
router.post("/webhooks/meta", webhookLimiter, handleMetaWebhookNotification)
router.post("/meta/connect", authenticate, requireAccountAdmin, connectMetaIntegration)
router.get("/meta/auth-url", authenticate, getMetaAuthUrl)
router.post("/meta/:id/backfill", authenticate, requireAccountAdmin, triggerMetaBackfill)

// 7. Phase 13 IndiaMART Lead Manager Endpoints
router.post("/webhooks/indiamart", webhookLimiter, handleIndiaMartWebhook)
router.post("/indiamart/connect", authenticate, requireAccountAdmin, connectIndiaMartIntegration)
router.get("/indiamart/status", authenticate, getIndiaMartStatus)
router.post("/indiamart/:id/sync", authenticate, requireAccountAdmin, triggerIndiaMartSync)

// 8. Phase 23 Google Ads Lead Form Webhook Endpoints
router.post("/webhooks/google", webhookLimiter, handleGoogleWebhook)
router.get("/google/status", authenticate, getGoogleConfig)
router.post("/google/connect", authenticate, requireAccountAdmin, connectGoogleIntegration)
router.post("/google/rotate-key", authenticate, requireAccountAdmin, rotateGoogleKey)
router.post("/google/test", authenticate, requireAccountAdmin, sendGoogleTestLead)

// 9. Phase 24 Generic Connector Endpoints (Zapier, Make, n8n, Pabbly)
router.post("/webhooks/generic", webhookLimiter, handleGenericWebhook)
router.get("/generic/status", authenticate, getGenericConfig)
router.post("/generic/connect", authenticate, requireAccountAdmin, connectGenericIntegration)
router.post("/generic/rotate-key", authenticate, requireAccountAdmin, rotateGenericKey)
router.post("/generic/test", authenticate, requireAccountAdmin, sendGenericTestLead)

// 10. Phase 11 Multi-Tenant Integration Connectors CRUD
router.get("/", authenticate, listIntegrations)
router.post("/", authenticate, requireAccountAdmin, createIntegration)
router.get("/:id", authenticate, getIntegrationById)
router.get("/:id/snippets", authenticate, getIntegrationSnippets)
router.post("/:id/test", authenticate, requireAccountAdmin, testIntegrationById)
router.put("/:id", authenticate, requireAccountAdmin, updateIntegration)
router.post("/:id/rotate-key", authenticate, requireAccountAdmin, rotateIntegrationKey)
router.delete("/:id", authenticate, requireAccountAdmin, deleteIntegration)

module.exports = router
