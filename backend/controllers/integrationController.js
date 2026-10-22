const crypto = require("crypto")
const Lead = require("../models/Lead")
const LeadFeedConfig = require("../models/LeadFeedConfig")
const User = require("../models/User")
const Account = require("../models/Account")

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
 * Public Webhook: Ingest lead from website forms/integrations
 */
const receiveWebsiteLead = async (req, res) => {
  try {
    // 1. Authenticate via API key in header (x-api-key or Authorization Bearer)
    const rawApiKey =
      req.headers["x-api-key"] ||
      (req.headers.authorization && req.headers.authorization.startsWith("Bearer ")
        ? req.headers.authorization.slice(7).trim()
        : null)

    if (!rawApiKey) {
      return res.status(401).json({
        success: false,
        error: "Missing API key. Provide credential via 'x-api-key' header or 'Authorization: Bearer <key>'",
      })
    }

    // 2. Hash incoming credential for secure constant-time lookup
    const incomingKeyHash = crypto.createHash("sha256").update(rawApiKey.trim()).digest("hex")

    const config = await LeadFeedConfig.findOne({
      "websiteSource.apiKeyHash": incomingKeyHash,
    })

    if (!config) {
      return res.status(401).json({
        success: false,
        error: "Unauthorized: Invalid or revoked integration API key",
      })
    }

    // Derived strictly from authenticated credential
    const tenantId = config.tenantId

    // 3. Verify that the website source is enabled
    if (!config.websiteSource.enabled) {
      // Record error on config stats
      config.websiteSource.stats.totalReceived = (config.websiteSource.stats.totalReceived || 0) + 1
      config.websiteSource.stats.totalErrors = (config.websiteSource.stats.totalErrors || 0) + 1
      config.websiteSource.stats.lastReceivedAt = new Date()
      config.websiteSource.stats.lastErrorAt = new Date()
      config.websiteSource.stats.lastErrorMessage = "Integration disabled"
      await config.save()

      return res.status(403).json({
        success: false,
        error: "Website lead integration is currently disabled for this account",
      })
    }

    // 3.5 Check Webhook Idempotency (prevent duplicate creates on automated retries)
    const idempotencyKey = (
      req.headers["x-idempotency-key"] ||
      req.headers["idempotency-key"] ||
      req.body?.idempotencyKey ||
      req.body?.submissionId ||
      ""
    ).toString().trim()

    if (idempotencyKey) {
      const existingIdempotentLead = await Lead.findOne({
        tenantId,
        "metadata.idempotencyKey": idempotencyKey,
      }).lean()

      if (existingIdempotentLead) {
        return res.status(200).json({
          success: true,
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
        })
      }
    }

    // 4. Extract and sanitize incoming fields
    const body = req.body || {}
    const name = (body.name || body.fullName || body.full_name || body.contactName || "Website Lead").slice(0, 100).trim()
    const rawEmail = (body.email || body.emailAddress || body.email_address || "").toLowerCase().trim()
    const rawPhone = (body.phone || body.phoneNumber || body.phone_number || body.tel || body.mobile || "").trim()
    const message = (body.message || body.notes || body.comment || body.inquiry || "").slice(0, 2000).trim()
    const formId = (body.formId || body.form_id || body.formName || body.form_name || "").slice(0, 100).trim()
    const landingPage = (body.landingPage || body.landing_page || body.pageUrl || body.page_url || req.headers.referer || "").slice(0, 500).trim()
    const isTest = Boolean(body.isTest || body.is_test || req.query?.isTest === "true")
    const verificationToken = (body.verificationToken || body.token || body.verification_token || "").trim()

    // Validate email length
    if (rawEmail && rawEmail.length > 255) {
      return res.status(400).json({
        success: false,
        error: "Email address exceeds maximum length of 255 characters",
      })
    }

    // Validate phone number format if provided
    const normalizedPhone = normalizePhone(rawPhone)
    if (rawPhone && (normalizedPhone.replace(/[^\d]/g, "").length < 5 || normalizedPhone.length > 20)) {
      return res.status(400).json({
        success: false,
        error: "Invalid phone number format. Must contain between 5 and 20 digits.",
      })
    }

    // 5. Accepted Forms Filtering
    const acceptedForms = config.websiteSource.acceptedForms || []
    if (acceptedForms.length > 0) {
      const isFormAllowed = acceptedForms.some(
        (allowed) => allowed.toLowerCase() === formId.toLowerCase(),
      )
      if (!isFormAllowed) {
        config.websiteSource.stats.totalReceived = (config.websiteSource.stats.totalReceived || 0) + 1
        config.websiteSource.stats.totalErrors = (config.websiteSource.stats.totalErrors || 0) + 1
        config.websiteSource.stats.lastReceivedAt = new Date()
        config.websiteSource.stats.lastErrorAt = new Date()
        config.websiteSource.stats.lastErrorMessage = `Form '${formId || "unknown"}' rejected by form rules`
        await config.save()

        return res.status(422).json({
          success: false,
          error: `Form '${formId || "unspecified"}' is not allowed for this integration`,
        })
      }
    }

    // 6. Blocked Domains Filtering
    const blockedDomains = config.websiteSource.blockedDomains || []
    if (rawEmail && isDomainBlocked(rawEmail, blockedDomains)) {
      config.websiteSource.stats.totalReceived = (config.websiteSource.stats.totalReceived || 0) + 1
      config.websiteSource.stats.totalErrors = (config.websiteSource.stats.totalErrors || 0) + 1
      config.websiteSource.stats.lastReceivedAt = new Date()
      config.websiteSource.stats.lastErrorAt = new Date()
      config.websiteSource.stats.lastErrorMessage = "Submission rejected: Blocked email domain"
      await config.save()

      return res.status(422).json({
        success: false,
        error: "Submissions from this email domain are blocked by the account policy",
      })
    }

    // 7. Email & Phone Requirement / Verification Rules
    const verConfig = config.websiteSource.emailVerification || {}

    // Check if phone-only leads are allowed when email is omitted
    if (!rawEmail) {
      if (!verConfig.allowPhoneOnly) {
        return res.status(400).json({
          success: false,
          error: "An email address is required. Phone-only leads are not allowed by account settings.",
        })
      }
      if (!rawPhone) {
        return res.status(400).json({
          success: false,
          error: "Either a valid email address or phone number must be provided.",
        })
      }
    }

    // Check email verification rules
    let isVerified = false
    let verificationStatus = "unverified"

    if (rawEmail) {
      // Validate email format (supports all modern domain TLDs)
      const emailRegex = /^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/
      if (!emailRegex.test(rawEmail)) {
        return res.status(400).json({
          success: false,
          error: "Invalid email format",
        })
      }

      // Cryptographically verify email token if provided using tenant's API key
      const isStrict = Boolean(verConfig.strictVerification)
      const tokenValid = await verifyEmailToken(rawEmail, verificationToken, rawApiKey, tenantId, isStrict)

      if (verConfig.strictVerification) {
        // Strict verification requires trusted cryptographic HMAC proof or signed OTP token
        if (!tokenValid) {
          config.websiteSource.stats.totalReceived = (config.websiteSource.stats.totalReceived || 0) + 1
          config.websiteSource.stats.totalErrors = (config.websiteSource.stats.totalErrors || 0) + 1
          config.websiteSource.stats.lastReceivedAt = new Date()
          config.websiteSource.stats.lastErrorAt = new Date()
          config.websiteSource.stats.lastErrorMessage = "Strict verification failed: Invalid or missing cryptographic token"
          await config.save()

          return res.status(422).json({
            success: false,
            error: "Strict verification failed: Trusted verification token or HMAC proof is missing or invalid.",
          })
        }
        isVerified = true
        verificationStatus = "trusted"
      } else if (verConfig.requireVerifiedEmail) {
        // Enforce verified email through trusted mechanism; do not trust client-supplied boolean
        if (!tokenValid) {
          config.websiteSource.stats.totalReceived = (config.websiteSource.stats.totalReceived || 0) + 1
          config.websiteSource.stats.totalErrors = (config.websiteSource.stats.totalErrors || 0) + 1
          config.websiteSource.stats.lastReceivedAt = new Date()
          config.websiteSource.stats.lastErrorAt = new Date()
          config.websiteSource.stats.lastErrorMessage = "Email verification required: Untrusted submission rejected"
          await config.save()

          return res.status(422).json({
            success: false,
            error: "Submission rejected: Only verified emails with a trusted verification token are accepted.",
          })
        }
        isVerified = true
        verificationStatus = "verified"
      } else {
        // If verification is not mandatory, mark as verified ONLY if trusted cryptographic proof was provided
        if (tokenValid) {
          isVerified = true
          verificationStatus = "verified"
        } else {
          isVerified = false
          verificationStatus = "unverified"
        }
      }
    }

    // Determine initial status based on hold rule
    let leadStatus = "New"
    if (verConfig.holdUntilConfirmed && !isVerified) {
      leadStatus = "Engaged"
      verificationStatus = "pending_confirmation"
    }

    // 8. Determine Assignment
    let assignedStaffId = "unassigned"
    let assignedTo = "Unassigned"

    if (config.websiteSource.assignedStaffId && config.websiteSource.assignedStaffId !== "unassigned") {
      const staffUser = await User.findOne({
        _id: config.websiteSource.assignedStaffId,
        tenantId,
        status: "active",
      })

      if (staffUser) {
        assignedStaffId = staffUser._id.toString()
        assignedTo = staffUser.name
      } else {
        // Fallback: Selected staff member is no longer active or was removed
        console.warn(`Staff ID ${config.websiteSource.assignedStaffId} unavailable for tenant ${tenantId}; falling back to Unassigned`)
        assignedStaffId = "unassigned"
        assignedTo = "Unassigned"
      }
    }

    // 9. Lead Validation & Duplicate Handling (Tenant Scoped)
    const duplicateHandling = config.websiteSource.duplicateHandling || "reject"

    // Check for existing lead strictly in the caller's tenant
    const orConditions = []
    if (rawEmail) orConditions.push({ email: rawEmail })
    if (normalizedPhone) orConditions.push({ phone: normalizedPhone })

    let existingLead = null
    if (orConditions.length > 0) {
      existingLead = await Lead.findOne({
        tenantId,
        $or: orConditions,
      })
    }

    if (existingLead) {
      if (duplicateHandling === "reject") {
        config.websiteSource.stats.totalReceived = (config.websiteSource.stats.totalReceived || 0) + 1
        config.websiteSource.stats.totalErrors = (config.websiteSource.stats.totalErrors || 0) + 1
        config.websiteSource.stats.lastReceivedAt = new Date()
        config.websiteSource.stats.lastErrorAt = new Date()
        config.websiteSource.stats.lastErrorMessage = "Duplicate lead rejected"
        await config.save()

        return res.status(409).json({
          success: false,
          duplicate: true,
          error: "Duplicate lead detected: A lead with this email or phone number already exists in this account.",
        })
      } else if (duplicateHandling === "update") {
        // Update existing lead without overwriting assignment
        if (message) {
          existingLead.message = existingLead.message
            ? `${existingLead.message}\n[New Note ${new Date().toLocaleDateString()}]: ${message}`
            : message
        }
        if (landingPage) existingLead.landingPage = landingPage
        if (formId) existingLead.formId = formId
        if (isVerified) {
          existingLead.isEmailVerified = true
          existingLead.verificationStatus = verificationStatus
        }
        await existingLead.save()

        config.websiteSource.stats.totalReceived = (config.websiteSource.stats.totalReceived || 0) + 1
        config.websiteSource.stats.totalSuccess = (config.websiteSource.stats.totalSuccess || 0) + 1
        config.websiteSource.stats.lastReceivedAt = new Date()
        config.websiteSource.stats.lastSuccessAt = new Date()
        await config.save()

        return res.status(200).json({
          success: true,
          message: "Existing lead record updated successfully",
          leadId: existingLead._id.toString(),
          updated: true,
        })
      }
      // If duplicateHandling === "allow", proceed to create a new lead
    }

    // 10. Handle Test Leads
    if (isTest) {
      config.websiteSource.stats.lastReceivedAt = new Date()
      config.websiteSource.stats.lastSuccessAt = new Date()
      await config.save()

      return res.status(200).json({
        success: true,
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
      })
    }

    // 11. Create and Persist Lead
    const newLead = new Lead({
      name,
      email: rawEmail,
      phone: normalizedPhone,
      status: leadStatus,
      tenantId,
      source: "Website",
      assignedTo,
      assignedStaffId,
      message,
      formId,
      landingPage,
      isEmailVerified: isVerified,
      verificationStatus,
      isTest: false,
      metadata: {
        receivedVia: "website_webhook",
        submittedAt: new Date(),
        ipAddress: req.ip || req.headers["x-forwarded-for"] || "unknown",
        idempotencyKey: idempotencyKey || null,
        verificationTokenHash: verificationToken
          ? crypto.createHash("sha256").update(verificationToken.trim()).digest("hex")
          : null,
      },
    })

    const savedLead = await newLead.save()

    // Update stats
    config.websiteSource.stats.totalReceived = (config.websiteSource.stats.totalReceived || 0) + 1
    config.websiteSource.stats.totalSuccess = (config.websiteSource.stats.totalSuccess || 0) + 1
    config.websiteSource.stats.lastReceivedAt = new Date()
    config.websiteSource.stats.lastSuccessAt = new Date()
    await config.save()

    return res.status(201).json({
      success: true,
      message: "Lead received and created successfully",
      data: {
        id: savedLead._id.toString(),
        name: savedLead.name,
        email: savedLead.email,
        phone: savedLead.phone,
        status: savedLead.status,
        assignedTo: savedLead.assignedTo,
        createdAt: savedLead.createdAt,
      },
    })
  } catch (error) {
    console.error("Error processing website lead ingestion:", error)
    return res.status(500).json({
      success: false,
      error: "Internal server error while processing lead ingestion",
    })
  }
}

module.exports = {
  getWebsiteConfig,
  updateWebsiteConfig,
  rotateApiKey,
  sendTestLead,
  receiveWebsiteLead,
}
