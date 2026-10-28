const jwt = require("jsonwebtoken")
const User = require("../models/User")
const Device = require("../models/Device")
const { getJwtSecret, authenticate } = require("./authMiddleware")
const { authenticateDevice } = require("./deviceAuthMiddleware")
const { tenantStorage } = require("./tenantContext")

/**
 * Flexible Authenticator for Call Recording Uploads
 * 
 * Supports:
 * 1. Pre-flight recording upload ticket issued by POST /api/mobile/calls/:id/recording-ticket (X-Recording-Ticket header or Bearer ticket)
 * 2. Mobile device-access token issued by POST /api/mobile/auth/login
 * 3. Standard web CRM user token (cookie or Bearer token)
 */
const authenticateRecordingUpload = async (req, res, next) => {
  try {
    const ticketHeader = req.headers["x-recording-ticket"] || req.query?.ticket
    const authHeader = req.headers.authorization
    let token = ticketHeader

    if (!token && authHeader && authHeader.startsWith("Bearer ")) {
      token = authHeader.split(" ")[1].trim()
    }

    if (!token) {
      // Fallback to cookie authenticate if present
      return authenticate(req, res, next)
    }

    const secret = getJwtSecret()
    let decoded = null
    try {
      decoded = jwt.verify(token, secret)
    } catch (err) {
      // If token verify fails as ticket, try authenticate or authenticateDevice
      return authenticate(req, res, next)
    }

    // 1. Check if token is a pre-flight recording upload ticket
    if (decoded.subject === "recording_upload_ticket" || decoded.purpose === "recording_upload") {
      const targetCallId = req.params.id
      if (targetCallId && decoded.callId && decoded.callId.toString() !== targetCallId.toString()) {
        return res.status(403).json({
          success: false,
          error: "Recording upload ticket is not valid for this specific Call ID",
          code: "TICKET_CALL_MISMATCH",
        })
      }

      req.user = {
        _id: decoded.agentId,
        id: decoded.agentId,
        tenantId: decoded.tenantId,
        role: "agent",
        name: "Mobile Agent",
      }
      req.tenantId = decoded.tenantId

      const context = {
        tenantId: decoded.tenantId,
        isSuperAdmin: false,
        userId: decoded.agentId,
        userRole: "agent",
      }
      req.tenantContext = context

      return tenantStorage.run(context, () => next())
    }

    // 2. Check if token is a mobile device access token
    if (decoded.tokenType === "device_access") {
      return authenticateDevice(req, res, next)
    }

    // 3. Fallback to standard user authentication
    return authenticate(req, res, next)
  } catch (err) {
    return res.status(401).json({
      success: false,
      error: "Recording upload authentication failed: " + err.message,
    })
  }
}

module.exports = {
  authenticateRecordingUpload,
}
