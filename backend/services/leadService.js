const mongoose = require("mongoose")
const Lead = require("../models/Lead")
const User = require("../models/User")
const { normalizePhoneE164 } = require("../utils/phoneNormalizer")
const assignmentService = require("./assignmentService")

/**
 * Shared Lead Service - Phase 6: Lead Model v2 & Shared Lead Service
 * 
 * Centralizes lead creation, phone normalization, attribution tracking,
 * and duplicate detection across all ingestion channels (Manual, Webhooks,
 * Meta Ads, Google Ads, IndiaMART, and integrations).
 */

/**
 * Extracts and normalizes marketing attribution touch parameters
 */
function extractAttributionPayload(payload = {}, defaultSource = "Direct") {
  const source = payload.utm_source || payload.source || defaultSource || "Direct"
  const medium = payload.utm_medium || payload.medium || ""
  const campaign = payload.utm_campaign || payload.campaign || ""
  const term = payload.utm_term || payload.term || ""
  const content = payload.utm_content || payload.content || ""
  const gclid = payload.gclid || ""
  const fbclid = payload.fbclid || ""
  const adId = payload.adId || payload.ad_id || ""
  const adSetId = payload.adSetId || payload.adset_id || ""
  const campaignId = payload.campaignId || payload.campaign_id || ""
  const landingPage = payload.landingPage || payload.landing_page || payload.pageUrl || ""
  const referrer = payload.referrer || payload.referrerUrl || ""

  return {
    source: typeof source === "string" ? source.trim() : "Direct",
    medium: typeof medium === "string" ? medium.trim() : "",
    campaign: typeof campaign === "string" ? campaign.trim() : "",
    term: typeof term === "string" ? term.trim() : "",
    content: typeof content === "string" ? content.trim() : "",
    gclid: typeof gclid === "string" ? gclid.trim() : "",
    fbclid: typeof fbclid === "string" ? fbclid.trim() : "",
    adId: typeof adId === "string" ? adId.trim() : "",
    adSetId: typeof adSetId === "string" ? adSetId.trim() : "",
    campaignId: typeof campaignId === "string" ? campaignId.trim() : "",
    landingPage: typeof landingPage === "string" ? landingPage.trim() : "",
    referrer: typeof referrer === "string" ? referrer.trim() : "",
    timestamp: new Date(),
  }
}

/**
 * Core unified method to create or merge a lead across any channel.
 * 
 * @param {Object} params
 * @param {string} params.tenantId - Tenant account ID (mandatory)
 * @param {string} [params.source="Website"] - Lead acquisition channel
 * @param {Object} params.payload - Incoming lead data
 * @param {Object} [params.options] - Configuration options:
 *   - duplicateHandling: "reject" | "update" | "merge" | "allow" (default: "reject")
 *   - defaultCountry: Default country calling code for phone normalizer (default: "+91")
 *   - overwriteName: boolean (default: false)
 * @param {Object} [params.actor] - Current authenticated user / worker context
 * @returns {Promise<{ action: "created" | "merged" | "duplicate_rejected", lead: Object, reason?: string }>}
 */
async function createOrMergeLead({
  tenantId,
  source = "Website",
  payload = {},
  options = {},
  actor = null,
}) {
  if (!tenantId || typeof tenantId !== "string" || !tenantId.trim()) {
    throw new Error("Tenant context is required for lead creation")
  }

  const cleanTenantId = tenantId.trim()
  const name = typeof payload.name === "string" ? payload.name.trim() : ""
  if (!name || name.length < 2) {
    throw new Error("Valid lead name is required (minimum 2 characters)")
  }

  const rawEmail = typeof payload.email === "string" ? payload.email.toLowerCase().trim() : ""
  const rawPhone = typeof payload.phone === "string" ? payload.phone.trim() : ""
  const defaultCountry = options.defaultCountry || "+91"
  const phoneNormalized = rawPhone ? normalizePhoneE164(rawPhone, defaultCountry) : ""

  const duplicateHandling = options.duplicateHandling || "reject"

  // 1. Check for duplicates within caller's tenant partition
  const duplicateConditions = []
  if (rawEmail) {
    duplicateConditions.push({ email: rawEmail })
  }
  if (phoneNormalized) {
    duplicateConditions.push({ phoneNormalized })
  } else if (rawPhone) {
    duplicateConditions.push({ phone: rawPhone })
  }

  let existingLead = null
  if (duplicateConditions.length > 0) {
    existingLead = await Lead.findOne({
      tenantId: cleanTenantId,
      $or: duplicateConditions,
      deletedAt: null,
    })
  }

  const attributionTouch = extractAttributionPayload(payload, source)

  // 2. Handle duplicate scenarios
  if (existingLead) {
    if (duplicateHandling === "reject") {
      return {
        action: "duplicate_rejected",
        lead: existingLead,
        reason: "A lead with this email or phone number already exists in this account",
      }
    }

    if (duplicateHandling === "update" || duplicateHandling === "merge") {
      // Merge new data into existing lead
      if (options.overwriteName && name) {
        existingLead.name = name
      }
      if (payload.company && typeof payload.company === "string") {
        existingLead.company = payload.company.trim()
      }
      if (payload.city && typeof payload.city === "string") {
        existingLead.city = payload.city.trim()
      }
      if (payload.alternatePhone && typeof payload.alternatePhone === "string") {
        existingLead.alternatePhone = payload.alternatePhone.trim()
      }

      // Merge tags
      if (Array.isArray(payload.tags) && payload.tags.length > 0) {
        const cleanTags = payload.tags.map((t) => String(t).trim().toLowerCase()).filter(Boolean)
        const currentTags = Array.isArray(existingLead.tags) ? existingLead.tags : []
        existingLead.tags = Array.from(new Set([...currentTags, ...cleanTags]))
      }

      // Append message notes if provided
      if (payload.message && typeof payload.message === "string" && payload.message.trim()) {
        const timestampStr = new Date().toLocaleDateString()
        existingLead.message = existingLead.message
          ? `${existingLead.message}\n[Note ${timestampStr} via ${source}]: ${payload.message.trim()}`
          : payload.message.trim()
      }

      if (payload.landingPage) {
        existingLead.landingPage = String(payload.landingPage).trim()
      }
      if (payload.formId) {
        existingLead.formId = String(payload.formId).trim()
      }

      // First-touch attribution is write-once (preserve existing firstTouch); lastTouch is updated
      if (!existingLead.attribution) {
        existingLead.attribution = {
          firstTouch: attributionTouch,
          lastTouch: attributionTouch,
        }
      } else {
        if (!existingLead.attribution.firstTouch || !existingLead.attribution.firstTouch.source) {
          existingLead.attribution.firstTouch = attributionTouch
        }
        existingLead.attribution.lastTouch = attributionTouch
      }

      // Update verification if verified proof supplied
      if (payload.isEmailVerified) {
        existingLead.isEmailVerified = true
        existingLead.verificationStatus = payload.verificationStatus || "verified"
      }

      existingLead.lastContactedAt = new Date()

      // Track transition history if status changed
      if (payload.status && payload.status !== existingLead.status) {
        const existingHistory = Array.isArray(existingLead.metadata?.statusHistory)
          ? existingLead.metadata.statusHistory
          : []
        const transitionRecord = {
          fromStatus: existingLead.status,
          toStatus: payload.status,
          transitionedAt: new Date(),
          transitionedBy: actor?.name || actor?.email || source,
        }
        if (!existingLead.metadata) existingLead.metadata = {}
        existingLead.metadata.statusHistory = [...existingHistory, transitionRecord]
        existingLead.status = payload.status
      }

      await existingLead.save()

      // Automatically reconcile historical calls matching this merged lead
      let mergedReconciledCalls = null
      try {
        const callService = require("./callService")
        mergedReconciledCalls = await callService.reconcileHistoricalCallsForLead({
          lead: existingLead,
          tenantId: cleanTenantId,
          user: actor,
        })
      } catch (reconcileErr) {
        console.warn("[LeadService] Call reconciliation notice on lead merge:", reconcileErr.message)
      }

      return {
        action: "merged",
        lead: existingLead,
        reconciledCalls: mergedReconciledCalls,
      }
    }
  }

  // 3. Resolve Ownership and Assignment
  let ownerId = null
  let assignedStaffId = "unassigned"
  let assignedTo = "Unassigned"

  if (payload.ownerId && mongoose.Types.ObjectId.isValid(payload.ownerId)) {
    ownerId = new mongoose.Types.ObjectId(payload.ownerId)
    assignedStaffId = ownerId.toString()
  } else if (payload.assignedStaffId && mongoose.Types.ObjectId.isValid(payload.assignedStaffId)) {
    ownerId = new mongoose.Types.ObjectId(payload.assignedStaffId)
    assignedStaffId = ownerId.toString()
  }

  let teamId = payload.teamId && mongoose.Types.ObjectId.isValid(payload.teamId)
    ? new mongoose.Types.ObjectId(payload.teamId)
    : null

  let routingReason = "Direct creation"
  if (ownerId) {
    const ownerDoc = await User.findOne({ _id: ownerId, tenantId: cleanTenantId, isActive: { $ne: false } })
    if (ownerDoc) {
      assignedTo = ownerDoc.name
    } else {
      assignedTo = payload.assignedTo || "Unassigned"
    }
    routingReason = "Directly assigned"
  } else if (payload.assignedTo && typeof payload.assignedTo === "string" && payload.assignedTo !== "Unassigned") {
    assignedTo = payload.assignedTo.trim()
    routingReason = `Directly assigned to ${assignedTo}`
  } else if (actor?.role === "agent" && actor?.name) {
    assignedTo = actor.name
    if (actor.id && mongoose.Types.ObjectId.isValid(actor.id)) {
      ownerId = new mongoose.Types.ObjectId(actor.id)
      assignedStaffId = actor.id
    }
    routingReason = "Created by agent"
  } else {
    // Phase 7: Evaluate automated assignment rules for tenant
    const routing = await assignmentService.resolveLeadAssignment(
      { source, tags: payload.tags, city: payload.city },
      cleanTenantId,
    )
    if (routing.ownerId) {
      ownerId = routing.ownerId
      assignedTo = routing.assignedTo
      assignedStaffId = routing.assignedStaffId
      if (!teamId && routing.teamId) {
        teamId = routing.teamId
      }
      routingReason = routing.reason
    } else {
      routingReason = routing.reason || "Unassigned pool"
    }
  }

  const tags = Array.isArray(payload.tags)
    ? payload.tags.map((t) => String(t).trim().toLowerCase()).filter(Boolean)
    : []

  const leadMetadata = typeof payload.metadata === "object" && payload.metadata !== null
    ? { ...payload.metadata }
    : {}

  if (payload.company && typeof payload.company === "string") {
    leadMetadata.company = payload.company.trim()
  }

  const initialAssignmentHistory = [
    {
      fromOwnerId: null,
      fromOwnerName: "Unassigned Pool",
      toOwnerId: ownerId,
      toOwnerName: assignedTo,
      teamId,
      assignedBy: actor?.id && mongoose.Types.ObjectId.isValid(actor.id) ? new mongoose.Types.ObjectId(actor.id) : null,
      assignedByName: actor?.name || "System",
      assignedAt: new Date(),
      reason: routingReason,
    },
  ]

  // 4. Instantiate and Save Lead Model v2 Document
  const newLead = new Lead({
    name,
    email: rawEmail,
    phone: rawPhone,
    phoneNormalized,
    alternatePhone: typeof payload.alternatePhone === "string" ? payload.alternatePhone.trim() : "",
    company: typeof payload.company === "string" ? payload.company.trim() : "",
    city: typeof payload.city === "string" ? payload.city.trim() : "",
    status: payload.status || "New",
    tenantId: cleanTenantId,
    source: typeof source === "string" ? source.trim() : "Website",
    sourceId: typeof payload.sourceId === "string" ? payload.sourceId.trim() : "",
    assignedTo,
    assignedStaffId,
    ownerId,
    teamId,
    tags,
    attribution: {
      firstTouch: attributionTouch,
      lastTouch: attributionTouch,
    },
    assignmentHistory: initialAssignmentHistory,
    lastContactedAt: payload.lastContactedAt ? new Date(payload.lastContactedAt) : null,
    deletedAt: null,
    message: typeof payload.message === "string" ? payload.message.trim() : "",
    formId: typeof payload.formId === "string" ? payload.formId.trim() : "",
    landingPage: typeof payload.landingPage === "string" ? payload.landingPage.trim() : "",
    isEmailVerified: Boolean(payload.isEmailVerified),
    verificationStatus: payload.verificationStatus || "unverified",
    isTest: Boolean(payload.isTest),
    metadata: leadMetadata,
  })

  const savedLead = await newLead.save()

  // Automatically reconcile historical unassigned calls matching this new lead
  let reconciledCalls = null
  try {
    const callService = require("./callService")
    reconciledCalls = await callService.reconcileHistoricalCallsForLead({
      lead: savedLead,
      tenantId: cleanTenantId,
      user: actor,
    })
  } catch (reconcileErr) {
    console.warn("[LeadService] Call reconciliation notice on lead creation:", reconcileErr.message)
  }

  // Phase 10: Record lead.created activity event
  try {
    const { activity } = require("./activityService")
    await activity.record({
      tenantId: cleanTenantId,
      leadId: savedLead._id,
      type: "lead.created",
      actor: actor
        ? {
            id: actor._id || actor.id,
            name: actor.name || "System",
            email: actor.email || "",
            role: actor.role || "user",
          }
        : { name: source || "System", role: "system" },
      payload: {
        source: savedLead.source,
        assignedTo: savedLead.assignedTo,
        status: savedLead.status,
        company: savedLead.company || "",
        landingPage: savedLead.landingPage || "",
      },
    })
  } catch (actErr) {
    console.error("Failed to record lead.created activity:", actErr.message)
  }

  // Phase 15: Mobile lead assignment push notification
  if (savedLead.ownerId) {
    try {
      const pushService = require("./pushService")
      await pushService.sendLeadAssignedPush({
        tenantId: cleanTenantId,
        agentId: savedLead.ownerId,
        lead: savedLead,
      })
    } catch (pushErr) {
      console.error("Failed to trigger mobile push notification for new lead:", pushErr.message)
    }
  }

  return {
    action: "created",
    lead: savedLead,
    reconciledCalls,
  }
}

/**
 * Soft delete a lead by stamping deletedAt
 */
async function softDeleteLead(leadId, tenantId) {
  if (!leadId || !tenantId) return null
  return Lead.findOneAndUpdate(
    { _id: leadId, tenantId },
    { deletedAt: new Date() },
    { new: true },
  )
}

module.exports = {
  createOrMergeLead,
  extractAttributionPayload,
  softDeleteLead,
}
