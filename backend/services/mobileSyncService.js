const mongoose = require("mongoose")
const jwt = require("jsonwebtoken")
const Lead = require("../models/Lead")
const Call = require("../models/Call")
const FollowUp = require("../models/FollowUp")
const Device = require("../models/Device")
const { Activity } = require("../models/Activity")
const callService = require("./callService")
const { getJwtSecret } = require("../middleware/authMiddleware")
const { normalizePhoneE164 } = require("../utils/phoneNormalizer")

/**
 * Leads-365 CRM - Mobile Sync Service (Phase 15)
 * 
 * Provides:
 * - Agent-scoped incremental delta lead sync (only agent's owned leads + removedLeadIds)
 * - Mobile call reporting with clientCallId idempotency and lead matching
 * - Pre-flight recording upload eligibility ticket issuance
 */

/**
 * Synchronizes leads for an authenticated mobile agent.
 * 
 * @param {object} params
 * @param {string} params.tenantId - Tenant account ID
 * @param {string|mongoose.Types.ObjectId} params.agentId - Calling agent ID
 * @param {string|Date} [params.since] - Optional ISO date or timestamp cursor
 * @param {string|mongoose.Types.ObjectId} [params.deviceId] - Active mobile device ID
 * @returns {Promise<object>} Sync payload with leads, removedLeadIds, and syncTimestamp
 */
async function syncAgentLeads({ tenantId, agentId, since = null, deviceId = null }) {
  if (!tenantId || !agentId) {
    throw new Error("Missing required tenantId or agentId for mobile sync")
  }

  const agentObjId = mongoose.Types.ObjectId.isValid(agentId) ? new mongoose.Types.ObjectId(agentId) : agentId
  const syncStartTime = new Date()

  let sinceDate = null
  if (since) {
    const parsed = new Date(since)
    if (!isNaN(parsed.getTime())) {
      sinceDate = parsed
    }
  }

  // 1. Query active leads owned by this agent
  const query = {
    tenantId,
    ownerId: agentObjId,
    deletedAt: null,
  }

  if (sinceDate) {
    // Delta sync: fetch records created or updated since the timestamp
    query.updatedAt = { $gte: sinceDate }
  }

  const activeLeads = await Lead.find(query)
    .setOptions({ skipTenantFilter: true })
    .select("_id name phone phoneNormalized status company city nextFollowUpDate updatedAt createdAt metadata")
    .sort({ updatedAt: -1 })
    .lean()

  const leadIds = activeLeads.map((l) => l._id)

  // 2. Fetch upcoming pending follow-ups for these leads
  let followUpMap = new Map()
  if (leadIds.length > 0) {
    const pendingFollowUps = await FollowUp.find({
      tenantId,
      leadId: { $in: leadIds },
      status: "pending",
    })
      .setOptions({ skipTenantFilter: true })
      .sort({ scheduledAt: 1 })
      .select("leadId scheduledAt title priority")
      .lean()

    for (const f of pendingFollowUps) {
      const lid = f.leadId.toString()
      if (!followUpMap.has(lid)) {
        followUpMap.set(lid, {
          scheduledAt: f.scheduledAt,
          title: f.title,
          priority: f.priority,
        })
      }
    }
  }

  // 3. Format leads with minimum required fields
  const formattedLeads = activeLeads.map((lead) => {
    const lid = lead._id.toString()
    const nextFu = followUpMap.get(lid)

    return {
      id: lead._id,
      name: lead.name || "Unknown Lead",
      phone: lead.phone || "",
      phoneNormalized: lead.phoneNormalized || normalizePhoneE164(lead.phone, "+91") || lead.phone,
      status: lead.status || "New",
      company: lead.company || "",
      city: lead.city || "",
      nextFollowUp: nextFu ? nextFu.scheduledAt : lead.nextFollowUpDate || null,
      followUpSummary: nextFu ? nextFu.title : null,
      updatedAt: lead.updatedAt,
      createdAt: lead.createdAt,
    }
  })

  // 4. Calculate removedLeadIds if delta sync
  const removedSet = new Set()

  if (sinceDate) {
    // 4a. Leads deleted since `sinceDate`
    const deletedLeads = await Lead.find({
      tenantId,
      deletedAt: { $gte: sinceDate },
    })
      .setOptions({ skipTenantFilter: true })
      .select("_id")
      .lean()

    deletedLeads.forEach((l) => removedSet.add(l._id.toString()))

    // 4b. Leads reassigned away from this agent since `sinceDate`
    try {
      const reassignmentActivities = await Activity.find({
        tenantId,
        type: "lead.owner_changed",
        createdAt: { $gte: sinceDate },
        $or: [
          { "payload.fromOwnerId": agentObjId },
          { "payload.fromOwnerId": agentId.toString() },
        ],
      })
        .setOptions({ skipTenantFilter: true })
        .select("leadId")
        .lean()

      for (const act of reassignmentActivities) {
        if (act.leadId) {
          const actLeadIdStr = act.leadId.toString()
          // Check if this lead is currently active and still owned by this agent
          const isStillOwned = activeLeads.some((l) => l._id.toString() === actLeadIdStr)
          if (!isStillOwned) {
            removedSet.add(actLeadIdStr)
          }
        }
      }
    } catch (actErr) {
      console.warn("[MobileSyncService] Activity reassignment check warning:", actErr.message)
    }
  }

  // 5. Update device lastSyncAt
  if (deviceId) {
    Device.updateOne(
      { _id: deviceId, tenantId },
      { $set: { lastSyncAt: syncStartTime, lastSeenAt: syncStartTime } }
    ).exec().catch(() => {})
  }

  return {
    success: true,
    syncTimestamp: syncStartTime.toISOString(),
    isDelta: Boolean(sinceDate),
    leads: formattedLeads,
    removedLeadIds: Array.from(removedSet),
    total: formattedLeads.length,
    removedCount: removedSet.size,
  }
}

/**
 * Reports a completed call from the mobile dialer/sync engine.
 * Supports clientCallId idempotency to handle offline retries cleanly.
 */
async function reportMobileCall({ tenantId, agentId, deviceId, callData = {} }) {
  if (!tenantId || !agentId) {
    throw new Error("Missing required tenantId or agentId for mobile call report")
  }

  const rawNumber = (callData.phoneNumber || callData.phoneNumberNormalized || callData.number || callData.phone || "").trim()

  const {
    direction = "outbound",
    duration = 0,
    status = "completed",
    disposition = "Interested",
    notes = "",
    startedAt = null,
    endedAt = null,
    clientCallId = null,
    recording = {},
  } = callData

  if (!rawNumber) {
    const err = new Error("Phone number is required to log a call")
    err.status = 400
    err.statusCode = 400
    throw err
  }

  // 1. Idempotency Check on clientCallId
  if (clientCallId && typeof clientCallId === "string" && clientCallId.trim()) {
    const existingCall = await Call.findOne({
      tenantId,
      agentId,
      clientCallId: clientCallId.trim(),
    }).setOptions({ skipTenantFilter: true })

    if (existingCall) {
      return {
        success: true,
        call: existingCall,
        isDuplicate: true,
        duplicate: true,
        message: "Call already recorded (idempotent submission)",
      }
    }
  }

  // 2. Delegate to callService.logCall with source 'android_sync'
  const result = await callService.logCall({
    tenantId,
    agentId,
    deviceId,
    number: rawNumber,
    direction,
    duration: Number(duration) || 0,
    status,
    disposition,
    notes,
    source: "android_sync",
    startedAt,
    endedAt,
    recording,
    actor: { id: agentId, role: "agent", name: "Mobile Agent" },
  })

  // 3. Attach clientCallId if provided
  if (clientCallId && result.call) {
    result.call.clientCallId = clientCallId.trim()
    await result.call.save()
  }

  return {
    success: true,
    call: result.call,
    isDuplicate: false,
    duplicate: false,
    leadMatched: Boolean(result.lead),
    lead: result.lead
      ? {
          id: result.lead._id,
          name: result.lead.name,
          phone: result.lead.phone,
          status: result.lead.status,
        }
      : null,
  }
}

/**
 * Pre-flight verification for audio recording upload ticket (Phase 15 / 16 integration).
 * Verifies call exists, belongs to agent, is linked to a lead, and DNR is not active.
 */
async function issueRecordingTicket({ tenantId, agentId, callId }) {
  if (!tenantId || !agentId || !callId) {
    const err = new Error("Missing tenantId, agentId or callId")
    err.statusCode = 400
    throw err
  }

  if (!mongoose.Types.ObjectId.isValid(callId)) {
    const err = new Error("Invalid call ID format")
    err.statusCode = 400
    throw err
  }

  const call = await Call.findOne({
    _id: callId,
    tenantId,
    agentId,
  }).setOptions({ skipTenantFilter: true })

  if (!call) {
    const err = new Error("Call log not found or does not belong to this agent")
    err.status = 404
    err.statusCode = 404
    err.code = "CALL_NOT_FOUND"
    throw err
  }

  // Check 1: Must be linked to a CRM Lead and not marked personal
  if (!call.leadId || call.isPersonal) {
    const err = new Error("Recording permitted only for CRM leads. Unlinked or personal calls cannot be recorded.")
    err.status = 403
    err.statusCode = 403
    err.code = "RECORDING_NOT_PERMITTED"
    throw err
  }

  // Check 2: Evaluate DNR and Consent eligibility via PrivacyService
  const lead = await Lead.findOne({ _id: call.leadId, tenantId }).setOptions({ skipTenantFilter: true }).lean()
  const privacyService = require("./privacyService")
  const privacyCheck = await privacyService.evaluateRecordingEligibility({
    tenantId,
    lead,
    phoneNumber: call.number,
  })

  if (!privacyCheck.allowed) {
    const err = new Error(privacyCheck.message || "Recording prohibited by privacy policy.")
    err.status = 403
    err.statusCode = 403
    err.code = privacyCheck.reason || "RECORDING_FORBIDDEN_DNR"
    throw err
  }

  // Issue short-lived recording upload ticket (valid for 15-30 minutes)
  const jwtSecret = getJwtSecret()
  const ticketToken = jwt.sign(
    {
      callId: call._id.toString(),
      leadId: call.leadId.toString(),
      tenantId,
      agentId: agentId.toString(),
      purpose: "recording_upload",
    },
    jwtSecret,
    {
      subject: "recording_upload_ticket",
      expiresIn: "30m",
    },
  )

  const expiresAt = new Date(Date.now() + 30 * 60 * 1000)

  return {
    eligible: true,
    callId: call._id,
    leadId: call.leadId,
    uploadUrl: `/api/calls/${call._id}/recording`,
    ticket: ticketToken,
    expiresAt: expiresAt.toISOString(),
    maxSizeBytes: 52428800, // 50MB maximum audio payload
    acceptedFormats: ["audio/mp4", "audio/m4a", "audio/3gpp", "audio/aac", "audio/mpeg", "audio/wav"],
  }
}

module.exports = {
  syncAgentLeads,
  reportMobileCall,
  issueRecordingTicket,
}
