const crypto = require("crypto")
const mongoose = require("mongoose")
const { Integration } = require("../models/Integration")
const { IntegrationEvent } = require("../models/IntegrationEvent")
const Lead = require("../models/Lead")
const User = require("../models/User")
const { normalizeSource } = require("../models/LeadSource")
const leadService = require("./leadService")
const { maskSecret } = require("../utils/cryptoUtils")

/**
 * Leads-365 CRM - IndiaMART Integration Service (Phase 13)
 * 
 * Implements:
 * - IndiaMART Lead Manager API v2 client (pull sync)
 * - Push webhook intake receiver
 * - Date formatting: 'DD-MMM-YYYY HH:mm:ss'
 * - Contact & inquiry field mapping (name, phone, email, company, city, product, message)
 * - Canonical 'IndiaMART' source attribution
 * - Inquiry idempotency via UNIQUE_QUERY_ID
 * - Incremental watermark sync cursor (lastSyncTime)
 * - Token/Key invalidation & reconnect-needed detection (codes 401, 403, 429)
 * - Safe retry & background job handling
 */

const DEFAULT_INDIAMART_API_URL = "https://mapi.indiamart.com/wservce/crm/crmListing/v2/"

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
]

/**
 * Formats a JavaScript Date into IndiaMART API string: 'DD-MMM-YYYY HH:mm:ss'
 * Example: '24-Mar-2026 10:30:00'
 */
function formatIndiaMartDate(date) {
  const d = date instanceof Date ? date : new Date(date)
  const day = String(d.getDate()).padStart(2, "0")
  const month = MONTH_NAMES[d.getMonth()]
  const year = d.getFullYear()
  const hours = String(d.getHours()).padStart(2, "0")
  const minutes = String(d.getMinutes()).padStart(2, "0")
  const seconds = String(d.getSeconds()).padStart(2, "0")
  return `${day}-${month}-${year} ${hours}:${minutes}:${seconds}`
}

/**
 * Parses IndiaMART date string ('DD-MMM-YYYY HH:mm:ss' or 'YYYY-MM-DD HH:mm:ss') into Date.
 */
function parseIndiaMartDate(str) {
  if (!str) return new Date()
  const parts = str.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/)
  if (parts) {
    const day = parseInt(parts[1], 10)
    const monthIdx = MONTH_NAMES.indexOf(parts[2])
    const year = parseInt(parts[3], 10)
    const hours = parseInt(parts[4], 10)
    const minutes = parseInt(parts[5], 10)
    const seconds = parseInt(parts[6], 10)
    if (monthIdx !== -1) {
      return new Date(year, monthIdx, day, hours, minutes, seconds)
    }
  }
  const parsed = new Date(str)
  return isNaN(parsed.getTime()) ? new Date() : parsed
}

/**
 * Executes an HTTP GET request to IndiaMART Lead Manager API v2.
 * 
 * @param {object} params
 * @param {string} params.crmKey - Decrypted IndiaMART glusr_crm_key
 * @param {Date|string} [params.startTime] - Start of query window
 * @param {Date|string} [params.endTime] - End of query window
 * @param {Function} [params.customFetch] - Injected fetch implementation for tests
 * @returns {Promise<{ code: number, status: string, message: string, totalRecords: number, records: Array }>}
 */
async function fetchIndiaMartLeads({
  crmKey,
  startTime,
  endTime,
  customFetch = null,
}) {
  if (!crmKey || typeof crmKey !== "string" || !crmKey.trim()) {
    throw new Error("Missing required IndiaMART CRM key (glusr_crm_key)")
  }

  const now = new Date()
  const start = startTime ? new Date(startTime) : new Date(now.getTime() - 24 * 60 * 60 * 1000)
  const end = endTime ? new Date(endTime) : now

  const startFormatted = formatIndiaMartDate(start)
  const endFormatted = formatIndiaMartDate(end)

  const baseUrl = process.env.INDIAMART_API_URL || DEFAULT_INDIAMART_API_URL
  const url = `${baseUrl}?glusr_crm_key=${encodeURIComponent(crmKey.trim())}&start_time=${encodeURIComponent(startFormatted)}&end_time=${encodeURIComponent(endFormatted)}`

  const fetcher = customFetch || global.fetch
  if (!fetcher) {
    throw new Error("HTTP fetch is not available in environment")
  }

  const res = await fetcher(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      "User-Agent": "Leads365-CRM/1.0",
    },
  })

  let data
  try {
    data = await res.json()
  } catch (err) {
    throw new Error(`Failed to parse IndiaMART API response: ${err.message}`)
  }

  const code = parseInt(data.CODE || res.status, 10)
  const statusStr = (data.STATUS || "").toUpperCase()
  const message = data.MESSAGE || ""

  // Handle Authentication / Plan failure
  if (code === 401 || code === 403 || statusStr.includes("UNAUTHORIZED") || message.toLowerCase().includes("invalid key") || message.toLowerCase().includes("inactive")) {
    const authErr = new Error(message || "Invalid or inactive IndiaMART CRM key")
    authErr.statusCode = code || 401
    authErr.reconnectNeeded = true
    authErr.code = "INDIAMART_AUTH_ERROR"
    throw authErr
  }

  // Handle Rate Limiting
  if (code === 429 || message.toLowerCase().includes("rate limit") || message.toLowerCase().includes("too many")) {
    const rateErr = new Error(message || "IndiaMART API rate limit exceeded")
    rateErr.statusCode = 429
    rateErr.rateLimited = true
    rateErr.code = "INDIAMART_RATE_LIMITED"
    throw rateErr
  }

  // Handle 204 or empty records
  if (code === 204 || statusStr === "NO DATA" || !Array.isArray(data.RESPONSE)) {
    return {
      code: code || 204,
      status: "SUCCESS",
      message: message || "No new enquiries found in specified window",
      totalRecords: 0,
      records: [],
    }
  }

  return {
    code: 200,
    status: "SUCCESS",
    message: message || "Enquiries retrieved successfully",
    totalRecords: parseInt(data.TOTAL_RECORDS || data.RESPONSE.length, 10),
    records: data.RESPONSE,
  }
}

/**
 * Maps a single IndiaMART inquiry object to the CRM Lead payload schema.
 * 
 * @param {object} inquiry - Raw IndiaMART inquiry item from RESPONSE array
 * @param {object} [integration] - Tenant's Integration document
 * @returns {object} Normalized CRM lead payload
 */
function mapIndiaMartInquiryToCrmPayload(inquiry = {}, integration = {}) {
  const queryId = String(inquiry.UNIQUE_QUERY_ID || inquiry.query_id || "").trim()
  const senderName = String(inquiry.SENDER_NAME || inquiry.name || "").trim() || "IndiaMART Buyer"
  const senderMobile = String(inquiry.SENDER_MOBILE || inquiry.mobile || inquiry.phone || "").trim()
  const senderEmail = String(inquiry.SENDER_EMAIL || inquiry.email || "").toLowerCase().trim()
  const senderCompany = String(inquiry.SENDER_COMPANY || inquiry.company || "").trim()
  const senderCity = String(inquiry.SENDER_CITY || inquiry.city || "").trim()
  const senderState = String(inquiry.SENDER_STATE || inquiry.state || "").trim()
  const countryIso = String(inquiry.SENDER_COUNTRY_ISO || inquiry.country_iso || "IN").trim().toUpperCase()
  const productName = String(inquiry.PRODUCT_NAME || inquiry.product || "").trim()
  const subject = String(inquiry.SUBJECT || inquiry.subject || "").trim()
  const queryMessage = String(inquiry.QUERY_MESSAGE || inquiry.message || "").trim()
  const queryType = String(inquiry.QUERY_TYPE || "W").trim().toUpperCase() // W: Web/Catalogue, P: Buy Lead, C: Call
  const queryTime = inquiry.QUERY_TIME || inquiry.query_time || new Date().toISOString()

  // Format combined customer message/notes
  const messageParts = []
  if (productName) messageParts.push(`Product: ${productName}`)
  if (subject && subject !== productName) messageParts.push(`Subject: ${subject}`)
  if (queryMessage) messageParts.push(`Requirement: ${queryMessage}`)
  if (inquiry.SENDER_ADDRESS) messageParts.push(`Address: ${inquiry.SENDER_ADDRESS}`)
  if (inquiry.CALL_DURATION) messageParts.push(`Call Duration: ${inquiry.CALL_DURATION}s`)

  // Query Type descriptive label
  const typeMap = {
    W: "Direct Catalogue Enquiry",
    P: "Verified Buy Lead",
    C: "Call Enquiry",
  }
  const typeLabel = typeMap[queryType] || `Enquiry (${queryType})`
  messageParts.push(`Type: ${typeLabel}`)

  // Apply custom fieldMapping if defined in integration
  let finalName = senderName
  if (Array.isArray(integration.fieldMapping)) {
    for (const mapping of integration.fieldMapping) {
      if (mapping.sourceField && mapping.targetField) {
        const val = inquiry[mapping.sourceField] || inquiry[mapping.sourceField.toUpperCase()]
        if (val !== undefined && mapping.targetField === "name") {
          finalName = val
        }
      }
    }
  }

  return {
    name: finalName.slice(0, 100),
    email: senderEmail,
    phone: senderMobile,
    company: senderCompany,
    city: senderCity,
    state: senderState,
    message: messageParts.join("\n").slice(0, 2000),
    utm_source: "indiamart",
    utm_medium: "b2b_marketplace",
    utm_campaign: productName || subject || "IndiaMART B2B",
    utm_content: typeLabel,
    utm_term: senderCity ? `${senderCity}_buyer` : "b2b_buyer",
    metadata: {
      indiamartQueryId: queryId,
      queryType,
      typeLabel,
      productName,
      subject,
      state: senderState,
      city: senderCity,
      countryIso,
      queryTime,
      receivedVia: "indiamart_crm_api",
    },
  }
}

/**
 * Ingests a single IndiaMART inquiry into the CRM idempotently.
 * 
 * @param {object} params
 * @param {object} params.inquiry - Raw inquiry object
 * @param {object} params.integration - Tenant Integration document
 * @param {string} params.tenantId - Tenant account ID
 * @returns {Promise<{ action: string, leadId: string, inquiryId: string }>}
 */
async function processIndiaMartInquiry({
  inquiry,
  integration,
  tenantId,
}) {
  const queryId = String(inquiry.UNIQUE_QUERY_ID || inquiry.query_id || "").trim()
  if (!queryId) {
    throw new Error("Missing UNIQUE_QUERY_ID in IndiaMART inquiry record")
  }

  const idempotencyKey = `indiamart_inquiry_${queryId}`

  // 1. Check existing event ledger for idempotency
  let event = await IntegrationEvent.findOne({
    tenantId,
    idempotencyKey,
  }).setOptions({ skipTenantFilter: true })

  if (event && event.status === "processed" && event.result?.leadId) {
    return {
      action: "skipped_duplicate",
      leadId: event.result.leadId.toString(),
      inquiryId: queryId,
    }
  }

  // Create event ledger record if not present
  if (!event) {
    event = new IntegrationEvent({
      tenantId,
      integrationId: integration._id,
      platform: "indiamart",
      source: "IndiaMART",
      direction: "inbound",
      status: "received",
      idempotencyKey,
      payload: inquiry,
      headers: { "x-source": "indiamart-api" },
    })
    await event.save()
  }

  // 2. Map payload & normalize source
  const crmPayload = mapIndiaMartInquiryToCrmPayload(inquiry, integration)
  const canonicalSource = await normalizeSource(tenantId, "IndiaMART")

  // 3. Resolve Assignment
  let assignedStaffId = integration.assignedStaffId || "unassigned"
  let assignedTo = integration.assignedStaffName || "Unassigned"

  if (assignedStaffId && assignedStaffId !== "unassigned") {
    const staffUser = await User.findOne({ _id: assignedStaffId, tenantId, status: "active" })
    if (!staffUser) {
      assignedStaffId = "unassigned"
      assignedTo = "Unassigned"
    }
  }

  // 4. Ingest via leadService
  const duplicateHandling = integration.settings?.duplicateHandling || "update"

  const serviceResult = await leadService.createOrMergeLead({
    tenantId,
    source: canonicalSource,
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
      name: `IndiaMART Ingestion (${integration.name})`,
    },
  })

  const leadId = serviceResult.lead ? (serviceResult.lead._id || serviceResult.lead.id) : null

  // 5. Update Event Ledger
  event.status = "processed"
  event.httpStatus = 200
  event.result = {
    action: serviceResult.action,
    leadId,
    timestamp: new Date(),
  }
  await event.save()

  // 6. Update Integration Stats
  integration.stats.totalReceived = (integration.stats.totalReceived || 0) + 1
  integration.stats.totalSuccess = (integration.stats.totalSuccess || 0) + 1
  integration.stats.lastReceivedAt = new Date()
  integration.stats.lastSuccessAt = new Date()
  await integration.save()

  return {
    action: serviceResult.action,
    leadId: leadId ? leadId.toString() : null,
    inquiryId: queryId,
  }
}

/**
 * Central sync runner to pull inquiries from IndiaMART Lead Manager API v2.
 * 
 * @param {string|mongoose.Types.ObjectId} integrationId - Target integration ID
 * @param {object} [options]
 * @param {number} [options.lookbackHours=24] - Hours to look back if no lastSyncTime
 * @param {Function} [options.customFetch] - Injected fetch for unit tests
 * @param {string} [options.tenantId] - Optional explicit tenant ID scope
 * @returns {Promise<object>} Sync summary
 */
async function syncIndiaMartLeads(integrationId, options = {}) {
  const query = { _id: integrationId, type: "indiamart" }
  if (options.tenantId) {
    query.tenantId = options.tenantId
  }

  const integration = await Integration.findOne(query).setOptions({ skipTenantFilter: true })
  if (!integration) {
    throw new Error(`IndiaMART integration not found for ID: ${integrationId}`)
  }

  // 1. Recover decrypted credentials
  let creds = null
  try {
    creds = integration.getDecryptedCredentials()
  } catch (err) {
    integration.status = "error"
    integration.stats.lastErrorAt = new Date()
    integration.stats.lastErrorMessage = `Decryption failure: ${err.message}`
    await integration.save()
    throw new Error(`Failed to decrypt IndiaMART credentials: ${err.message}`)
  }

  const crmKey = creds?.crmKey || creds?.glusr_crm_key
  if (!crmKey) {
    integration.status = "error"
    integration.stats.lastErrorAt = new Date()
    integration.stats.lastErrorMessage = "Missing IndiaMART glusr_crm_key in credentials"
    await integration.save()
    throw new Error("Missing IndiaMART glusr_crm_key in integration credentials")
  }

  // 2. Determine time window
  const now = new Date()
  let startTime = null

  if (options.startTime) {
    startTime = new Date(options.startTime)
  } else if (creds.lastSyncTime) {
    // Pull starting from last sync watermark with a small 2-minute safety overlap
    startTime = new Date(new Date(creds.lastSyncTime).getTime() - 2 * 60 * 1000)
  } else {
    const lookbackHours = options.lookbackHours || 24
    startTime = new Date(now.getTime() - lookbackHours * 60 * 60 * 1000)
  }

  const endTime = options.endTime ? new Date(options.endTime) : now

  // 3. Fetch from IndiaMART API
  let apiResult
  try {
    apiResult = await fetchIndiaMartLeads({
      crmKey,
      startTime,
      endTime,
      customFetch: options.customFetch,
    })
  } catch (err) {
    integration.stats.totalErrors = (integration.stats.totalErrors || 0) + 1
    integration.stats.lastErrorAt = new Date()
    integration.stats.lastErrorMessage = err.message

    if (err.reconnectNeeded) {
      integration.status = "error"
      const updatedCreds = {
        ...(creds || {}),
        reconnectNeeded: true,
        reconnectReason: err.message,
      }
      integration.setCredentials(updatedCreds)
    }

    await integration.save()
    throw err
  }

  // 4. Ingest retrieved records
  const records = apiResult.records || []
  let processedCount = 0
  let skippedCount = 0
  let failedCount = 0
  const leadResults = []

  for (const inquiry of records) {
    try {
      const res = await processIndiaMartInquiry({
        inquiry,
        integration,
        tenantId: integration.tenantId,
      })
      if (res.action === "skipped_duplicate") {
        skippedCount++
      } else {
        processedCount++
      }
      leadResults.push(res)
    } catch (ingestErr) {
      failedCount++
      console.error(`[IndiaMART] Failed to ingest inquiry ${inquiry.UNIQUE_QUERY_ID}:`, ingestErr.message)
    }
  }

  // 5. Update watermark sync cursor in credentials
  const updatedCreds = {
    ...(creds || {}),
    lastSyncTime: endTime.toISOString(),
    reconnectNeeded: false,
    reconnectReason: null,
  }
  integration.setCredentials(updatedCreds)
  integration.status = "active"
  integration.stats.lastSuccessAt = new Date()
  await integration.save()

  return {
    success: true,
    totalRecords: records.length,
    processedCount,
    skippedCount,
    failedCount,
    startTime: startTime.toISOString(),
    endTime: endTime.toISOString(),
    results: leadResults,
  }
}

module.exports = {
  DEFAULT_INDIAMART_API_URL,
  formatIndiaMartDate,
  parseIndiaMartDate,
  fetchIndiaMartLeads,
  mapIndiaMartInquiryToCrmPayload,
  processIndiaMartInquiry,
  syncIndiaMartLeads,
}
