const { Integration } = require("../models/Integration")
const User = require("../models/User")
const audit = require("../services/auditService")
const genericConnectorService = require("../services/genericConnectorService")
const { hashApiKey } = require("../utils/cryptoUtils")

/**
 * Leads-365 CRM - Generic Connector Controller (Phase 24)
 * 
 * Public Webhook:
 * - POST /api/integrations/webhooks/generic
 * 
 * Authenticated Management:
 * - GET  /api/integrations/generic/status
 * - POST /api/integrations/generic/connect
 * - POST /api/integrations/generic/rotate-key
 * - POST /api/integrations/generic/test
 */

/**
 * POST /api/integrations/webhooks/generic
 * Public Webhook intake for Zapier, Make.com, n8n, Pabbly, or custom API scripts.
 */
const handleGenericWebhook = async (req, res) => {
  try {
    const body = req.body || {}

    // Extract API Key from multiple standard locations
    let rawKey =
      req.headers["x-api-key"] ||
      req.headers["x-generic-key"] ||
      null

    if (!rawKey && req.headers["authorization"]) {
      const authHeader = req.headers["authorization"].trim()
      if (authHeader.startsWith("Bearer ")) {
        rawKey = authHeader.slice(7).trim()
      } else {
        rawKey = authHeader
      }
    }

    if (!rawKey) {
      rawKey =
        req.query?.api_key ||
        req.query?.apiKey ||
        req.query?.key ||
        body.api_key ||
        body.apiKey ||
        null
    }

    // 1. Fail closed on missing key
    if (!rawKey || typeof rawKey !== "string" || !rawKey.trim()) {
      return res.status(401).json({
        success: false,
        error: "Unauthorized: Missing API key. Provide your connector API key via 'x-api-key' header, 'Authorization: Bearer <key>', or '?api_key=' parameter.",
      })
    }

    const cleanKey = rawKey.trim()
    const keyHash = hashApiKey(cleanKey)

    // 2. Server-side key lookup across tenants
    const integration = await Integration.findOne({
      type: { $in: ["generic", "zapier"] },
      apiKeyHash: keyHash,
    }).setOptions({ skipTenantFilter: true })

    if (!integration) {
      return res.status(401).json({
        success: false,
        error: "Unauthorized: Invalid or revoked Generic Connector API key.",
      })
    }

    const tenantId = integration.tenantId

    // 3. Constant-time credential verification on decrypted credentials
    if (integration.credentials) {
      try {
        const decrypted = integration.getDecryptedCredentials()
        if (decrypted?.apiKey) {
          const isMatch = genericConnectorService.verifyGenericApiKey(cleanKey, decrypted.apiKey)
          if (!isMatch) {
            return res.status(401).json({
              success: false,
              error: "Unauthorized: API key verification failed.",
            })
          }
        }
      } catch (err) {
        console.warn("[Generic Connector] Credential decryption check bypassed to hash comparison:", err.message)
      }
    }

    // 4. Verify integration status
    if (integration.status !== "active") {
      return res.status(403).json({
        success: false,
        error: "Forbidden: Generic Connector integration is currently disabled for this account.",
      })
    }

    // 5. Validate payload
    if (!body || typeof body !== "object" || Object.keys(body).length === 0) {
      return res.status(400).json({
        success: false,
        error: "Bad Request: Malformed or empty webhook payload.",
      })
    }

    // 6. Process lead ingestion through genericConnectorService
    const result = await genericConnectorService.processGenericLead({
      payload: body,
      integration,
      tenantId,
      headers: req.headers,
      ip: req.ip || req.headers["x-forwarded-for"] || "unknown",
    })

    return res.status(result.status || (result.success ? 200 : 400)).json(result)
  } catch (err) {
    console.error("[Generic Connector Webhook Error]:", err)
    return res.status(500).json({
      success: false,
      error: `Failed to process incoming lead: ${err.message}`,
    })
  }
}

/**
 * GET /api/integrations/generic/status
 * Authenticated: Retrieve current tenant's Generic Connector configuration and masked credentials.
 */
const getGenericConfig = async (req, res) => {
  try {
    const tenantId = req.user?.tenantId || req.tenantId
    if (!tenantId) {
      return res.status(400).json({ success: false, error: "Missing tenant context" })
    }

    const { integration, rawKey } = await genericConnectorService.getOrCreateGenericIntegration(tenantId)

    const host = req.get("host") || "localhost:5000"
    const protocol = req.protocol || (req.get("x-forwarded-proto") || "http")
    const webhookUrl = `${protocol}://${host}/api/integrations/webhooks/generic`

    const samplePayload = {
      name: "Rohit Verma",
      email: "rohit.verma@example.com",
      phone: "+91 98765 43210",
      company: "Apex Healthcare Ltd",
      city: "Mumbai",
      message: "Interested in hospital diagnostic equipment demo.",
      source: "Zapier",
      utm_source: "facebook_leads",
      utm_campaign: "b2b_q4_surge",
    }

    return res.status(200).json({
      success: true,
      configured: true,
      integration: {
        id: integration._id,
        name: integration.name,
        type: integration.type,
        status: integration.status,
        apiKeyMasked: integration.apiKeyMasked || "",
        apiKeyLastRotatedAt: integration.apiKeyLastRotatedAt,
        assignedStaffId: integration.assignedStaffId || "unassigned",
        assignedStaffName: integration.assignedStaffName || "Unassigned",
        duplicateHandling: integration.settings?.duplicateHandling || "update",
        fieldMapping: integration.fieldMapping || [],
        stats: integration.stats || {},
      },
      webhookUrl,
      rawKeyOnce: rawKey || null,
      samplePayload,
    })
  } catch (err) {
    console.error("[Get Generic Config Error]:", err)
    return res.status(500).json({ success: false, error: "Failed to load Generic Connector configuration" })
  }
}

/**
 * POST /api/integrations/generic/connect
 * Authenticated (Admin): Configure or update Generic Connector settings.
 */
const connectGenericIntegration = async (req, res) => {
  try {
    const tenantId = req.user?.tenantId || req.tenantId
    if (!tenantId) {
      return res.status(400).json({ success: false, error: "Missing tenant context" })
    }

    const { duplicateHandling, assignedStaffId, status, fieldMapping } = req.body || {}

    const { integration } = await genericConnectorService.getOrCreateGenericIntegration(tenantId)

    if (duplicateHandling && ["reject", "update", "allow"].includes(duplicateHandling)) {
      integration.settings.duplicateHandling = duplicateHandling
    }

    if (status && ["active", "inactive"].includes(status)) {
      integration.status = status
    }

    if (Array.isArray(fieldMapping)) {
      integration.fieldMapping = fieldMapping
    }

    if (assignedStaffId !== undefined) {
      integration.assignedStaffId = assignedStaffId
      if (assignedStaffId && assignedStaffId !== "unassigned") {
        const staff = await User.findOne({ _id: assignedStaffId, tenantId, status: "active" })
        integration.assignedStaffName = staff ? staff.name : "Unassigned"
      } else {
        integration.assignedStaffName = "Unassigned"
      }
    }

    await integration.save()

    // Audit log
    await audit.logSecurityEvent({
      tenantId,
      actor: {
        userId: req.user?._id || req.user?.id,
        email: req.user?.email,
        role: req.user?.role,
      },
      action: "INTEGRATION_CONFIG_UPDATE",
      targetId: integration._id.toString(),
      targetType: "Integration",
      metadata: {
        type: "generic",
        duplicateHandling: integration.settings.duplicateHandling,
        assignedStaffId: integration.assignedStaffId,
        status: integration.status,
      },
      ip: req.ip,
      userAgent: req.headers["user-agent"],
    })

    return res.status(200).json({
      success: true,
      message: "Generic Connector settings updated successfully",
      integration: {
        id: integration._id,
        status: integration.status,
        apiKeyMasked: integration.apiKeyMasked,
        duplicateHandling: integration.settings.duplicateHandling,
        assignedStaffId: integration.assignedStaffId,
        assignedStaffName: integration.assignedStaffName,
        stats: integration.stats,
      },
    })
  } catch (err) {
    console.error("[Connect Generic Integration Error]:", err)
    return res.status(500).json({ success: false, error: "Failed to update Generic Connector settings" })
  }
}

/**
 * POST /api/integrations/generic/rotate-key
 * Authenticated (Admin): Immediately revokes existing API key and issues a new one.
 */
const rotateGenericKey = async (req, res) => {
  try {
    const tenantId = req.user?.tenantId || req.tenantId
    if (!tenantId) {
      return res.status(400).json({ success: false, error: "Missing tenant context" })
    }

    const { rawKey, maskedKey, rotatedAt } = await genericConnectorService.rotateGenericApiKey(tenantId)

    // Audit log
    await audit.logSecurityEvent({
      tenantId,
      actor: {
        userId: req.user?._id || req.user?.id,
        email: req.user?.email,
        role: req.user?.role,
      },
      action: "INTEGRATION_KEY_ROTATED",
      targetType: "Integration",
      metadata: {
        type: "generic",
        apiKeyMasked: maskedKey,
        rotatedAt,
      },
      ip: req.ip,
      userAgent: req.headers["user-agent"],
    })

    return res.status(200).json({
      success: true,
      message: "Generic Connector API key rotated successfully. Update your Zapier/Make/n8n scenario with the new key.",
      rawKey,
      apiKeyMasked: maskedKey,
      apiKeyLastRotatedAt: rotatedAt,
    })
  } catch (err) {
    console.error("[Rotate Generic Key Error]:", err)
    return res.status(500).json({ success: false, error: "Failed to rotate Generic Connector API key" })
  }
}

/**
 * POST /api/integrations/generic/test
 * Authenticated (Admin): Generates a simulated inbound test lead to verify webhook processing.
 */
const sendGenericTestLead = async (req, res) => {
  try {
    const tenantId = req.user?.tenantId || req.tenantId
    if (!tenantId) {
      return res.status(400).json({ success: false, error: "Missing tenant context" })
    }

    const { integration } = await genericConnectorService.getOrCreateGenericIntegration(tenantId)

    const testPayload = {
      name: "Zapier / Make Test Lead",
      email: `test_generic_${Date.now()}@connector-demo.in`,
      phone: "+91 99887 76655",
      company: "Automation Hub India",
      city: "Hyderabad",
      message: "Simulated test lead dispatched from CRM Lead Feeds test tool.",
      source: "Zapier Test",
      utm_source: "zapier",
      utm_medium: "test_trigger",
      utm_campaign: "integration_verification",
      idempotency_key: `test_evt_${Date.now()}`,
    }

    const result = await genericConnectorService.processGenericLead({
      payload: testPayload,
      integration,
      tenantId,
      headers: { "x-test-simulation": "true" },
      ip: req.ip || "127.0.0.1",
    })

    return res.status(200).json({
      success: true,
      message: "Simulated test lead sent and processed successfully",
      result,
      sampleDispatched: testPayload,
    })
  } catch (err) {
    console.error("[Send Generic Test Lead Error]:", err)
    return res.status(500).json({ success: false, error: "Failed to send simulated test lead" })
  }
}

module.exports = {
  handleGenericWebhook,
  getGenericConfig,
  connectGenericIntegration,
  rotateGenericKey,
  sendGenericTestLead,
}
