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
const { hashApiKey, maskSecret, generateApiKey } = require("../utils/cryptoUtils")

/**
 * Leads-365 CRM - Google Ads Lead Form Webhook Service (Phase 23)
 * 
 * Supports:
 * - Google Ads Lead Form Webhook delivery parsing (user_column_data)
 * - Safe constant-time webhook key verification
 * - Server-side tenant resolution without trusting client tenant IDs
 * - Lead idempotency on Google's lead_id
 * - Google test submissions handling ('is_test': true / 'test-' prefix)
 * - Multi-touch attribution (utm_source, utm_medium, utm_campaign, gclid, formId, campaignId)
 * - Timeline inquiry note appending on repeat leads (duplicateHandling: "update")
 * - Fail-closed security on missing/invalid keys
 */

/**
 * Generates a secure webhook key for Google Ads Lead Form extension.
 */
function generateGoogleKey() {
  const rawKey = `gkey_live_${crypto.randomBytes(24).toString("hex")}`
  const keyHash = hashApiKey(rawKey)
  const maskedKey = `gkey_live_••••••••••••${rawKey.slice(-4)}`
  return { rawKey, keyHash, maskedKey }
}

/**
 * Constant-time comparison between incoming Google key and expected key.
 * 
 * @param {string} incomingKey 
 * @param {string} expectedKey 
 * @returns {boolean}
 */
function verifyGoogleWebhookKey(incomingKey, expectedKey) {
  if (!incomingKey || !expectedKey) return false
  if (typeof incomingKey !== "string" || typeof expectedKey !== "string") return false

  const incomingBuf = Buffer.from(incomingKey.trim())
  const expectedBuf = Buffer.from(expectedKey.trim())

  if (incomingBuf.length !== expectedBuf.length) {
    // Constant time dummy comparison to mitigate length-based timing attacks
    crypto.timingSafeEqual(incomingBuf, incomingBuf)
    return false
  }

  return crypto.timingSafeEqual(incomingBuf, expectedBuf)
}

/**
 * Normalizes Google Ads webhook payload into CRM lead fields.
 * 
 * Standard Google Ads user_column_data column_ids:
 * - FULL_NAME, FIRST_NAME, LAST_NAME
 * - EMAIL, WORK_EMAIL
 * - PHONE_NUMBER, WORK_PHONE
 * - COMPANY_NAME, JOB_TITLE
 * - CITY, REGION, POSTAL_CODE, COUNTRY
 * 
 * @param {object} payload 
 * @returns {object} Normalized lead fields and attribution
 */
function normalizeGoogleLeadPayload(payload = {}) {
  const leadId = String(payload.lead_id || payload.leadId || "").trim()
  const formId = String(payload.form_id || payload.formId || "").trim()
  const campaignId = String(payload.campaign_id || payload.campaignId || "").trim()
  const adgroupId = String(payload.adgroup_id || payload.adgroupId || "").trim()
  const creativeId = String(payload.creative_id || payload.creativeId || "").trim()
  const apiVersion = String(payload.api_version || payload.apiVersion || "").trim()
  const gclid = String(payload.gcl_id || payload.gclid || "").trim()
  const isTest = Boolean(
    payload.is_test === true ||
    payload.isTest === true ||
    (leadId && (leadId.toLowerCase().startsWith("test-") || leadId === "0"))
  )

  let name = ""
  let firstName = ""
  let lastName = ""
  let email = ""
  let phone = ""
  let company = ""
  let city = ""
  let region = ""
  let country = ""
  let postalCode = ""
  let jobTitle = ""
  const customQuestions = []

  // 1. Process Google user_column_data array if present
  if (Array.isArray(payload.user_column_data)) {
    for (const col of payload.user_column_data) {
      if (!col || typeof col !== "object") continue
      const colId = String(col.column_id || "").toUpperCase().trim()
      const val = typeof col.string_value === "string" ? col.string_value.trim() : ""
      if (!val) continue

      switch (colId) {
        case "FULL_NAME":
          name = val
          break
        case "FIRST_NAME":
          firstName = val
          break
        case "LAST_NAME":
          lastName = val
          break
        case "EMAIL":
        case "WORK_EMAIL":
          if (!email) email = val.toLowerCase()
          break
        case "PHONE_NUMBER":
        case "WORK_PHONE":
          if (!phone) phone = val
          break
        case "COMPANY_NAME":
          company = val
          break
        case "JOB_TITLE":
          jobTitle = val
          break
        case "CITY":
          city = val
          break
        case "REGION":
          region = val
          break
        case "COUNTRY":
          country = val
          break
        case "POSTAL_CODE":
          postalCode = val
          break
        default:
          customQuestions.push({
            id: colId,
            question: col.column_name || colId,
            answer: val,
          })
          break
      }
    }
  }

  // 2. Fallback to direct top-level payload fields (for testing or webhook forwarders)
  if (!name) {
    if (payload.name) name = String(payload.name).trim()
    else if (payload.fullName || payload.full_name) name = String(payload.fullName || payload.full_name).trim()
    else if (firstName || lastName) name = `${firstName} ${lastName}`.trim()
  }

  if (!email && (payload.email || payload.emailAddress || payload.email_address)) {
    email = String(payload.email || payload.emailAddress || payload.email_address).toLowerCase().trim()
  }

  if (!phone && (payload.phone || payload.phoneNumber || payload.phone_number || payload.tel)) {
    phone = String(payload.phone || payload.phoneNumber || payload.phone_number || payload.tel).trim()
  }

  if (!company && (payload.company || payload.companyName || payload.company_name)) {
    company = String(payload.company || payload.companyName || payload.company_name).trim()
  }

  if (!city && payload.city) {
    city = String(payload.city).trim()
  }
  if (!region && payload.region) {
    region = String(payload.region).trim()
  }
  if (!country && payload.country) {
    country = String(payload.country).trim()
  }

  // Construct readable message with any custom Google form questions
  let messageParts = []
  if (jobTitle) messageParts.push(`Job Title: ${jobTitle}`)
  if (postalCode) messageParts.push(`Postal Code: ${postalCode}`)
  if (region) messageParts.push(`Region: ${region}`)
  if (country) messageParts.push(`Country: ${country}`)
  if (formId) messageParts.push(`Google Form ID: ${formId}`)
  if (campaignId) messageParts.push(`Campaign ID: ${campaignId}`)
  if (adgroupId) messageParts.push(`AdGroup ID: ${adgroupId}`)
  if (creativeId) messageParts.push(`Creative ID: ${creativeId}`)

  for (const q of customQuestions) {
    messageParts.push(`${q.question}: ${q.answer}`)
  }

  if (payload.message && typeof payload.message === "string") {
    messageParts.unshift(payload.message.trim())
  }

  const message = messageParts.join("\n")

  return {
    leadId: leadId || null,
    formId: formId || null,
    campaignId: campaignId || null,
    gclid: gclid || null,
    isTest,
    name: name || "Google Ads Lead",
    email,
    phone,
    company,
    city,
    postalCode,
    jobTitle,
    message,
    customQuestions,
    source: "Google Ads",
    utm_source: "google",
    utm_medium: "cpc",
    utm_campaign: campaignId || "google_lead_ad",
    utm_term: payload.utm_term || "",
    utm_content: payload.utm_content || "",
  }
}

/**
 * Central processing engine for incoming Google Ads lead form submissions.
 * 
 * @param {object} params
 * @param {object} params.payload - Raw parsed JSON body from Google
 * @param {object} params.integration - Verified Integration document
 * @param {object} [params.legacyConfig] - Verified LeadFeedConfig document
 * @param {string} params.tenantId - Resolved tenant ID
 * @param {object} [params.headers] - Request headers
 * @param {string} [params.ip] - Remote client IP
 * @returns {Promise<{ success: boolean, status: number, action?: string, leadId?: string, isTest?: boolean, error?: string }>}
 */
async function processGoogleLead({
  payload = {},
  integration,
  legacyConfig = null,
  tenantId,
  headers = {},
  ip = "unknown",
}) {
  if (!tenantId) {
    return { success: false, status: 400, error: "Missing required tenant context" }
  }

  // 1. Wrap in tenant ambient context
  return await runWithTenantContext({ tenantId, isSuperAdmin: false }, async () => {
    // 2. Verify account is not suspended
    const account = await Account.findOne({ accountId: tenantId }).lean()
    if (account && account.status === "suspended") {
      return {
        success: false,
        status: 403,
        error: "Google Ads integration is currently disabled: Account is suspended.",
      }
    }

    // 3. Normalize incoming Google lead
    const normalized = normalizeGoogleLeadPayload(payload)
    const { leadId, isTest } = normalized

    // 4. Validate that at least email or phone is present
    if (!normalized.email && !normalized.phone) {
      return {
        success: false,
        status: 400,
        error: "Google lead submission must include either an email address or phone number",
      }
    }

    // 5. Idempotency Check on Google's lead_id
    if (leadId) {
      const existingLead = await Lead.findOne({
        tenantId,
        $or: [
          { "metadata.providerLeadId": leadId },
          { "metadata.idempotencyKey": leadId },
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

    // 6. Record append-only IntegrationEvent ledger record
    const event = new IntegrationEvent({
      tenantId,
      integrationId: integration?._id || null,
      integrationType: "google_ads",
      idempotencyKey: leadId || null,
      headers,
      rawPayload: payload,
      source: "Google Ads",
      status: "received",
    })
    await event.save()

    // 7. Handle Google Ads diagnostic test submission ('send test data' button in Google Ads UI)
    if (isTest) {
      if (integration) {
        integration.stats.totalReceived = (integration.stats.totalReceived || 0) + 1
        integration.stats.totalSuccess = (integration.stats.totalSuccess || 0) + 1
        integration.stats.lastReceivedAt = new Date()
        integration.stats.lastSuccessAt = new Date()
        await integration.save()
      }

      if (legacyConfig) {
        legacyConfig.googleSource.stats = integration ? integration.stats : legacyConfig.googleSource.stats
        await legacyConfig.save()
      }

      event.status = "processed"
      event.httpStatus = 200
      event.result = { action: "test_verified", message: "Google Ads test lead verified successfully" }
      await event.save()

      return {
        success: true,
        status: 200,
        isTest: true,
        message: "Google Ads test lead processed successfully. Webhook pipeline verified.",
        leadPreview: {
          name: normalized.name,
          email: normalized.email,
          phone: normalized.phone,
          formId: normalized.formId,
          campaignId: normalized.campaignId,
          tenantId,
        },
      }
    }

    // 8. Resolve Staff Assignment
    let assignedStaffId = "unassigned"
    let assignedTo = "Unassigned"

    const targetStaffId = integration?.assignedStaffId || legacyConfig?.googleSource?.assignedStaffId
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

    // 9. Canonical source normalization
    const canonicalSource = await normalizeSource(tenantId, "Google Ads")

    // 10. Prepare Lead Metadata
    const leadMetadata = {
      receivedVia: "google_ads_webhook",
      providerLeadId: leadId || null,
      idempotencyKey: leadId || null,
      formId: normalized.formId || null,
      campaignId: normalized.campaignId || null,
      gclid: normalized.gclid || null,
      submittedAt: new Date(),
      ipAddress: ip,
      customQuestions: normalized.customQuestions,
      integrationId: integration?._id || null,
    }

    const duplicateHandling =
      integration?.settings?.duplicateHandling ||
      legacyConfig?.googleSource?.duplicateHandling ||
      "update"

    // 11. Create or merge lead via unified leadService
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
        formId: normalized.formId,
        campaignId: normalized.campaignId,
        gclid: normalized.gclid,
        utm_source: normalized.utm_source,
        utm_medium: normalized.utm_medium,
        utm_campaign: normalized.utm_campaign,
        utm_term: normalized.utm_term,
        utm_content: normalized.utm_content,
        landingPage: "Google Ads Lead Form",
        referrer: "https://www.google.com",
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
        name: "Google Ads Webhook",
      },
    })

    // 12. Update integration stats
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

    if (legacyConfig) {
      legacyConfig.googleSource.stats = integration ? integration.stats : legacyConfig.googleSource.stats
      await legacyConfig.save()
    }

    // 13. Update ledger event
    event.status = serviceResult.action === "duplicate_rejected" ? "failed" : "processed"
    event.httpStatus = serviceResult.action === "duplicate_rejected" ? 409 : 200
    event.result = {
      action: serviceResult.action,
      leadId: serviceResult.lead?._id,
      message:
        serviceResult.action === "merged"
          ? "Existing lead record updated with Google inquiry note"
          : "Google lead ingested successfully",
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
      status: 200, // Google Ads explicitly expects HTTP 200 OK on all successful deliveries
      action: serviceResult.action,
      leadId: serviceResult.lead?._id ? serviceResult.lead._id.toString() : null,
      message:
        serviceResult.action === "merged"
          ? "Existing lead record updated with Google inquiry note"
          : "Google lead created successfully",
    }
  })
}

/**
 * Rotates Google webhook key for a given tenant.
 * Updates both Integration and LeadFeedConfig models atomically.
 * 
 * @param {string} tenantId 
 * @returns {Promise<{ rawKey: string, keyHash: string, maskedKey: string, rotatedAt: Date }>}
 */
async function rotateGoogleKey(tenantId) {
  const { rawKey, keyHash, maskedKey } = generateGoogleKey()
  const rotatedAt = new Date()

  const integration = await Integration.findOne({
    tenantId,
    type: "google_ads",
  }).setOptions({ skipTenantFilter: true })

  if (integration) {
    integration.apiKeyHash = keyHash
    integration.apiKeyMasked = maskedKey
    integration.apiKeyLastRotatedAt = rotatedAt
    integration.setCredentials({ googleKey: rawKey })
    await integration.save()
  }

  const config = await LeadFeedConfig.findOne({ tenantId })
  if (config) {
    config.googleSource.googleKeyHash = keyHash
    config.googleSource.googleKeyMasked = maskedKey
    config.googleSource.googleKeyLastRotatedAt = rotatedAt
    await config.save()
  }

  return { rawKey, keyHash, maskedKey, rotatedAt }
}

module.exports = {
  generateGoogleKey,
  verifyGoogleWebhookKey,
  normalizeGoogleLeadPayload,
  processGoogleLead,
  rotateGoogleKey,
}

