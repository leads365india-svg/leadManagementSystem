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
    clientCallId = null,
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
  const trimmedClientCallId = clientCallId && typeof clientCallId === "string" && clientCallId.trim()
    ? clientCallId.trim()
    : null

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

  // 3. Canonical Upsert: Check if call already exists by clientCallId
  if (trimmedClientCallId) {
    const existingCall = await Call.findOne({
      tenantId,
      clientCallId: trimmedClientCallId,
    }).setOptions({ skipTenantFilter: true })

    if (existingCall) {
      let updated = false
      if (disposition && disposition !== "connected" && existingCall.disposition !== disposition) {
        existingCall.disposition = disposition
        existingCall.callOutcome = disposition
        updated = true
      }
      if (durationSec > 0 && (!existingCall.duration || existingCall.duration === 0)) {
        existingCall.duration = durationSec
        existingCall.durationSeconds = durationSec
        updated = true
      }
      if (notes && notes.trim() && existingCall.notes !== notes.trim()) {
        existingCall.notes = notes.trim()
        updated = true
      }
      if (recording && recording.fileId) {
        existingCall.recording = { ...existingCall.recording, ...recording }
        existingCall.hasRecording = true
        updated = true
      }
      if (updated) {
        await existingCall.save()
      }
      return {
        success: true,
        data: existingCall,
        call: existingCall,
        lead: matchedLead,
        isExisting: true,
      }
    }
  }

  // 3b. Fallback candidate match if no clientCallId provided: require unambiguous single match
  if (!trimmedClientCallId && phoneNormalized) {
    const minTime = new Date(callStartedAt.getTime() - 5000)
    const maxTime = new Date(callStartedAt.getTime() + 5000)
    const dirNorm = direction === "inbound" ? ["inbound", "INCOMING"] : ["outbound", "OUTGOING"]
    const candidateCalls = await Call.find({
      tenantId,
      agentId,
      phoneNormalized,
      direction: { $in: dirNorm },
      startedAt: { $gte: minTime, $lte: maxTime },
    }).setOptions({ skipTenantFilter: true })

    if (candidateCalls.length === 1) {
      const matchedCandidate = candidateCalls[0]
      if (disposition && disposition !== "connected") {
        matchedCandidate.disposition = disposition
        matchedCandidate.callOutcome = disposition
      }
      if (durationSec > 0) {
        matchedCandidate.duration = durationSec
        matchedCandidate.durationSeconds = durationSec
      }
      if (notes && notes.trim()) {
        matchedCandidate.notes = notes.trim()
      }
      if (recording && recording.fileId) {
        matchedCandidate.recording = { ...matchedCandidate.recording, ...recording }
        matchedCandidate.hasRecording = true
      }
      await matchedCandidate.save()
      return {
        success: true,
        data: matchedCandidate,
        call: matchedCandidate,
        lead: matchedLead,
        isExisting: true,
      }
    }
  }

  // 4. Create Call record
  const call = new Call({
    tenantId,
    clientCallId: trimmedClientCallId,
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

  let savedCall
  try {
    savedCall = await call.save()
  } catch (saveErr) {
    if (saveErr.code === 11000 && trimmedClientCallId) {
      const raceExisting = await Call.findOne({
        tenantId,
        clientCallId: trimmedClientCallId,
      }).setOptions({ skipTenantFilter: true })
      if (raceExisting) {
        return {
          success: true,
          data: raceExisting,
          call: raceExisting,
          lead: matchedLead,
          isExisting: true,
        }
      }
    }
    throw saveErr
  }

  // 5. If linked to lead: update lastContactedAt & record Activity timeline entry
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
  if (query.hasRecording === "true" || query.hasRecording === true) {
    filter["recording.status"] = "stored"
  } else if (query.hasRecording === "false" || query.hasRecording === false) {
    filter["recording.status"] = { $ne: "stored" }
  }
  if (query.missingRecording === "true" || query.missingRecording === true) {
    filter.status = "completed"
    filter["recording.status"] = { $ne: "stored" }
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
        withRecordingCount: {
          $sum: { $cond: [{ $eq: ["$recording.status", "stored"] }, 1, 0] },
        },
        missingRecordingCount: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $eq: ["$status", "completed"] },
                  { $ne: ["$recording.status", "stored"] },
                ],
              },
              1,
              0,
            ],
          },
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

  const byRecordingStatus = await Call.aggregate([
    { $match: matchStage },
    {
      $group: {
        _id: { $ifNull: ["$recording.status", "none"] },
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
      withRecordingCount: summary?.withRecordingCount || 0,
      missingRecordingCount: summary?.missingRecordingCount || 0,
      byDisposition,
      byStatus,
      byRecordingStatus,
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

/**
 * Automatically reconciles unassigned historical calls matching a newly created or updated CRM lead.
 * 
 * Safety & Matching Rules:
 * - Scoped strictly to the specified tenantId (cross-tenant calls are NEVER shared).
 * - Multi-lead disambiguation: If multiple active leads share the same phone number within the tenant,
 *   automatic association is halted to avoid misassociation; manual association via associateCallToLead is required.
 * - Non-overwrite: Calls already associated with a different active lead are NEVER reassigned.
 * - Idempotent: If a call is already associated with this lead, it is safely retained without duplicate records or activity logs.
 * - Preserves original call metadata, direction, timestamps, duration, and GridFS recording links.
 * 
 * @param {Object} params
 * @param {Object} params.lead - The newly created or updated Lead document
 * @param {string} [params.tenantId] - Effective tenant ID
 * @param {Object} [params.user] - Actor performing lead creation/reconciliation
 * @returns {Promise<{ success: boolean, associatedCount: number, callIds: string[], ambiguous?: boolean, message?: string }>}
 */
async function reconcileHistoricalCallsForLead({ lead, tenantId = null, user = null }) {
  if (!lead) {
    throw new Error("Lead document is required for call reconciliation")
  }

  const effectiveTenantId = tenantId || lead.tenantId
  if (!effectiveTenantId) {
    throw new Error("tenantId is required for call reconciliation")
  }

  const rawPhone = lead.phone || lead.rawPhone || ""
  let phoneNormalized = lead.phoneNormalized || ""
  if (!phoneNormalized && rawPhone) {
    try {
      phoneNormalized = normalizePhoneE164(rawPhone, "+91")
    } catch (_) {
      phoneNormalized = rawPhone
    }
  }

  if (!phoneNormalized && !rawPhone) {
    return {
      success: true,
      associatedCount: 0,
      callIds: [],
      message: "Lead has no phone number to reconcile",
    }
  }

  // 1. Multi-lead Disambiguation Check:
  // If multiple active (non-deleted) leads share this phone number in the same tenant,
  // do NOT guess. Mark as ambiguous and require manual association.
  const disambiguationConditions = []
  if (phoneNormalized) disambiguationConditions.push({ phoneNormalized })
  if (rawPhone) disambiguationConditions.push({ phone: rawPhone.trim() })

  const matchingLeadsCount = await Lead.countDocuments({
    tenantId: effectiveTenantId,
    $or: disambiguationConditions,
    deletedAt: null,
  }).setOptions({ skipTenantFilter: true })

  if (matchingLeadsCount > 1) {
    return {
      success: true,
      associatedCount: 0,
      callIds: [],
      ambiguous: true,
      message: `Multiple leads (${matchingLeadsCount}) share phone ${rawPhone}. Automatic reconciliation halted for safety; manual call association required.`,
    }
  }

  // 2. Query unassigned calls for this phone number within the tenant
  const phoneMatchConditions = []
  if (phoneNormalized) {
    phoneMatchConditions.push({ phoneNormalized })
  }
  if (rawPhone) {
    const cleanRaw = rawPhone.trim()
    phoneMatchConditions.push({ number: cleanRaw })
    phoneMatchConditions.push({ phoneNumber: cleanRaw })
  }

  const unassignedCalls = await Call.find({
    tenantId: effectiveTenantId,
    $or: [
      { leadId: null },
      { leadId: { $exists: false } },
      { isUnlinked: true },
      { leadId: lead._id }, // allow idempotent re-evaluation
    ],
    $and: [
      { $or: phoneMatchConditions },
    ],
  }).setOptions({ skipTenantFilter: true })

  if (!unassignedCalls || unassignedCalls.length === 0) {
    return {
      success: true,
      associatedCount: 0,
      callIds: [],
      message: "No unassigned historical calls found matching lead phone",
    }
  }

  const reconciledCallIds = []
  let latestCallTime = lead.lastContactedAt ? new Date(lead.lastContactedAt).getTime() : 0

  for (const call of unassignedCalls) {
    // Safety check: Never reassign a call already linked to another lead
    if (call.leadId && call.leadId.toString() !== lead._id.toString()) {
      continue
    }

    const wasAlreadyLinked = call.leadId && call.leadId.toString() === lead._id.toString() && !call.isUnlinked

    call.leadId = lead._id
    call.isUnlinked = false
    if (!call.agentId && lead.ownerId) {
      call.agentId = lead.ownerId
    }
    call.metadata = call.metadata || {}
    call.metadata.reconciledAt = Date.now()
    call.metadata.reconciledWithLeadId = lead._id.toString()
    call.metadata.reconciledVia = "automatic_lead_creation_backfill"
    call.markModified("metadata")
    await call.save()

    reconciledCallIds.push(call._id.toString())

    const callTimeMs = call.startedAt ? new Date(call.startedAt).getTime() : (call.startTimeMs || 0)
    if (callTimeMs > latestCallTime) {
      latestCallTime = callTimeMs
    }

    // Record timeline activity only if newly linked (avoid duplicate activity entries)
    if (!wasAlreadyLinked) {
      try {
        const actorInfo = user
          ? { id: user._id || user.id, name: user.name || "System", role: user.role || "user" }
          : { role: "system", name: "Historical Call Reconciler" }

        await activity.record({
          tenantId: effectiveTenantId,
          leadId: lead._id,
          type: "call.associated",
          actor: actorInfo,
          payload: {
            callId: call._id.toString(),
            clientCallId: call.clientCallId,
            direction: call.direction || call.callDirection,
            duration: call.duration || call.durationSeconds || 0,
            durationFormatted: formatDuration(call.duration || call.durationSeconds || 0),
            disposition: call.disposition || call.callOutcome,
            hasRecording: Boolean(call.hasRecording || (call.recording && call.recording.status === "stored")),
            recordingStatus: call.recording?.status || (call.hasRecording ? "stored" : "none"),
            startedAt: call.startedAt,
            reconciledAt: new Date(),
          },
        })
      } catch (actErr) {
        console.warn("[CallService] Non-blocking activity recording failure on call association:", actErr.message)
      }
    }
  }

  // Update lead's lastContactedAt and metadata.lastCallAt if historical calls were found
  if (latestCallTime > 0) {
    try {
      const leadDoc = await Lead.findOne({ _id: lead._id, tenantId: effectiveTenantId }).setOptions({ skipTenantFilter: true })
      if (leadDoc) {
        const currentLastContact = leadDoc.lastContactedAt ? new Date(leadDoc.lastContactedAt).getTime() : 0
        if (latestCallTime > currentLastContact) {
          leadDoc.lastContactedAt = new Date(latestCallTime)
          leadDoc.metadata = leadDoc.metadata || {}
          leadDoc.metadata.lastCallAt = new Date(latestCallTime)
          leadDoc.markModified("metadata")
          await leadDoc.save()
        }
      }
    } catch (leadSaveErr) {
      console.warn("[CallService] Non-blocking lead timestamp update failure:", leadSaveErr.message)
    }
  }

  return {
    success: true,
    associatedCount: reconciledCallIds.length,
    callIds: reconciledCallIds,
    message: `Successfully reconciled ${reconciledCallIds.length} historical call(s) with lead`,
  }
}

/**
 * Manually and explicitly associates a specific Call to a CRM Lead.
 * Used for safe disambiguation when multiple leads share the same phone number.
 */
async function associateCallToLead({ callId, leadId, tenantId = null, user = null }) {
  if (!callId || !leadId) {
    throw new Error("Both callId and leadId are required to associate call")
  }

  const trimmedCallId = String(callId).trim()
  const isObjectId = mongoose.Types.ObjectId.isValid(trimmedCallId)
  const callQuery = {
    $or: [
      { clientCallId: trimmedCallId },
      ...(isObjectId ? [{ _id: trimmedCallId }] : [])
    ]
  }
  if (tenantId) {
    callQuery.tenantId = tenantId
  }

  const call = await Call.findOne(callQuery).setOptions({ skipTenantFilter: true })
  if (!call) {
    const err = new Error("Call not found in this tenant partition")
    err.statusCode = 404
    throw err
  }

  const effectiveTenantId = tenantId || call.tenantId
  const lead = await Lead.findOne({ _id: leadId, tenantId: effectiveTenantId }).setOptions({ skipTenantFilter: true })
  if (!lead) {
    const err = new Error("Target lead not found in this tenant partition")
    err.statusCode = 404
    throw err
  }

  // Safety check: if call is already associated with another lead, only allow admin to reassign
  if (call.leadId && call.leadId.toString() !== lead._id.toString()) {
    const isPrivileged = user && (user.role === "account_admin" || user.role === "super_admin")
    if (!isPrivileged) {
      const err = new Error("Call is already associated with another lead. Only an administrator can reassign it.")
      err.statusCode = 403
      throw err
    }
  }

  call.leadId = lead._id
  call.isUnlinked = false
  call.metadata = call.metadata || {}
  call.metadata.manuallyAssociatedAt = Date.now()
  call.metadata.associatedBy = user ? (user._id || user.id) : "manual"
  call.markModified("metadata")
  await call.save()

  // Update lead last contact timestamp if call is more recent
  const callTimeMs = call.startedAt ? new Date(call.startedAt).getTime() : (call.startTimeMs || 0)
  if (callTimeMs > 0) {
    const currentLastContact = lead.lastContactedAt ? new Date(lead.lastContactedAt).getTime() : 0
    if (callTimeMs > currentLastContact) {
      lead.lastContactedAt = new Date(callTimeMs)
      lead.metadata = lead.metadata || {}
      lead.metadata.lastCallAt = new Date(callTimeMs)
      lead.markModified("metadata")
      await lead.save()
    }
  }

  // Activity log
  try {
    const actorInfo = user
      ? { id: user._id || user.id, name: user.name || "User", role: user.role || "user" }
      : { role: "system", name: "User" }

    await activity.record({
      tenantId: effectiveTenantId,
      leadId: lead._id,
      type: "call.associated",
      actor: actorInfo,
      payload: {
        callId: call._id.toString(),
        clientCallId: call.clientCallId,
        direction: call.direction || call.callDirection,
        duration: call.duration || call.durationSeconds || 0,
        durationFormatted: formatDuration(call.duration || call.durationSeconds || 0),
        disposition: call.disposition || call.callOutcome,
        hasRecording: Boolean(call.hasRecording || (call.recording && call.recording.status === "stored")),
        recordingStatus: call.recording?.status || (call.hasRecording ? "stored" : "none"),
        startedAt: call.startedAt,
        manual: true,
      },
    })
  } catch (actErr) {
    console.warn("[CallService] Non-blocking activity recording failure on manual call association:", actErr.message)
  }

  return {
    success: true,
    message: "Call successfully associated with lead",
    call,
    lead: {
      id: lead._id.toString(),
      name: lead.name,
      phone: lead.phone,
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
  reconcileHistoricalCallsForLead,
  associateCallToLead,
}
