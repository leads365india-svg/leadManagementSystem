const mongoose = require("mongoose")
const Call = require("../models/Call")
const Device = require("../models/Device")
const callService = require("../services/callService")
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

    const result = await callService.logCall({
      tenantId,
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

module.exports = {
  createCallLog,
  getCallLogs,
  getCallReportMetrics,
  getCallById,
  updateCallLog,
  listDevices,
  registerDevice,
  updateDeviceStatus,
}
