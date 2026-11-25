const jwt = require("jsonwebtoken")
const mongoose = require("mongoose")
const User = require("../models/User")
const Device = require("../models/Device")
const Account = require("../models/Account")
const Call = require("../models/Call")
const { getJwtSecret, authenticate } = require("./authMiddleware")
const { authenticateDevice } = require("./deviceAuthMiddleware")
const { tenantContextMiddleware } = require("./tenantContext")

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
      // If an explicit recording ticket was supplied and invalid/expired, fail closed
      if (ticketHeader) {
        return res.status(401).json({
          success: false,
          error: "Invalid or expired recording upload ticket",
          code: "INVALID_RECORDING_TICKET",
        })
      }
      return authenticate(req, res, next)
    }

    // 1. Check if token is a pre-flight recording upload ticket
    if (decoded.subject === "recording_upload_ticket" || decoded.purpose === "recording_upload") {
      if (!decoded.agentId || !decoded.tenantId) {
        return res.status(401).json({
          success: false,
          error: "Malformed recording upload ticket missing agent or tenant claim",
          code: "MALFORMED_RECORDING_TICKET",
        })
      }

      const targetCallId = req.params.id || req.params.callId
      if (targetCallId && decoded.callId && decoded.callId.toString() !== targetCallId.toString()) {
        return res.status(403).json({
          success: false,
          error: "Recording upload ticket is not valid for this specific Call ID",
          code: "TICKET_CALL_MISMATCH",
        })
      }

      // Live DB verification: reject suspended/deleted user, revoked tokenVersion, suspended tenant, or revoked device
      const user = await User.findOne({ _id: decoded.agentId, tenantId: decoded.tenantId }).select("-password").lean()
      if (!user) {
        return res.status(401).json({
          success: false,
          error: "Recording ticket user not found or tenant mismatch",
          code: "USER_NOT_FOUND",
        })
      }
      if (user.status === "suspended" || user.isActive === false) {
        return res.status(403).json({
          success: false,
          error: "Staff account is deactivated",
          code: "USER_DEACTIVATED",
        })
      }
      if (
        decoded.tokenVersion !== undefined &&
        user.tokenVersion !== undefined &&
        decoded.tokenVersion !== user.tokenVersion
      ) {
        return res.status(401).json({
          success: false,
          error: "Recording ticket session has been invalidated",
          code: "TOKEN_REVOKED",
        })
      }

      const account = await Account.findOne({ accountId: user.tenantId }).lean()
      if (account && account.status === "suspended") {
        return res.status(403).json({
          success: false,
          error: "Account is suspended",
          code: "ACCOUNT_SUSPENDED",
        })
      }

      if (decoded.deviceId) {
        const device = await Device.findOne({ _id: decoded.deviceId, tenantId: user.tenantId })
          .setOptions({ skipTenantFilter: true })
          .lean()
        if (!device || String(device.status || "").toUpperCase() === "REVOKED") {
          return res.status(403).json({
            success: false,
            error: "Device session has been revoked",
            code: "DEVICE_REVOKED",
          })
        }
        req.device = device
      }

      // Enforce call & workspace ownership against DB record + header anti-spoofing
      const requestedWorkspaceHeader =
        typeof req.headers["x-workspace-id"] === "string" ? req.headers["x-workspace-id"].trim() : null
      let boundWorkspaceId = decoded.workspaceId ? decoded.workspaceId.toString() : null

      const lookupCallId = targetCallId || decoded.callId
      if (lookupCallId) {
        const isObjId = mongoose.Types.ObjectId.isValid(lookupCallId)
        const callDoc = await Call.findOne({
          tenantId: user.tenantId,
          $or: [
            { clientCallId: lookupCallId },
            ...(isObjId ? [{ _id: lookupCallId }] : []),
          ],
        })
          .setOptions({ skipTenantFilter: true })
          .select("tenantId workspaceId agentId")
          .lean()

        if (!callDoc) {
          return res.status(404).json({
            success: false,
            error: "Target call record not found in your tenant",
            code: "CALL_NOT_FOUND",
          })
        }

        const isPrivileged = user.role === "account_admin" || user.role === "super_admin"
        if (!isPrivileged && callDoc.agentId && callDoc.agentId.toString() !== user._id.toString()) {
          return res.status(403).json({
            success: false,
            error: "Forbidden: Recording ticket user does not own target call",
            code: "FORBIDDEN_CALL_OWNERSHIP",
          })
        }

        if (callDoc.workspaceId) {
          const callWsStr = callDoc.workspaceId.toString()
          if (boundWorkspaceId && boundWorkspaceId !== callWsStr) {
            return res.status(403).json({
              success: false,
              error: "Recording ticket workspace does not match target call workspace",
              code: "TICKET_WORKSPACE_MISMATCH",
            })
          }
          if (!boundWorkspaceId) {
            boundWorkspaceId = callWsStr
          }
        }
      }

      if (boundWorkspaceId && requestedWorkspaceHeader && requestedWorkspaceHeader !== boundWorkspaceId) {
        return res.status(403).json({
          success: false,
          error: "Recording ticket workspace mismatch",
          code: "TICKET_WORKSPACE_MISMATCH",
        })
      }

      if (boundWorkspaceId && !requestedWorkspaceHeader) {
        req.headers["x-workspace-id"] = boundWorkspaceId
      }

      req.user = {
        _id: user._id,
        id: user._id.toString(),
        tenantId: user.tenantId,
        role: user.role,
        name: user.name,
        email: user.email,
      }
      req.tenantId = user.tenantId

      return tenantContextMiddleware(req, res, next)
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
