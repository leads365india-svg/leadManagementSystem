const express = require("express")
const {
  listDevices,
  registerDevice,
  updateDeviceStatus,
  getDeviceById,
} = require("../controllers/callController")
const { authenticate } = require("../middleware/authMiddleware")

const router = express.Router()

// All device management routes require active authentication
router.use(authenticate)

// GET /api/devices - List all devices for tenant (supports ?status=active, ?userId=...)
router.get("/", listDevices)

// GET /api/devices/all - Backward compatibility alias
router.get("/all", listDevices)

// POST /api/devices - Register or link an agent device
router.post("/", registerDevice)

// GET /api/devices/:id - Retrieve specific device details by ID
router.get("/:id", getDeviceById)

// PATCH /api/devices/:id/status - Update device status (active or revoked)
router.patch("/:id/status", updateDeviceStatus)

module.exports = router

