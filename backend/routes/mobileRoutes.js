const express = require("express")
const router = express.Router()
const mobileController = require("../controllers/mobileController")
const {
  authenticateDevice,
  checkAppVersion,
  mobileRateLimiter,
} = require("../middleware/deviceAuthMiddleware")

/**
 * Mobile Router - Phase 15: Device Authentication & Mobile Sync API
 * 
 * Base path: /api/mobile
 */

// Global middleware for mobile API traffic
router.use(checkAppVersion)
router.use(mobileRateLimiter)

// 1. Device Authentication & Token Lifecycle
router.post("/auth/login", mobileController.login)
router.post("/auth/refresh", mobileController.refresh)
router.post("/auth/logout", authenticateDevice, mobileController.logout)

// 2. Device & Session Status
router.get("/status", authenticateDevice, mobileController.getDeviceStatus)
router.post("/push-token", authenticateDevice, mobileController.updatePushToken)

// 3. Mobile Synchronization
router.get("/leads", authenticateDevice, mobileController.syncLeads)
router.post("/calls", authenticateDevice, mobileController.reportCall)

// 4. Pre-flight Recording Ticket Authorization
router.post("/calls/:id/recording-ticket", authenticateDevice, mobileController.getRecordingTicket)

module.exports = router
