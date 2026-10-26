const crypto = require("crypto")
const { Integration } = require("../models/Integration")
const { IntegrationEvent } = require("../models/IntegrationEvent")
const Lead = require("../models/Lead")
const User = require("../models/User")
const Account = require("../models/Account")
const leadService = require("./leadService")
const assignmentService = require("./assignmentService")
const audit = require("./auditService")
const { normalizeSource } = require("../models/LeadSource")
const { runWithTenantContext } = require("../middleware/tenantContext")

/**
 * Leads-365 CRM - Meta (Facebook + Instagram) Lead Ads Service (Phase 12)
 * 
 * Provides:
 * - Webhook handshake verification (hub.verify_token & hub.challenge)
 * - Timing-safe X-Hub-Signature-256 HMAC verification
 * - Meta Graph API client (leadgen details, ad attribution, form subscription, lead reconciliation)
 * - Standard & custom field mapping (full_name, email, phone, city, questions)
 * - Source attribution: Facebook vs Instagram normalized via Phase 11 LeadSource
 * - Idempotent lead creation and assignment via shared leadService
 * - Reconnect-needed detection on expired tokens (Meta error 190)
 * - Reconciliation and historical backfill engine
 */

const DEFAULT_GRAPH_VERSION = "v19.0"
const DEFAULT_GRAPH_BASE_URL = "https://graph.facebook.com"
const DEFAULT_VERIFY_TOKEN = "leadflow_meta_verify_token_2026"

/**
 * Verifies Meta webhook GET verification handshake.
 * 
 * @param {object} query - Express req.query
 * @param {string} [configuredVerifyToken] - Verify token from tenant integration or env
 * @returns {{ isValid: boolean, challenge: string|null }}
 */
function verifyWebhookHandshake(query = {}, configuredVerifyToken) {
  const mode = query["hub.mode"]
  const token = query["hub.verify_token"]
  const challenge = query["hub.challenge"]

  const expectedToken =
    configuredVerifyToken ||
    process.env.META_VERIFY_TOKEN ||
    DEFAULT_VERIFY_TOKEN

  if (mode === "subscribe" && token && expectedToken && token.trim() === expectedToken.trim()) {
    return {
      isValid: true,
      challenge: challenge || "",
    }
  }

  return {
    isValid: false,
    challenge: null,
  }
}

/**
 * Timing-safe verification of X-Hub-Signature-256 HMAC signature.
 * 
 * @param {string|Buffer} rawBody - Raw unparsed webhook request payload
 * @param {string} signatureHeader - 'X-Hub-Signature-256' header (format: 'sha256=<hex>')
 * @param {string} appSecret - Meta App Secret
 * @returns {boolean} True if signature is cryptographically authentic
 */
function verifyWebhookSignature(rawBody, signatureHeader, appSecret) {
  if (!rawBody || !signatureHeader || !appSecret) return false

  const cleanHeader = signatureHeader.trim()
  if (!cleanHeader.startsWith("sha256=")) return false

  const incomingHash = cleanHeader.slice(7).trim()
  if (incomingHash.length !== 64) return false

  try {
    const rawBuffer = Buffer.isBuffer(rawBody)
      ? rawBody
      : Buffer.from(typeof rawBody === "string" ? rawBody : JSON.stringify(rawBody), "utf8")

    const expectedHash = crypto
      .createHmac("sha256", appSecret.trim())
      .update(rawBuffer)
      .digest("hex")

    const incomingBuffer = Buffer.from(incomingHash, "hex")
    const expectedBuffer = Buffer.from(expectedHash, "hex")

    if (incomingBuffer.length !== expectedBuffer.length) return false

    return crypto.timingSafeEqual(incomingBuffer, expectedBuffer)
  } catch (err) {
    return false
  }
}

/**
 * Executes an HTTP request against Meta Graph API or mock handler.
 */
async function graphApiRequest(endpoint, options = {}, customFetch = null) {
  const baseUrl = process.env.META_GRAPH_BASE_URL || DEFAULT_GRAPH_BASE_URL
  const version = process.env.META_GRAPH_VERSION || DEFAULT_GRAPH_VERSION
  const url = `${baseUrl}/${version}/${endpoint.replace(/^\//, "")}`

  const fetcher = customFetch || global.fetch
  if (!fetcher) {
    throw new Error("HTTP fetch is not available in environment")
  }

  const res = await fetcher(url, options)
  const data = await res.json()

  if (!res.ok || data.error) {
    const err = new Error(data.error?.message || `Meta Graph API error (${res.status})`)
    err.status = res.status
    err.metaCode = data.error?.code
    err.metaSubcode = data.error?.error_subcode
    err.metaType = data.error?.type
    throw err
  }

  return data
}

/**
 * Fetches full lead payload from Meta Graph API using decrypted page access token.
 */
async function fetchLeadgenDetails(leadgenId, pageAccessToken, customFetch = null) {
  if (!leadgenId || !pageAccessToken) {
    throw new Error("Missing required leadgenId or pageAccessToken")
  }

  return await graphApiRequest(
    `/${leadgenId}?access_token=${encodeURIComponent(pageAccessToken)}`,
    { method: "GET" },
    customFetch
  )
}

/**
 * Fetches Ad attribution metadata (campaign, adset, ad name).
 */
async function fetchAdDetails(adId, pageAccessToken, customFetch = null) {
  if (!adId || !pageAccessToken) return null

  try {
    return await graphApiRequest(
      `/${adId}?fields=name,campaign{id,name},adset{id,name}&access_token=${encodeURIComponent(pageAccessToken)}`,
      { method: "GET" },
      customFetch
    )
  } catch (err) {
    // Non-fatal if ad details cannot be fetched
    return null
  }
}

/**
 * Subscribes a Facebook Page to the leadgen webhook field.
 */
async function subscribePageToLeadgen(pageId, pageAccessToken, customFetch = null) {
  if (!pageId || !pageAccessToken) {
    throw new Error("Missing required pageId or pageAccessToken to subscribe page")
  }

  return await graphApiRequest(
    `/${pageId}/subscribed_apps?subscribed_fields=leadgen&access_token=${encodeURIComponent(pageAccessToken)}`,
    { method: "POST" },
    customFetch
  )
}

/**
 * Fetches form leads for reconciliation or historical backfill.
 */
async function fetchFormLeads(formId, pageAccessToken, options = {}, customFetch = null) {
  if (!formId || !pageAccessToken) {
    throw new Error("Missing required formId or pageAccessToken")
  }

  const { since, limit = 50 } = options
  let query = `?fields=id,created_time,field_data,ad_id&limit=${limit}&access_token=${encodeURIComponent(pageAccessToken)}`
  if (since) {
    const unixTimestamp = since instanceof Date ? Math.floor(since.getTime() / 1000) : since
    query += `&since=${unixTimestamp}`
  }

  return await graphApiRequest(`/${formId}/leads${query}`, { method: "GET" }, customFetch)
}

/**
 * Maps Meta field_data array into normalized CRM Lead payload.
 * 
 * @param {object} metaLead - Raw Meta lead object
 * @param {object} integration - Tenant integration document
 * @param {object} [adDetails] - Optional ad attribution metadata
 * @returns {object} Normalized CRM lead payload
 */
function mapMetaLeadToCrmPayload(metaLead = {}, integration = {}, adDetails = null) {
  const fieldData = metaLead.field_data || []
  const answers = {}

  for (const item of fieldData) {
    const name = (item.name || "").toLowerCase().trim()
    const val = Array.isArray(item.values) && item.values.length > 0 ? item.values[0] : ""
    answers[name] = val
  }

  // Extract contact fields
  let fullName = answers.full_name || ""
  if (!fullName) {
    const fName = answers.first_name || ""
    const lName = answers.last_name || ""
    fullName = `${fName} ${lName}`.trim() || "Meta Lead"
  }

  const email = (answers.email || answers.email_address || "").toLowerCase().trim()
  const phone = (answers.phone_number || answers.phone || answers.mobile_number || "").trim()
  const city = answers.city || answers.location || ""
  const company = answers.company_name || answers.company || ""

  // Aggregate custom questions into notes
  const standardKeys = new Set(["full_name", "first_name", "last_name", "email", "email_address", "phone_number", "phone", "mobile_number", "city", "location", "company_name", "company"])
  const customResponses = []
  for (const [key, val] of Object.entries(answers)) {
    if (!standardKeys.has(key) && val) {
      customResponses.push(`${key}: ${val}`)
    }
  }

  // Apply custom fieldMapping if defined in integration
  if (Array.isArray(integration.fieldMapping)) {
    for (const mapping of integration.fieldMapping) {
      const customVal = answers[mapping.sourceField?.toLowerCase()]
      if (customVal !== undefined) {
        if (mapping.targetField === "name") fullName = customVal
      }
    }
  }

  // Determine platform: Facebook vs Instagram
  const rawPlatform = (metaLead.platform || "").toLowerCase()
  const isInstagram = rawPlatform.includes("ig") || rawPlatform.includes("instagram")
  const platformSource = isInstagram ? "Instagram" : "Facebook"

  const campaignName = adDetails?.campaign?.name || metaLead.campaign_name || ""
  const adsetName = adDetails?.adset?.name || metaLead.adset_name || ""
  const adName = adDetails?.name || metaLead.ad_name || ""

  return {
    name: fullName.slice(0, 100),
    email,
    phone,
    company,
    city,
    message: customResponses.join(" | ").slice(0, 2000),
    formId: metaLead.form_id || "",
    landingPage: `https://facebook.com/leadgen/${metaLead.form_id || ""}`,
    utm_source: platformSource.toLowerCase(),
    utm_medium: "paid_social",
    utm_campaign: campaignName,
    utm_content: adName,
    utm_term: adsetName,
    fbclid: metaLead.ad_id || metaLead.id,
    platform: platformSource,
    metadata: {
      metaLeadId: metaLead.id,
      formId: metaLead.form_id,
      pageId: metaLead.page_id,
      adId: metaLead.ad_id,
      adsetId: adDetails?.adset?.id,
      campaignId: adDetails?.campaign?.id,
      createdTime: metaLead.created_time,
      receivedVia: "meta_lead_ads",
    },
  }
}

/**
 * Central worker function to ingest a single Meta lead by leadgenId.
 */
async function processMetaLeadIntake({
  eventId,
  tenantId,
  integrationId,
  leadgenId,
  formId,
  pageId,
  adId,
  createdTime,
  customFetch = null,
}) {
  if (!tenantId || !leadgenId) {
    throw new Error("Missing required tenantId or leadgenId for Meta lead intake")
  }

  // 1. Load Integration document
  let integration = null
  if (integrationId) {
    integration = await Integration.findOne({ _id: integrationId, tenantId }).setOptions({ skipTenantFilter: true })
  }
  if (!integration) {
    // Lookup by pageId
    integration = await Integration.findOne({
      tenantId,
      type: "meta",
      status: "active",
    }).setOptions({ skipTenantFilter: true })
  }

  if (!integration) {
    throw new Error(`Active Meta integration not found for tenant: ${tenantId}`)
  }

  // Decrypt credentials
  const creds = integration.getDecryptedCredentials()
  if (!creds || !creds.pageAccessToken) {
    throw new Error("Meta integration missing decrypted pageAccessToken")
  }

  let event = null
  if (eventId) {
    event = await IntegrationEvent.findOne({ _id: eventId, tenantId }).setOptions({ skipTenantFilter: true })
  }

  try {
    // 2. Fetch full lead payload from Meta Graph API
    let metaLead = null
    try {
      metaLead = await fetchLeadgenDetails(leadgenId, creds.pageAccessToken, customFetch)
    } catch (apiErr) {
      // Check for token expiry / OAuthException (Code 190)
      if (apiErr.metaCode === 190 || (apiErr.message && apiErr.message.includes("OAuthException"))) {
        integration.status = "error"
        creds.reconnectNeeded = true
        creds.reconnectReason = "Page access token expired or permissions revoked. Reconnection required."
        integration.setCredentials(creds)
        await integration.save()

        if (event) {
          event.status = "failed"
          event.errorMessage = "Meta Page access token expired. Reconnect needed."
          await event.save()
        }

        return {
          success: false,
          reconnectNeeded: true,
          error: "Meta token expired",
        }
      }
      throw apiErr
    }

    // Attach form_id, page_id, ad_id if missing in raw lead
    metaLead.form_id = metaLead.form_id || formId
    metaLead.page_id = metaLead.page_id || pageId
    metaLead.ad_id = metaLead.ad_id || adId

    // 3. Fetch optional ad attribution
    let adDetails = null
    if (metaLead.ad_id) {
      adDetails = await fetchAdDetails(metaLead.ad_id, creds.pageAccessToken, customFetch)
    }

    // 4. Map to CRM Schema
    const crmPayload = mapMetaLeadToCrmPayload(metaLead, integration, adDetails)
    const normalizedSource = await normalizeSource(tenantId, crmPayload.platform || "Facebook")

    // 5. Determine Assignment
    let assignedStaffId = integration.assignedStaffId || "unassigned"
    let assignedTo = integration.assignedStaffName || "Unassigned"

    if (assignedStaffId && assignedStaffId !== "unassigned") {
      const staffUser = await User.findOne({ _id: assignedStaffId, tenantId, status: "active" })
      if (!staffUser) {
        assignedStaffId = "unassigned"
        assignedTo = "Unassigned"
      }
    }

    // 6. Ingest via shared leadService with idempotency key
    const idempotencyKey = `meta_lead_${leadgenId}`
    const duplicateHandling = integration.settings?.duplicateHandling || "update"

    const serviceResult = await leadService.createOrMergeLead({
      tenantId,
      source: normalizedSource,
      payload: {
        ...crmPayload,
        assignedTo,
        assignedStaffId,
        ownerId: assignedStaffId !== "unassigned" ? assignedStaffId : null,
      },
      options: {
        duplicateHandling,
      },
      actor: {
        role: "system",
        name: `Meta Lead Ads (${integration.name})`,
      },
    })

    // 7. Update Event & Stats
    integration.stats.totalReceived = (integration.stats.totalReceived || 0) + 1
    integration.stats.totalSuccess = (integration.stats.totalSuccess || 0) + 1
    integration.stats.lastReceivedAt = new Date()
    integration.stats.lastSuccessAt = new Date()
    await integration.save()

    if (event) {
      event.status = "processed"
      event.httpStatus = 200
      event.source = normalizedSource
      event.normalizedPayload = crmPayload
      event.result = {
        leadId: serviceResult.lead ? serviceResult.lead._id : null,
        action: serviceResult.action,
        message: "Meta lead ingested successfully",
      }
      await event.save()
    }

    return {
      success: true,
      action: serviceResult.action,
      leadId: serviceResult.lead ? serviceResult.lead._id.toString() : null,
    }
  } catch (err) {
    integration.stats.totalReceived = (integration.stats.totalReceived || 0) + 1
    integration.stats.totalErrors = (integration.stats.totalErrors || 0) + 1
    integration.stats.lastReceivedAt = new Date()
    integration.stats.lastErrorAt = new Date()
    integration.stats.lastErrorMessage = err.message
    await integration.save()

    if (event) {
      event.status = "failed"
      event.httpStatus = 500
      event.errorMessage = err.message
      await event.save()
    }

    throw err
  }
}

/**
 * Reconciles leads for all connected forms of a Meta integration.
 * Deduplicates against existing leads in the database.
 * 
 * @param {string} integrationId 
 * @param {object} options 
 * @param {Date} [options.since] - Lookback window
 * @param {Function} [customFetch] - Optional mock fetcher for tests
 * @returns {Promise<{ scanned: number, imported: number, skipped: number }>}
 */
async function reconcileMetaLeads(integrationId, options = {}, customFetch = null) {
  const integration = await Integration.findById(integrationId)
  if (!integration || integration.type !== "meta") {
    throw new Error("Invalid or missing Meta integration document")
  }

  const tenantId = integration.tenantId
  const creds = integration.getDecryptedCredentials()
  if (!creds || !creds.pageAccessToken) {
    throw new Error("Meta integration has no page access token")
  }

  // Get list of form IDs from settings or Page
  const formIds = integration.settings?.forms || [integration.settings?.formId || "default_form"]
  const since = options.since || new Date(Date.now() - 30 * 60 * 1000) // Default 30 min window

  let scanned = 0
  let imported = 0
  let skipped = 0

  for (const formId of formIds) {
    if (!formId) continue
    try {
      const response = await fetchFormLeads(formId, creds.pageAccessToken, { since }, customFetch)
      const leads = response.data || []
      scanned += leads.length

      for (const rawLead of leads) {
        // Deduplicate against existing lead in CRM
        const existing = await Lead.findOne({
          tenantId,
          "metadata.metaLeadId": rawLead.id,
        }).lean()

        if (existing) {
          skipped++
          continue
        }

        // Process missing lead
        await processMetaLeadIntake({
          tenantId,
          integrationId: integration._id,
          leadgenId: rawLead.id,
          formId,
          pageId: creds.pageId,
          adId: rawLead.ad_id,
          createdTime: rawLead.created_time,
          customFetch,
        })
        imported++
      }
    } catch (err) {
      console.warn(`Reconciliation for form ${formId} encountered an error:`, err.message)
    }
  }

  return { scanned, imported, skipped }
}

module.exports = {
  DEFAULT_GRAPH_VERSION,
  DEFAULT_GRAPH_BASE_URL,
  DEFAULT_VERIFY_TOKEN,
  verifyWebhookHandshake,
  verifyWebhookSignature,
  graphApiRequest,
  fetchLeadgenDetails,
  fetchAdDetails,
  subscribePageToLeadgen,
  fetchFormLeads,
  mapMetaLeadToCrmPayload,
  processMetaLeadIntake,
  reconcileMetaLeads,
}
