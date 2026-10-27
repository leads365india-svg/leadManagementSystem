const crypto = require("crypto")
const { Integration } = require("../models/Integration")
const { LeadSource, normalizeSource } = require("../models/LeadSource")
const { IntegrationEvent } = require("../models/IntegrationEvent")
const LeadFeedConfig = require("../models/LeadFeedConfig")
const Lead = require("../models/Lead")
const User = require("../models/User")
const Account = require("../models/Account")
const leadService = require("./leadService")
const queueService = require("./queueService")
const audit = require("./auditService")
const { hashApiKey } = require("../utils/cryptoUtils")
const { runWithTenantContext } = require("../middleware/tenantContext")

/**
 * Leads-365 CRM - Central Integration Service (Phase 11)
 * 
 * Unifies platform intake across all channels:
 * - Constant-time API key / token authentication
 * - Dual-lookup compatibility with legacy LeadFeedConfig
 * - Tenant account & integration health checks
 * - Idempotency enforcement
 * - Append-only IntegrationEvent ledger
 * - Canonical source normalization (LeadSource)
 * - Shared lead ingestion (leadService.createOrMergeLead)
 * - Event replay mechanism
 */

// Helper: Normalize domain (lowercase, strip protocols/paths/www)
const sanitizeDomain = (domain) => {
  if (!domain || typeof domain !== "string") return ""
  let d = domain.trim().toLowerCase()
  d = d.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0]
  return d
}

// Helper: Check if an email domain matches blocked domain list (exact or subdomain)
const isDomainBlocked = (email, blockedDomains = []) => {
  if (!email || !email.includes("@")) return false
  const emailDomain = email.split("@")[1].toLowerCase().trim()
  return blockedDomains.some((blocked) => {
    const cleanBlocked = sanitizeDomain(blocked)
    if (!cleanBlocked) return false
    return emailDomain === cleanBlocked || emailDomain.endsWith(`.${cleanBlocked}`)
  })
}

// Helper: Normalize phone number for validation
const normalizePhoneDigits = (phone) => {
  if (!phone || typeof phone !== "string") return ""
  return phone.replace(/[^\d+]/g, "").trim()
}

// Helper: Cryptographically verify email verification token or OTP proof using integration key
const verifyEmailToken = async (email, token, rawApiKey, tenantId, strictMode = false) => {
  if (!email || !token || typeof token !== "string" || !rawApiKey) return false
  const cleanEmail = email.toLowerCase().trim()
  const trimmedToken = token.trim()

  try {
    // 1. Timestamped HMAC token: timestamp:HMAC(rawApiKey, cleanEmail + ":" + timestamp)
    if (trimmedToken.includes(":")) {
      const parts = trimmedToken.split(":")
      if (parts.length === 2) {
        const [timestampStr, sig] = parts
        const ts = parseInt(timestampStr, 10)
        const now = Date.now()

        // Enforce strict 1-hour expiration and reject timestamps from the future (> 60s skew allowance)
        if (!isNaN(ts) && ts <= now + 60000 && now - ts < 3600000) {
          const expectedSig = crypto
            .createHmac("sha256", rawApiKey)
            .update(`${cleanEmail}:${timestampStr}`)
            .digest("hex")
          if (sig.length === expectedSig.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))) {
            // Replay protection: check if this token was already used in this tenant
            if (tenantId) {
              const tokenHash = crypto.createHash("sha256").update(trimmedToken).digest("hex")
              const replayed = await Lead.exists({
                tenantId,
                "metadata.verificationTokenHash": tokenHash,
              })
              if (replayed) {
                return false
              }
            }
            return true
          }
        }
      }
      return false
    }

    // 2. Direct HMAC token (Allowed only in non-strict mode)
    if (!strictMode) {
      const expectedDirectHash = crypto.createHmac("sha256", rawApiKey).update(cleanEmail).digest("hex")
      if (
        trimmedToken.length === expectedDirectHash.length &&
        crypto.timingSafeEqual(Buffer.from(trimmedToken), Buffer.from(expectedDirectHash))
      ) {
        if (tenantId) {
          const tokenHash = crypto.createHash("sha256").update(trimmedToken).digest("hex")
          const replayed = await Lead.exists({
            tenantId,
            "metadata.verificationTokenHash": tokenHash,
          })
          if (replayed) {
            return false
          }
        }
        return true
      }
    }
  } catch (err) {
    return false
  }

  return false
}

/**
 * Authenticates an incoming integration credential.
 * Supports dual lookup:
 * 1. Integration collection (new Phase 11 model)
 * 2. LeadFeedConfig collection (legacy website integration)
 * 
 * @param {string} rawApiKey - Plaintext API key
 * @returns {Promise<{ integration: object, tenantId: string, isLegacy: boolean }|null>}
 */
async function authenticateCredential(rawApiKey) {
  if (!rawApiKey || typeof rawApiKey !== "string") return null

  const keyHash = hashApiKey(rawApiKey)

  // 1. Check Integration collection (Phase 11 model)
  let integration = await Integration.findOne({ apiKeyHash: keyHash }).setOptions({ skipTenantFilter: true })
  if (integration) {
    if (integration.type === "website") {
      const legacyConfig = await LeadFeedConfig.findOne({ tenantId: integration.tenantId }).setOptions({ skipTenantFilter: true })
      if (legacyConfig && legacyConfig.websiteSource) {
        // If legacyConfig has rotated its key, verify incoming keyHash matches the active key!
        if (legacyConfig.websiteSource.apiKeyHash && legacyConfig.websiteSource.apiKeyHash !== keyHash) {
          integration.apiKeyHash = legacyConfig.websiteSource.apiKeyHash
          integration.apiKeyMasked = legacyConfig.websiteSource.apiKeyMasked || integration.apiKeyMasked
          await integration.save()
          return null
        }
        integration = await syncLegacyToIntegration(legacyConfig)
        return {
          integration,
          tenantId: integration.tenantId,
          isLegacy: true,
          legacyConfig,
        }
      }
    }
    return {
      integration,
      tenantId: integration.tenantId,
      isLegacy: false,
    }
  }

  // 2. Dual-lookup fallback: Check LeadFeedConfig collection (legacy website model)
  const legacyConfig = await LeadFeedConfig.findOne({
    "websiteSource.apiKeyHash": keyHash,
  }).setOptions({ skipTenantFilter: true })

  if (legacyConfig) {
    const tenantId = legacyConfig.tenantId
    // Idempotently sync legacy config into Integration model
    integration = await syncLegacyToIntegration(legacyConfig)
    return {
      integration,
      tenantId,
      isLegacy: true,
      legacyConfig,
    }
  }

  return null
}

/**
 * Idempotently synchronizes a legacy LeadFeedConfig into the Integration collection.
 * 
 * @param {object} legacyConfig 
 * @returns {Promise<object>} Synchronized Integration document
 */
async function syncLegacyToIntegration(legacyConfig) {
  if (!legacyConfig || !legacyConfig.tenantId) return null
  const tenantId = legacyConfig.tenantId
  const ws = legacyConfig.websiteSource || {}

  let integration = await Integration.findOne({
    tenantId,
    type: "website",
  }).setOptions({ skipTenantFilter: true })

  if (!integration) {
    integration = new Integration({
      tenantId,
      name: "Website Webhook",
      type: "website",
      status: ws.enabled ? "active" : "inactive",
      apiKeyHash: ws.apiKeyHash,
      apiKeyMasked: ws.apiKeyMasked || "",
      apiKeyLastRotatedAt: ws.apiKeyLastRotatedAt || new Date(),
      assignedStaffId: ws.assignedStaffId || "unassigned",
      assignedStaffName: ws.assignedStaffName || "Unassigned",
      settings: {
        acceptedForms: ws.acceptedForms || [],
        blockedDomains: ws.blockedDomains || [
          "mailinator.com",
          "tempmail.com",
          "guerrillamail.com",
          "10minutemail.com",
          "throwawaymail.com",
          "yopmail.com",
        ],
        duplicateHandling: ws.duplicateHandling || "reject",
        emailVerification: ws.emailVerification || {
          requireVerifiedEmail: false,
          holdUntilConfirmed: false,
          strictVerification: false,
          allowPhoneOnly: true,
        },
      },
      stats: ws.stats || {
        totalReceived: 0,
        totalSuccess: 0,
        totalErrors: 0,
        lastReceivedAt: null,
        lastSuccessAt: null,
        lastErrorAt: null,
        lastErrorMessage: "",
      },
    })
    await integration.save()
  } else {
    integration.status = ws.enabled ? "active" : "inactive"
    if (ws.apiKeyHash) {
      integration.apiKeyHash = ws.apiKeyHash
      integration.apiKeyMasked = ws.apiKeyMasked || integration.apiKeyMasked
    }
    if (ws.assignedStaffId) {
      integration.assignedStaffId = ws.assignedStaffId
      integration.assignedStaffName = ws.assignedStaffName || "Unassigned"
    }
    if (Array.isArray(ws.acceptedForms)) {
      integration.settings.acceptedForms = ws.acceptedForms
    }
    if (Array.isArray(ws.blockedDomains)) {
      integration.settings.blockedDomains = ws.blockedDomains
    }
    if (ws.duplicateHandling) {
      integration.settings.duplicateHandling = ws.duplicateHandling
    }
    await integration.save()
  }

  return integration
}

/**
 * Central intake pipeline for incoming webhook payloads across all platforms.
 * 
 * @param {object} params
 * @param {string} params.rawApiKey
 * @param {object} [params.headers]
 * @param {object} [params.body]
 * @param {object} [params.query]
 * @param {string} [params.ip]
 * @param {boolean} [params.async]
 * @returns {Promise<{ success: boolean, status: number, [key: string]: any }>}
 */
async function intakeWebhookPayload({ rawApiKey, headers = {}, body = {}, query = {}, ip = "unknown", async = false }) {
  // 1. Authenticate credential
  if (!rawApiKey) {
    return {
      success: false,
      status: 401,
      error: "Missing API key. Provide credential via 'x-api-key' header or 'Authorization: Bearer <key>'",
    }
  }

  const authResult = await authenticateCredential(rawApiKey)
  if (!authResult) {
    return {
      success: false,
      status: 401,
      error: "Unauthorized: Invalid or revoked integration API key",
    }
  }

  const { integration, tenantId, isLegacy, legacyConfig } = authResult

  // 2. Wrap execution in tenant ambient context
  return await runWithTenantContext({ tenantId, isSuperAdmin: false }, async () => {
    // Verify tenant account is active
    const account = await Account.findOne({ accountId: tenantId }).lean()
    if (account && account.status === "suspended") {
      return {
        success: false,
        status: 403,
        error: "Website lead integration is currently disabled: Account is suspended.",
      }
    }

    // 3. Verify integration status
    const isEnabled = integration.status === "active"
    if (!isEnabled) {
      // Update stats
      integration.stats.totalReceived = (integration.stats.totalReceived || 0) + 1
      integration.stats.totalErrors = (integration.stats.totalErrors || 0) + 1
      integration.stats.lastReceivedAt = new Date()
      integration.stats.lastErrorAt = new Date()
      integration.stats.lastErrorMessage = "Integration disabled"
      await integration.save()

      if (legacyConfig) {
        legacyConfig.websiteSource.stats = integration.stats
        await legacyConfig.save()
      }

      // Log failed event
      await IntegrationEvent.create({
        tenantId,
        integrationId: integration._id,
        integrationType: integration.type,
        headers,
        rawPayload: body,
        source: "Website",
        status: "failed",
        httpStatus: 403,
        errorMessage: "Website lead integration is currently disabled for this account",
      })

      return {
        success: false,
        status: 403,
        error: "Website lead integration is currently disabled for this account",
      }
    }

    // 4. Idempotency Check (Fast return on duplicate delivery)
    const idempotencyKey = (
      headers["x-idempotency-key"] ||
      headers["idempotency-key"] ||
      body.idempotencyKey ||
      body.submissionId ||
      ""
    ).toString().trim()

    if (idempotencyKey) {
      const existingIdempotentLead = await Lead.findOne({
        tenantId,
        "metadata.idempotencyKey": idempotencyKey,
      }).lean()

      if (existingIdempotentLead) {
        return {
          success: true,
          status: 200,
          message: "Lead already received and processed (idempotent request)",
          idempotent: true,
          data: {
            id: existingIdempotentLead._id.toString(),
            name: existingIdempotentLead.name,
            email: existingIdempotentLead.email,
            phone: existingIdempotentLead.phone,
            status: existingIdempotentLead.status,
            assignedTo: existingIdempotentLead.assignedTo,
            createdAt: existingIdempotentLead.createdAt,
          },
        }
      }
    }

    // 5. Create initial append-only IntegrationEvent ledger record
    const event = new IntegrationEvent({
      tenantId,
      integrationId: integration._id,
      integrationType: integration.type,
      idempotencyKey: idempotencyKey || null,
      headers,
      rawPayload: body,
      source: "Website",
      status: "received",
    })
    await event.save()

    // 6. Check for background queue offloading (Async mode)
    const shouldQueue =
      async === true ||
      headers["x-queue-async"] === "true" ||
      query.async === "true"

    if (shouldQueue) {
      try {
        const queuedJob = await queueService.addJob({
          name: "integration.intake",
          tenantId,
          idempotencyKey: idempotencyKey || null,
          payload: {
            eventId: event._id.toString(),
            tenantId,
            integrationId: integration._id.toString(),
            body,
            headers,
            ip,
            rawApiKey,
          },
        })

        event.status = "queued"
        event.httpStatus = 202
        await event.save()

        return {
          success: true,
          status: 202,
          queued: true,
          jobId: queuedJob.job.jobId,
          eventId: event._id.toString(),
          message: "Webhook accepted and queued for background processing",
        }
      } catch (err) {
        console.warn("Queue offload failed; falling back to synchronous intake:", err.message)
      }
    }

    // 7. Synchronous Intake Processing
    return await processIntakePayload({
      event,
      integration,
      legacyConfig,
      tenantId,
      body,
      headers,
      query,
      ip,
      rawApiKey,
      idempotencyKey,
    })
  })
}

/**
 * Executes field normalization, validation, assignment, and lead creation for an event.
 */
async function processIntakePayload({
  event,
  integration,
  legacyConfig,
  tenantId,
  body = {},
  headers = {},
  query = {},
  ip = "unknown",
  rawApiKey,
  idempotencyKey,
}) {
  try {
    // 1. Source Normalization
    const rawSource =
      body.source ||
      body.utm_source ||
      body.lead_source ||
      (integration.type === "website" ? "Website" : integration.type)
    const normalizedSource = await normalizeSource(tenantId, rawSource)
    if (event) event.source = normalizedSource

    // 2. Extract and sanitize fields (with field mapping support)
    const settings = integration.settings || {}
    let name = (
      body.name ||
      body.fullName ||
      body.full_name ||
      body.contactName ||
      "Website Lead"
    ).slice(0, 100).trim()
    let rawEmail = (body.email || body.emailAddress || body.email_address || "").toLowerCase().trim()
    let rawPhone = (body.phone || body.phoneNumber || body.phone_number || body.tel || body.mobile || "").trim()
    let message = (body.message || body.notes || body.comment || body.inquiry || "").slice(0, 2000).trim()
    let formId = (body.formId || body.form_id || body.formName || body.form_name || "").slice(0, 100).trim()
    let landingPage = (
      body.landingPage ||
      body.landing_page ||
      body.pageUrl ||
      body.page_url ||
      headers.referer ||
      ""
    ).slice(0, 500).trim()
    const isTest = Boolean(body.isTest || body.is_test || query?.isTest === "true")
    const verificationToken = (body.verificationToken || body.token || body.verification_token || "").trim()

    // Apply custom field mappings if configured
    if (Array.isArray(integration.fieldMapping) && integration.fieldMapping.length > 0) {
      for (const map of integration.fieldMapping) {
        if (!map.sourceField || !map.targetField) continue
        const val = body[map.sourceField]
        if (val !== undefined && val !== null) {
          let processedVal = String(val)
          if (map.transform === "lowercase") processedVal = processedVal.toLowerCase()
          if (map.transform === "uppercase") processedVal = processedVal.toUpperCase()
          if (map.transform === "trim") processedVal = processedVal.trim()
          if (map.transform === "phone_e164") processedVal = normalizePhoneDigits(processedVal)

          if (map.targetField === "name") name = processedVal
          if (map.targetField === "email") rawEmail = processedVal.toLowerCase()
          if (map.targetField === "phone") rawPhone = processedVal
          if (map.targetField === "message") message = processedVal
          if (map.targetField === "formId") formId = processedVal
        }
      }
    }

    // 3. Field validation
    if (rawEmail && rawEmail.length > 255) {
      if (event) {
        event.status = "failed"
        event.httpStatus = 400
        event.errorMessage = "Email address exceeds maximum length of 255 characters"
        await event.save()
      }
      return {
        success: false,
        status: 400,
        error: "Email address exceeds maximum length of 255 characters",
      }
    }

    const normalizedPhone = normalizePhoneDigits(rawPhone)
    if (rawPhone && (normalizedPhone.replace(/[^\d]/g, "").length < 5 || normalizedPhone.length > 20)) {
      if (event) {
        event.status = "failed"
        event.httpStatus = 400
        event.errorMessage = "Invalid phone number format. Must contain between 5 and 20 digits."
        await event.save()
      }
      return {
        success: false,
        status: 400,
        error: "Invalid phone number format. Must contain between 5 and 20 digits.",
      }
    }

    // 4. Accepted Forms Filtering
    const acceptedForms = settings.acceptedForms || []
    if (acceptedForms.length > 0) {
      const isFormAllowed = acceptedForms.some((allowed) => allowed.toLowerCase() === formId.toLowerCase())
      if (!isFormAllowed) {
        integration.stats.totalReceived = (integration.stats.totalReceived || 0) + 1
        integration.stats.totalErrors = (integration.stats.totalErrors || 0) + 1
        integration.stats.lastReceivedAt = new Date()
        integration.stats.lastErrorAt = new Date()
        integration.stats.lastErrorMessage = `Form '${formId || "unknown"}' rejected by form rules`
        await integration.save()

        if (event) {
          event.status = "failed"
          event.httpStatus = 422
          event.errorMessage = `Form '${formId || "unspecified"}' is not allowed for this integration`
          await event.save()
        }

        return {
          success: false,
          status: 422,
          error: `Form '${formId || "unspecified"}' is not allowed for this integration`,
        }
      }
    }

    // 5. Blocked Domains Filtering
    const blockedDomains = settings.blockedDomains || []
    if (rawEmail && isDomainBlocked(rawEmail, blockedDomains)) {
      integration.stats.totalReceived = (integration.stats.totalReceived || 0) + 1
      integration.stats.totalErrors = (integration.stats.totalErrors || 0) + 1
      integration.stats.lastReceivedAt = new Date()
      integration.stats.lastErrorAt = new Date()
      integration.stats.lastErrorMessage = "Submission rejected: Blocked email domain"
      await integration.save()

      if (event) {
        event.status = "failed"
        event.httpStatus = 422
        event.errorMessage = "Submissions from this email domain are blocked by the account policy"
        await event.save()
      }

      return {
        success: false,
        status: 422,
        error: "Submissions from this email domain are blocked by the account policy",
      }
    }

    // 6. Email & Phone Requirement / Verification Rules
    const verConfig = settings.emailVerification || {}
    if (!rawEmail) {
      if (!verConfig.allowPhoneOnly) {
        return {
          success: false,
          status: 400,
          error: "An email address is required. Phone-only leads are not allowed by account settings.",
        }
      }
      if (!rawPhone) {
        return {
          success: false,
          status: 400,
          error: "Either a valid email address or phone number must be provided.",
        }
      }
    }

    let isVerified = false
    let verificationStatus = "unverified"

    if (rawEmail) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/
      if (!emailRegex.test(rawEmail)) {
        return {
          success: false,
          status: 400,
          error: "Invalid email format",
        }
      }

      const isStrict = Boolean(verConfig.strictVerification)
      const tokenValid = await verifyEmailToken(rawEmail, verificationToken, rawApiKey, tenantId, isStrict)

      if (verConfig.strictVerification) {
        if (!tokenValid) {
          integration.stats.totalReceived = (integration.stats.totalReceived || 0) + 1
          integration.stats.totalErrors = (integration.stats.totalErrors || 0) + 1
          integration.stats.lastReceivedAt = new Date()
          integration.stats.lastErrorAt = new Date()
          integration.stats.lastErrorMessage = "Strict verification failed: Invalid or missing cryptographic token"
          await integration.save()

          if (event) {
            event.status = "failed"
            event.httpStatus = 422
            event.errorMessage = "Strict verification failed: Trusted verification token or HMAC proof is missing or invalid."
            await event.save()
          }

          return {
            success: false,
            status: 422,
            error: "Strict verification failed: Trusted verification token or HMAC proof is missing or invalid.",
          }
        }
        isVerified = true
        verificationStatus = "trusted"
      } else if (verConfig.requireVerifiedEmail) {
        if (!tokenValid) {
          integration.stats.totalReceived = (integration.stats.totalReceived || 0) + 1
          integration.stats.totalErrors = (integration.stats.totalErrors || 0) + 1
          integration.stats.lastReceivedAt = new Date()
          integration.stats.lastErrorAt = new Date()
          integration.stats.lastErrorMessage = "Email verification required: Untrusted submission rejected"
          await integration.save()

          if (event) {
            event.status = "failed"
            event.httpStatus = 422
            event.errorMessage = "Submission rejected: Only verified emails with a trusted verification token are accepted."
            await event.save()
          }

          return {
            success: false,
            status: 422,
            error: "Submission rejected: Only verified emails with a trusted verification token are accepted.",
          }
        }
        isVerified = true
        verificationStatus = "verified"
      } else {
        if (tokenValid) {
          isVerified = true
          verificationStatus = "verified"
        }
      }
    }

    let leadStatus = "New"
    if (verConfig.holdUntilConfirmed && !isVerified) {
      leadStatus = "Engaged"
      verificationStatus = "pending_confirmation"
    }

    // 7. Staff Assignment Resolution
    let assignedStaffId = "unassigned"
    let assignedTo = "Unassigned"

    if (integration.assignedStaffId && integration.assignedStaffId !== "unassigned") {
      const staffUser = await User.findOne({
        _id: integration.assignedStaffId,
        tenantId,
        status: "active",
      })

      if (staffUser) {
        assignedStaffId = staffUser._id.toString()
        assignedTo = staffUser.name
      } else {
        assignedStaffId = "unassigned"
        assignedTo = "Unassigned"
      }
    }

    // 8. Test Lead Handling
    if (isTest) {
      integration.stats.lastReceivedAt = new Date()
      integration.stats.lastSuccessAt = new Date()
      await integration.save()

      if (legacyConfig) {
        legacyConfig.websiteSource.stats = integration.stats
        await legacyConfig.save()
      }

      if (event) {
        event.status = "processed"
        event.httpStatus = 200
        event.result = { action: "test_verified", message: "Test lead processed successfully" }
        await event.save()
      }

      return {
        success: true,
        status: 200,
        message: "Test lead processed successfully. Integration pipeline verified.",
        isTest: true,
        leadPreview: {
          name,
          email: rawEmail,
          phone: normalizedPhone,
          status: leadStatus,
          assignedTo,
          tenantId,
        },
      }
    }

    // 9. Prepare Lead Metadata & Lead Creation
    const leadMetadata = {
      receivedVia: `${integration.type}_webhook`,
      submittedAt: new Date(),
      ipAddress: ip,
      idempotencyKey: idempotencyKey || null,
      verificationTokenHash: verificationToken
        ? crypto.createHash("sha256").update(verificationToken.trim()).digest("hex")
        : null,
      integrationId: integration._id,
    }

    const duplicateHandling = settings.duplicateHandling || "reject"

    const serviceResult = await leadService.createOrMergeLead({
      tenantId,
      source: normalizedSource,
      payload: {
        name,
        email: rawEmail,
        phone: rawPhone,
        status: leadStatus,
        assignedTo,
        assignedStaffId,
        ownerId: assignedStaffId && assignedStaffId !== "unassigned" ? assignedStaffId : null,
        message,
        formId,
        landingPage,
        isEmailVerified: isVerified,
        verificationStatus,
        isTest: false,
        metadata: leadMetadata,
        utm_source: body.utm_source,
        utm_medium: body.utm_medium,
        utm_campaign: body.utm_campaign,
        utm_term: body.utm_term,
        utm_content: body.utm_content,
        gclid: body.gclid,
        fbclid: body.fbclid,
        referrer: body.referrer || headers.referer,
      },
      options: {
        duplicateHandling,
      },
      actor: {
        role: "system",
        name: `Integration (${integration.name})`,
      },
    })

    // 10. Process Result
    if (serviceResult.action === "duplicate_rejected") {
      integration.stats.totalReceived = (integration.stats.totalReceived || 0) + 1
      integration.stats.totalErrors = (integration.stats.totalErrors || 0) + 1
      integration.stats.lastReceivedAt = new Date()
      integration.stats.lastErrorAt = new Date()
      integration.stats.lastErrorMessage = "Duplicate lead rejected"
      await integration.save()

      if (legacyConfig) {
        legacyConfig.websiteSource.stats = integration.stats
        await legacyConfig.save()
      }

      if (event) {
        event.status = "failed"
        event.httpStatus = 409
        event.errorMessage = "Duplicate lead detected"
        event.result = { action: "duplicate_rejected" }
        await event.save()
      }

      return {
        success: false,
        status: 409,
        duplicate: true,
        error: "Duplicate lead detected: A lead with this email or phone number already exists in this account.",
      }
    }

    // Success: Either merged or created
    integration.stats.totalReceived = (integration.stats.totalReceived || 0) + 1
    integration.stats.totalSuccess = (integration.stats.totalSuccess || 0) + 1
    integration.stats.lastReceivedAt = new Date()
    integration.stats.lastSuccessAt = new Date()
    await integration.save()

    if (legacyConfig) {
      legacyConfig.websiteSource.stats = integration.stats
      await legacyConfig.save()
    }

    if (event) {
      event.status = "processed"
      event.httpStatus = serviceResult.action === "merged" ? 200 : 201
      event.result = {
        leadId: serviceResult.lead ? serviceResult.lead._id : null,
        action: serviceResult.action,
        message:
          serviceResult.action === "merged"
            ? "Existing lead record updated successfully"
            : "Lead received and created successfully",
      }
      await event.save()
    }

    if (serviceResult.action === "merged") {
      return {
        success: true,
        status: 200,
        message: "Existing lead record updated successfully",
        leadId: serviceResult.lead._id.toString(),
        updated: true,
      }
    }

    return {
      success: true,
      status: 201,
      message: "Lead received and created successfully",
      data: {
        id: serviceResult.lead._id.toString(),
        name: serviceResult.lead.name,
        email: serviceResult.lead.email,
        phone: serviceResult.lead.phone,
        status: serviceResult.lead.status,
        assignedTo: serviceResult.lead.assignedTo,
        createdAt: serviceResult.lead.createdAt,
      },
    }
  } catch (error) {
    if (error.code === 11000 && idempotencyKey) {
      const recheckLead = await Lead.findOne({
        tenantId,
        "metadata.idempotencyKey": idempotencyKey,
      }).lean()
      if (recheckLead) {
        if (event) {
          event.status = "processed"
          event.httpStatus = 200
          event.result = { leadId: recheckLead._id, action: "idempotent" }
          await event.save()
        }
        return {
          success: true,
          status: 200,
          message: "Lead already received and processed (idempotent request)",
          idempotent: true,
          data: {
            id: recheckLead._id.toString(),
            name: recheckLead.name,
            email: recheckLead.email,
            phone: recheckLead.phone,
            status: recheckLead.status,
            assignedTo: recheckLead.assignedTo,
            createdAt: recheckLead.createdAt,
          },
        }
      }
    }

    console.error("Error processing integration lead intake:", error)
    if (event) {
      event.status = "failed"
      event.httpStatus = 500
      event.errorMessage = error.message
      event.errorStack = error.stack
      await event.save()
    }

    return {
      success: false,
      status: 500,
      error: "Internal server error while processing lead ingestion",
    }
  }
}

/**
 * Replays a past or failed integration event.
 * Preserves the original submission timestamp and tracks replay metadata.
 * 
 * @param {string} eventId 
 * @param {object} context 
 * @param {string} context.tenantId 
 * @param {object} context.actor 
 * @returns {Promise<object>} Replay result
 */
async function replayEvent(eventId, { tenantId, actor }) {
  if (!eventId || !tenantId) {
    throw new Error("Missing required eventId or tenantId for event replay")
  }

  const event = await IntegrationEvent.findOne({
    _id: eventId,
    tenantId,
  }).setOptions({ skipTenantFilter: true })

  if (!event) {
    throw new Error("Integration event not found")
  }

  // Retrieve associated integration (or fallback)
  let integration = null
  if (event.integrationId) {
    integration = await Integration.findOne({
      _id: event.integrationId,
      tenantId,
    }).setOptions({ skipTenantFilter: true })
  }
  if (!integration) {
    integration = await Integration.findOne({
      tenantId,
      type: event.integrationType || "website",
    }).setOptions({ skipTenantFilter: true })
  }

  if (!integration) {
    throw new Error("Associated integration configuration not found for replay")
  }

  // Execute intake with rawPayload
  const result = await processIntakePayload({
    event,
    integration,
    tenantId,
    body: event.rawPayload || {},
    headers: event.headers || {},
    idempotencyKey: event.idempotencyKey,
  })

  // Update replay tracking fields (never modify original createdAt)
  event.replayCount = (event.replayCount || 0) + 1
  event.lastReplayedAt = new Date()
  event.status = result.success ? "replayed" : "failed"
  if (actor) {
    event.replayedBy = {
      id: actor.id || actor._id,
      name: actor.name || "Admin",
      role: actor.role || "account_admin",
    }
  }
  await event.save()

  // Log in Audit Trail
  await audit.log({
    tenantId,
    actor: actor || { role: "account_admin", name: "Admin" },
    action: "integration.event_replay",
    entity: "integration_event",
    entityId: event._id.toString(),
    summary: `Replayed integration event #${event._id} (${event.source})`,
    details: {
      eventId: event._id.toString(),
      status: event.status,
      replayCount: event.replayCount,
      success: result.success,
    },
  })

  return {
    success: result.success,
    eventId: event._id.toString(),
    status: event.status,
    replayCount: event.replayCount,
    result,
  }
}

/**
 * Migration helper to backfill legacy LeadFeedConfig records into Integration collection.
 * 
 * @param {string} [tenantId] - Optional tenantId to scope migration
 * @returns {Promise<{ processed: number, synced: number, skipped: number }>}
 */
async function migrateLegacyLeadFeedConfig(tenantId) {
  const query = tenantId ? { tenantId } : {}
  const legacyConfigs = await LeadFeedConfig.find(query).setOptions({ skipTenantFilter: true })

  let processed = 0
  let synced = 0
  let skipped = 0

  for (const cfg of legacyConfigs) {
    processed++
    const ws = cfg.websiteSource
    if (!ws || !ws.apiKeyHash) {
      skipped++
      continue
    }

    const existing = await Integration.findOne({
      tenantId: cfg.tenantId,
      type: "website",
    }).setOptions({ skipTenantFilter: true })

    if (!existing) {
      await syncLegacyToIntegration(cfg)
      synced++
    } else {
      skipped++
    }
  }

  return { processed, synced, skipped }
}

module.exports = {
  authenticateCredential,
  intakeWebhookPayload,
  processIntakePayload,
  replayEvent,
  migrateLegacyLeadFeedConfig,
  syncLegacyToIntegration,
}
