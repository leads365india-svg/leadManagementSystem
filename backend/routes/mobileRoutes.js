const { Router } = require("express")
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
} = require("../controllers/mobileController")
const { authenticate } = require("../middleware/authMiddleware")

const router = Router()

// Public mobile authentication endpoints
router.post("/auth/login", mobileLogin)
router.post("/auth/refresh", mobileRefreshToken)

// Authenticated mobile endpoints
router.post("/auth/logout", authenticate, mobileLogout)
router.post("/devices/register", authenticate, mobileRegisterDevice)
router.post("/devices/:deviceId/revoke", authenticate, mobileRevokeDevice)
router.post("/push-token", authenticate, updateMobilePushToken)

// Phase 5: Lead Delta Sync
router.get("/leads/sync", authenticate, syncMobileLeads)

// Phase 6: Call Reporting & History
router.post("/calls", authenticate, reportMobileCall)
router.patch("/calls/:callId/link-lead", authenticate, linkCallToLead)
router.get("/calls", authenticate, getMobileCalls)

// Phase 8: Call Recording Streaming Upload & Playback
router.put("/calls/:callId/recording", authenticate, uploadMobileRecording)
router.get("/calls/:callId/recording", authenticate, streamCallRecording)

// Phase 9: Agency Privacy, Consent & DNR Policy
router.get("/policy", authenticate, getMobilePolicy)
router.post("/policy/pause", authenticate, setMobileRecordingSyncPause)

// Phase 11: Diagnostics & Health Heartbeat
router.post("/heartbeat", authenticate, mobileHeartbeat)
router.post("/diagnostics", authenticate, mobileDiagnostics)

module.exports = router
