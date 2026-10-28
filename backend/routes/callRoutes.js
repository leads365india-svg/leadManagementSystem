const express = require("express")
const rateLimit = require("express-rate-limit")
const {
  createCallLog,
  getCallLogs,
  getCallReportMetrics,
  getCallById,
  updateCallLog,
  listDevices,
  registerDevice,
  updateDeviceStatus,
  uploadCallRecording,
  playCallRecording,
  purgeRecordings,
} = require("../controllers/callController")
const { authenticate, requireAccountAdmin } = require("../middleware/authMiddleware")
const { authenticateRecordingUpload } = require("../middleware/recordingAuthMiddleware")

const router = express.Router()

// Dedicated limiter for call logging
const callLogLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 120, // 120 call logs per minute
  message: {
    success: false,
    error: "Too many call logging requests. Please try again shortly.",
  },
  standardHeaders: true,
  legacyHeaders: false,
})

// Dedicated rate limiter for audio recording streaming uploads
const recordingUploadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60, // 60 uploads per minute per IP
  message: {
    success: false,
    error: "Too many recording upload attempts. Please try again shortly.",
  },
  standardHeaders: true,
  legacyHeaders: false,
})

const {
  ingestAudio,
  ingestCsv,
  getReviewQueue,
  matchCall,
  getStats: getIngestionStats,
} = require("../controllers/callIngestionController")

// Call Log Endpoints
router.post("/", authenticate, callLogLimiter, createCallLog)
router.get("/metrics", authenticate, getCallReportMetrics)

// Phase 21: Call Ingestion (Manual Upload & Review Queue) Endpoints
router.post("/ingestion/audio", authenticate, recordingUploadLimiter, ingestAudio)
router.post("/ingestion/csv", authenticate, ingestCsv)
router.get("/ingestion/review", authenticate, getReviewQueue)
router.post("/ingestion/match", authenticate, matchCall)
router.get("/ingestion/stats", authenticate, getIngestionStats)

router.get("/", authenticate, getCallLogs)
router.get("/:id", authenticate, getCallById)
router.patch("/:id", authenticate, updateCallLog)

// Phase 16: Call Recording Upload & Streaming Playback Endpoints
router.put("/:id/recording", recordingUploadLimiter, authenticateRecordingUpload, uploadCallRecording)
router.get("/:id/recording", authenticate, playCallRecording)
router.post("/recordings/purge", authenticate, requireAccountAdmin, purgeRecordings)

// Device Endpoints
router.get("/devices/all", authenticate, listDevices)
router.post("/devices", authenticate, registerDevice)
router.patch("/devices/:id/status", authenticate, updateDeviceStatus)

module.exports = router
