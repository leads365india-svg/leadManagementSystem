const crypto = require("crypto")
const mongoose = require("mongoose")
const { Integration } = require("../models/Integration")
const { IntegrationEvent } = require("../models/IntegrationEvent")
const LeadFeedConfig = require("../models/LeadFeedConfig")
const Lead = require("../models/Lead")
const User = require("../models/User")
const Account = require("../models/Account")
const { normalizeSource } = require("../models/LeadSource")
const { runWithTenantContext } = require("../middleware/tenantContext")
const leadService = require("./leadService")
const { hashApiKey, maskSecret } = require("../utils/cryptoUtils")

/**
 * Leads-365 CRM - Generic Connector Service (Phase 24)
 * 
 * Ingestion engine for Zapier, Make.com, n8n, Pabbly Connect, and generic webhooks:
 * - Flexible payload key normalization (first/last name, phones, emails, UTMs, custom data)
 * - Per-tenant API key management with SHA-256 hash lookup and AES credential encryption
 * - Constant-time API key verification
 * - Seamless integration with unified leadService (dedupe, assignment, attribution)
 * - Multi-touch attribution preservation (firstTouch vs lastTouch)
 * - Idempotency handling on provider event_id / lead_id / idempotencyKey
 * - Duplicate handling policies ("update" inquiry note append vs "reject" fail-closed)
 * - Append-only IntegrationEvent audit ledger logging
 */

/**
 * Generates a secure API key for the Generic Connector.
 */
function generateGenericApiKey() {
  const rawKey = `gen_live_${crypto.randomBytes(24).toString("hex")}`
  const keyHash = hashApiKey(rawKey)
  const maskedKey = `gen_live_••••••••••••${rawKey.slice(-4)}`
  return { rawKey, keyHash, maskedKey }
}

/**
 * Constant-time comparison between incoming key and expected key.
 */
function verifyGenericApiKey(incomingKey, expectedKey) {
  if (!incomingKey || !expectedKey) return false
  if (typeof incomingKey !== "string" || typeof expectedKey !== "string") return false

  const incomingBuf = Buffer.from(incomingKey.trim())
  const expectedBuf = Buffer.from(expectedKey.trim())

  if (incomingBuf.length !== expectedBuf.length) {
    crypto.timingSafeEqual(incomingBuf, incomingBuf)
    return false
  }

  return crypto.timingSafeEqual(incomingBuf, expectedBuf)
}

/**
 * Flexible payload normalizer for Zapier, Make, n8n, and custom webhooks.
 * Supports various common field naming schemes.
 * 
 * @param {object} payload 
 * @param {Array} [fieldMappings] - Optional custom field mappings configured on integration
 * @returns {object} Normalized lead fields
 */
function normalizeGenericPayload(payload = {}, fieldMappings = []) {
  if (!payload || typeof payload !== "object") return {}

  // 1. Apply custom field mappings if defined
  const mappedPayload = { ...payload }
  if (Array.isArray(fieldMappings) && fieldMappings.length > 0) {
    for (const mapping of fieldMappings) {
      if (mapping.sourceField && mapping.targetField && payload[mapping.sourceField] !== undefined) {
        let val = payload[mapping.sourceField]
        if (mapping.transform === "lowercase" && typeof val === "string") val = val.toLowerCase()
        if (mapping.transform === "uppercase" && typeof val === "string") val = val.toUpperCase()
        if (mapping.transform === "trim" && typeof val === "string") val = val.trim()
        mappedPayload[mapping.targetField] = val
      }
    }
  }

  // 2. Name extraction
  let name = ""
  if (mappedPayload.name) name = String(mappedPayload.name).trim()
  else if (mappedPayload.fullName || mappedPayload.full_name) name = String(mappedPayload.fullName || mappedPayload.full_name).trim()
  else if (mappedPayload.lead_name || mappedPayload.leadName) name = String(mappedPayload.lead_name || mappedPayload.leadName).trim()
  else {
    const first = String(mappedPayload.first_name || mappedPayload.firstName || "").trim()
    const last = String(mappedPayload.last_name || mappedPayload.lastName || "").trim()
    if (first || last) {
      name = `${first} ${last}`.trim()
    }
  }

  // 3. Email extraction
  let email = ""
  const rawEmail =
    mappedPayload.email ||
    mappedPayload.email_address ||
    mappedPayload.emailAddress ||
    mappedPayload.work_email ||
    mappedPayload.workEmail ||
    ""
  if (rawEmail) {
    email = String(rawEmail).toLowerCase().trim()
  }

  // 4. Phone extraction
  let phone = ""
  const rawPhone =
    mappedPayload.phone ||
    mappedPayload.phone_number ||
    mappedPayload.phoneNumber ||
    mappedPayload.mobile ||
    mappedPayload.mobile_number ||
    mappedPayload.tel ||
    mappedPayload.cell ||
    ""
  if (rawPhone) {
    phone = String(rawPhone).trim()
  }

  // 5. Company / Organization extraction
  let company = ""
  const rawCompany =
    mappedPayload.company ||
    mappedPayload.company_name ||
    mappedPayload.companyName ||
    mappedPayload.organization ||
    mappedPayload.org ||
    ""
  if (rawCompany) {
    company = String(rawCompany).trim()
  }

  // 6. City / Location extraction
  let city = ""
  const rawCity = mappedPayload.city || mappedPayload.location || mappedPayload.town || ""
  if (rawCity) {
    city = String(rawCity).trim()
  }

  // 7. Message / Query extraction
  let message = ""
  const rawMessage =
    mappedPayload.message ||
    mappedPayload.notes ||
    mappedPayload.query ||
    mappedPayload.description ||
    mappedPayload.comment ||
    mappedPayload.comments ||
    ""
  if (rawMessage) {
    message = String(rawMessage).trim()
  }

  // 8. Source detection (defaults to "Zapier" or "Generic Connector")
  let source = "Zapier"
  const rawSource =
    mappedPayload.source ||
    mappedPayload.lead_source ||
    mappedPayload.leadSource ||
    mappedPayload.platform ||
    mappedPayload.utm_source ||
    ""
  if (rawSource) {
    source = String(rawSource).trim()
  }

  // 9. Attribution Touch extraction
  const utm_source = String(mappedPayload.utm_source || source || "").toLowerCase().trim()
  const utm_medium = String(mappedPayload.utm_medium || mappedPayload.medium || "webhook").toLowerCase().trim()
  const utm_campaign = String(mappedPayload.utm_campaign || mappedPayload.campaign || "").trim()
  const utm_term = String(mappedPayload.utm_term || mappedPayload.term || "").trim()
  const utm_content = String(mappedPayload.utm_content || mappedPayload.content || "").trim()
  const gclid = String(mappedPayload.gclid || mappedPayload.gcl_id || "").trim()
  const fbclid = String(mappedPayload.fbclid || "").trim()
  const campaignId = String(mappedPayload.campaign_id || mappedPayload.campaignId || "").trim()
  const adId = String(mappedPayload.ad_id || mappedPayload.adId || "").trim()

  // 10. Idempotency Key / Provider Lead ID
  const idempotencyKey = String(
    mappedPayload.idempotency_key ||
    mappedPayload.idempotencyKey ||
    mappedPayload.event_id ||
    mappedPayload.eventId ||
    mappedPayload.lead_id ||
    mappedPayload.leadId ||
    mappedPayload.id ||
    ""
  ).trim()

  // 11. Custom & Extra Fields Collection
  const knownKeys = new Set([
    "name", "fullName", "full_name", "first_name", "firstName", "last_name", "lastName", "lead_name", "leadName",
    "email", "email_address", "emailAddress", "work_email", "workEmail",
    "phone", "phone_number", "phoneNumber", "mobile", "mobile_number", "tel", "cell",
    "company", "company_name", "companyName", "organization", "org",
    "city", "location", "town",
    "message", "notes", "query", "description", "comment", "comments",
    "source", "lead_source", "leadSource", "platform",
    "utm_source", "utm_medium", "utm_campaign", "campaign", "utm_term", "term", "utm_content", "content",
    "gclid", "gcl_id", "fbclid", "campaign_id", "campaignId", "ad_id", "adId",
    "idempotency_key", "idempotencyKey", "event_id", "eventId", "lead_id", "leadId", "id",
    "api_key", "apiKey", "key",
  ])

  const customFields = {}
  const extraDetails = []
  for (const [k, v] of Object.entries(mappedPayload)) {
    if (!knownKeys.has(k) && v !== undefined && v !== null && v !== "") {
      const stringVal = typeof v === "object" ? JSON.stringify(v) : String(v)
      customFields[k] = v
      extraDetails.push(`${k}: ${stringVal}`)
    }
  }

  if (extraDetails.length > 0) {
    const extraBlock = extraDetails.join("\n")
    message = message ? `${message}\n\nAdditional Details:\n${extraBlock}` : extraBlock
  }

  return {
    name: name || "Generic Inbound Lead",
    email,
    phone,
    company,
    city,
    message,
    source,
    utm_source: utm_source || "generic",
    utm_medium,
    utm_campaign,
    utm_term,
    utm_content,
    gclid,
    fbclid,
    campaignId,
    adId,
    idempotencyKey,
    customFields,
  }
}

/**
 * Main ingestion processor for generic incoming leads.
 * 
 * @param {object} params
 * @param {object} params.payload - Parsed incoming payload
 * @param {object} params.integration - Verified Integration document
 * @param {string} params.tenantId - Resolved tenant context
 * @param {object} [params.headers] - Request headers
 * @param {string} [params.ip] - Request IP
 * @returns {Promise<{ success: boolean, status: number, action?: string, leadId?: string, error?: string }>}
 */
async function processGenericLead({
  payload = {},
  integration,
  tenantId,
  headers = {},
  ip = "unknown",
}) {
  if (!tenantId) {
    return { success: false, status: 400, error: "Missing required tenant context" }
  }

  return await runWithTenantContext({ tenantId, isSuperAdmin: false }, async () => {
    // 1. Verify tenant account status
    const account = await Account.findOne({ accountId: tenantId }).lean()
    if (account && account.status === "suspended") {
      return {
        success: false,
        status: 403,
        error: "Generic connector is currently disabled: Account is suspended.",
      }
    }

    // 2. Normalize payload
    const fieldMappings = integration?.fieldMapping || []
    const normalized = normalizeGenericPayload(payload, fieldMappings)
    const { idempotencyKey } = normalized

    // 3. Contact information validation (require email or phone)
    if (!normalized.email && !normalized.phone) {
      return {
        success: false,
        status: 400,
        error: "Lead submission must include at least an email address or phone number",
      }
    }

    // 4. Idempotency Check
    if (idempotencyKey) {
      const existingLead = await Lead.findOne({
        tenantId,
        $or: [
          { "metadata.providerLeadId": idempotencyKey },
          { "metadata.idempotencyKey": idempotencyKey },
        ],
      }).lean()

      if (existingLead) {
        return {
          success: true,
          status: 200,
          idempotent: true,
          action: "idempotent_duplicate_skipped",
          message: "Lead already received and processed (idempotent request)",
          leadId: existingLead._id.toString(),
        }
      }
    }

    // 5. Append-only IntegrationEvent ledger record
    const event = new IntegrationEvent({
      tenantId,
      integrationId: integration?._id || null,
      integrationType: "generic",
      idempotencyKey: idempotencyKey || null,
      headers,
      rawPayload: payload,
      source: normalized.source || "Generic Connector",
      status: "received",
    })
    await event.save()

    // 6. Resolve Staff Assignment
    let assignedStaffId = "unassigned"
    let assignedTo = "Unassigned"

    const targetStaffId = integration?.assignedStaffId
    if (targetStaffId && targetStaffId !== "unassigned") {
      const staffUser = await User.findOne({
        _id: targetStaffId,
        tenantId,
        status: "active",
      })
      if (staffUser) {
        assignedStaffId = staffUser._id.toString()
        assignedTo = staffUser.name
      }
    }

    // 7. Canonical source normalization
    const canonicalSource = await normalizeSource(tenantId, normalized.source || "Zapier")

    // 8. Lead Metadata
    const leadMetadata = {
      receivedVia: "generic_webhook",
      providerLeadId: idempotencyKey || null,
      idempotencyKey: idempotencyKey || null,
      submittedAt: new Date(),
      ipAddress: ip,
      integrationId: integration?._id || null,
      customFields: normalized.customFields,
    }

    const duplicateHandling = integration?.settings?.duplicateHandling || "update"

    // 9. Unified lead creation via leadService
    const serviceResult = await leadService.createOrMergeLead({
      tenantId,
      source: canonicalSource,
      payload: {
        name: normalized.name,
        email: normalized.email,
        phone: normalized.phone,
        company: normalized.company,
        city: normalized.city,
        message: normalized.message,
        gclid: normalized.gclid,
        fbclid: normalized.fbclid,
        campaignId: normalized.campaignId,
        adId: normalized.adId,
        utm_source: normalized.utm_source,
        utm_medium: normalized.utm_medium,
        utm_campaign: normalized.utm_campaign,
        utm_term: normalized.utm_term,
        utm_content: normalized.utm_content,
        landingPage: "Generic Webhook Intake",
        referrer: headers["referer"] || headers["origin"] || "Webhook Connector",
        assignedTo,
        assignedStaffId,
        ownerId: assignedStaffId !== "unassigned" ? assignedStaffId : null,
        metadata: leadMetadata,
        isTest: false,
      },
      options: {
        duplicateHandling,
      },
      actor: {
        role: "system",
        name: "Generic Connector Webhook",
      },
    })

    // 10. Update integration statistics
    if (integration) {
      integration.stats.totalReceived = (integration.stats.totalReceived || 0) + 1
      if (serviceResult.action === "duplicate_rejected") {
        integration.stats.totalErrors = (integration.stats.totalErrors || 0) + 1
        integration.stats.lastErrorAt = new Date()
        integration.stats.lastErrorMessage = "Duplicate lead rejected"
      } else {
        integration.stats.totalSuccess = (integration.stats.totalSuccess || 0) + 1
        integration.stats.lastSuccessAt = new Date()
      }
      integration.stats.lastReceivedAt = new Date()
      await integration.save()
    }

    // 11. Update ledger event
    event.status = serviceResult.action === "duplicate_rejected" ? "failed" : "processed"
    event.httpStatus = serviceResult.action === "duplicate_rejected" ? 409 : 200
    event.result = {
      action: serviceResult.action,
      leadId: serviceResult.lead?._id,
      message:
        serviceResult.action === "merged"
          ? "Existing lead record updated with new inquiry note"
          : "Generic webhook lead ingested successfully",
    }
    await event.save()

    if (serviceResult.action === "duplicate_rejected") {
      return {
        success: false,
        status: 409,
        duplicate: true,
        error: "Duplicate lead detected: A lead with this email or phone number already exists in this account.",
      }
    }

    return {
      success: true,
      status: 200,
      action: serviceResult.action,
      leadId: serviceResult.lead?._id ? serviceResult.lead._id.toString() : null,
      message:
        serviceResult.action === "merged"
          ? "Existing lead record updated with new inquiry note"
          : "Lead ingested successfully via Generic Connector",
    }
  })
}

/**
 * Gets or creates the tenant's Generic Integration document.
 */
async function getOrCreateGenericIntegration(tenantId) {
  let integration = await Integration.findOne({
    tenantId,
    type: "generic",
  })

  if (!integration) {
    const keyData = generateGenericApiKey()
    integration = new Integration({
      tenantId,
      type: "generic",
      name: "Generic Connector (Zapier, Make, n8n)",
      status: "active",
      apiKeyHash: keyData.keyHash,
      apiKeyMasked: keyData.maskedKey,
      apiKeyLastRotatedAt: new Date(),
      settings: {
        duplicateHandling: "update",
        rateLimitPerMinute: 60,
      },
      stats: {
        totalReceived: 0,
        totalSuccess: 0,
        totalErrors: 0,
      },
    })
    integration.setCredentials({ apiKey: keyData.rawKey, apiKeyMasked: keyData.maskedKey })
    await integration.save()
    return { integration, rawKey: keyData.rawKey }
  }

  return { integration, rawKey: null }
}

/**
 * Rotates the API key for the tenant's Generic Connector.
 */
async function rotateGenericApiKey(tenantId) {
  const { integration } = await getOrCreateGenericIntegration(tenantId)
  const keyData = generateGenericApiKey()

  integration.apiKeyHash = keyData.keyHash
  integration.apiKeyMasked = keyData.maskedKey
  integration.apiKeyLastRotatedAt = new Date()
  integration.setCredentials({ apiKey: keyData.rawKey, apiKeyMasked: keyData.maskedKey })
  await integration.save()

  return {
    rawKey: keyData.rawKey,
    maskedKey: keyData.maskedKey,
    rotatedAt: integration.apiKeyLastRotatedAt,
  }
}

module.exports = {
  generateGenericApiKey,
  verifyGenericApiKey,
  normalizeGenericPayload,
  processGenericLead,
  getOrCreateGenericIntegration,
  rotateGenericApiKey,
}
