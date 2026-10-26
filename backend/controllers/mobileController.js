const deviceAuthService = require("../services/deviceAuthService")
const mobileSyncService = require("../services/mobileSyncService")

/**
 * Mobile Controller - Phase 15
 * 
 * Handles mobile device authentication, token lifecycle, incremental lead synchronization,
 * call log reporting with idempotency, and pre-flight recording upload authorization.
 */

/**
 * Device login & token pair generation
 * POST /api/mobile/auth/login
 */
async function login(req, res) {
  try {
    const { email, password, deviceUuid, deviceModel, osVersion, appVersion, pushToken } = req.body || {}

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: "Email and password are required",
        code: "CREDENTIALS_REQUIRED",
      })
    }

    if (!deviceUuid) {
      return res.status(400).json({
        success: false,
        error: "Device UUID is required for mobile authentication",
        code: "DEVICE_UUID_REQUIRED",
      })
    }

    const result = await deviceAuthService.loginDevice({
      email,
      password,
      deviceUuid,
      deviceModel,
      osVersion,
      appVersion: appVersion || req.headers["x-app-version"],
      pushToken,
      ipAddress: req.ip || req.connection?.remoteAddress,
    })

    return res.status(200).json({
      success: true,
      ...result,
    })
  } catch (err) {
    const status = err.status || 500
    return res.status(status).json({
      success: false,
      error: err.message,
      code: err.code || "AUTH_FAILED",
    })
  }
}

/**
 * Device token rotation and refresh
 * POST /api/mobile/auth/refresh
 */
async function refresh(req, res) {
  try {
    const { refreshToken, deviceUuid } = req.body || {}

    if (!refreshToken) {
      return res.status(400).json({
        success: false,
        error: "Refresh token is required",
        code: "REFRESH_TOKEN_REQUIRED",
      })
    }

    const result = await deviceAuthService.refreshDeviceToken({
      refreshToken,
      deviceUuid,
    })

    return res.status(200).json({
      success: true,
      ...result,
    })
  } catch (err) {
    const status = err.status || 401
    return res.status(status).json({
      success: false,
      error: err.message,
      code: err.code || "REFRESH_FAILED",
    })
  }
}

/**
 * Device logout (clears active refresh token)
 * POST /api/mobile/auth/logout
 */
async function logout(req, res) {
  try {
    const deviceId = req.device?._id || req.device?.id
    const tenantId = req.tenantId

    if (!deviceId || !tenantId) {
      return res.status(400).json({
        success: false,
        error: "Authenticated device context required for logout",
        code: "INVALID_DEVICE_CONTEXT",
      })
    }

    await deviceAuthService.logoutDevice(deviceId, tenantId)

    return res.status(200).json({
      success: true,
      message: "Device logged out successfully",
    })
  } catch (err) {
    const status = err.status || 500
    return res.status(status).json({
      success: false,
      error: err.message,
      code: err.code || "LOGOUT_FAILED",
    })
  }
}

/**
 * Update FCM / APNS push token for authenticated device
 * POST /api/mobile/push-token
 */
async function updatePushToken(req, res) {
  try {
    const { pushToken } = req.body || {}
    const deviceId = req.device?._id || req.device?.id
    const tenantId = req.tenantId

    if (!pushToken) {
      return res.status(400).json({
        success: false,
        error: "pushToken is required",
        code: "PUSH_TOKEN_REQUIRED",
      })
    }

    const updatedDevice = await deviceAuthService.updateDevicePushToken(deviceId, pushToken, tenantId)

    return res.status(200).json({
      success: true,
      message: "Push token updated successfully",
      deviceId: updatedDevice._id,
    })
  } catch (err) {
    const status = err.status || 500
    return res.status(status).json({
      success: false,
      error: err.message,
      code: err.code || "UPDATE_FAILED",
    })
  }
}

/**
 * Incremental agent-scoped lead synchronization
 * GET /api/mobile/leads
 */
async function syncLeads(req, res) {
  try {
    const tenantId = req.tenantId
    const agentId = req.user?._id || req.user?.id
    const { since, limit, cursor } = req.query

    const result = await mobileSyncService.syncAgentLeads({
      tenantId,
      agentId,
      since,
      limit,
      cursor,
    })

    return res.status(200).json({
      success: true,
      ...result,
    })
  } catch (err) {
    const status = err.status || 500
    return res.status(status).json({
      success: false,
      error: err.message,
      code: err.code || "SYNC_FAILED",
    })
  }
}

/**
 * Report mobile call log with clientCallId idempotency
 * POST /api/mobile/calls
 */
async function reportCall(req, res) {
  try {
    const tenantId = req.tenantId
    const agentId = req.user?._id || req.user?.id
    const deviceId = req.device?._id || req.device?.id

    const result = await mobileSyncService.reportMobileCall({
      tenantId,
      agentId,
      deviceId,
      callData: req.body || {},
    })

    const httpStatus = result.isDuplicate ? 200 : 201
    return res.status(httpStatus).json({
      success: true,
      ...result,
    })
  } catch (err) {
    const status = err.status || 500
    return res.status(status).json({
      success: false,
      error: err.message,
      code: err.code || "REPORT_CALL_FAILED",
    })
  }
}

/**
 * Issue pre-flight recording upload ticket
 * POST /api/mobile/calls/:id/recording-ticket
 */
async function getRecordingTicket(req, res) {
  try {
    const tenantId = req.tenantId
    const agentId = req.user?._id || req.user?.id
    const callId = req.params.id

    const result = await mobileSyncService.issueRecordingTicket({
      tenantId,
      agentId,
      callId,
    })

    return res.status(200).json({
      success: true,
      ...result,
    })
  } catch (err) {
    const status = err.status || 500
    return res.status(status).json({
      success: false,
      error: err.message,
      code: err.code || "TICKET_DENIED",
    })
  }
}

/**
 * Get authenticated device and agent profile status
 * GET /api/mobile/status
 */
async function getDeviceStatus(req, res) {
  try {
    return res.status(200).json({
      success: true,
      device: {
        id: req.device?._id,
        deviceUuid: req.device?.deviceUuid,
        deviceModel: req.device?.deviceModel,
        osVersion: req.device?.osVersion,
        appVersion: req.device?.appVersion,
        status: req.device?.status,
        lastSyncAt: req.device?.lastSyncAt,
      },
      user: {
        id: req.user?._id,
        name: req.user?.name,
        email: req.user?.email,
        role: req.user?.role,
      },
      tenantId: req.tenantId,
    })
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err.message,
    })
  }
}

module.exports = {
  login,
  refresh,
  logout,
  updatePushToken,
  syncLeads,
  reportCall,
  getRecordingTicket,
  getDeviceStatus,
}
