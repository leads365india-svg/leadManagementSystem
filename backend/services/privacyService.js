const mongoose = require("mongoose")
const DnrRule = require("../models/DnrRule")
const Lead = require("../models/Lead")
const Call = require("../models/Call")
const Account = require("../models/Account")
const audit = require("./auditService")
const recordingStorage = require("./recordingStorage")
const { normalizePhoneE164 } = require("../utils/phoneNormalizer")

/**
 * Privacy Service - Roadmap Phase 18: Do-Not-Record, Consent & Privacy Controls
 * 
 * Centralized compliance engine resolving:
 * - Dynamic DNR evaluation (lead switch, tags, and tenant DNR list)
 * - Consent lifecycle (explicit opt-in vs implied disclosure policies)
 * - Right to erasure (purging recordings upon lead deletion/anonymization)
 * - Auditability of all privacy preference changes
 */

/**
 * Evaluates whether recording is permitted for a given lead, call, and dialed number.
 * Server-authoritative: client-side flags are never trusted as the sole source.
 * 
 * @param {Object} params
 * @param {string} params.tenantId - Tenant account identifier
 * @param {Object} [params.lead] - Mongoose Lead document or lean object
 * @param {string} [params.phoneNumber] - Raw or dialed phone number
 * @returns {Promise<{ allowed: boolean, reason?: string, details?: Object }>}
 */
async function evaluateRecordingEligibility({ tenantId, lead = null, phoneNumber = null }) {
  if (!tenantId) {
    return { allowed: false, reason: "TENANT_REQUIRED" }
  }

  // 1. If lead provided, check lead-level Do-Not-Record switch
  if (lead) {
    const isLeadDnr =
      lead.metadata?.doNotRecord === true ||
      lead.doNotRecord === true ||
      (Array.isArray(lead.tags) && lead.tags.some((t) => String(t).toUpperCase() === "DNR"))

    if (isLeadDnr) {
      return {
        allowed: false,
        reason: "RECORDING_FORBIDDEN_DNR",
        message: "Recording prohibited: Lead has Do-Not-Record (DNR) active",
      }
    }
  }

  // 2. Check Tenant-Level DNR Number List
  const rawNum = phoneNumber || lead?.phone || lead?.phoneNormalized
  if (rawNum) {
    const norm = normalizePhoneE164(rawNum, "+91")
    const dnrNumberMatch = await DnrRule.findOne({
      tenantId,
      type: "number",
      valueNormalized: norm,
    }).setOptions({ skipTenantFilter: true })

    if (dnrNumberMatch) {
      return {
        allowed: false,
        reason: "RECORDING_FORBIDDEN_DNR_NUMBER",
        message: `Recording prohibited: Phone number ${rawNum} is registered in the agency Do-Not-Record list`,
        ruleId: dnrNumberMatch._id,
      }
    }
  }

  // 3. Check Tenant-Level DNR Tag List against lead tags
  if (lead && Array.isArray(lead.tags) && lead.tags.length > 0) {
    const leadUpperTags = lead.tags.map((t) => String(t).trim().toUpperCase())
    const dnrTagMatch = await DnrRule.findOne({
      tenantId,
      type: "tag",
      valueNormalized: { $in: leadUpperTags },
    }).setOptions({ skipTenantFilter: true })

    if (dnrTagMatch) {
      return {
        allowed: false,
        reason: "RECORDING_FORBIDDEN_DNR_TAG",
        message: `Recording prohibited: Lead contains restricted tag '${dnrTagMatch.value}'`,
        ruleId: dnrTagMatch._id,
      }
    }
  }

  // 4. Consent Policy Evaluation
  const account = await Account.findOne({ accountId: tenantId }).setOptions({ skipTenantFilter: true }).lean()
  const consentPolicy = account?.metadata?.consentPolicy || "implied_disclosure" // 'explicit_opt_in' | 'implied_disclosure' | 'exempt'
  const leadConsent = lead?.metadata?.consent || lead?.consent || {}
  const consentStatus = leadConsent.status || "unknown" // 'granted' | 'declined' | 'withdrawn' | 'unknown'

  // Explicit declined or withdrawn consent ALWAYS blocks recording
  if (consentStatus === "declined" || consentStatus === "withdrawn") {
    return {
      allowed: false,
      reason: "RECORDING_FORBIDDEN_CONSENT_DECLINED",
      message: `Recording prohibited: Lead consent status is '${consentStatus}'`,
      consentStatus,
    }
  }

  // If agency requires explicit opt-in consent, status must be 'granted'
  if (consentPolicy === "explicit_opt_in" && consentStatus !== "granted") {
    return {
      allowed: false,
      reason: "RECORDING_FORBIDDEN_CONSENT_REQUIRED",
      message: "Recording prohibited: Agency requires explicit opt-in consent before calls can be recorded",
      consentPolicy,
      consentStatus,
    }
  }

  return {
    allowed: true,
    consentPolicy,
    consentStatus,
  }
}

/**
 * Retrieves all active DNR rules for a tenant.
 */
async function getDnrRules(tenantId) {
  if (!tenantId) return []
  return DnrRule.find({ tenantId })
    .setOptions({ skipTenantFilter: true })
    .sort({ createdAt: -1 })
    .lean()
}

/**
 * Adds a new phone number or tag to the tenant's Do-Not-Record list.
 */
async function addDnrRule({ tenantId, type, value, reason = "", actor = null }) {
  if (!tenantId || !type || !value) {
    const err = new Error("tenantId, type ('number' | 'tag'), and value are required")
    err.statusCode = 400
    throw err
  }

  const cleanType = String(type).toLowerCase().trim()
  if (!["number", "tag"].includes(cleanType)) {
    const err = new Error("Invalid rule type. Allowed types are 'number' or 'tag'")
    err.statusCode = 400
    throw err
  }

  const norm = cleanType === "number" ? normalizePhoneE164(value, "+91") : value.trim().toUpperCase()

  const existing = await DnrRule.findOne({
    tenantId,
    type: cleanType,
    valueNormalized: norm,
  }).setOptions({ skipTenantFilter: true })

  if (existing) {
    return { rule: existing, alreadyExisted: true }
  }

  const rule = new DnrRule({
    tenantId,
    type: cleanType,
    value: value.trim(),
    valueNormalized: norm,
    reason: reason.trim(),
    createdBy: actor?.id || actor?._id || null,
  })

  await rule.save()

  // Audit log rule creation
  if (audit && typeof audit.log === "function") {
    audit.log({
      tenantId,
      action: "privacy.dnr.added",
      category: "privacy",
      entity: "DnrRule",
      entityId: rule._id,
      summary: `Added ${cleanType} '${value}' to Do-Not-Record list`,
      actor,
      details: { type: cleanType, value, reason },
    }).catch(() => {})
  }

  return { rule, alreadyExisted: false }
}

/**
 * Removes a DNR rule from the tenant list.
 */
async function removeDnrRule({ tenantId, ruleId, actor = null }) {
  if (!tenantId || !ruleId) {
    const err = new Error("tenantId and ruleId are required")
    err.statusCode = 400
    throw err
  }

  const rule = await DnrRule.findOneAndDelete({
    _id: ruleId,
    tenantId,
  }).setOptions({ skipTenantFilter: true })

  if (!rule) {
    const err = new Error("DNR rule not found or does not belong to this tenant")
    err.statusCode = 404
    throw err
  }

  // Audit log rule removal
  if (audit && typeof audit.log === "function") {
    audit.log({
      tenantId,
      action: "privacy.dnr.removed",
      category: "privacy",
      entity: "DnrRule",
      entityId: rule._id,
      summary: `Removed ${rule.type} '${rule.value}' from Do-Not-Record list`,
      actor,
      details: { type: rule.type, value: rule.value },
    }).catch(() => {})
  }

  return { success: true, removedRule: rule }
}

/**
 * Updates a lead's individual privacy controls (per-lead DNR switch and/or consent status).
 */
async function updateLeadPrivacy({ tenantId, leadId, doNotRecord = null, consent = null, actor = null }) {
  if (!tenantId || !leadId) {
    const err = new Error("tenantId and leadId are required")
    err.statusCode = 400
    throw err
  }

  const lead = await Lead.findOne({ _id: leadId, tenantId }).setOptions({ skipTenantFilter: true })
  if (!lead) {
    const err = new Error("Lead not found")
    err.statusCode = 404
    throw err
  }

  if (!lead.metadata) lead.metadata = {}
  const changes = {}

  // 1. Update Do-Not-Record flag if provided
  if (doNotRecord !== null) {
    const dnrBool = Boolean(doNotRecord)
    lead.metadata.doNotRecord = dnrBool
    lead.markModified("metadata")
    changes.doNotRecord = dnrBool

    // Keep DNR tag synchronized
    if (dnrBool) {
      if (!Array.isArray(lead.tags)) lead.tags = []
      if (!lead.tags.includes("DNR")) lead.tags.push("DNR")
    } else {
      if (Array.isArray(lead.tags)) {
        lead.tags = lead.tags.filter((t) => String(t).toUpperCase() !== "DNR")
      }
    }
  }

  // 2. Update Consent record if provided
  if (consent && typeof consent === "object") {
    const validStatuses = ["granted", "declined", "withdrawn", "unknown"]
    const status = validStatuses.includes(consent.status) ? consent.status : "unknown"

    lead.metadata.consent = {
      status,
      method: consent.method || "verbal",
      updatedAt: new Date(),
      updatedBy: actor?.id || actor?._id || null,
      notes: consent.notes || "",
    }
    lead.markModified("metadata")
    changes.consent = lead.metadata.consent
  }

  await lead.save()

  // Audit log privacy preference update
  if (audit && typeof audit.log === "function") {
    audit.log({
      tenantId,
      action: "privacy.lead_preferences.updated",
      category: "privacy",
      entity: "Lead",
      entityId: lead._id,
      summary: `Updated privacy controls for lead ${lead.name}`,
      actor,
      details: changes,
    }).catch(() => {})
  }

  return { success: true, lead, changes }
}

/**
 * Erasure: Immediately purges all audio recordings for a lead from GridFS.
 * Preserves the Call log metadata while removing the audio binaries per privacy policy.
 */
async function eraseLeadRecordings({ tenantId, leadId, actor = null }) {
  if (!tenantId || !leadId) return { erasedCount: 0 }

  const bucket = recordingStorage.getBucket()
  const calls = await Call.find({
    tenantId,
    leadId,
    "recording.status": "stored",
  }).setOptions({ skipTenantFilter: true })

  let erasedCount = 0
  for (const call of calls) {
    if (call.recording?.fileId) {
      try {
        await bucket.delete(call.recording.fileId)
      } catch (_) {}
    }
    call.recording.status = "expired"
    call.recording.fileId = null
    await call.save()
    erasedCount++
  }

  if (audit && typeof audit.log === "function" && erasedCount > 0) {
    audit.log({
      tenantId,
      action: "privacy.recordings.erased",
      category: "privacy",
      entity: "Lead",
      entityId: leadId,
      summary: `Erased ${erasedCount} audio recording(s) for lead ${leadId}`,
      actor,
      details: { leadId, erasedCount },
    }).catch(() => {})
  }

  return { erasedCount }
}

module.exports = {
  evaluateRecordingEligibility,
  getDnrRules,
  addDnrRule,
  removeDnrRule,
  updateLeadPrivacy,
  eraseLeadRecordings,
}
