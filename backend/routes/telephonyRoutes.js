const express = require("express")
const router = express.Router()
const { authenticate, requireAccountAdmin } = require("../middleware/authMiddleware")
const telephonyWebhookAuth = require("../middleware/telephonyWebhookAuth")
const {
  getTelephonyConfig,
  updateTelephonyConfig,
  handleInboundCallWebhook,
  handleCallStatusWebhook,
  handleRecordingStatusWebhook,
} = require("../controllers/telephonyController")

/**
 * Leads365 AI Receptionist — Telephony Routes (Phase 1 & Phase 2)
 * 
 * 1. Multi-tenant telephony configuration management (JWT + Account Admin).
 * 2. Inbound carrier webhooks (Cryptographic signature verification).
 */

// --- Tenant Management Endpoints (Strictly JWT Authenticated) ---
router.get("/config", authenticate, requireAccountAdmin, getTelephonyConfig)
router.put("/config", authenticate, requireAccountAdmin, updateTelephonyConfig)

// --- Inbound Telephony Webhooks (Guarded by Carrier Signature Auth) ---
router.post("/webhook/inbound", telephonyWebhookAuth, handleInboundCallWebhook)
router.post("/webhook/inbound/:provider", telephonyWebhookAuth, handleInboundCallWebhook)

// --- Call Status Callbacks ---
router.post("/webhook/status", handleCallStatusWebhook)
router.post("/webhook/status/:provider", handleCallStatusWebhook)

// --- Call Recording Callbacks ---
router.post("/webhook/recording", handleRecordingStatusWebhook)
router.post("/webhook/recording/:provider", handleRecordingStatusWebhook)

module.exports = router
