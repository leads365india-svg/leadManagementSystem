const mongoose = require("mongoose")
const { normalizePhoneE164 } = require("../../utils/phoneNormalizer")
const { syncAiCallToLeadPipeline, mapAiOutlineToLeadStatus } = require("../leadPipelineSync.service")

/**
 * AI Receptionist Controlled CRM Tools Service
 * 
 * Secure server-side execution boundary connecting AI voice events to Leads365 CRM:
 * - Search, create, and update Leads with strict tenant scoping.
 * - Link Calls and Recordings to Leads with duration and outcome metadata.
 * - Schedule tenant-scoped Follow-ups.
 * - Trigger Lead Pipeline synchronization (Engaged, Closed-Won, Closed-Lost).
 * - Idempotency protection: prevents duplicate leads or calls from webhook retries.
 * - Zero direct MongoDB access for Gemini: all actions strictly mediated and validated server-side.
 */

// In-Memory Test Store (Active when testing without live Atlas database)
class InMemoryCrmStore {
  constructor() {
    this.leads = new Map() // leadId -> Lead
    this.calls = new Map() // callId -> Call
    this.followUps = new Map() // followUpId -> FollowUp
  }

  clear() {
    this.leads.clear()
    this.calls.clear()
    this.followUps.clear()
  }
}

const inMemoryStore = new InMemoryCrmStore()

function isLiveDbReady() {
  return Boolean(mongoose.connection && mongoose.connection.readyState === 1 && mongoose.connection.db)
}

/**
 * Searches an existing lead by phone number within the current tenant.
 */
async function searchLeadByPhone({ tenantId, phone }) {
  if (!tenantId || !phone) {
    throw new Error("searchLeadByPhone: tenantId and phone are required")
  }

  const normalized = normalizePhoneE164(phone)
  if (!normalized) {
    return { found: false, lead: null, reason: "INVALID_PHONE_FORMAT" }
  }

  if (!isLiveDbReady()) {
    // In-Memory Search
    for (const lead of inMemoryStore.leads.values()) {
      if (lead.tenantId === tenantId && (lead.phoneNormalized === normalized || lead.phone === phone)) {
        return { found: true, lead: { ...lead } }
      }
    }
    return { found: false, lead: null }
  }

  const Lead = require("../../models/Lead")
  const lead = await Lead.findOne({
    tenantId,
    $or: [{ phoneNormalized: normalized }, { phone: phone }],
  }).lean()

  return { found: Boolean(lead), lead: lead || null }
}

/**
 * Creates a new lead or updates existing lead requirements idempotently.
 */
async function createOrUpdateLead({
  tenantId,
  phone,
  name,
  email = "",
  requirement = "",
  notes = "",
  source = "AI Receptionist",
}) {
  if (!tenantId || !phone) {
    throw new Error("createOrUpdateLead: tenantId and phone are required")
  }

  const normalized = normalizePhoneE164(phone)
  if (!normalized) {
    throw new Error("createOrUpdateLead: Invalid phone number format")
  }

  const searchResult = await searchLeadByPhone({ tenantId, phone: normalized })

  if (searchResult.found && searchResult.lead) {
    // Update existing lead
    const existing = searchResult.lead
    const updatedNotes = [existing.notes, notes, requirement ? `Requirement: ${requirement}` : ""]
      .filter(Boolean)
      .join("\n")

    if (!isLiveDbReady()) {
      existing.notes = updatedNotes
      if (name && (!existing.name || existing.name === "Incoming Caller")) {
        existing.name = name
      }
      if (email && !existing.email) {
        existing.email = email
      }
      existing.updatedAt = new Date()
      inMemoryStore.leads.set(existing._id, existing)
      return { action: "updated", lead: { ...existing } }
    }

    const Lead = require("../../models/Lead")
    const updatedDoc = await Lead.findOneAndUpdate(
      { _id: existing._id, tenantId },
      {
        $set: {
          notes: updatedNotes,
          ...(name && (!existing.name || existing.name === "Incoming Caller") ? { name } : {}),
          ...(email && !existing.email ? { email } : {}),
        },
      },
      { new: true }
    ).lean()

    return { action: "updated", lead: updatedDoc }
  }

  // Create new Lead
  const safeName = name && name.trim().length >= 2 ? name.trim() : "Incoming Caller"

  if (!isLiveDbReady()) {
    const leadId = `lead_mem_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    const newLead = {
      _id: leadId,
      id: leadId,
      tenantId,
      name: safeName,
      phone,
      phoneNormalized: normalized,
      email,
      requirement,
      notes: requirement ? `Requirement: ${requirement}` : notes,
      status: "New",
      source,
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    inMemoryStore.leads.set(leadId, newLead)
    return { action: "created", lead: { ...newLead } }
  }

  const Lead = require("../../models/Lead")
  const newLead = await Lead.create({
    tenantId,
    name: safeName,
    phone,
    phoneNormalized: normalized,
    email,
    requirement,
    notes: requirement ? `Requirement: ${requirement}` : notes,
    status: "New",
    source,
  })

  return { action: "created", lead: newLead.toJSON() }
}

/**
 * Updates verified customer requirement notes for a lead.
 */
async function updateLeadRequirements({ tenantId, leadId, requirement, notes = "" }) {
  if (!tenantId || !leadId) {
    throw new Error("updateLeadRequirements: tenantId and leadId are required")
  }

  if (!isLiveDbReady()) {
    const lead = inMemoryStore.leads.get(leadId)
    if (!lead || lead.tenantId !== tenantId) {
      throw new Error("Lead not found or access denied")
    }
    lead.requirement = requirement || lead.requirement
    if (notes) lead.notes = `${lead.notes || ""}\n${notes}`.trim()
    lead.updatedAt = new Date()
    return { success: true, lead: { ...lead } }
  }

  const Lead = require("../../models/Lead")
  const updated = await Lead.findOneAndUpdate(
    { _id: leadId, tenantId },
    {
      $set: {
        ...(requirement ? { requirement } : {}),
        ...(notes ? { notes } : {}),
      },
    },
    { new: true }
  ).lean()

  if (!updated) {
    throw new Error("Lead not found or access denied")
  }

  return { success: true, lead: updated }
}

/**
 * Schedules a tenant-scoped follow-up task.
 */
async function scheduleFollowup({ tenantId, leadId, scheduledAt, note = "", type = "call" }) {
  if (!tenantId || !leadId) {
    throw new Error("scheduleFollowup: tenantId and leadId are required")
  }

  const scheduledEpochMs = typeof scheduledAt === "number" ? scheduledAt : new Date(scheduledAt || Date.now() + 86400000).getTime()

  if (!isLiveDbReady()) {
    const lead = inMemoryStore.leads.get(leadId)
    if (!lead || lead.tenantId !== tenantId) {
      throw new Error("Cannot schedule follow-up: Lead not found in current tenant")
    }
    const followUpId = `fu_mem_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    const followUp = {
      _id: followUpId,
      id: followUpId,
      tenantId,
      leadId,
      leadName: lead.name,
      leadPhone: lead.phone,
      type,
      scheduledAtEpochMs: scheduledEpochMs,
      note,
      status: "pending",
      createdAt: new Date(),
    }
    inMemoryStore.followUps.set(followUpId, followUp)
    return { success: true, followUp }
  }

  const Lead = require("../../models/Lead")
  const FollowUp = require("../../models/FollowUp")

  const lead = await Lead.findOne({ _id: leadId, tenantId }).lean()
  if (!lead) {
    throw new Error("Cannot schedule follow-up: Lead not found in current tenant")
  }

  const followUp = await FollowUp.create({
    tenantId,
    leadId,
    leadName: lead.name,
    leadPhone: lead.phone,
    type,
    scheduledAtEpochMs: scheduledEpochMs,
    notes: note,
    status: "pending",
  })

  return { success: true, followUp: followUp.toJSON() }
}

/**
 * Links a completed or active AI call to a Lead, saving duration, outcome, and triggering pipeline sync.
 */
async function linkCallToLead({
  tenantId,
  callSid,
  phone,
  leadId,
  durationSeconds = 0,
  callOutcome = "Connected",
  notes = "",
  transcript = "",
}) {
  if (!tenantId || !callSid) {
    throw new Error("linkCallToLead: tenantId and callSid are required")
  }

  const normalized = phone ? normalizePhoneE164(phone) : ""

  if (!isLiveDbReady()) {
    // Idempotent: check if call already recorded
    let call = inMemoryStore.calls.get(callSid)
    if (!call) {
      call = {
        _id: `call_${callSid}`,
        id: `call_${callSid}`,
        clientCallId: callSid,
        tenantId,
        leadId: leadId || null,
        phone: phone || "",
        phoneNormalized: normalized,
        duration: durationSeconds,
        callOutcome,
        notes,
        transcript,
        source: "ai_receptionist",
        hasRecording: true,
        createdAt: new Date(),
      }
      inMemoryStore.calls.set(callSid, call)
    } else {
      call.duration = durationSeconds || call.duration
      call.callOutcome = callOutcome || call.callOutcome
      call.notes = notes || call.notes
      if (leadId) call.leadId = leadId
    }

    // Trigger pipeline sync if leadId is linked
    if (leadId && inMemoryStore.leads.has(leadId)) {
      const lead = inMemoryStore.leads.get(leadId)
      const targetStatus = mapAiOutlineToLeadStatus(callOutcome)
      if (targetStatus && targetStatus !== lead.status) {
        lead.status = targetStatus
        lead.updatedAt = new Date()
      }
    }

    return { success: true, call: { ...call } }
  }

  const Call = require("../../models/Call")
  const callDoc = await Call.findOneAndUpdate(
    { clientCallId: callSid, tenantId },
    {
      $set: {
        leadId: leadId || null,
        phone: phone || "",
        phoneNormalized: normalized,
        duration: durationSeconds,
        durationSeconds,
        callOutcome,
        notes,
        source: "ai_receptionist",
        hasRecording: true,
        metadata: {
          aiReceptionist: true,
          transcript,
        },
      },
    },
    { upsert: true, new: true }
  ).lean()

  // Trigger live pipeline synchronization
  if (leadId) {
    try {
      await syncAiCallToLeadPipeline({
        callId: callDoc._id.toString(),
        tenantId,
        callOutcome,
        actorId: null,
      })
    } catch (_) {}
  }

  return { success: true, call: callDoc }
}

/**
 * Controlled Dispatcher for Gemini Function Calls
 */
async function executeCrmTool({ tenantId, name, args = {} }) {
  if (!tenantId) {
    throw new Error("SECURITY_ERROR: Missing server-side tenantId in executeCrmTool")
  }

  switch (name) {
    case "searchLeadByPhone":
      return await searchLeadByPhone({ tenantId, phone: args.phone })

    case "createOrUpdateLead":
      return await createOrUpdateLead({
        tenantId,
        phone: args.phone,
        name: args.name,
        email: args.email,
        requirement: args.requirement,
        notes: args.notes,
      })

    case "updateLeadRequirements":
      return await updateLeadRequirements({
        tenantId,
        leadId: args.leadId,
        requirement: args.requirement,
        notes: args.notes,
      })

    case "scheduleFollowup":
      return await scheduleFollowup({
        tenantId,
        leadId: args.leadId,
        scheduledAt: args.scheduledAt,
        note: args.note,
        type: args.type,
      })

    default:
      return { status: "unsupported", message: `CRM tool '${name}' is not recognized` }
  }
}

module.exports = {
  searchLeadByPhone,
  createOrUpdateLead,
  updateLeadRequirements,
  scheduleFollowup,
  linkCallToLead,
  executeCrmTool,
  inMemoryStore,
}

