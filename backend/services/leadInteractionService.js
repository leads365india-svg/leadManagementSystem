const mongoose = require("mongoose")
const Lead = require("../models/Lead")
const { normalizePhoneE164 } = require("../utils/phoneNormalizer")

/**
 * Lead Voice Interaction Service
 *
 * Centralizes detection, disambiguation, timestamp resolution, and atomic monotonic
 * updates for successful connected voice calls across:
 * - Normal phone calls (incoming & outgoing via SIM/mobile sync, manual call logs, telephony)
 * - WhatsApp voice calls (incoming & outgoing via Android VoIP call sync / call API)
 *
 * Deliberately excludes:
 * - Ordinary WhatsApp text/media messages
 * - Missed, rejected, declined, busy, failed, unanswered, or ringing-only calls
 * - Ambiguous phone/contact matches across multiple leads in scope
 */

const NON_CONNECTED_CALL_TYPES = new Set([
  3, // Android CallLog.Calls.MISSED_TYPE
  4, // Android CallLog.Calls.VOICEMAIL_TYPE
  5, // Android CallLog.Calls.REJECTED_TYPE
  6, // Android CallLog.Calls.BLOCKED_TYPE
])

const NON_CONNECTED_DIRECTIONS = new Set([
  "missed",
  "rejected",
  "declined",
  "busy",
  "failed",
  "unanswered",
  "no_answer",
  "no-answer",
  "canceled",
  "cancelled",
])

const NON_CONNECTED_STATUSES = new Set([
  "missed",
  "rejected",
  "declined",
  "busy",
  "failed",
  "no-answer",
  "no_answer",
  "unanswered",
  "initiated",
  "ringing",
  "queued",
  "dialing",
  "in-progress",
  "in_progress",
  "canceled",
  "cancelled",
  "voicemail",
])

const CONNECTED_STATUSES = new Set(["", "completed", "answered", "connected", "ended"])

const NON_CONNECTED_OUTCOME_REGEX =
  /\b(missed|reject(?:ed)?|declin(?:ed|e)?|busy|fail(?:ed)?|unanswered|no[\s_-]?answer|not[\s_-]?answered|cancel(?:led|ed)?|switched[\s_-]?off|unreachable|not[\s_-]?connected|did[\s_-]?not[\s_-]?connect|ringing|initiated|voicemail|abandoned|dropped)\b/i

function toFiniteNumber(val) {
  if (val === null || val === undefined || val === "") return null
  const num = Number(val)
  return Number.isFinite(num) ? num : null
}

function toValidDate(val) {
  if (!val) return null
  if (val instanceof Date) {
    return Number.isFinite(val.getTime()) ? val : null
  }
  if (typeof val === "number") {
    return Number.isFinite(val) && val > 0 ? new Date(val) : null
  }
  const parsed = new Date(val)
  return Number.isFinite(parsed.getTime()) ? parsed : null
}

/**
 * Determines whether a call payload/document represents a successful connected voice conversation.
 */
function isSuccessfulVoiceCall(callOrPayload = {}) {
  if (!callOrPayload || typeof callOrPayload !== "object") {
    return { connected: false, reason: "invalid_payload" }
  }

  if (callOrPayload.isPersonal === true) {
    return { connected: false, reason: "personal_call" }
  }

  const callType = toFiniteNumber(callOrPayload.call_type ?? callOrPayload.callType)
  if (callType !== null && NON_CONNECTED_CALL_TYPES.has(callType)) {
    return { connected: false, reason: `non_connected_call_type_${callType}` }
  }

  const direction = String(
    callOrPayload.call_direction ?? callOrPayload.callDirection ?? callOrPayload.direction ?? ""
  )
    .trim()
    .toLowerCase()
  if (direction && NON_CONNECTED_DIRECTIONS.has(direction)) {
    return { connected: false, reason: `non_connected_direction_${direction}` }
  }

  const status = String(callOrPayload.status || "")
    .trim()
    .toLowerCase()
  if (status && (NON_CONNECTED_STATUSES.has(status) || !CONNECTED_STATUSES.has(status))) {
    return { connected: false, reason: `non_connected_status_${status}` }
  }

  const outcomeText = [
    callOrPayload.call_outcome,
    callOrPayload.callOutcome,
    callOrPayload.disposition,
  ]
    .filter((v) => typeof v === "string" && v.trim())
    .join(" ")
    .trim()

  if (outcomeText && NON_CONNECTED_OUTCOME_REGEX.test(outcomeText)) {
    return { connected: false, reason: `non_connected_outcome_${outcomeText.toLowerCase()}` }
  }

  // Check actual duration or verified stored audio recording
  const explicitDuration = toFiniteNumber(
    callOrPayload.duration_seconds ??
      callOrPayload.durationSeconds ??
      callOrPayload.duration ??
      callOrPayload.recording?.duration
  )

  const startedAt =
    toValidDate(callOrPayload.start_time_ms ?? callOrPayload.startTimeMs ?? callOrPayload.startedAt)
  const endedAt =
    toValidDate(
      callOrPayload.ended_at_ms ??
        callOrPayload.endedAtMs ??
        callOrPayload.endedAt ??
        callOrPayload.completed_at_ms ??
        callOrPayload.completedAtMs ??
        callOrPayload.completedAt
    )

  const computedSpanSec =
    startedAt && endedAt && endedAt.getTime() > startedAt.getTime()
      ? Math.round((endedAt.getTime() - startedAt.getTime()) / 1000)
      : 0

  const effectiveDuration = Math.max(explicitDuration || 0, computedSpanSec || 0)

  const hasStoredAudio = Boolean(
    callOrPayload.hasRecording === true &&
      (callOrPayload.recording?.status === "stored" ||
        callOrPayload.recording?.status === "ready" ||
        callOrPayload.recording?.fileId)
  ) || Boolean(
    callOrPayload.recording?.fileId &&
      ["stored", "ready"].includes(String(callOrPayload.recording?.status || "").toLowerCase())
  )

  if (effectiveDuration <= 0 && !hasStoredAudio) {
    return { connected: false, reason: "zero_duration_unconnected" }
  }

  return { connected: true, reason: "connected_voice_call", effectiveDuration }
}

/**
 * Classifies call channel into canonical Lead interaction channel.
 */
function resolveInteractionChannel(callOrPayload = {}) {
  const source = String(callOrPayload.source || "").trim().toLowerCase()
  const channel = String(callOrPayload.call_channel ?? callOrPayload.callChannel ?? "")
    .trim()
    .toUpperCase()
  const recordingOrigin = String(callOrPayload.recordingOrigin || callOrPayload.metadata?.recordingOrigin || "")
    .trim()
    .toLowerCase()
  const sourceApp = String(callOrPayload.source_app ?? callOrPayload.sourceApp ?? callOrPayload.metadata?.sourceApp ?? "")
    .trim()
    .toLowerCase()
  const clientCallId = String(callOrPayload.client_call_id ?? callOrPayload.clientCallId ?? "")
    .trim()
    .toLowerCase()

  if (
    source === "whatsapp_voip" ||
    channel === "WHATSAPP_VOIP" ||
    recordingOrigin === "whatsapp_voip" ||
    sourceApp === "com.whatsapp" ||
    sourceApp === "com.whatsapp.w4b" ||
    clientCallId.startsWith("wa_voip_")
  ) {
    return "whatsapp_voice"
  }

  if (source === "ai_receptionist") {
    return "ai_phone"
  }

  return "phone"
}

/**
 * Maps call direction to canonical inbound/outbound.
 */
function resolveInteractionDirection(callOrPayload = {}) {
  const raw = String(
    callOrPayload.call_direction ?? callOrPayload.callDirection ?? callOrPayload.direction ?? ""
  )
    .trim()
    .toLowerCase()

  if (raw === "inbound" || raw === "incoming") return "inbound"
  if (raw === "outbound" || raw === "outgoing") return "outbound"

  const callType = toFiniteNumber(callOrPayload.call_type ?? callOrPayload.callType)
  if (callType === 1) return "inbound"
  if (callType === 2) return "outbound"

  return ""
}

/**
 * Computes canonical completion timestamp for a successful call.
 * Prefers explicit endedAt/completedAt; falls back to startedAt + duration.
 */
function resolveCallInteractionTimestamp(callOrPayload = {}) {
  const endedAt = toValidDate(
    callOrPayload.ended_at_ms ??
      callOrPayload.endedAtMs ??
      callOrPayload.endedAt ??
      callOrPayload.completed_at_ms ??
      callOrPayload.completedAtMs ??
      callOrPayload.completedAt
  )
  if (endedAt) {
    return endedAt
  }

  const startedAt = toValidDate(
    callOrPayload.start_time_ms ?? callOrPayload.startTimeMs ?? callOrPayload.startedAt
  )
  const durationSec = Math.max(
    0,
    toFiniteNumber(
      callOrPayload.duration_seconds ??
        callOrPayload.durationSeconds ??
        callOrPayload.duration ??
        callOrPayload.recording?.duration
    ) || 0
  )

  if (startedAt) {
    return new Date(startedAt.getTime() + durationSec * 1000)
  }

  return new Date()
}

/**
 * Builds strict phone matching variants using normalizePhoneE164.
 * Refuses strings shorter than 7 digits to avoid accidental matches.
 */
function buildPhoneVariants(rawPhone, defaultCountryPrefix = "+91") {
  const cleanRaw = typeof rawPhone === "string" ? rawPhone.trim() : ""
  if (!cleanRaw) return { normalized: "", variants: [] }

  const digits = cleanRaw.replace(/\D/g, "")
  if (digits.length < 7) {
    return { normalized: "", variants: [] }
  }

  const normalized = normalizePhoneE164(cleanRaw, defaultCountryPrefix) || ""
  const variantSet = new Set()

  if (normalized) variantSet.add(normalized)
  variantSet.add(cleanRaw)

  // Only generate 10-digit / +91 / 0-prefixed local variants when default Indian trunk rules apply
  // or no conflicting international country code is present.
  const stripped = digits.replace(/^0+/, "")
  if (normalized.startsWith("+91") && stripped.length >= 10) {
    const last10 = stripped.slice(-10)
    variantSet.add(last10)
    variantSet.add(`0${last10}`)
    variantSet.add(`91${last10}`)
    variantSet.add(`+91${last10}`)
  } else if (!cleanRaw.startsWith("+") && digits.length === 10) {
    variantSet.add(digits)
    variantSet.add(`0${digits}`)
    variantSet.add(`91${digits}`)
    variantSet.add(`+91${digits}`)
  } else if (digits.length >= 7) {
    variantSet.add(digits)
  }

  return {
    normalized,
    variants: Array.from(variantSet).filter(Boolean),
  }
}

/**
 * Resolves an unambiguous active Lead for a call strictly inside tenant (+ workspace) scope.
 * Never auto-creates Leads and never guesses when multiple leads match the same phone/name.
 */
async function resolveUnambiguousLeadForCall({
  tenantId,
  workspaceId = null,
  workspaceMode = "all",
  leadId = null,
  phone = "",
  contactName = "",
  agentId = null,
  allowNameFallback = false,
  preferAgentOwnership = false,
  ignoreInvalidExplicitLeadId = false,
} = {}) {
  if (!tenantId) {
    return { lead: null, ambiguous: false, matchedBy: "missing_tenant" }
  }

  const baseFilter = {
    tenantId: String(tenantId),
    deletedAt: null,
  }

  if (workspaceMode === "single_workspace" && workspaceId) {
    baseFilter.workspaceId = workspaceId
  } else if (workspaceMode === "unassigned_review") {
    baseFilter.$or = [{ workspaceId: null }, { workspaceId: { $exists: false } }]
  }

  // 1. Prefer verified explicit leadId when supplied
  const trimmedLeadId = leadId ? String(leadId).trim() : ""
  if (trimmedLeadId && mongoose.Types.ObjectId.isValid(trimmedLeadId)) {
    const byId = await Lead.findOne({ ...baseFilter, _id: trimmedLeadId }).setOptions({
      skipTenantFilter: true,
    })
    if (byId) {
      return { lead: byId, ambiguous: false, matchedBy: "leadId" }
    }
    if (!ignoreInvalidExplicitLeadId) {
      return { lead: null, ambiguous: false, matchedBy: "leadId_not_found" }
    }
  }

  // 2. Match via normalized phone
  const { variants } = buildPhoneVariants(phone)
  if (variants.length > 0) {
    const phoneQuery = {
      ...baseFilter,
      $and: [
        ...(baseFilter.$or ? [{ $or: baseFilter.$or }] : []),
        {
          $or: [
            { phoneNormalized: { $in: variants } },
            { phone: { $in: variants } },
            { alternatePhone: { $in: variants } },
          ],
        },
      ],
    }
    if (baseFilter.$or) {
      delete phoneQuery.$or
    }

    const phoneMatches = await Lead.find(phoneQuery)
      .limit(5)
      .setOptions({ skipTenantFilter: true })

    if (phoneMatches.length === 1) {
      return { lead: phoneMatches[0], ambiguous: false, matchedBy: "phone" }
    }

    if (phoneMatches.length > 1) {
      if (preferAgentOwnership && agentId && mongoose.Types.ObjectId.isValid(agentId)) {
        const ownedMatches = phoneMatches.filter(
          (candidate) => candidate.ownerId && candidate.ownerId.toString() === agentId.toString()
        )
        if (ownedMatches.length === 1) {
          return { lead: ownedMatches[0], ambiguous: false, matchedBy: "phone_owner" }
        }
      }

      console.warn(
        `[LeadInteraction] Ambiguous phone match (${phoneMatches.length} leads) in tenant ${tenantId}; skipping arbitrary lead update`
      )
      return {
        lead: null,
        ambiguous: true,
        matchCount: phoneMatches.length,
        matchedBy: "phone_ambiguous",
      }
    }
  }

  // 3. Optional contact-name fallback (used for WhatsApp VoIP calls showing saved/lead name)
  if (allowNameFallback && typeof contactName === "string" && contactName.trim().length >= 2) {
    const escaped = contactName.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    const exactNameRegex = new RegExp(`^${escaped}$`, "i")

    const TenantPhoneContact = require("../models/TenantPhoneContact")
    const phoneContacts = await TenantPhoneContact.find({
      tenantId: String(tenantId),
      contactName: exactNameRegex,
    })
      .limit(5)
      .lean()

    const distinctContactPhones = Array.from(
      new Set(phoneContacts.map((c) => c.normalizedPhone || c.rawPhone).filter(Boolean))
    )

    if (distinctContactPhones.length === 1) {
      const contactVariantsResult = buildPhoneVariants(distinctContactPhones[0])
      if (contactVariantsResult.variants.length > 0) {
        const contactLeadQuery = {
          ...baseFilter,
          $and: [
            ...(baseFilter.$or ? [{ $or: baseFilter.$or }] : []),
            {
              $or: [
                { phoneNormalized: { $in: contactVariantsResult.variants } },
                { phone: { $in: contactVariantsResult.variants } },
                { alternatePhone: { $in: contactVariantsResult.variants } },
              ],
            },
          ],
        }
        if (baseFilter.$or) delete contactLeadQuery.$or

        const viaContactLeads = await Lead.find(contactLeadQuery)
          .limit(5)
          .setOptions({ skipTenantFilter: true })

        if (viaContactLeads.length === 1) {
          return { lead: viaContactLeads[0], ambiguous: false, matchedBy: "phone_contact" }
        }
        if (viaContactLeads.length > 1) {
          return {
            lead: null,
            ambiguous: true,
            matchCount: viaContactLeads.length,
            matchedBy: "phone_contact_ambiguous",
          }
        }
      }
    } else if (distinctContactPhones.length > 1) {
      return {
        lead: null,
        ambiguous: true,
        matchCount: distinctContactPhones.length,
        matchedBy: "phone_contact_name_ambiguous",
      }
    }

    const nameMatches = await Lead.find({
      ...baseFilter,
      name: exactNameRegex,
    })
      .limit(5)
      .setOptions({ skipTenantFilter: true })

    if (nameMatches.length === 1) {
      return { lead: nameMatches[0], ambiguous: false, matchedBy: "contact_name" }
    }
    if (nameMatches.length > 1) {
      console.warn(
        `[LeadInteraction] Ambiguous contact name match (${nameMatches.length} leads) in tenant ${tenantId}; skipping arbitrary lead update`
      )
      return {
        lead: null,
        ambiguous: true,
        matchCount: nameMatches.length,
        matchedBy: "contact_name_ambiguous",
      }
    }
  }

  return { lead: null, ambiguous: false, matchedBy: "unmatched" }
}

/**
 * Atomically updates a lead's dedicated latest voice-interaction fields when a
 * voice call completes successfully, preserving monotonic ordering.
 */
async function recordSuccessfulCallInteraction({
  tenantId,
  workspaceId = null,
  workspaceMode = "all",
  call = null,
  callData = {},
  lead = null,
  agentId = null,
  allowNameFallback = false,
  preferAgentOwnership = false,
} = {}) {
  const effectiveTenantId = tenantId || call?.tenantId || lead?.tenantId
  if (!effectiveTenantId) {
    return { updated: false, skipped: true, reason: "missing_tenant" }
  }

  const combined = {
    ...(callData && typeof callData === "object" ? callData : {}),
    ...(call && typeof call.toObject === "function" ? call.toObject() : call || {}),
  }

  const eligibility = isSuccessfulVoiceCall(combined)
  if (!eligibility.connected) {
    return { updated: false, skipped: true, reason: eligibility.reason }
  }

  let targetLead = lead || null
  let matchedBy = lead ? "provided_lead" : ""

  if (targetLead) {
    if (
      String(targetLead.tenantId) !== String(effectiveTenantId) ||
      targetLead.deletedAt != null
    ) {
      return { updated: false, skipped: true, reason: "invalid_target_lead" }
    }
  } else {
    const resolved = await resolveUnambiguousLeadForCall({
      tenantId: effectiveTenantId,
      workspaceId: workspaceId || combined.workspaceId || null,
      workspaceMode,
      leadId: combined.leadId || combined.lead_id || null,
      phone:
        combined.phoneNormalized ||
        combined.phoneNumber ||
        combined.number ||
        combined.phone_number ||
        combined.phone ||
        "",
      contactName: combined.contactName || combined.contact_name || "",
      agentId: agentId || combined.agentId || null,
      allowNameFallback,
      preferAgentOwnership,
    })

    if (resolved.ambiguous) {
      return {
        updated: false,
        skipped: true,
        ambiguous: true,
        reason: resolved.matchedBy || "ambiguous_lead",
      }
    }

    targetLead = resolved.lead
    matchedBy = resolved.matchedBy
  }

  if (!targetLead || !targetLead._id) {
    return { updated: false, skipped: true, reason: "lead_not_found" }
  }

  const interactionAt = resolveCallInteractionTimestamp(combined)
  const channel = resolveInteractionChannel(combined)
  const direction = resolveInteractionDirection(combined)
  const callId = call?._id && mongoose.Types.ObjectId.isValid(call._id) ? call._id : null

  const updateInteractionFields = {
    lastInteractionAt: interactionAt,
    lastInteractionChannel: channel,
    lastInteractionDirection: direction,
    lastInteractionCallId: callId,
  }

  // Atomic monotonic update for dedicated voice interaction timestamp
  const interactionUpdateRes = await Lead.updateOne(
    {
      _id: targetLead._id,
      tenantId: String(effectiveTenantId),
      deletedAt: null,
      $or: [
        { lastInteractionAt: null },
        { lastInteractionAt: { $exists: false } },
        { lastInteractionAt: { $lt: interactionAt } },
      ],
    },
    { $set: updateInteractionFields }
  ).setOptions({ skipTenantFilter: true })

  // Keep lastContactedAt monotonic as well so UI Last Contacted never regresses or gets overwritten by missed calls
  await Lead.updateOne(
    {
      _id: targetLead._id,
      tenantId: String(effectiveTenantId),
      deletedAt: null,
      $or: [
        { lastContactedAt: null },
        { lastContactedAt: { $exists: false } },
        { lastContactedAt: { $lt: interactionAt } },
      ],
    },
    { $set: { lastContactedAt: interactionAt } }
  ).setOptions({ skipTenantFilter: true })

  const updated = Boolean(interactionUpdateRes?.modifiedCount > 0)
  if (updated && typeof targetLead === "object") {
    targetLead.lastInteractionAt = interactionAt
    targetLead.lastInteractionChannel = channel
    targetLead.lastInteractionDirection = direction
    targetLead.lastInteractionCallId = callId
    if (!targetLead.lastContactedAt || new Date(targetLead.lastContactedAt) < interactionAt) {
      targetLead.lastContactedAt = interactionAt
    }
  }

  return {
    updated,
    skipped: false,
    leadId: targetLead._id,
    matchedBy,
    interactionAt,
    channel,
    direction,
    callId,
  }
}

module.exports = {
  isSuccessfulVoiceCall,
  resolveInteractionChannel,
  resolveInteractionDirection,
  resolveCallInteractionTimestamp,
  buildPhoneVariants,
  resolveUnambiguousLeadForCall,
  recordSuccessfulCallInteraction,
}
