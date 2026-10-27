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
} = require("../controllers/callController")
const { authenticate, requireAccountAdmin } = require("../middleware/authMiddleware")

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

// Call Log Endpoints
router.post("/", authenticate, callLogLimiter, createCallLog)
router.get("/metrics", authenticate, getCallReportMetrics)
router.get("/", authenticate, getCallLogs)
router.get("/:id", authenticate, getCallById)
router.patch("/:id", authenticate, updateCallLog)

// Device Endpoints
router.get("/devices/all", authenticate, listDevices)
router.post("/devices", authenticate, registerDevice)
router.patch("/devices/:id/status", authenticate, updateDeviceStatus)

module.exports = router
