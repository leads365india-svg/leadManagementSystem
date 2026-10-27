const { Router } = require("express")
const mobileController = require("../controllers/mobileController")
const {
  syncMobileLeads,
  reportMobileCall,
  linkCallToLead,
  getMobileCalls,
  mobileLogin,
  mobileRefreshToken,
  mobileRegisterDevice,
  updateMobilePushToken,
  mobileLogout,
  mobileRevokeDevice,
  uploadMobileRecording,
  streamCallRecording,
  getMobilePolicy,
  setMobileRecordingSyncPause,
  mobileHeartbeat,
  mobileDiagnostics,
} = mobileController
const { authenticate } = require("../middleware/authMiddleware")
const {
  authenticateDevice,
  checkAppVersion,
  mobileRateLimiter,
} = require("../middleware/deviceAuthMiddleware")

const router = Router()

// App version check across mobile endpoints
router.use(checkAppVersion)

// Hybrid mobile auth middleware: accepts either device_access token or standard mobile agent token
const authenticateAnyMobile = (req, res, next) => {
  const authHeader = req.headers.authorization
  if (authHeader && authHeader.startsWith("Bearer ")) {
    // If standard authenticate succeeds, proceed
    authenticate(req, res, (err) => {
      if (!err && req.user) return next()
      // Fallback to authenticateDevice
      authenticateDevice(req, res, next)
    })
  } else {
    authenticate(req, res, next)
  }
}

// ----------------------------------------------------
// Authentication Endpoints
// ----------------------------------------------------
// Unified login supporting both Android app contract and Phase 15 deviceUuid auth
router.post("/auth/login", (req, res, next) => {
  if (req.body && req.body.deviceUuid && typeof mobileController.login === "function") {
    return mobileController.login(req, res, next)
  }
  return mobileLogin(req, res, next)
})

// Unified refresh supporting both refresh contracts
router.post("/auth/refresh", (req, res, next) => {
  if (req.body && req.body.deviceUuid && typeof mobileController.refresh === "function") {
    return mobileController.refresh(req, res, next)
  }
  return mobileRefreshToken(req, res, next)
})

// Logout
router.post("/auth/logout", authenticateAnyMobile, (req, res, next) => {
  if (req.device && typeof mobileController.logout === "function") {
    return mobileController.logout(req, res, next)
  }
  return mobileLogout(req, res, next)
})

// ----------------------------------------------------
// Device Registration & Push Tokens
// ----------------------------------------------------
router.post("/devices/register", authenticate, mobileRegisterDevice)
router.post("/devices/:deviceId/revoke", authenticate, mobileRevokeDevice)
router.post("/push-token", authenticateAnyMobile, (req, res, next) => {
  if (req.device && typeof mobileController.updatePushToken === "function") {
    return mobileController.updatePushToken(req, res, next)
  }
  return updateMobilePushToken(req, res, next)
})

// Phase 15 Device Status
router.get("/status", authenticateAnyMobile, (req, res, next) => {
  if (typeof mobileController.getDeviceStatus === "function") {
    return mobileController.getDeviceStatus(req, res, next)
  }
  return res.status(200).json({ success: true, user: req.user, status: "ACTIVE" })
})

// ----------------------------------------------------
// Phase 5: Lead Delta Sync
// ----------------------------------------------------
router.get("/leads/sync", authenticate, syncMobileLeads)
router.get("/leads", authenticateAnyMobile, (req, res, next) => {
  if (req.device && typeof mobileController.syncLeads === "function") {
    return mobileController.syncLeads(req, res, next)
  }
  return syncMobileLeads(req, res, next)
})

// ----------------------------------------------------
// Phase 6: Call Reporting & History
// ----------------------------------------------------
router.post("/calls", authenticateAnyMobile, (req, res, next) => {
  if (req.device && typeof mobileController.reportCall === "function") {
    return mobileController.reportCall(req, res, next)
  }
  return reportMobileCall(req, res, next)
})
router.patch("/calls/:callId/link-lead", authenticate, linkCallToLead)
router.get("/calls", authenticate, getMobileCalls)

// Phase 15: Recording Ticket
router.post("/calls/:id/recording-ticket", authenticateAnyMobile, (req, res, next) => {
  if (typeof mobileController.getRecordingTicket === "function") {
    return mobileController.getRecordingTicket(req, res, next)
  }
  return res.status(200).json({ success: true, uploadTicket: "ticket_mock" })
})

// ----------------------------------------------------
// Phase 8: Call Recording Streaming Upload & Playback
// ----------------------------------------------------
router.put("/calls/:callId/recording", authenticate, uploadMobileRecording)
router.get("/calls/:callId/recording", authenticate, streamCallRecording)

// ----------------------------------------------------
// Phase 9: Agency Privacy, Consent & DNR Policy
// ----------------------------------------------------
router.get("/policy", authenticate, getMobilePolicy)
router.post("/policy/pause", authenticate, setMobileRecordingSyncPause)

// ----------------------------------------------------
// Phase 11: Diagnostics & Health Heartbeat
// ----------------------------------------------------
router.post("/heartbeat", authenticate, mobileHeartbeat)
router.post("/diagnostics", authenticate, mobileDiagnostics)

module.exports = router
