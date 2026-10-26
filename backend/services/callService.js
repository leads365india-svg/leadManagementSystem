const mongoose = require("mongoose")
const Call = require("../models/Call")
const Lead = require("../models/Lead")
const User = require("../models/User")
const Device = require("../models/Device")
const { activity } = require("./activityService")
const { normalizePhoneE164 } = require("../utils/phoneNormalizer")
const { checkDirectObjectAccess, scopeFilter } = require("../utils/rbacScope")
const { getTenantContext } = require("../middleware/tenantContext")

/**
 * Leads-365 CRM - Call Service (Phase 14)
 * 
 * Implements:
 * - Phone number matching to CRM Leads (agent-first with tenant fallback)
 * - Call log creation with phone normalization & timeline activity linking
 * - Call query filtering respecting RBAC scopes (own / team / all)
 * - Call disposition & notes updates
 * - Call report metrics aggregation
 * - Device registration & management
 */

/**
 * Formats duration in seconds into human-readable string (e.g., '2m 15s' or '45s').
 */
function formatDuration(seconds = 0) {
  const s = Math.max(0, parseInt(seconds, 10) || 0)
  if (s < 60) return `${s}s`
  const mins = Math.floor(s / 60)
  const remainingSecs = s % 60
  return remainingSecs > 0 ? `${mins}m ${remainingSecs}s` : `${mins}m`
}

/**
 * Matches a raw or normalized phone number to an active Lead in the tenant partition.
 * Prioritizes leads assigned to the calling agent, falling back to any matching tenant lead.
 * 
 * @param {string} rawPhone - Inbound or dialed phone number
 * @param {string|mongoose.Types.ObjectId} [tenantIdOrAgentId] - Tenant account ID or agent ID
 * @param {string|mongoose.Types.ObjectId} [maybeAgentId] - Calling agent ID for priority matching
 * @returns {Promise<object|null>} Matched Lead document or null if unknown
 */
async function findLeadByPhoneNumber(rawPhone, tenantIdOrAgentId = null, maybeAgentId = null) {
  if (!rawPhone) return null

  let tenantId = null
  let agentId = null

  if (typeof tenantIdOrAgentId === "string" && !mongoose.Types.ObjectId.isValid(tenantIdOrAgentId)) {
    tenantId = tenantIdOrAgentId
    agentId = maybeAgentId
  } else if (tenantIdOrAgentId) {
    agentId = tenantIdOrAgentId
  }

  if (!tenantId) {
    const ambient = getTenantContext()
    if (ambient?.tenantId) {
      tenantId = ambient.tenantId
    }
  }

  if (!tenantId) return null

  const phoneNormalized = normalizePhoneE164(rawPhone, "+91")
  const cleanRaw = String(rawPhone).trim()

  const phoneConditions = []
  if (phoneNormalized) {
    phoneConditions.push({ phoneNormalized })
  }
  if (cleanRaw) {
    phoneConditions.push({ phone: cleanRaw })
    phoneConditions.push({ alternatePhone: cleanRaw })
  }

  if (phoneConditions.length === 0) return null

  // 1. Priority matching: Check if lead is assigned to this specific agent
  if (agentId && mongoose.Types.ObjectId.isValid(agentId)) {
    const agentLead = await Lead.findOne({
      tenantId,
      ownerId: agentId,
      $or: phoneConditions,
      deletedAt: null,
    }).setOptions({ skipTenantFilter: true })

    if (agentLead) return agentLead
  }

  // 2. Fallback: Tenant-wide lead matching
  const tenantLead = await Lead.findOne({
    tenantId,
    $or: phoneConditions,
    deletedAt: null,
  }).setOptions({ skipTenantFilter: true })

  return tenantLead || null
}

/**
 * Logs a new call in the CRM, linking to Lead and recording timeline activity.
 * 
 * @param {object} params
 * @returns {Promise<{ success: boolean, data: object, call: object, lead: object|null }>}
 */
async function logCall(params = {}) {
  let {
    tenantId,
    agentId,
    leadId = null,
    deviceId = null,
    number,
    direction = "outbound",
    duration = 0,
    status = "completed",
    disposition = "Interested",
    notes = "",
    source = "manual",
    startedAt = null,
    endedAt = null,
    recording = {},
    actor = null,
  } = params

  if (!tenantId) {
    const ambient = getTenantContext()
    if (ambient?.tenantId) {
      tenantId = ambient.tenantId
    }
  }

  if (!tenantId) {
    throw new Error("tenantId is required to log a call")
  }
  if (!agentId) {
    throw new Error("agentId is required to log a call")
  }
  if (!number || typeof number !== "string" || !number.trim()) {
    throw new Error("Phone number is required to log a call")
  }

  const cleanNumber = number.trim()
  const phoneNormalized = normalizePhoneE164(cleanNumber, "+91")
  const callStartedAt = startedAt ? new Date(startedAt) : new Date()
  const durationSec = Math.max(0, parseInt(duration, 10) || 0)
  const callEndedAt = endedAt ? new Date(endedAt) : new Date(callStartedAt.getTime() + durationSec * 1000)

  // 1. Resolve Lead linkage
  let matchedLead = null
  if (leadId && mongoose.Types.ObjectId.isValid(leadId)) {
    matchedLead = await Lead.findOne({ _id: leadId, tenantId, deletedAt: null }).setOptions({ skipTenantFilter: true })
  }

  // If no explicit leadId provided or not found, attempt matching by phone number
  if (!matchedLead) {
    matchedLead = await findLeadByPhoneNumber(cleanNumber, tenantId, agentId)
  }

  // 2. Resolve Agent user info
  let agentUser = null
  if (mongoose.Types.ObjectId.isValid(agentId)) {
    agentUser = await User.findOne({ _id: agentId, tenantId }).setOptions({ skipTenantFilter: true })
  }

  // 3. Create Call record
  const call = new Call({
    tenantId,
    leadId: matchedLead ? matchedLead._id : null,
    agentId,
    deviceId: deviceId && mongoose.Types.ObjectId.isValid(deviceId) ? deviceId : null,
    direction: direction === "inbound" ? "inbound" : "outbound",
    number: cleanNumber,
    phoneNormalized,
    startedAt: callStartedAt,
    endedAt: callEndedAt,
    duration: durationSec,
    status: ["completed", "busy", "no-answer", "failed", "missed", "rejected"].includes(status) ? status : "completed",
    disposition: disposition ? String(disposition).trim() : "Interested",
    notes: notes ? String(notes).trim().slice(0, 2000) : "",
    source: ["android_sync", "manual", "exotel", "twilio"].includes(source) ? source : "manual",
    recording: {
      fileId: recording?.fileId || null,
      sizeBytes: recording?.sizeBytes || 0,
      sha256: recording?.sha256 || "",
      status: recording?.status || "pending",
      expiresAt: recording?.expiresAt || null,
    },
  })

  const savedCall = await call.save()

  // 4. If linked to lead: update lastContactedAt & record Activity timeline entry
  if (matchedLead) {
    matchedLead.lastContactedAt = callStartedAt
    await matchedLead.save()

    // Activity timeline hook
    try {
      const actorInfo = actor || (agentUser ? { id: agentUser._id, name: agentUser.name, role: agentUser.role } : { role: "system", name: "Telephony Engine" })
      await activity.record({
        tenantId,
        leadId: matchedLead._id,
        type: "call.logged",
        actor: actorInfo,
        payload: {
          callId: savedCall._id.toString(),
          direction: savedCall.direction,
          duration: savedCall.duration,
          durationFormatted: formatDuration(savedCall.duration),
          status: savedCall.status,
          disposition: savedCall.disposition,
          notes: savedCall.notes,
          source: savedCall.source,
          hasRecording: savedCall.recording?.status === "ready" || savedCall.recording?.status === "stored",
        },
      })
    } catch (actErr) {
      console.warn("[CallService] Non-blocking activity recording failure:", actErr.message)
    }
  }

  return {
    success: true,
    data: savedCall,
    call: savedCall,
    lead: matchedLead,
  }
}

/**
 * Updates call disposition and notes.
 * 
 * @param {string|mongoose.Types.ObjectId} callId
 * @param {string|object} tenantIdOrUpdates
 * @param {object} [maybeUpdates]
 * @param {object} [maybeUser]
 * @returns {Promise<{ success: boolean, data: object }>}
 */
async function updateCall(callId, tenantIdOrUpdates, maybeUpdates = null, maybeUser = null) {
  let tenantId = null
  let updates = {}
  let user = null

  if (typeof tenantIdOrUpdates === "string") {
    tenantId = tenantIdOrUpdates
    updates = maybeUpdates || {}
    user = maybeUser
  } else if (tenantIdOrUpdates && typeof tenantIdOrUpdates === "object") {
    updates = tenantIdOrUpdates
    user = maybeUpdates && (maybeUpdates._id || maybeUpdates.role || maybeUpdates.id) ? maybeUpdates : null
  }

  if (!tenantId) {
    const ambient = getTenantContext()
    if (ambient?.tenantId) {
      tenantId = ambient.tenantId
    }
  }

  if (!callId || !tenantId) {
    throw new Error("Missing callId or tenantId")
  }

  const call = await Call.findOne({ _id: callId, tenantId }).setOptions({ skipTenantFilter: true })
  if (!call) {
    const err = new Error("Call record not found")
    err.statusCode = 404
    throw err
  }

  // RBAC scope check
  if (user && (user._id || user.id || user.role)) {
    const access = await checkDirectObjectAccess(user, call, "calls", "edit")
    if (!access.allowed) {
      const err = new Error(access.reason || "Forbidden: You do not have permission to modify this call log")
      err.statusCode = 403
      throw err
    }
  }

  if (updates.disposition !== undefined) {
    call.disposition = String(updates.disposition).trim()
  }
  if (updates.notes !== undefined) {
    call.notes = String(updates.notes).trim().slice(0, 2000)
  }

  const saved = await call.save()
  return {
    success: true,
    data: saved,
  }
}

/**
 * Queries calls for a tenant respecting RBAC scope (own vs team vs all).
 */
async function listCalls(query = {}, user = null, explicitTenantId = null) {
  let tenantId = explicitTenantId || user?.tenantId || query.tenantId
  if (!tenantId) {
    const ambient = getTenantContext()
    if (ambient?.tenantId) {
      tenantId = ambient.tenantId
    }
  }

  if (!tenantId) {
    throw new Error("tenantId is required to list calls")
  }

  const filter = { tenantId }

  // Apply RBAC scope filter if user provided
  if (user) {
    const scoped = await scopeFilter(user, "calls", "view")
    Object.assign(filter, scoped)
  }

  // Additional query filters
  if (query.leadId && mongoose.Types.ObjectId.isValid(query.leadId)) {
    filter.leadId = query.leadId
  }
  if (query.agentId && mongoose.Types.ObjectId.isValid(query.agentId)) {
    filter.agentId = query.agentId
  }
  if (query.direction && ["inbound", "outbound"].includes(query.direction)) {
    filter.direction = query.direction
  }
  if (query.status) {
    filter.status = query.status
  }
  if (query.disposition) {
    filter.disposition = query.disposition
  }
  if (query.startDate || query.endDate) {
    filter.startedAt = {}
    if (query.startDate) filter.startedAt.$gte = new Date(query.startDate)
    if (query.endDate) filter.startedAt.$lte = new Date(query.endDate)
  }
  if (query.recordingStatus) {
    filter["recording.status"] = query.recordingStatus
  }

  const pageNum = Math.max(1, parseInt(query.page, 10) || 1)
  const limitNum = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 20))
  const skip = (pageNum - 1) * limitNum

  const [calls, total] = await Promise.all([
    Call.find(filter)
      .setOptions({ skipTenantFilter: true })
      .sort({ startedAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .populate("agentId", "name email role")
      .populate("leadId", "name phone company status")
      .lean(),
    Call.countDocuments(filter).setOptions({ skipTenantFilter: true }),
  ])

  return {
    success: true,
    data: {
      calls,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        pages: Math.ceil(total / limitNum) || 1,
      },
    },
  }
}

/**
 * Aggregates call reports metrics for a tenant.
 */
async function getCallMetrics(queryOrTenantId = {}, maybeQuery = {}) {
  let tenantId = null
  let query = {}

  if (typeof queryOrTenantId === "string") {
    tenantId = queryOrTenantId
    query = maybeQuery || {}
  } else if (queryOrTenantId && typeof queryOrTenantId === "object") {
    query = queryOrTenantId
    tenantId = query.tenantId
  }

  if (!tenantId) {
    const ambient = getTenantContext()
    if (ambient?.tenantId) {
      tenantId = ambient.tenantId
    }
  }

  if (!tenantId) {
    throw new Error("tenantId is required for metrics calculation")
  }

  const matchStage = { tenantId }
  if (query.agentId && mongoose.Types.ObjectId.isValid(query.agentId)) {
    matchStage.agentId = new mongoose.Types.ObjectId(query.agentId)
  }
  if (query.startDate || query.endDate) {
    matchStage.startedAt = {}
    if (query.startDate) matchStage.startedAt.$gte = new Date(query.startDate)
    if (query.endDate) matchStage.startedAt.$lte = new Date(query.endDate)
  }

  const [summary] = await Call.aggregate([
    { $match: matchStage },
    {
      $group: {
        _id: null,
        totalCalls: { $sum: 1 },
        inboundCalls: {
          $sum: { $cond: [{ $eq: ["$direction", "inbound"] }, 1, 0] },
        },
        outboundCalls: {
          $sum: { $cond: [{ $eq: ["$direction", "outbound"] }, 1, 0] },
        },
        totalDurationSeconds: { $sum: "$duration" },
        avgDurationSeconds: { $avg: "$duration" },
        completedCalls: {
          $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] },
        },
      },
    },
  ])

  const byDisposition = await Call.aggregate([
    { $match: matchStage },
    {
      $group: {
        _id: "$disposition",
        count: { $sum: 1 },
        totalDuration: { $sum: "$duration" },
      },
    },
    { $sort: { count: -1 } },
  ])

  const byStatus = await Call.aggregate([
    { $match: matchStage },
    {
      $group: {
        _id: "$status",
        count: { $sum: 1 },
      },
    },
    { $sort: { count: -1 } },
  ])

  const totalCalls = summary?.totalCalls || 0
  const completedCalls = summary?.completedCalls || 0
  const connectRate = totalCalls > 0 ? Math.round((completedCalls / totalCalls) * 100) : 0

  return {
    success: true,
    data: {
      totalCalls,
      inboundCalls: summary?.inboundCalls || 0,
      outboundCalls: summary?.outboundCalls || 0,
      totalDurationSeconds: summary?.totalDurationSeconds || 0,
      avgDurationSeconds: Math.round(summary?.avgDurationSeconds || 0),
      completedCalls,
      connectRate,
      byDisposition,
      byStatus,
    },
  }
}

/**
 * Mobile Device Management (Phase 14)
 */
async function registerDevice(deviceData = {}, explicitTenantId = null) {
  let tenantId = explicitTenantId || deviceData.tenantId
  if (!tenantId) {
    const ambient = getTenantContext()
    if (ambient?.tenantId) {
      tenantId = ambient.tenantId
    }
  }

  if (!tenantId) {
    throw new Error("tenantId is required to register a device")
  }
  if (!deviceData.userId) {
    throw new Error("userId is required to register a device")
  }

  let device = null
  if (deviceData.pushToken) {
    device = await Device.findOne({ tenantId, pushToken: deviceData.pushToken }).setOptions({ skipTenantFilter: true })
  }

  if (device) {
    device.lastSeenAt = new Date()
    if (deviceData.label) device.label = deviceData.label
    if (deviceData.model) device.model = deviceData.model
    if (deviceData.osVersion) device.osVersion = deviceData.osVersion
    if (deviceData.appVersion) device.appVersion = deviceData.appVersion
    device.status = "active"
    await device.save()
  } else {
    device = await Device.create({
      tenantId,
      userId: deviceData.userId,
      label: deviceData.label || "Mobile Device",
      model: deviceData.model || "",
      osVersion: deviceData.osVersion || "",
      appVersion: deviceData.appVersion || "",
      pushToken: deviceData.pushToken || "",
      status: "active",
      lastSeenAt: new Date(),
    })
  }

  return {
    success: true,
    data: device,
  }
}

async function updateDeviceStatus(deviceId, status, explicitTenantId = null) {
  let tenantId = explicitTenantId
  if (!tenantId) {
    const ambient = getTenantContext()
    if (ambient?.tenantId) {
      tenantId = ambient.tenantId
    }
  }

  if (!deviceId || !tenantId) {
    throw new Error("Missing deviceId or tenantId")
  }

  if (!["active", "revoked"].includes(status)) {
    throw new Error("Invalid status. Must be 'active' or 'revoked'")
  }

  const device = await Device.findOne({ _id: deviceId, tenantId }).setOptions({ skipTenantFilter: true })
  if (!device) {
    const err = new Error("Device not found")
    err.statusCode = 404
    throw err
  }

  device.status = status
  await device.save()

  return {
    success: true,
    data: device,
  }
}

async function listDevices(query = {}, explicitTenantId = null) {
  let tenantId = explicitTenantId || query.tenantId
  if (!tenantId) {
    const ambient = getTenantContext()
    if (ambient?.tenantId) {
      tenantId = ambient.tenantId
    }
  }

  if (!tenantId) {
    throw new Error("tenantId is required to list devices")
  }

  const filter = { tenantId }
  if (query.userId && mongoose.Types.ObjectId.isValid(query.userId)) {
    filter.userId = query.userId
  }
  if (query.status) {
    filter.status = query.status
  }

  const devices = await Device.find(filter)
    .setOptions({ skipTenantFilter: true })
    .sort({ lastSeenAt: -1 })
    .populate("userId", "name email role")
    .lean()

  return {
    success: true,
    data: {
      devices,
      total: devices.length,
    },
  }
}

module.exports = {
  findLeadByPhoneNumber,
  logCall,
  updateCall,
  listCalls,
  getCallMetrics,
  registerDevice,
  updateDeviceStatus,
  listDevices,
  formatDuration,
}
