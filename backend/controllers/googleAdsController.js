const { Integration } = require("../models/Integration")
const LeadFeedConfig = require("../models/LeadFeedConfig")
const User = require("../models/User")
const audit = require("../services/auditService")
const googleAdsService = require("../services/googleAdsService")
const { hashApiKey, maskSecret } = require("../utils/cryptoUtils")

/**
 * Leads-365 CRM - Google Ads Lead Form Webhook Controller (Phase 23)
 * 
 * Provides:
 * - POST /api/integrations/webhooks/google (Public Google Ads webhook intake)
 * - GET  /api/integrations/google/status (Retrieve current tenant Google configuration)
 * - POST /api/integrations/google/connect (Connect / update Google Ads integration)
 * - POST /api/integrations/google/rotate-key (Rotate webhook key & invalidate old key)
 * - POST /api/integrations/google/test (Send simulated test lead)
 */

/**
 * POST /api/integrations/webhooks/google
 * Public Webhook: Ingests incoming lead submissions from Google Ads Lead Form extension.
 */
const handleGoogleWebhook = async (req, res) => {
  try {
    const body = req.body || {}
    const rawKey =
      body.google_key ||
      body.googleKey ||
      req.query?.google_key ||
      req.query?.googleKey ||
      req.query?.key ||
      req.headers["x-google-key"] ||
      req.headers["x-goog-key"] ||
      req.headers["x-api-key"] ||
      null

    // 1. Verify key is provided (Fail closed if missing)
    if (!rawKey || typeof rawKey !== "string" || !rawKey.trim()) {
      return res.status(401).json({
        success: false,
        error: "Unauthorized: Missing Google Ads webhook key. Configure 'google_key' in Google Ads lead form delivery settings.",
      })
    }

    const cleanKey = rawKey.trim()
    const keyHash = hashApiKey(cleanKey)

    // 2. Resolve tenant & integration securely via server-side key lookup
    let targetIntegration = await Integration.findOne({
      type: "google_ads",
      apiKeyHash: keyHash,
    }).setOptions({ skipTenantFilter: true })

    let legacyConfig = null

    if (!targetIntegration) {
      // Check LeadFeedConfig model fallback
      legacyConfig = await LeadFeedConfig.findOne({
        "googleSource.googleKeyHash": keyHash,
      }).setOptions({ skipTenantFilter: true })

      if (legacyConfig) {
        // Sync or find existing integration
        targetIntegration = await Integration.findOne({
          tenantId: legacyConfig.tenantId,
          type: "google_ads",
        }).setOptions({ skipTenantFilter: true })
      }
    }

    if (!targetIntegration && !legacyConfig) {
      return res.status(401).json({
        success: false,
        error: "Unauthorized: Invalid or revoked Google Ads webhook key.",
      })
    }

    const tenantId = targetIntegration?.tenantId || legacyConfig?.tenantId

    // 3. Constant-time verification on decrypted credentials if available
    if (targetIntegration?.credentials) {
      try {
        const decrypted = targetIntegration.getDecryptedCredentials()
        if (decrypted?.googleKey) {
          const isMatch = googleAdsService.verifyGoogleWebhookKey(cleanKey, decrypted.googleKey)
          if (!isMatch) {
            return res.status(401).json({
              success: false,
              error: "Unauthorized: Webhook key verification failed.",
            })
          }
        }
      } catch (err) {
        console.warn("[Google Ads Webhook] Credential decryption check bypassed to hash comparison:", err.message)
      }
    }

    // 4. Verify integration status
    const isEnabled = targetIntegration
      ? targetIntegration.status === "active"
      : legacyConfig?.googleSource?.enabled

    if (!isEnabled) {
      return res.status(403).json({
        success: false,
        error: "Forbidden: Google Ads lead integration is currently disabled for this account.",
      })
    }

    // 5. Validate payload
    if (!body || typeof body !== "object" || Object.keys(body).length === 0) {
      return res.status(400).json({
        success: false,
        error: "Bad Request: Malformed or empty Google Ads payload.",
      })
    }

    // 6. Process lead ingestion through googleAdsService
    const result = await googleAdsService.processGoogleLead({
      payload: body,
      integration: targetIntegration,
      legacyConfig,
      tenantId,
      headers: req.headers,
      ip: req.ip || req.headers["x-forwarded-for"] || "unknown",
    })

    return res.status(result.status || (result.success ? 200 : 400)).json(result)
  } catch (err) {
    console.error("[Google Ads Webhook Error]:", err)
    return res.status(500).json({
      success: false,
      error: `Failed to process Google Ads webhook: ${err.message}`,
    })
  }
}

/**
 * GET /api/integrations/google/status
 * Authenticated: Retrieve current tenant's Google Ads integration status and webhook details.
 */
const getGoogleConfig = async (req, res) => {
  try {
    const tenantId = req.user?.tenantId || req.tenantId
    if (!tenantId) {
      return res.status(400).json({ success: false, error: "Missing tenant context" })
    }

    const integration = await Integration.findOne({
      tenantId,
      type: "google_ads",
    }).setOptions({ skipTenantFilter: true })

    const legacyConfig = await LeadFeedConfig.findOne({ tenantId })

    // Active staff members for assignment
    const staffMembers = await User.find({
      tenantId,
      status: "active",
    })
      .select("_id name email role")
      .lean()

    const protocol = req.headers["x-forwarded-proto"] || req.protocol || "http"
    const host = req.get("host") || "localhost:5000"
    const webhookUrl = `${protocol}://${host}/api/integrations/webhooks/google`

    const isConfigured = Boolean(integration || legacyConfig?.googleSource?.googleKeyHash)
    const isEnabled = Boolean(
      integration ? integration.status === "active" : legacyConfig?.googleSource?.enabled
    )

    const googleKeyMasked =
      integration?.apiKeyMasked ||
      legacyConfig?.googleSource?.googleKeyMasked ||
      ""

    const googleKeyLastRotatedAt =
      integration?.apiKeyLastRotatedAt ||
      legacyConfig?.googleSource?.googleKeyLastRotatedAt ||
      null

    const assignedStaffId =
      integration?.assignedStaffId ||
      legacyConfig?.googleSource?.assignedStaffId ||
      "unassigned"

    const assignedStaffName =
      integration?.assignedStaffName ||
      legacyConfig?.googleSource?.assignedStaffName ||
      "Unassigned"

    const duplicateHandling =
      integration?.settings?.duplicateHandling ||
      legacyConfig?.googleSource?.duplicateHandling ||
      "update"

    const stats = integration?.stats || legacyConfig?.googleSource?.stats || {}

    return res.status(200).json({
      success: true,
      data: {
        configured: isConfigured,
        enabled: isEnabled,
        status: isConfigured ? (isEnabled ? "active" : "inactive") : "not_configured",
        webhookUrl,
        googleKeyMasked,
        googleKeyLastRotatedAt,
        assignedStaffId,
        assignedStaffName,
        duplicateHandling,
        stats,
        staff: staffMembers.map((s) => ({
          id: s._id.toString(),
          name: s.name,
          email: s.email,
          role: s.role,
        })),
      },
    })
  } catch (err) {
    console.error("[Get Google Config Error]:", err)
    return res.status(500).json({
      success: false,
      error: `Failed to load Google Ads configuration: ${err.message}`,
    })
  }
}

/**
 * POST /api/integrations/google/connect
 * Authenticated (requireAccountAdmin): Connect or update Google Ads webhook settings.
 */
const connectGoogleIntegration = async (req, res) => {
  try {
    const tenantId = req.user?.tenantId || req.tenantId
    if (!tenantId) {
      return res.status(400).json({ success: false, error: "Missing tenant context" })
    }

    const {
      enabled = true,
      assignedStaffId = "unassigned",
      duplicateHandling = "update",
      name = "Google Ads Lead Form",
    } = req.body || {}

    // Resolve assigned staff
    let resolvedStaffName = "Unassigned"
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
      resolvedStaffName = staffUser.name
    }

    // Check existing or initialize new
    let integration = await Integration.findOne({
      tenantId,
      type: "google_ads",
    }).setOptions({ skipTenantFilter: true })

    let config = await LeadFeedConfig.findOne({ tenantId })
    if (!config) {
      config = new LeadFeedConfig({ tenantId })
    }

    let rawKey = null
    let keyHash = integration?.apiKeyHash || config.googleSource?.googleKeyHash
    let maskedKey = integration?.apiKeyMasked || config.googleSource?.googleKeyMasked
    let lastRotatedAt = integration?.apiKeyLastRotatedAt || config.googleSource?.googleKeyLastRotatedAt

    // If never generated key, generate initial one
    if (!keyHash) {
      const generated = googleAdsService.generateGoogleKey()
      rawKey = generated.rawKey
      keyHash = generated.keyHash
      maskedKey = generated.maskedKey
      lastRotatedAt = new Date()
    }

    // 1. Update Integration document
    if (!integration) {
      integration = new Integration({
        tenantId,
        type: "google_ads",
        name: name.trim(),
        status: enabled ? "active" : "inactive",
        apiKeyHash: keyHash,
        apiKeyMasked: maskedKey,
        apiKeyLastRotatedAt: lastRotatedAt,
        assignedStaffId: resolvedStaffId,
        assignedStaffName: resolvedStaffName,
        settings: {
          duplicateHandling,
        },
      })
    } else {
      integration.name = name.trim()
      integration.status = enabled ? "active" : "inactive"
      integration.apiKeyHash = keyHash
      integration.apiKeyMasked = maskedKey
      integration.apiKeyLastRotatedAt = lastRotatedAt
      integration.assignedStaffId = resolvedStaffId
      integration.assignedStaffName = resolvedStaffName
      integration.settings.duplicateHandling = duplicateHandling
    }

    if (rawKey) {
      integration.setCredentials({ googleKey: rawKey })
    }
    await integration.save()

    // 2. Update LeadFeedConfig model
    config.googleSource.enabled = enabled
    config.googleSource.status = enabled ? "active" : "inactive"
    config.googleSource.googleKeyHash = keyHash
    config.googleSource.googleKeyMasked = maskedKey
    config.googleSource.googleKeyLastRotatedAt = lastRotatedAt
    config.googleSource.assignedStaffId = resolvedStaffId
    config.googleSource.assignedStaffName = resolvedStaffName
    config.googleSource.duplicateHandling = duplicateHandling
    await config.save()

    const protocol = req.headers["x-forwarded-proto"] || req.protocol || "http"
    const host = req.get("host") || "localhost:5000"
    const webhookUrl = `${protocol}://${host}/api/integrations/webhooks/google`

    await audit.log({
      tenantId,
      actor: req.user,
      action: "integration.google_ads_connect",
      entity: "integration",
      entityId: integration._id,
      summary: "Updated Google Ads lead form integration configuration",
      details: {
        enabled,
        assignedStaffName: resolvedStaffName,
        duplicateHandling,
      },
      req,
    })

    return res.status(200).json({
      success: true,
      message: "Google Ads lead integration configured successfully",
      data: {
        rawGoogleKey: rawKey, // Only returned on initial creation
        googleKeyMasked: maskedKey,
        googleKeyLastRotatedAt: lastRotatedAt,
        webhookUrl,
        enabled,
        assignedStaffId: resolvedStaffId,
        assignedStaffName: resolvedStaffName,
        duplicateHandling,
      },
    })
  } catch (err) {
    console.error("[Connect Google Ads Error]:", err)
    return res.status(500).json({
      success: false,
      error: `Failed to configure Google Ads integration: ${err.message}`,
    })
  }
}

/**
 * POST /api/integrations/google/rotate-key
 * Authenticated (requireAccountAdmin): Rotates Google Ads webhook key and immediately invalidates old key.
 */
const rotateGoogleKey = async (req, res) => {
  try {
    const tenantId = req.user?.tenantId || req.tenantId
    if (!tenantId) {
      return res.status(400).json({ success: false, error: "Missing tenant context" })
    }

    const { rawKey, keyHash, maskedKey } = googleAdsService.generateGoogleKey()
    const rotatedAt = new Date()

    let integration = await Integration.findOne({
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

    let config = await LeadFeedConfig.findOne({ tenantId })
    if (config) {
      config.googleSource.googleKeyHash = keyHash
      config.googleSource.googleKeyMasked = maskedKey
      config.googleSource.googleKeyLastRotatedAt = rotatedAt
      await config.save()
    }

    await audit.log({
      tenantId,
      actor: req.user,
      action: "integration.google_key_rotate",
      entity: "integration",
      entityId: integration?._id || config?._id,
      summary: `Rotated Google Ads webhook key (${maskedKey})`,
      details: {
        maskedKey,
        rotatedAt,
      },
      req,
    })

    return res.status(200).json({
      success: true,
      message: "Google Ads webhook key rotated successfully. Update your Google Ads delivery settings immediately.",
      data: {
        rawGoogleKey: rawKey,
        googleKeyMasked: maskedKey,
        googleKeyLastRotatedAt: rotatedAt,
      },
    })
  } catch (err) {
    console.error("[Rotate Google Key Error]:", err)
    return res.status(500).json({
      success: false,
      error: `Failed to rotate Google Ads key: ${err.message}`,
    })
  }
}

/**
 * POST /api/integrations/google/test
 * Authenticated: Sends a simulated Google Ads test lead through the tenant pipeline.
 */
const sendGoogleTestLead = async (req, res) => {
  try {
    const tenantId = req.user?.tenantId || req.tenantId
    if (!tenantId) {
      return res.status(400).json({ success: false, error: "Missing tenant context" })
    }

    const integration = await Integration.findOne({
      tenantId,
      type: "google_ads",
    }).setOptions({ skipTenantFilter: true })

    const config = await LeadFeedConfig.findOne({ tenantId })

    const testPayload = {
      lead_id: `test-google-${Date.now()}`,
      api_version: "1.0",
      form_id: "google_test_form_001",
      campaign_id: "campaign_test_999",
      is_test: true,
      gclid: "test_gclid_google_ads_mock",
      user_column_data: [
        { column_id: "FULL_NAME", string_value: "Google Test Lead", column_name: "Full Name" },
        { column_id: "EMAIL", string_value: `test-lead-${Date.now()}@example.com`, column_name: "Email" },
        { column_id: "PHONE_NUMBER", string_value: "+15550192834", column_name: "Phone Number" },
        { column_id: "COMPANY_NAME", string_value: "Google Ads Test Partner", column_name: "Company Name" },
        { column_id: "CITY", string_value: "Mountain View", column_name: "City" },
      ],
    }

    const result = await googleAdsService.processGoogleLead({
      payload: testPayload,
      integration,
      legacyConfig: config,
      tenantId,
      headers: req.headers,
      ip: req.ip || "127.0.0.1",
    })

    return res.status(200).json({
      success: true,
      message: "Diagnostic Google Ads lead processed successfully.",
      data: {
        testPayload,
        result,
      },
    })
  } catch (err) {
    console.error("[Send Google Test Error]:", err)
    return res.status(500).json({
      success: false,
      error: `Failed to execute Google test lead: ${err.message}`,
    })
  }
}

module.exports = {
  handleGoogleWebhook,
  getGoogleConfig,
  connectGoogleIntegration,
  rotateGoogleKey,
  sendGoogleTestLead,
}
