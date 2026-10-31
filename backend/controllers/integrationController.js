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
const { normalizeOrigin, validateOrigin } = require("../utils/originValidator")

// Helper: Generate secure API credential
const generateIntegrationKey = () => {
  const rawKey = `lf_live_${crypto.randomBytes(24).toString("hex")}`
  const keyHash = crypto.createHash("sha256").update(rawKey).digest("hex")
  const maskedKey = `lf_live_••••••••••••••••${rawKey.slice(-4)}`
  return { rawKey, keyHash, maskedKey }
}

// Helper: Generate public website site key (Phase 22)
const generateSiteKey = () => `lf_site_${crypto.randomBytes(16).toString("hex")}`

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
      const initialSiteKey = generateSiteKey()

      config = new LeadFeedConfig({
        tenantId,
        websiteSource: {
          enabled: true,
          apiKeyHash: keyHash,
          apiKeyMasked: maskedKey,
          apiKeyLastRotatedAt: new Date(),
          siteKey: initialSiteKey,
          allowedOrigins: [],
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
    } else if (!config.websiteSource.siteKey) {
      // Ensure siteKey exists for existing configurations
      config.websiteSource.siteKey = generateSiteKey()
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
    const snippetUrl = `${protocol}://${host}/api/integrations/snippet.js`

    res.status(200).json({
      success: true,
      data: {
        config: {
          tenantId: config.tenantId,
          websiteSource: {
            enabled: config.websiteSource.enabled,
            apiKeyMasked: config.websiteSource.apiKeyMasked,
            apiKeyLastRotatedAt: config.websiteSource.apiKeyLastRotatedAt,
            siteKey: config.websiteSource.siteKey,
            allowedOrigins: config.websiteSource.allowedOrigins || [],
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
        snippetUrl,
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
      allowedOrigins,
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

    // 3b. Validate and parse allowed origins (Phase 22)
    let parsedAllowedOrigins = config.websiteSource.allowedOrigins || []
    if (allowedOrigins !== undefined) {
      const rawOrigins = Array.isArray(allowedOrigins)
        ? allowedOrigins
        : typeof allowedOrigins === "string"
        ? allowedOrigins.split("\n")
        : []

      const normalizedList = []
      for (const originItem of rawOrigins) {
        if (!originItem || typeof originItem !== "string") continue
        const trimmed = originItem.trim()
        if (!trimmed) continue
        const normalized = normalizeOrigin(trimmed)
        if (!normalized) {
          return res.status(400).json({
            success: false,
            error: `Invalid allowed origin format: "${trimmed}". Origins must include http:// or https:// and a valid hostname without path.`,
          })
        }
        normalizedList.push(normalized)
      }
      parsedAllowedOrigins = [...new Set(normalizedList)]
    }

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
    config.websiteSource.allowedOrigins = parsedAllowedOrigins
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
        allowedOriginsCount: parsedAllowedOrigins.length,
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
          siteKey: config.websiteSource.siteKey,
          allowedOrigins: config.websiteSource.allowedOrigins || [],
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
 * POST /api/integrations/settings/website/rotate-site-key
 * Authenticated: Rotate public website site key (Phase 22)
 */
const rotateSiteKey = async (req, res) => {
  try {
    const tenantId = req.user.tenantId
    if (!tenantId) {
      return res.status(400).json({ success: false, error: "Tenant context missing" })
    }

    let config = await LeadFeedConfig.findOne({ tenantId })
    if (!config) {
      return res.status(404).json({ success: false, error: "Configuration not found" })
    }

    const newSiteKey = generateSiteKey()
    config.websiteSource.siteKey = newSiteKey
    await config.save()

    // Sync to Integration model
    try {
      const integration = await Integration.findOne({ tenantId, type: "website" })
      if (integration) {
        integration.siteKey = newSiteKey
        await integration.save()
      } else {
        await integrationService.syncLegacyToIntegration(config)
      }
    } catch (e) {
      console.warn("Failed to sync rotated site key to Integration model:", e.message)
    }

    await audit.log({
      tenantId,
      actor: req.user,
      action: "integration.site_key_rotate",
      entity: "integration",
      entityId: config._id,
      summary: `Rotated website lead feed public site key`,
      details: { siteKey: newSiteKey },
      req,
    })

    res.status(200).json({
      success: true,
      message: "Website public site key rotated successfully",
      data: {
        siteKey: newSiteKey,
      },
    })
  } catch (error) {
    console.error("Error rotating site key:", error)
    res.status(500).json({
      success: false,
      error: "Failed to rotate site key",
    })
  }
}

/**
 * GET /api/integrations/snippet.js
 * Public: Serves the lightweight embeddable lead capture snippet (Phase 22)
 */
const serveWebsiteSnippet = (req, res) => {
  res.setHeader("Content-Type", "application/javascript; charset=utf-8")
  res.setHeader("Access-Control-Allow-Origin", "*")
  res.setHeader("Cache-Control", "public, max-age=3600")

  const snippetCode = `(function() {
  'use strict';
  try {
    var currentScript = document.currentScript || (function() {
      var scripts = document.getElementsByTagName('script');
      return scripts[scripts.length - 1];
    })();
    var siteKey = currentScript ? currentScript.getAttribute('data-site-key') : null;
    var defaultEndpoint = (currentScript && currentScript.src)
      ? currentScript.src.replace(/\\/snippet\\.js.*$/, '/leads/website')
      : '/api/integrations/leads/website';
    var customEndpoint = currentScript ? currentScript.getAttribute('data-endpoint') : null;
    var endpoint = customEndpoint || defaultEndpoint;

    if (!siteKey) {
      console.warn('[Leads365] Missing data-site-key attribute on integration script tag.');
      return;
    }

    function getQueryParams() {
      var params = {};
      try {
        var search = window.location.search.substring(1);
        if (search) {
          var pairs = search.split('&');
          for (var i = 0; i < pairs.length; i++) {
            var pair = pairs[i].split('=');
            if (pair.length === 2) {
              params[decodeURIComponent(pair[0])] = decodeURIComponent(pair[1].replace(/\\+/g, ' '));
            }
          }
        }
      } catch (e) {}
      return params;
    }

    function captureLead(formData, formElement) {
      var q = getQueryParams();
      var payload = {
        name: formData.name || formData.fullName || formData.full_name || formData['your-name'] || '',
        email: formData.email || formData.emailAddress || formData.email_address || formData['your-email'] || '',
        phone: formData.phone || formData.phoneNumber || formData.phone_number || formData.tel || formData['your-phone'] || '',
        message: formData.message || formData.notes || formData.comment || formData['your-message'] || '',
        formId: (formElement && (formElement.getAttribute('data-form-id') || formElement.id || formElement.name)) || 'website_form',
        landingPage: window.location.href,
        referrer: document.referrer || '',
        utm_source: q.utm_source || '',
        utm_medium: q.utm_medium || '',
        utm_campaign: q.utm_campaign || '',
        utm_term: q.utm_term || '',
        utm_content: q.utm_content || '',
        gclid: q.gclid || '',
        fbclid: q.fbclid || ''
      };

      if (formData._hp_trap || formData.hp_field || formData._lead_hp) {
        payload._hp_trap = formData._hp_trap || formData.hp_field || formData._lead_hp;
      }

      for (var key in formData) {
        if (formData.hasOwnProperty(key) && !payload.hasOwnProperty(key)) {
          payload[key] = formData[key];
        }
      }

      fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-site-key': siteKey
        },
        body: JSON.stringify(payload),
        keepalive: true
      }).then(function(res) {
        if (!res.ok) {
          return res.json().then(function(err) {
            console.warn('[Leads365] Lead submission warning:', err.error || res.statusText);
          });
        }
      }).catch(function(err) {
        console.warn('[Leads365] Lead transmission error:', err.message);
      });
    }

    function initFormListener() {
      document.addEventListener('submit', function(e) {
        var form = e.target;
        if (!form || form.tagName !== 'FORM') return;
        var isTarget = form.hasAttribute('data-leads365-form') || form.classList.contains('leads365-form');
        if (!isTarget) {
          var hasContactField = form.querySelector('input[type="email"], input[type="tel"], input[name*="email"], input[name*="phone"]');
          if (!hasContactField) return;
        }

        var data = {};
        var elements = form.elements;
        for (var i = 0; i < elements.length; i++) {
          var el = elements[i];
          if (!el.name || el.disabled || el.type === 'submit' || el.type === 'button' || el.type === 'password') continue;
          if ((el.type === 'radio' || el.type === 'checkbox') && !el.checked) continue;
          data[el.name] = el.value;
        }

        captureLead(data, form);
      }, true);
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initFormListener);
    } else {
      initFormListener();
    }

    window.Leads365 = window.Leads365 || {};
    window.Leads365.capture = function(customData) {
      captureLead(customData || {}, null);
    };
  } catch (err) {
    console.warn('[Leads365] Snippet init failed:', err);
  }
})();`

  return res.send(snippetCode)
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

    const createRealLead = req.body?.createRealLead === true || req.body?.isTest === false
    const isTest = !createRealLead

    // Generate diagnostic test payload
    const testPayload = {
      name: req.body?.name || (createRealLead ? "Real Website Lead" : "Test Lead Submission"),
      email: req.body?.email || `lead-${Date.now()}@example.com`,
      phone: req.body?.phone || "+919876543210",
      message: req.body?.message || (createRealLead ? "Real website lead created via Website Lead Feed" : "This is a diagnostic test submission verifying the webhook pipeline and settings."),
      formId: req.body?.formId || config.websiteSource.acceptedForms[0] || "contact_us_form",
      landingPage: req.body?.landingPage || "https://example.com/contact-test",
      emailVerified: true,
      isTest: isTest,
    }

    let realLeadResult = null
    if (createRealLead) {
      const integration = await integrationService.syncLegacyToIntegration(config)
      const event = await IntegrationEvent.create({
        tenantId,
        integrationId: integration._id,
        integrationType: "website",
        source: "Website",
        headers: req.headers,
        rawPayload: testPayload,
        status: "pending",
        ipAddress: req.ip || "127.0.0.1",
      })

      realLeadResult = await integrationService.processIntakePayload({
        event,
        integration,
        legacyConfig: config,
        tenantId,
        body: testPayload,
        headers: req.headers,
        query: { isTest: "false" },
        ip: req.ip || "127.0.0.1",
        rawApiKey: null,
        idempotencyKey: "test_web_" + Date.now(),
      })
    } else {
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

      realLeadResult = {
        testPayload,
        validationResults: checks,
      }
    }

    res.status(200).json({
      success: true,
      message: createRealLead
        ? "Real lead created successfully in CRM! You can view it in the Leads table."
        : "Test lead processed successfully. Integration pipeline is online and healthy.",
      isTest,
      createdRealLead: createRealLead,
      data: realLeadResult,
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

  const rawSiteKey =
    req.headers["x-site-key"] ||
    req.headers["X-Site-Key"] ||
    req.query.site_key ||
    req.query.siteKey ||
    req.body.siteKey ||
    req.body.site_key ||
    null

  const incomingOrigin = req.headers.origin || req.headers.referer || null

  const result = await integrationService.intakeWebhookPayload({
    rawApiKey,
    rawSiteKey,
    incomingOrigin,
    headers: req.headers,
    body: req.body,
    query: req.query,
    ip: req.ip || req.headers["x-forwarded-for"] || "unknown",
    async: req.headers["x-queue-async"] === "true" || req.query.async === "true",
  })

  if (result.permittedOrigin) {
    res.setHeader("Access-Control-Allow-Origin", result.permittedOrigin)
    res.setHeader("Vary", "Origin")
  }

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

    // Generate secure API key and public site key for the integration
    const rawApiKey = generateApiKey()
    const apiKeyHash = hashApiKey(rawApiKey)
    const apiKeyMasked = maskSecret(rawApiKey)
    const siteKey = generateSiteKey()

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
      siteKey,
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
      siteKey,
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


/**
 * Helper to construct the dynamic base URL from request
 */
const getBaseUrl = (req) => {
  const protocol = req.headers["x-forwarded-proto"] || req.protocol || "http"
  const host = req.headers["x-forwarded-host"] || req.get("host") || "localhost:5000"
  return `${protocol}://${host}`
}

/**
 * Constructs production-ready integration snippets for all 6 platforms
 */
const generatePlatformSnippets = ({ integration, baseUrl, rawApiKey = null }) => {
  const webhookUrl = `${baseUrl}/api/integrations/leads/website`
  const siteKey = integration.siteKey || "lf_site_YOUR_PUBLIC_KEY"
  const apiKey = rawApiKey || "lf_live_YOUR_PRIVATE_API_KEY"
  const integrationName = integration.name || "Leads-365 Website Integration"

  // 1. WordPress
  const wordpress = {
    title: "WordPress Integration",
    description: "Connect standard WordPress forms, Elementor, Contact Form 7, WPForms, or custom PHP themes.",
    webhookUrl,
    siteKey,
    cf7WebhookInstructions: `1. In WordPress, install 'CF7 to Webhook' or 'Redirection for Contact Form 7'.\n2. Set Webhook URL to: ${webhookUrl}\n3. Set Request Header: X-API-Key = ${apiKey} (or X-Site-Key = ${siteKey})\n4. Map CF7 form tag names: your-name -> name, your-email -> email, your-phone -> phone, your-message -> message.`,
    elementorInstructions: `1. In Elementor Form settings, go to Actions After Submit -> Add 'Webhook'.\n2. Under Webhook settings, set Webhook URL: ${webhookUrl}\n3. In Advanced Settings, add Header: X-API-Key: ${apiKey} (or pass siteKey in form field).\n4. Map Field IDs to: name, email, phone, message.`,
    wpformsInstructions: `1. In WPForms Settings -> Webhooks -> Add New Webhook.\n2. Request URL: ${webhookUrl}\n3. Request Method: POST, Request Format: JSON.\n4. Headers: X-API-Key: ${apiKey}\n5. Map Form Fields to: name, email, phone, message.`,
    customPhpHook: `// Add to your WordPress child theme's functions.php
add_action('wpcf7_mail_sent', 'leads365_forward_cf7_lead');
function leads365_forward_cf7_lead($contact_form) {
    $submission = WPCF7_Submission::get_instance();
    if (!$submission) return;
    $posted_data = $submission->get_posted_data();

    $payload = array(
        'name'    => sanitize_text_field($posted_data['your-name'] ?? ''),
        'email'   => sanitize_email($posted_data['your-email'] ?? ''),
        'phone'   => sanitize_text_field($posted_data['your-phone'] ?? ''),
        'message' => sanitize_textarea_field($posted_data['your-message'] ?? ''),
        'source'  => 'WordPress'
    );

    wp_remote_post('${webhookUrl}', array(
        'method'      => 'POST',
        'timeout'     => 15,
        'headers'     => array(
            'Content-Type' => 'application/json',
            'X-API-Key'    => '${apiKey}'
        ),
        'body'        => wp_json_encode($payload)
    ));
}`,
    embedScript: `<script 
  src="${baseUrl}/api/integrations/snippet.js" 
  data-site-key="${siteKey}" 
  async defer>
</script>`
  }

  // 2. HTML / JavaScript
  const html = {
    title: "HTML / JavaScript Website Integration",
    description: "Embed directly on any static HTML or client-side website with built-in anti-spam honeypot and client-side protection.",
    webhookUrl,
    siteKey,
    htmlForm: `<!-- Leads-365 HTML Lead Capture Form -->
<form id="leads365-form">
  <!-- Anti-bot honeypot field (hidden from human visitors) -->
  <input type="text" name="_hp_trap" style="display:none !important;" tabindex="-1" autocomplete="off" />

  <div>
    <label for="name">Full Name *</label>
    <input type="text" id="name" name="name" placeholder="John Doe" required />
  </div>

  <div>
    <label for="email">Email Address</label>
    <input type="email" id="email" name="email" placeholder="john@example.com" />
  </div>

  <div>
    <label for="phone">Phone Number *</label>
    <input type="tel" id="phone" name="phone" placeholder="+1234567890" required />
  </div>

  <div>
    <label for="message">Message</label>
    <textarea id="message" name="message" placeholder="How can we help you?"></textarea>
  </div>

  <button type="submit" id="leads365-submit-btn">Submit Enquiry</button>
  <div id="leads365-status" style="margin-top: 10px; display: none;"></div>
</form>

<script>
document.getElementById('leads365-form').addEventListener('submit', async function(e) {
  e.preventDefault();
  const form = e.target;
  const btn = document.getElementById('leads365-submit-btn');
  const statusDiv = document.getElementById('leads365-status');

  btn.disabled = true;
  btn.textContent = 'Sending...';
  statusDiv.style.display = 'none';

  const formData = new FormData(form);
  const payload = {
    name: formData.get('name'),
    email: formData.get('email'),
    phone: formData.get('phone'),
    message: formData.get('message'),
    _hp_trap: formData.get('_hp_trap'),
    landingPage: window.location.href,
    source: 'Website'
  };

  try {
    const res = await fetch('${webhookUrl}', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Site-Key': '${siteKey}'
      },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (res.ok && data.success) {
      statusDiv.textContent = 'Thank you! Your enquiry has been received.';
      statusDiv.style.color = 'green';
      statusDiv.style.display = 'block';
      form.reset();
    } else {
      throw new Error(data.error || 'Failed to submit form');
    }
  } catch (err) {
    statusDiv.textContent = 'Error: ' + err.message;
    statusDiv.style.color = 'red';
    statusDiv.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Submit Enquiry';
  }
});
</script>`
  }

  // 3. PHP
  const php = {
    title: "PHP Website Integration",
    description: "Production-ready server-to-server PHP script with HMAC-SHA256 signature, timestamp expiration, and idempotency protection.",
    webhookUrl,
    apiKey,
    serverScript: `<?php
/**
 * Leads-365 CRM - PHP Server-Side Lead Ingestion
 */
$apiUrl    = '${webhookUrl}';
$apiKey    = '${apiKey}'; // Keep secure in environment / config file
$siteKey   = '${siteKey}';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    // 1. Anti-bot honeypot check
    if (!empty($_POST['_hp_trap'])) {
        http_response_code(400);
        die(json_encode(['error' => 'Spam detected']));
    }

    // 2. Sanitize form inputs
    $payload = [
        'name'        => trim(filter_input(INPUT_POST, 'name', FILTER_SANITIZE_FULL_SPECIAL_CHARS)),
        'email'       => trim(filter_input(INPUT_POST, 'email', FILTER_SANITIZE_EMAIL)),
        'phone'       => trim(filter_input(INPUT_POST, 'phone', FILTER_SANITIZE_FULL_SPECIAL_CHARS)),
        'message'     => trim(filter_input(INPUT_POST, 'message', FILTER_SANITIZE_FULL_SPECIAL_CHARS)),
        'source'      => 'PHP Website',
        'landingPage' => $_SERVER['HTTP_REFERER'] ?? ''
    ];

    $jsonPayload    = json_encode($payload);
    $timestamp      = time() * 1000;
    $idempotencyKey = bin2hex(random_bytes(16));
    
    // HMAC-SHA256 Signature calculation
    $hmacSignature  = hash_hmac('sha256', $jsonPayload, $apiKey);

    $ch = curl_init($apiUrl);
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => $jsonPayload,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 15,
        CURLOPT_HTTPHEADER     => [
            'Content-Type: application/json',
            'X-API-Key: ' . $apiKey,
            'X-Signature-256: ' . $hmacSignature,
            'X-Timestamp: ' . $timestamp,
            'X-Idempotency-Key: ' . $idempotencyKey
        ]
    ]);

    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $curlErr  = curl_error($ch);
    curl_close($ch);

    if ($curlErr) {
        error_log("Leads-365 CRM Connection Error: " . $curlErr);
        echo json_encode(['success' => false, 'error' => 'Network error connecting to CRM']);
    } else {
        http_response_code($httpCode);
        echo $response;
    }
    exit;
}`
  }

  // 4. React
  const react = {
    title: "React Component Integration",
    description: "Reusable React functional component using public Site Key, client-side validation, loading states, and honeypot protection.",
    siteKey,
    webhookUrl,
    component: `import React, { useState } from 'react';

export default function LeadCaptureForm() {
  const [formData, setFormData] = useState({ name: '', email: '', phone: '', message: '', _hp_trap: '' });
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(false);

    try {
      const res = await fetch('${webhookUrl}', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Site-Key': '${siteKey}'
        },
        body: JSON.stringify({
          ...formData,
          source: 'React Website',
          landingPage: typeof window !== 'undefined' ? window.location.href : ''
        })
      });

      const result = await res.json();
      if (!res.ok || !result.success) {
        throw new Error(result.error || 'Failed to submit enquiry');
      }

      setSuccess(true);
      setFormData({ name: '', email: '', phone: '', message: '', _hp_trap: '' });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-w-md mx-auto p-6 bg-white shadow rounded-lg">
      <input
        type="text"
        name="_hp_trap"
        value={formData._hp_trap}
        onChange={(e) => setFormData({ ...formData, _hp_trap: e.target.value })}
        style={{ display: 'none' }}
        tabIndex={-1}
      />

      <div>
        <label className="block text-sm font-medium text-gray-700">Full Name *</label>
        <input
          type="text"
          required
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          className="mt-1 block w-full border border-gray-300 rounded-md p-2"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700">Email Address</label>
        <input
          type="email"
          value={formData.email}
          onChange={(e) => setFormData({ ...formData, email: e.target.value })}
          className="mt-1 block w-full border border-gray-300 rounded-md p-2"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700">Phone Number *</label>
        <input
          type="tel"
          required
          value={formData.phone}
          onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
          className="mt-1 block w-full border border-gray-300 rounded-md p-2"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700">Message</label>
        <textarea
          rows={3}
          value={formData.message}
          onChange={(e) => setFormData({ ...formData, message: e.target.value })}
          className="mt-1 block w-full border border-gray-300 rounded-md p-2"
        />
      </div>

      {error && <div className="p-3 text-sm text-red-600 bg-red-50 rounded-md">{error}</div>}
      {success && <div className="p-3 text-sm text-green-700 bg-green-50 rounded-md">Enquiry sent successfully!</div>}

      <button
        type="submit"
        disabled={loading}
        className="w-full bg-blue-600 text-white font-medium py-2 rounded-md hover:bg-blue-700 disabled:opacity-50"
      >
        {loading ? 'Submitting...' : 'Submit Lead'}
      </button>
    </form>
  );
}`
  }

  // 5. Next.js
  const nextjs = {
    title: "Next.js App Router Integration",
    description: "Next.js Route Handler / Server Action storing private API keys securely in backend environment variables, with client-side form.",
    webhookUrl,
    apiKey,
    envExample: `# .env.local (Never prefix with NEXT_PUBLIC_)
LEADS365_WEBHOOK_URL="${webhookUrl}"
LEADS365_API_KEY="${apiKey}"`,
    routeHandler: `// app/api/contact/route.js (Next.js App Router Server Handler)
import { NextResponse } from 'next/server';

export async function POST(request) {
  try {
    const body = await request.json();

    if (body._hp_trap) {
      return NextResponse.json({ error: 'Spam detected' }, { status: 400 });
    }

    const res = await fetch(process.env.LEADS365_WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': process.env.LEADS365_API_KEY,
        'X-Idempotency-Key': 'nextjs_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9)
      },
      body: JSON.stringify({
        name: body.name,
        email: body.email,
        phone: body.phone,
        message: body.message,
        source: 'Next.js Website'
      })
    });

    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (error) {
    return NextResponse.json({ error: error.message || 'Server error' }, { status: 500 });
  }
}`,
    clientComponent: `// app/components/ContactForm.jsx (Client Form)
'use client';

import { useState } from 'react';

export default function ContactForm() {
  const [status, setStatus] = useState({ loading: false, msg: '', error: false });

  const onSubmit = async (e) => {
    e.preventDefault();
    setStatus({ loading: true, msg: '', error: false });

    const form = e.target;
    const payload = {
      name: form.name.value,
      email: form.email.value,
      phone: form.phone.value,
      message: form.message.value,
      _hp_trap: form._hp_trap.value
    };

    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to submit');
      setStatus({ loading: false, msg: 'Thank you! We will get in touch shortly.', error: false });
      form.reset();
    } catch (err) {
      setStatus({ loading: false, msg: err.message, error: true });
    }
  };

  return (
    <form onSubmit={onSubmit} className="max-w-md mx-auto space-y-4">
      <input type="text" name="_hp_trap" className="hidden" tabIndex={-1} />
      <input name="name" placeholder="Full Name" required className="w-full p-2 border rounded" />
      <input name="email" type="email" placeholder="Email Address" className="w-full p-2 border rounded" />
      <input name="phone" type="tel" placeholder="Phone Number" required className="w-full p-2 border rounded" />
      <textarea name="message" placeholder="Your Message" className="w-full p-2 border rounded" />
      {status.msg && (
        <p className={status.error ? "text-red-500 text-sm" : "text-green-600 text-sm"}>{status.msg}</p>
      )}
      <button type="submit" disabled={status.loading} className="w-full bg-blue-600 text-white p-2 rounded">
        {status.loading ? 'Sending...' : 'Send Message'}
      </button>
    </form>
  );
}`
  }

  // 6. Custom Webhook
  const webhook = {
    title: "Custom Third-Party Webhook",
    description: "Connect external platforms, custom backend scripts, or automation tools using standard HTTP POST.",
    webhookUrl,
    apiKey,
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": apiKey,
      "X-Signature-256": "Optional HMAC-SHA256 of raw body using your API key",
      "X-Timestamp": "Optional Epoch milliseconds timestamp",
      "X-Idempotency-Key": "Optional unique submission ID for retry safety"
    },
    curlExample: `curl -X POST "${webhookUrl}" \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: ${apiKey}" \\
  -d '{
    "name": "Alex Mercer",
    "email": "alex@example.com",
    "phone": "+1-555-0199",
    "message": "Interested in enterprise plan",
    "source": "Custom Webhook",
    "formId": "enterprise_contact"
  }'`
  }

  return {
    wordpress,
    html,
    php,
    react,
    nextjs,
    webhook,
  }
}

/**
 * GET /api/integrations/:id/snippets
 * Authenticated: Retrieve tailored code snippets for all platforms
 */
const getIntegrationSnippets = async (req, res) => {
  try {
    const tenantId = req.user.tenantId
    const integration = await Integration.findOne({ _id: req.params.id, tenantId })
    if (!integration) {
      return res.status(404).json({ success: false, error: "Integration not found" })
    }

    const baseUrl = getBaseUrl(req)
    const snippets = generatePlatformSnippets({
      integration,
      baseUrl,
      rawApiKey: null,
    })

    return res.status(200).json({
      success: true,
      data: {
        integration: {
          id: integration._id,
          name: integration.name,
          type: integration.type,
          siteKey: integration.siteKey,
          apiKeyMasked: integration.apiKeyMasked,
          status: integration.status,
          settings: integration.settings,
        },
        snippets,
      },
    })
  } catch (error) {
    console.error("Error generating snippets:", error)
    return res.status(500).json({ success: false, error: "Failed to generate integration snippets" })
  }
}

/**
 * POST /api/integrations/:id/test
 * Authenticated (requireAccountAdmin): Send test lead for a specific integration
 */
const testIntegrationById = async (req, res) => {
  try {
    const tenantId = req.user.tenantId
    const integration = await Integration.findOne({ _id: req.params.id, tenantId })
    if (!integration) {
      return res.status(404).json({ success: false, error: "Integration not found" })
    }

    const createRealLead = req.body?.createRealLead === true || req.body?.isTest === false
    const isTest = !createRealLead

    const incoming = req.body?.payload || {}
    const testPayload = {
      name: incoming.name || (createRealLead ? `Lead via ${integration.name}` : `Test Lead (${integration.name})`),
      email: incoming.email || `lead-${Date.now()}@example.com`,
      phone: incoming.phone || "+919876543210",
      message: incoming.message || (createRealLead ? `Real lead submitted via ${integration.name}` : `Testing website lead ingestion pipeline for ${integration.name}`),
      source: incoming.source || integration.settings?.leadSource || (integration.type === "website" ? "Website" : integration.name),
      ...incoming,
    }
    testPayload.isTest = isTest

    let event = null
    if (createRealLead) {
      event = await IntegrationEvent.create({
        tenantId,
        integrationId: integration._id,
        integrationType: integration.type,
        source: testPayload.source,
        headers: req.headers,
        rawPayload: testPayload,
        status: "pending",
        ipAddress: req.ip || "127.0.0.1",
      })
    }

    const result = await integrationService.processIntakePayload({
      event,
      integration,
      legacyConfig: null,
      tenantId,
      body: testPayload,
      headers: req.headers,
      query: { isTest: isTest ? "true" : "false" },
      ip: req.ip || "127.0.0.1",
      rawApiKey: null,
      idempotencyKey: "test_" + Date.now(),
    })

    return res.status(200).json({
      success: true,
      message: createRealLead
        ? "Real lead created successfully in CRM! You can view it in the Leads table."
        : "Test lead verified successfully",
      isTest,
      createdRealLead: createRealLead,
      data: result,
    })
  } catch (error) {
    console.error("Error testing integration:", error)
    return res.status(500).json({ success: false, error: error.message || "Failed to test integration" })
  }
}


module.exports = {
  getWebsiteConfig,
  updateWebsiteConfig,
  rotateApiKey,
  rotateSiteKey,
  serveWebsiteSnippet,
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
  generatePlatformSnippets,
  getIntegrationSnippets,
  testIntegrationById,
}

