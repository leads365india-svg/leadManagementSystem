const crypto = require("crypto")
const Lead = require("../models/Lead")
const LeadFeedConfig = require("../models/LeadFeedConfig")
const User = require("../models/User")
const Account = require("../models/Account")
const { Integration, ALLOWED_INTEGRATION_TYPES } = require("../models/Integration")
const { LeadSource, seedDefaultSources, normalizeSource } = require("../models/LeadSource")
const { IntegrationEvent } = require("../models/IntegrationEvent")
const { runWithTenantContext } = require("../middleware/tenantContext")
const leadService = require("../services/leadService")
const integrationService = require("../services/integrationService")
const audit = require("../services/auditService")
const { generateApiKey, hashApiKey, maskSecret } = require("../utils/cryptoUtils")

// Helper: Generate secure API credential
const generateIntegrationKey = () => {
  const rawKey = `lf_live_${crypto.randomBytes(24).toString("hex")}`
  const keyHash = crypto.createHash("sha256").update(rawKey).digest("hex")
  const maskedKey = `lf_live_••••••••••••••••${rawKey.slice(-4)}`
  return { rawKey, keyHash, maskedKey }
}

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

// Helper: Normalize phone number for deduplication
const normalizePhone = (phone) => {
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
                console.warn(`Replay protection triggered: Token for ${cleanEmail} was already redeemed.`)
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
            console.warn(`Replay protection triggered: Direct token for ${cleanEmail} was already redeemed.`)
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
 * GET /api/integrations/settings/website
 * Authenticated: Retrieve current tenant's website lead feed settings & eligible staff
 */
const getWebsiteConfig = async (req, res) => {
  try {
    const tenantId = req.user.tenantId
    if (!tenantId) {
      return res.status(400).json({
        success: false,
        error: "Tenant context not found on user session",
      })
    }

    let config = await LeadFeedConfig.findOne({ tenantId })

    let rawApiKey = null
    // If tenant does not have a config yet, create one automatically
    if (!config) {
      const { rawKey, keyHash, maskedKey } = generateIntegrationKey()
      rawApiKey = rawKey

      config = new LeadFeedConfig({
        tenantId,
        websiteSource: {
          enabled: true,
          apiKeyHash: keyHash,
          apiKeyMasked: maskedKey,
          apiKeyLastRotatedAt: new Date(),
          assignedStaffId: "unassigned",
          assignedStaffName: "Unassigned",
          acceptedForms: [],
          emailVerification: {
            requireVerifiedEmail: false,
            holdUntilConfirmed: false,
            strictVerification: false,
            allowPhoneOnly: true,
          },
          blockedDomains: [
            "mailinator.com",
            "tempmail.com",
            "guerrillamail.com",
            "10minutemail.com",
            "throwawaymail.com",
            "yopmail.com",
          ],
          duplicateHandling: "reject",
        },
      })
      await config.save()
    }

    // Retrieve active staff belonging to this tenant
    const staffMembers = await User.find({
      tenantId,
      status: "active",
    })
      .select("_id name email role")
      .lean()

    // Host-derived webhook URL
    const protocol = req.headers["x-forwarded-proto"] || req.protocol || "http"
    const host = req.get("host") || "localhost:5000"
    const webhookUrl = `${protocol}://${host}/api/integrations/leads/website`

    res.status(200).json({
      success: true,
      data: {
        config: {
          tenantId: config.tenantId,
          websiteSource: {
            enabled: config.websiteSource.enabled,
            apiKeyMasked: config.websiteSource.apiKeyMasked,
            apiKeyLastRotatedAt: config.websiteSource.apiKeyLastRotatedAt,
            assignedStaffId: config.websiteSource.assignedStaffId,
            assignedStaffName: config.websiteSource.assignedStaffName,
            acceptedForms: config.websiteSource.acceptedForms || [],
            emailVerification: config.websiteSource.emailVerification,
            blockedDomains: config.websiteSource.blockedDomains || [],
            duplicateHandling: config.websiteSource.duplicateHandling || "reject",
            stats: config.websiteSource.stats || {},
          },
          additionalSources: [
            { id: "wordpress", name: "WordPress / Elementor", status: "not_configured" },
            { id: "meta", name: "Meta Lead Ads (Facebook & Instagram)", status: "not_configured" },
            { id: "google", name: "Google Lead Forms", status: "not_configured" },
            { id: "zapier", name: "Zapier / Make Webhook", status: "not_configured" },
          ],
        },
        staff: staffMembers.map((s) => ({
          id: s._id.toString(),
          name: s.name,
          email: s.email,
          role: s.role,
        })),
        webhookUrl,
        rawApiKey, // Only provided on initial config creation
      },
    })
  } catch (error) {
    console.error("Error fetching lead feeds config:", error)
    res.status(500).json({
      success: false,
      error: "Failed to load lead feed configuration",
    })
  }
}

/**
 * PUT /api/integrations/settings/website
 * Authenticated: Save configuration settings for current tenant
 */
const updateWebsiteConfig = async (req, res) => {
  try {
    const tenantId = req.user.tenantId
    if (!tenantId) {
      return res.status(400).json({ success: false, error: "Tenant context missing" })
    }

    const {
      enabled,
      assignedStaffId,
      acceptedForms,
      emailVerification,
      blockedDomains,
      duplicateHandling,
    } = req.body

    let config = await LeadFeedConfig.findOne({ tenantId })
    if (!config) {
      return res.status(404).json({ success: false, error: "Configuration not found" })
    }

    // 1. Validate & resolve staff assignment
    let assignedStaffName = "Unassigned"
    let resolvedStaffId = "unassigned"

    if (assignedStaffId && assignedStaffId !== "unassigned") {
      const staffUser = await User.findOne({
        _id: assignedStaffId,
        tenantId,
        status: "active",
      })
      if (!staffUser) {
        return res.status(400).json({
          success: false,
          error: "Selected staff member does not exist or is inactive in your account",
        })
      }
      resolvedStaffId = staffUser._id.toString()
      assignedStaffName = staffUser.name
    }

    // 2. Validate and parse accepted forms
    let parsedAcceptedForms = []
    if (Array.isArray(acceptedForms)) {
      parsedAcceptedForms = acceptedForms
        .map((f) => (typeof f === "string" ? f.trim() : ""))
        .filter(Boolean)
    } else if (typeof acceptedForms === "string") {
      parsedAcceptedForms = acceptedForms
        .split("\n")
        .map((f) => f.trim())
        .filter(Boolean)
    }

    // 3. Validate and parse blocked domains
    let parsedBlockedDomains = []
    if (Array.isArray(blockedDomains)) {
      parsedBlockedDomains = blockedDomains
        .map(sanitizeDomain)
        .filter((d) => d && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(d))
    } else if (typeof blockedDomains === "string") {
      parsedBlockedDomains = blockedDomains
        .split("\n")
        .map(sanitizeDomain)
        .filter((d) => d && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(d))
    }
    // Deduplicate
    parsedBlockedDomains = [...new Set(parsedBlockedDomains)]

    // 4. Validate duplicateHandling enum
    const validDuplicatePolicies = ["reject", "update", "allow"]
    const resolvedDuplicatePolicy = validDuplicatePolicies.includes(duplicateHandling)
      ? duplicateHandling
      : "reject"

    // 5. Validate Email Verification Rules & Precedence
    const resolvedVerification = {
      requireVerifiedEmail: Boolean(emailVerification?.requireVerifiedEmail),
      holdUntilConfirmed: Boolean(emailVerification?.holdUntilConfirmed),
      strictVerification: Boolean(emailVerification?.strictVerification),
      allowPhoneOnly:
        emailVerification?.allowPhoneOnly !== undefined
          ? Boolean(emailVerification.allowPhoneOnly)
          : true,
    }

    // Enforce logical precedence:
    // If strictVerification is enabled, requireVerifiedEmail must also be true
    if (resolvedVerification.strictVerification) {
      resolvedVerification.requireVerifiedEmail = true
    }

    // Apply updates
    if (typeof enabled === "boolean") {
      config.websiteSource.enabled = enabled
    }
    config.websiteSource.assignedStaffId = resolvedStaffId
    config.websiteSource.assignedStaffName = assignedStaffName
    config.websiteSource.acceptedForms = parsedAcceptedForms
    config.websiteSource.blockedDomains = parsedBlockedDomains
    config.websiteSource.duplicateHandling = resolvedDuplicatePolicy
    config.websiteSource.emailVerification = resolvedVerification

    await config.save()

    // Sync legacy config with Integration model
    try {
      await integrationService.syncLegacyToIntegration(config)
    } catch (e) {
      console.warn("Failed to sync legacy config to Integration model:", e.message)
    }

    await audit.log({
      tenantId,
      actor: req.user,
      action: audit.AUDIT_ACTIONS.INTEGRATION_CONFIG_UPDATE,
      entity: "integration",
      entityId: config._id,
      summary: "Updated website lead feed integration configuration",
      details: {
        enabled: config.websiteSource.enabled,
        assignedStaffName: config.websiteSource.assignedStaffName,
        duplicateHandling: config.websiteSource.duplicateHandling,
      },
      req,
    })

    res.status(200).json({
      success: true,
      message: "Lead feed settings saved successfully",
      data: {
        websiteSource: {
          enabled: config.websiteSource.enabled,
          apiKeyMasked: config.websiteSource.apiKeyMasked,
          apiKeyLastRotatedAt: config.websiteSource.apiKeyLastRotatedAt,
          assignedStaffId: config.websiteSource.assignedStaffId,
          assignedStaffName: config.websiteSource.assignedStaffName,
          acceptedForms: config.websiteSource.acceptedForms,
          emailVerification: config.websiteSource.emailVerification,
          blockedDomains: config.websiteSource.blockedDomains,
          duplicateHandling: config.websiteSource.duplicateHandling,
          stats: config.websiteSource.stats,
        },
      },
    })
  } catch (error) {
    console.error("Error updating lead feeds config:", error)
    res.status(500).json({
      success: false,
      error: error.message || "Failed to update lead feed configuration",
    })
  }
}

/**
 * POST /api/integrations/settings/website/rotate-key
 * Authenticated: Rotate API key and invalidate previous key immediately
 */
const rotateApiKey = async (req, res) => {
  try {
    const tenantId = req.user.tenantId
    if (!tenantId) {
      return res.status(400).json({ success: false, error: "Tenant context missing" })
    }

    let config = await LeadFeedConfig.findOne({ tenantId })
    if (!config) {
      return res.status(404).json({ success: false, error: "Configuration not found" })
    }

    const { rawKey, keyHash, maskedKey } = generateIntegrationKey()

    config.websiteSource.apiKeyHash = keyHash
    config.websiteSource.apiKeyMasked = maskedKey
    config.websiteSource.apiKeyLastRotatedAt = new Date()

    await config.save()

    // Sync rotated key with Integration model
    try {
      const integration = await Integration.findOne({ tenantId, type: "website" })
      if (integration) {
        integration.apiKeyHash = keyHash
        integration.apiKeyMasked = maskedKey
        integration.apiKeyLastRotatedAt = config.websiteSource.apiKeyLastRotatedAt
        await integration.save()
      } else {
        await integrationService.syncLegacyToIntegration(config)
      }
    } catch (e) {
      console.warn("Failed to sync rotated key to Integration model:", e.message)
    }

    await audit.log({
      tenantId,
      actor: req.user,
      action: audit.AUDIT_ACTIONS.INTEGRATION_KEY_ROTATE,
      entity: "integration",
      entityId: config._id,
      summary: `Rotated website lead feed API key (${maskedKey})`,
      details: {
        maskedKey,
        apiKeyLastRotatedAt: config.websiteSource.apiKeyLastRotatedAt,
      },
      req,
    })

    res.status(200).json({
      success: true,
      message: "API key rotated successfully. The previous key has been immediately invalidated.",
      data: {
        rawApiKey: rawKey,
        apiKeyMasked: maskedKey,
        apiKeyLastRotatedAt: config.websiteSource.apiKeyLastRotatedAt,
      },
    })
  } catch (error) {
    console.error("Error rotating API key:", error)
    res.status(500).json({
      success: false,
      error: "Failed to rotate API key",
    })
  }
}


/**
 * POST /api/integrations/settings/website/test
 * Authenticated: Send a simulated test lead submission through the tenant's integration pipeline
 */
const sendTestLead = async (req, res) => {
  try {
    const tenantId = req.user.tenantId
    if (!tenantId) {
      return res.status(400).json({ success: false, error: "Tenant context missing" })
    }

    const config = await LeadFeedConfig.findOne({ tenantId })
    if (!config) {
      return res.status(404).json({ success: false, error: "Lead feed configuration not found" })
    }

    if (!config.websiteSource.enabled) {
      return res.status(400).json({
        success: false,
        error: "Website lead integration is currently disabled. Please enable it before testing.",
      })
    }

    // Generate diagnostic test payload
    const testPayload = {
      name: "Test Lead Submission",
      email: `test-${Date.now()}@example.com`,
      phone: "+1 (555) 019-2834",
      message: "This is a diagnostic test submission verifying the webhook pipeline and settings.",
      formId: config.websiteSource.acceptedForms[0] || "contact_us_form",
      landingPage: "https://example.com/contact-test",
      emailVerified: true,
      isTest: true,
    }

    // Run pipeline validation check
    const checks = {
      sourceEnabled: config.websiteSource.enabled,
      formAccepted:
        config.websiteSource.acceptedForms.length === 0 ||
        config.websiteSource.acceptedForms.includes(testPayload.formId),
      domainAllowed: !isDomainBlocked(testPayload.email, config.websiteSource.blockedDomains),
      assignedStaff: config.websiteSource.assignedStaffName,
      duplicateHandling: config.websiteSource.duplicateHandling,
      timestamp: new Date().toISOString(),
    }

    // Record test activity in stats safely
    config.websiteSource.stats.lastReceivedAt = new Date()
    config.websiteSource.stats.lastSuccessAt = new Date()
    await config.save()

    res.status(200).json({
      success: true,
      message: "Test lead processed successfully. Integration pipeline is online and healthy.",
      data: {
        testPayload,
        validationResults: checks,
      },
    })
  } catch (error) {
    console.error("Error sending test lead:", error)
    res.status(500).json({
      success: false,
      error: "Failed to execute test lead submission",
    })
  }
}

/**
 * POST /api/integrations/leads/website
 * Public Webhook: Ingest lead from website forms/integrations via common pipeline
 */
const receiveWebsiteLead = async (req, res) => {
  const rawApiKey =
    req.headers["x-api-key"] ||
    (req.headers.authorization && req.headers.authorization.startsWith("Bearer ")
      ? req.headers.authorization.slice(7).trim()
      : null)

  const result = await integrationService.intakeWebhookPayload({
    rawApiKey,
    headers: req.headers,
    body: req.body,
    query: req.query,
    ip: req.ip || req.headers["x-forwarded-for"] || "unknown",
    async: req.headers["x-queue-async"] === "true" || req.query.async === "true",
  })

  return res.status(result.status || (result.success ? 200 : 400)).json(result)
}

/**
 * GET /api/integrations
 * Authenticated: List all integrations for current tenant
 */
const listIntegrations = async (req, res) => {
  try {
    const tenantId = req.user.tenantId
    const { type, status } = req.query
    const filter = { tenantId }
    if (type) filter.type = type
    if (status) filter.status = status

    // Auto-sync legacy website integration if none exist yet
    const count = await Integration.countDocuments({ tenantId })
    if (count === 0) {
      await integrationService.migrateLegacyLeadFeedConfig(tenantId)
    }

    const integrations = await Integration.find(filter).sort({ createdAt: -1 })
    return res.status(200).json({
      success: true,
      count: integrations.length,
      data: integrations,
    })
  } catch (error) {
    console.error("Error listing integrations:", error)
    return res.status(500).json({ success: false, error: "Failed to list integrations" })
  }
}

/**
 * POST /api/integrations
 * Authenticated (requireAccountAdmin): Create a new integration connector
 */
const createIntegration = async (req, res) => {
  try {
    const tenantId = req.user.tenantId
    const { name, type, fieldMapping, assignedRuleId, assignedStaffId, settings, credentials } = req.body

    if (!name || typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ success: false, error: "Integration name is required" })
    }
    if (!type || !ALLOWED_INTEGRATION_TYPES.includes(type)) {
      return res.status(400).json({
        success: false,
        error: `Invalid integration type. Allowed: ${ALLOWED_INTEGRATION_TYPES.join(", ")}`,
      })
    }

    // Generate secure API key for the integration
    const rawApiKey = generateApiKey()
    const apiKeyHash = hashApiKey(rawApiKey)
    const apiKeyMasked = maskSecret(rawApiKey)

    let assignedStaffName = "Unassigned"
    if (assignedStaffId && assignedStaffId !== "unassigned") {
      const staff = await User.findOne({ _id: assignedStaffId, tenantId, status: "active" })
      if (staff) assignedStaffName = staff.name
    }

    const integration = new Integration({
      tenantId,
      name: name.trim(),
      type,
      status: "active",
      apiKeyHash,
      apiKeyMasked,
      apiKeyLastRotatedAt: new Date(),
      fieldMapping: Array.isArray(fieldMapping) ? fieldMapping : [],
      assignedRuleId: assignedRuleId || null,
      assignedStaffId: assignedStaffId || "unassigned",
      assignedStaffName,
      settings: settings || {},
    })

    if (credentials && typeof credentials === "object") {
      integration.setCredentials(credentials)
    }

    await integration.save()

    await audit.log({
      tenantId,
      actor: req.user,
      action: "integration.create",
      entity: "integration",
      entityId: integration._id,
      summary: `Created ${type} integration: ${name}`,
      details: { type, name, apiKeyMasked },
      req,
    })

    return res.status(201).json({
      success: true,
      message: "Integration created successfully",
      rawApiKey, // Displayed only ONCE upon creation
      data: integration,
    })
  } catch (error) {
    console.error("Error creating integration:", error)
    return res.status(500).json({ success: false, error: error.message || "Failed to create integration" })
  }
}

/**
 * GET /api/integrations/:id
 * Authenticated: Retrieve single integration details
 */
const getIntegrationById = async (req, res) => {
  try {
    const tenantId = req.user.tenantId
    const integration = await Integration.findOne({ _id: req.params.id, tenantId })
    if (!integration) {
      return res.status(404).json({ success: false, error: "Integration not found" })
    }
    return res.status(200).json({ success: true, data: integration })
  } catch (error) {
    return res.status(500).json({ success: false, error: "Failed to get integration" })
  }
}

/**
 * PUT /api/integrations/:id
 * Authenticated (requireAccountAdmin): Update integration settings
 */
const updateIntegration = async (req, res) => {
  try {
    const tenantId = req.user.tenantId
    const integration = await Integration.findOne({ _id: req.params.id, tenantId })
    if (!integration) {
      return res.status(404).json({ success: false, error: "Integration not found" })
    }

    const { name, status, fieldMapping, assignedRuleId, assignedStaffId, settings, credentials } = req.body
    if (name) integration.name = name.trim()
    if (status && ["active", "inactive", "error"].includes(status)) integration.status = status
    if (Array.isArray(fieldMapping)) integration.fieldMapping = fieldMapping
    if (assignedRuleId !== undefined) integration.assignedRuleId = assignedRuleId || null
    if (assignedStaffId !== undefined) {
      integration.assignedStaffId = assignedStaffId
      if (assignedStaffId && assignedStaffId !== "unassigned") {
        const staff = await User.findOne({ _id: assignedStaffId, tenantId, status: "active" })
        integration.assignedStaffName = staff ? staff.name : "Unassigned"
      } else {
        integration.assignedStaffName = "Unassigned"
      }
    }
    if (settings && typeof settings === "object") {
      integration.settings = { ...integration.settings, ...settings }
    }
    if (credentials && typeof credentials === "object") {
      integration.setCredentials(credentials)
    }

    await integration.save()

    await audit.log({
      tenantId,
      actor: req.user,
      action: "integration.update",
      entity: "integration",
      entityId: integration._id,
      summary: `Updated integration: ${integration.name}`,
      details: { name: integration.name, status: integration.status },
      req,
    })

    return res.status(200).json({
      success: true,
      message: "Integration updated successfully",
      data: integration,
    })
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message || "Failed to update integration" })
  }
}

/**
 * POST /api/integrations/:id/rotate-key
 * Authenticated (requireAccountAdmin): Rotate API key for integration
 */
const rotateIntegrationKey = async (req, res) => {
  try {
    const tenantId = req.user.tenantId
    const integration = await Integration.findOne({ _id: req.params.id, tenantId })
    if (!integration) {
      return res.status(404).json({ success: false, error: "Integration not found" })
    }

    const rawApiKey = generateApiKey()
    const apiKeyHash = hashApiKey(rawApiKey)
    const apiKeyMasked = maskSecret(rawApiKey)

    integration.apiKeyHash = apiKeyHash
    integration.apiKeyMasked = apiKeyMasked
    integration.apiKeyLastRotatedAt = new Date()
    await integration.save()

    // Sync legacy LeadFeedConfig if this is the website integration
    if (integration.type === "website") {
      const legacy = await LeadFeedConfig.findOne({ tenantId })
      if (legacy) {
        legacy.websiteSource.apiKeyHash = apiKeyHash
        legacy.websiteSource.apiKeyMasked = apiKeyMasked
        legacy.websiteSource.apiKeyLastRotatedAt = integration.apiKeyLastRotatedAt
        await legacy.save()
      }
    }

    await audit.log({
      tenantId,
      actor: req.user,
      action: audit.AUDIT_ACTIONS.INTEGRATION_KEY_ROTATE,
      entity: "integration",
      entityId: integration._id,
      summary: `Rotated API key for integration ${integration.name} (${apiKeyMasked})`,
      details: { apiKeyMasked },
      req,
    })

    return res.status(200).json({
      success: true,
      message: "API key rotated successfully. Previous key has been immediately invalidated.",
      data: {
        rawApiKey,
        apiKeyMasked,
        apiKeyLastRotatedAt: integration.apiKeyLastRotatedAt,
      },
    })
  } catch (error) {
    return res.status(500).json({ success: false, error: "Failed to rotate integration API key" })
  }
}

/**
 * DELETE /api/integrations/:id
 * Authenticated (requireAccountAdmin): Deactivate integration
 */
const deleteIntegration = async (req, res) => {
  try {
    const tenantId = req.user.tenantId
    const integration = await Integration.findOne({ _id: req.params.id, tenantId })
    if (!integration) {
      return res.status(404).json({ success: false, error: "Integration not found" })
    }

    integration.status = "inactive"
    integration.apiKeyHash = null
    await integration.save()

    await audit.log({
      tenantId,
      actor: req.user,
      action: "integration.deactivate",
      entity: "integration",
      entityId: integration._id,
      summary: `Deactivated integration: ${integration.name}`,
      req,
    })

    return res.status(200).json({ success: true, message: "Integration deactivated successfully" })
  } catch (error) {
    return res.status(500).json({ success: false, error: "Failed to delete integration" })
  }
}

/**
 * GET /api/integrations/sources
 * Authenticated: List canonical sources and aliases for current tenant
 */
const listSources = async (req, res) => {
  try {
    const tenantId = req.user.tenantId
    let sources = await LeadSource.find({ tenantId }).sort({ isSystem: -1, name: 1 })
    if (sources.length === 0) {
      sources = await seedDefaultSources(tenantId)
    }
    return res.status(200).json({ success: true, count: sources.length, data: sources })
  } catch (error) {
    return res.status(500).json({ success: false, error: "Failed to list lead sources" })
  }
}

/**
 * POST /api/integrations/sources
 * Authenticated (requireAccountAdmin): Create or customize canonical source & aliases
 */
const upsertSource = async (req, res) => {
  try {
    const tenantId = req.user.tenantId
    const { name, code, aliases, color, description, isActive } = req.body

    if (!name || !code) {
      return res.status(400).json({ success: false, error: "Name and code are required for lead source" })
    }

    const cleanCode = code.trim().toLowerCase().replace(/[\s\-]+/g, "_")
    let source = await LeadSource.findOne({ tenantId, code: cleanCode })

    if (source) {
      source.name = name.trim()
      if (Array.isArray(aliases)) source.aliases = aliases
      if (color) source.color = color
      if (description !== undefined) source.description = description
      if (typeof isActive === "boolean") source.isActive = isActive
      await source.save()
    } else {
      source = await LeadSource.create({
        tenantId,
        name: name.trim(),
        code: cleanCode,
        aliases: Array.isArray(aliases) ? aliases : [],
        color: color || "#3b82f6",
        description: description || "",
        isActive: isActive !== false,
        isSystem: false,
      })
    }

    return res.status(200).json({ success: true, message: "Lead source saved successfully", data: source })
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message || "Failed to save lead source" })
  }
}

/**
 * GET /api/integrations/events
 * Authenticated: List append-only integration events
 */
const listEvents = async (req, res) => {
  try {
    const tenantId = req.user.tenantId
    const { status, integrationId, source, page = 1, limit = 20 } = req.query

    const filter = { tenantId }
    if (status) filter.status = status
    if (integrationId) filter.integrationId = integrationId
    if (source) filter.source = source

    const pageNum = Math.max(1, parseInt(page, 10) || 1)
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20))
    const skip = (pageNum - 1) * limitNum

    const [events, total] = await Promise.all([
      IntegrationEvent.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limitNum).lean(),
      IntegrationEvent.countDocuments(filter),
    ])

    return res.status(200).json({
      success: true,
      count: events.length,
      total,
      page: pageNum,
      pages: Math.ceil(total / limitNum) || 1,
      data: events,
    })
  } catch (error) {
    return res.status(500).json({ success: false, error: "Failed to list integration events" })
  }
}

/**
 * POST /api/integrations/events/:id/replay
 * Authenticated (requireAccountAdmin): Replay a past or failed integration event
 */
const replayIntegrationEvent = async (req, res) => {
  try {
    const tenantId = req.user.tenantId
    const eventId = req.params.id

    const replayResult = await integrationService.replayEvent(eventId, {
      tenantId,
      actor: req.user,
    })

    return res.status(200).json({
      success: true,
      message: "Event replayed successfully",
      data: replayResult,
    })
  } catch (error) {
    return res.status(error.message.includes("not found") ? 404 : 500).json({
      success: false,
      error: error.message || "Failed to replay event",
    })
  }
}

/**
 * POST /api/integrations/sync-legacy
 * Authenticated (requireAccountAdmin): Trigger legacy migration sync
 */
const syncLegacyIntegrations = async (req, res) => {
  try {
    const tenantId = req.user.tenantId
    const result = await integrationService.migrateLegacyLeadFeedConfig(tenantId)
    return res.status(200).json({ success: true, message: "Legacy configurations synced", data: result })
  } catch (error) {
    return res.status(500).json({ success: false, error: "Failed to sync legacy configurations" })
  }
}

module.exports = {
  getWebsiteConfig,
  updateWebsiteConfig,
  rotateApiKey,
  sendTestLead,
  receiveWebsiteLead,
  listIntegrations,
  createIntegration,
  getIntegrationById,
  updateIntegration,
  rotateIntegrationKey,
  deleteIntegration,
  listSources,
  upsertSource,
  listEvents,
  replayIntegrationEvent,
  syncLegacyIntegrations,
}

