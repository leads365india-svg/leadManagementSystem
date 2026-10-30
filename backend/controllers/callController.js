const mongoose = require("mongoose")
const Call = require("../models/Call")
const Device = require("../models/Device")
const callService = require("../services/callService")
const recordingStorage = require("../services/recordingStorage")
const { checkDirectObjectAccess } = require("../utils/rbacScope")
const audit = require("../services/auditService")

/**
 * Leads-365 CRM - Call & Device Controller (Phase 14)
 * 
 * Provides:
 * - POST   /api/calls (Log a call)
 * - GET    /api/calls (List calls with scope filtering own/team/all)
 * - GET    /api/calls/metrics (Aggregate metrics for Call Reports)
 * - GET    /api/calls/:id (Get single call details)
 * - PATCH  /api/calls/:id (Update disposition and notes)
 * - GET    /api/devices (List tenant devices)
 * - POST   /api/devices (Register a device)
 * - PATCH  /api/devices/:id/status (Revoke or activate device)
 */

/**
 * POST /api/calls
 * Logs a new completed, missed, or rejected call.
 */
const createCallLog = async (req, res) => {
  try {
    const tenantId = req.user.tenantId
    const {
      leadId,
      number,
      direction = "outbound",
      duration = 0,
      status = "completed",
      disposition = "connected",
      notes = "",
      source = "manual",
      startedAt = null,
      deviceId = null,
      recording = {},
    } = req.body || {}

    if (!number || typeof number !== "string" || !number.trim()) {
      return res.status(400).json({
        success: false,
        error: "Valid phone number is required to log a call",
      })
    }

    // Determine agent: regular agents log calls as themselves; admins can specify agentId
    let agentId = req.user._id
    if (req.body.agentId && req.user.role === "account_admin" && mongoose.Types.ObjectId.isValid(req.body.agentId)) {
      agentId = req.body.agentId
    }

    const clientCallId = req.body.clientCallId || req.body.client_call_id || null

    const result = await callService.logCall({
      tenantId,
      clientCallId,
      agentId,
      leadId,
      deviceId,
      number,
      direction,
      duration,
      status,
      disposition,
      notes,
      source,
      startedAt,
      recording,
      actor: {
        id: req.user._id,
        name: req.user.name,
        email: req.user.email,
        role: req.user.role,
      },
    })

    return res.status(201).json({
      success: true,
      message: "Call logged successfully",
      data: result.data || result.call,
      call: result.call || result.data,
      leadMatched: Boolean(result.lead),
      lead: result.lead ? {
        id: result.lead._id,
        name: result.lead.name,
        phone: result.lead.phone,
        status: result.lead.status,
      } : null,
    })
  } catch (err) {
    console.error("[CallController Log Error]:", err)
    return res.status(err.statusCode || 500).json({
      success: false,
      error: `Failed to log call: ${err.message}`,
    })
  }
}

/**
 * GET /api/calls
 * Lists calls with own/team/all RBAC scope enforcement.
 */
const getCallLogs = async (req, res) => {
  try {
    const result = await callService.listCalls(req.query, req.user)
    const listData = result.data || { calls: result.calls, pagination: result.pagination }
    return res.status(200).json({
      success: true,
      data: listData,
      calls: listData.calls || result.calls,
      pagination: listData.pagination || result.pagination,
    })
  } catch (err) {
    console.error("[CallController List Error]:", err)
    return res.status(500).json({
      success: false,
      error: `Failed to retrieve call logs: ${err.message}`,
    })
  }
}

/**
 * GET /api/calls/metrics
 * Returns aggregated call reporting metrics.
 */
const getCallReportMetrics = async (req, res) => {
  try {
    const result = await callService.getCallMetrics(req.query, req.user?.tenantId)
    const metricsData = result.data || result
    return res.status(200).json({
      success: true,
      data: metricsData,
      metrics: metricsData,
    })
  } catch (err) {
    console.error("[CallController Metrics Error]:", err)
    return res.status(500).json({
      success: false,
      error: `Failed to compute call metrics: ${err.message}`,
    })
  }
}

/**
 * GET /api/calls/:id
 * Retrieves a single call log with scope verification.
 */
const getCallById = async (req, res) => {
  try {
    const { id } = req.params
    const tenantId = req.user.tenantId

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, error: "Invalid call ID format" })
    }

    const call = await Call.findOne({ _id: id, tenantId })
      .setOptions({ skipTenantFilter: true })
      .populate("agentId", "name email role")
      .populate("leadId", "name phone email company status assignedTo")

    if (!call) {
      return res.status(404).json({ success: false, error: "Call log not found" })
    }

    const access = await checkDirectObjectAccess(req.user, call, "calls", "view")
    if (!access.allowed) {
      return res.status(403).json({
        success: false,
        error: access.reason || "Forbidden: You do not have permission to view this call",
      })
    }

    return res.status(200).json({
      success: true,
      data: call,
      call,
    })
  } catch (err) {
    console.error("[CallController GetById Error]:", err)
    return res.status(500).json({
      success: false,
      error: `Failed to retrieve call details: ${err.message}`,
    })
  }
}

/**
 * PATCH /api/calls/:id
 * Updates disposition and notes on a call.
 */
const updateCallLog = async (req, res) => {
  try {
    const { id } = req.params
    const tenantId = req.user.tenantId
    const { disposition, notes } = req.body || {}

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, error: "Invalid call ID format" })
    }

    const updated = await callService.updateCall(id, tenantId, { disposition, notes }, req.user)
    const callData = updated.data || updated

    return res.status(200).json({
      success: true,
      message: "Call log updated successfully",
      data: callData,
      call: callData,
    })
  } catch (err) {
    console.error("[CallController Update Error]:", err)
    return res.status(err.statusCode || 500).json({
      success: false,
      error: err.message || "Failed to update call log",
    })
  }
}

/**
 * GET /api/devices
 * Lists devices registered for the tenant.
 */
const listDevices = async (req, res) => {
  try {
    const tenantId = req.user.tenantId
    const { status, userId } = req.query
    const filter = { tenantId }

    if (status) filter.status = status
    if (userId && mongoose.Types.ObjectId.isValid(userId)) filter.userId = userId

    // If caller is agent (not admin), only see own devices
    if (req.user.role === "agent") {
      filter.userId = req.user._id
    }

    const devices = await Device.find(filter)
      .setOptions({ skipTenantFilter: true })
      .populate("userId", "name email role")
      .sort({ lastSeenAt: -1 })
      .lean()

    return res.status(200).json({
      success: true,
      data: { devices, total: devices.length },
      count: devices.length,
      devices,
    })
  } catch (err) {
    console.error("[DeviceController List Error]:", err)
    return res.status(500).json({
      success: false,
      error: `Failed to retrieve devices: ${err.message}`,
    })
  }
}

/**
 * POST /api/devices
 * Registers or updates an agent mobile device.
 */
const registerDevice = async (req, res) => {
  try {
    const tenantId = req.user.tenantId
    const {
      userId,
      label = "",
      model = "",
      osVersion = "",
      appVersion = "",
      pushToken = "",
    } = req.body || {}

    // Target user: agent registers self; admin can register for any agent
    let targetUserId = req.user._id
    if (userId && req.user.role === "account_admin" && mongoose.Types.ObjectId.isValid(userId)) {
      targetUserId = userId
    }

    const device = new Device({
      tenantId,
      userId: targetUserId,
      label: String(label).trim(),
      model: String(model).trim(),
      osVersion: String(osVersion).trim(),
      appVersion: String(appVersion).trim(),
      pushToken: String(pushToken).trim(),
      status: "active",
      lastSeenAt: new Date(),
    })

    await device.save()

    return res.status(201).json({
      success: true,
      message: "Device registered successfully",
      data: device,
      device,
    })
  } catch (err) {
    console.error("[DeviceController Register Error]:", err)
    return res.status(500).json({
      success: false,
      error: `Failed to register device: ${err.message}`,
    })
  }
}

/**
 * PATCH /api/devices/:id/status
 * Revokes or re-activates an agent device.
 */
const updateDeviceStatus = async (req, res) => {
  try {
    const tenantId = req.user.tenantId
    const { id } = req.params
    const { status } = req.body || {}

    if (!["active", "revoked"].includes(status)) {
      return res.status(400).json({
        success: false,
        error: "Invalid status: Expected 'active' or 'revoked'",
      })
    }

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, error: "Invalid device ID format" })
    }

    const device = await Device.findOne({ _id: id, tenantId }).setOptions({ skipTenantFilter: true })
    if (!device) {
      return res.status(404).json({ success: false, error: "Device not found" })
    }

    device.status = status
    await device.save()

    // Audit log device revocation
    await audit.log({
      tenantId,
      actor: { id: req.user._id, name: req.user.name, email: req.user.email, role: req.user.role },
      action: status === "revoked" ? "device.revoke" : "device.activate",
      entity: "Device",
      entityId: device._id,
      summary: `${status === "revoked" ? "Revoked" : "Re-activated"} agent device ${device.label || device.model}`,
      details: { deviceId: device._id, status, model: device.model },
      req,
    })

    return res.status(200).json({
      success: true,
      message: `Device status updated to '${status}'`,
      data: device,
      device,
    })
  } catch (err) {
    console.error("[DeviceController UpdateStatus Error]:", err)
    return res.status(500).json({
      success: false,
      error: `Failed to update device status: ${err.message}`,
    })
  }
}

/**
 * PUT /api/calls/:id/recording
 * Streams an audio recording into GridFS for a verified CRM lead call.
 */
const uploadCallRecording = async (req, res) => {
  try {
    const callId = req.params.id
    const tenantId = req.user?.tenantId || req.tenantId
    const user = req.user
    const mimeType = req.headers["content-type"] || "audio/mp4"
    const expectedSha256 = req.headers["x-audio-sha256"] || req.headers["x-sha256"] || null
    const filename = req.headers["x-filename"] || null
    const contentLength = parseInt(req.headers["content-length"], 10) || 0
    const retentionDays = parseInt(process.env.RECORDING_RETENTION_DAYS, 10) || 30

    const result = await recordingStorage.streamUpload({
      callId,
      tenantId,
      user,
      readStream: req,
      mimeType,
      filename,
      contentLength,
      expectedSha256,
      retentionDays,
    })

    return res.status(result.isDuplicate ? 200 : 201).json({
      success: true,
      message: result.message,
      data: result,
    })
  } catch (err) {
    console.error("[CallController Upload Recording Error]:", err.message)
    return res.status(err.statusCode || 500).json({
      success: false,
      error: err.message,
      code: err.code || "RECORDING_UPLOAD_FAILED",
    })
  }
}

/**
 * GET /api/calls/:id/recording
 * Streams audio recording from GridFS with HTTP Range request support for seeking.
 */
const playCallRecording = async (req, res) => {
  try {
    const callId = req.params.id
    const tenantId = req.user?.tenantId || req.tenantId
    const user = req.user
    const rangeHeader = req.headers.range

    await recordingStorage.streamPlayback({
      callId,
      tenantId,
      user,
      rangeHeader,
      res,
    })
  } catch (err) {
    console.error("[CallController Playback Error]:", err.message)
    if (!res.headersSent) {
      return res.status(err.statusCode || 500).json({
        success: false,
        error: err.message,
      })
    }
  }
}

/**
 * POST /api/calls/recordings/purge
 * Purges recordings older than retention window (default 30 days) from GridFS.
 */
const purgeRecordings = async (req, res) => {
  try {
    const isSuperAdmin = req.user?.role === "super_admin"
    const tenantId = isSuperAdmin ? (req.body?.tenantId || null) : req.user.tenantId
    const retentionDays = req.body?.retentionDays || parseInt(process.env.RECORDING_RETENTION_DAYS, 10) || 30

    const result = await recordingStorage.purgeExpiredRecordings({
      tenantId,
      retentionDays,
    })

    return res.status(200).json({
      success: true,
      message: `Purged ${result.purgedCount} expired recording(s)`,
      data: result,
    })
  } catch (err) {
    console.error("[CallController Purge Error]:", err.message)
    return res.status(err.statusCode || 500).json({
      success: false,
      error: err.message,
    })
  }
}

/**
 * POST /api/calls/:id/associate-lead
 * Explicitly associates a call to a CRM Lead (useful for manual disambiguation).
 */
const associateCallWithLead = async (req, res) => {
  try {
    const { id } = req.params
    const { leadId } = req.body

    if (!id || !leadId) {
      return res.status(400).json({ success: false, error: "Both call id and leadId are required" })
    }

    const tenantId = req.user.tenantId
    const result = await callService.associateCallToLead({
      callId: id,
      leadId,
      tenantId,
      user: req.user,
    })

    return res.status(200).json({
      success: true,
      data: result.call,
      lead: result.lead,
      message: "Call successfully associated with lead",
    })
  } catch (err) {
    console.error("[CallController AssociateLead Error]:", err)
    return res.status(err.statusCode || 500).json({
      success: false,
      error: err.message || "Failed to associate call with lead",
    })
  }
}

module.exports = {
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
  associateCallWithLead,
}
