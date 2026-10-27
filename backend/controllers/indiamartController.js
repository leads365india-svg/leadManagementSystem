const { Integration } = require("../models/Integration")
const { IntegrationEvent } = require("../models/IntegrationEvent")
const queue = require("../services/queueService")
const audit = require("../services/auditService")
const indiamartService = require("../services/indiamartService")
const { maskSecret } = require("../utils/cryptoUtils")

/**
 * Leads-365 CRM - IndiaMART Integration Controller (Phase 13)
 * 
 * Provides:
 * - POST /api/integrations/indiamart/connect (Secure credential configuration)
 * - GET  /api/integrations/indiamart/status (Connection health & sync metrics)
 * - POST /api/integrations/indiamart/:id/sync (Manual sync trigger)
 * - POST /api/integrations/webhooks/indiamart (Push webhook intake)
 */

/**
 * POST /api/integrations/indiamart/connect
 * Stores encrypted IndiaMART credentials and initializes connector.
 */
const connectIndiaMartIntegration = async (req, res) => {
  try {
    const tenantId = req.tenantId
    if (!tenantId) {
      return res.status(400).json({ success: false, error: "Missing required tenant context" })
    }

    const {
      crmKey,
      mobileNumber = "",
      name = "IndiaMART Lead Manager",
      assignedStaffId = "unassigned",
      assignedStaffName = "Unassigned",
      settings = {},
      fieldMapping = [],
    } = req.body || {}

    if (!crmKey || typeof crmKey !== "string" || crmKey.trim().length < 8) {
      return res.status(400).json({
        success: false,
        error: "Valid IndiaMART glusr_crm_key is required (minimum 8 characters)",
      })
    }

    const cleanCrmKey = crmKey.trim()
    const cleanMobile = typeof mobileNumber === "string" ? mobileNumber.trim() : ""

    // Find existing or initialize new
    let integration = await Integration.findOne({
      tenantId,
      type: "indiamart",
    }).setOptions({ skipTenantFilter: true })

    const isNew = !integration
    if (isNew) {
      integration = new Integration({
        tenantId,
        type: "indiamart",
        name: name.trim(),
        status: "active",
      })
    } else {
      if (name) integration.name = name.trim()
      integration.status = "active"
    }

    // Encrypt credentials securely with AES-256-GCM
    const credentialsPayload = {
      crmKey: cleanCrmKey,
      glusr_crm_key: cleanCrmKey,
      mobileNumber: cleanMobile,
      connectedAt: new Date().toISOString(),
      reconnectNeeded: false,
      reconnectReason: null,
      lastSyncTime: isNew ? null : integration.credentials?.lastSyncTime || null,
    }

    integration.setCredentials(credentialsPayload)
    integration.assignedStaffId = assignedStaffId
    integration.assignedStaffName = assignedStaffName

    if (settings && typeof settings === "object") {
      integration.settings = {
        ...integration.settings?.toObject?.() || {},
        ...settings,
      }
    }

    if (Array.isArray(fieldMapping)) {
      integration.fieldMapping = fieldMapping
    }

    await integration.save()

    // Audit log event
    await audit.log({
      tenantId,
      actor: req.user ? { id: req.user._id, name: req.user.name, email: req.user.email, role: req.user.role } : { role: "admin", name: "Tenant Admin" },
      action: isNew ? "integration.create" : "integration.update",
      entity: "Integration",
      entityId: integration._id,
      summary: `${isNew ? "Connected" : "Updated"} IndiaMART Lead Manager integration`,
      details: {
        type: "indiamart",
        integrationId: integration._id,
        crmKeyMasked: maskSecret(cleanCrmKey),
        assignedStaffName,
      },
      req,
    })

    return res.status(200).json({
      success: true,
      message: "IndiaMART integration configured successfully",
      integration: {
        id: integration._id,
        name: integration.name,
        type: integration.type,
        status: integration.status,
        assignedStaffId: integration.assignedStaffId,
        assignedStaffName: integration.assignedStaffName,
        crmKeyMasked: maskSecret(cleanCrmKey),
        stats: integration.stats,
        lastSyncTime: credentialsPayload.lastSyncTime,
      },
    })
  } catch (err) {
    console.error("[IndiaMART Connect Error]:", err)
    return res.status(500).json({
      success: false,
      error: `Failed to configure IndiaMART integration: ${err.message}`,
    })
  }
}

/**
 * GET /api/integrations/indiamart/status
 * Returns current IndiaMART connection health, sync metrics, and setup guidance.
 */
const getIndiaMartStatus = async (req, res) => {
  try {
    const tenantId = req.tenantId
    if (!tenantId) {
      return res.status(400).json({ success: false, error: "Missing required tenant context" })
    }

    const integration = await Integration.findOne({
      tenantId,
      type: "indiamart",
    }).setOptions({ skipTenantFilter: true })

    if (!integration) {
      return res.status(200).json({
        success: true,
        configured: false,
        status: "disconnected",
        message: "IndiaMART integration has not been configured for this account",
        setupGuide: {
          step1: "Log into IndiaMART Seller portal (seller.indiamart.com)",
          step2: "Navigate to Settings -> Lead Manager -> CRM Integration",
          step3: "Generate your unique glusr_crm_key (CRM Key)",
          step4: "Paste the CRM Key into Leads-365 IndiaMART Connect form",
          step5: "Click 'Connect & Sync' to begin capturing B2B buyer inquiries",
        },
      })
    }

    let creds = null
    try {
      creds = integration.getDecryptedCredentials()
    } catch (e) {
      // Ignored for status
    }

    const crmKey = creds?.crmKey || creds?.glusr_crm_key || ""

    return res.status(200).json({
      success: true,
      configured: true,
      status: integration.status,
      reconnectNeeded: Boolean(creds?.reconnectNeeded),
      reconnectReason: creds?.reconnectReason || null,
      integration: {
        id: integration._id,
        name: integration.name,
        type: integration.type,
        status: integration.status,
        assignedStaffId: integration.assignedStaffId,
        assignedStaffName: integration.assignedStaffName,
        crmKeyMasked: crmKey ? maskSecret(crmKey) : "",
        lastSyncTime: creds?.lastSyncTime || null,
        stats: integration.stats,
        createdAt: integration.createdAt,
        updatedAt: integration.updatedAt,
      },
    })
  } catch (err) {
    console.error("[IndiaMART Status Error]:", err)
    return res.status(500).json({
      success: false,
      error: `Failed to retrieve IndiaMART status: ${err.message}`,
    })
  }
}

/**
 * POST /api/integrations/indiamart/:id/sync
 * Manually triggers an on-demand sync from IndiaMART Lead Manager API v2.
 */
const triggerIndiaMartSync = async (req, res) => {
  try {
    const tenantId = req.tenantId
    const { id } = req.params
    const { async: runAsync = true, lookbackHours = 24 } = req.body || {}

    const integration = await Integration.findOne({
      _id: id,
      tenantId,
      type: "indiamart",
    }).setOptions({ skipTenantFilter: true })

    if (!integration) {
      return res.status(404).json({
        success: false,
        error: "IndiaMART integration not found for this account",
      })
    }

    if (runAsync) {
      // Enqueue background sync job
      const idempotencyKey = `indiamart_sync_${id}_${Math.floor(Date.now() / 60000)}`
      const queueResult = await queue.addJob({
        name: "indiamart.sync_leads",
        tenantId,
        idempotencyKey,
        payload: {
          integrationId: integration._id.toString(),
          options: { lookbackHours },
        },
        maxAttempts: 3,
        backoff: { type: "exponential", delayMs: 15000 },
      })
      const enqueuedJob = queueResult?.job || queueResult

      return res.status(202).json({
        success: true,
        queued: true,
        jobId: enqueuedJob?.jobId || enqueuedJob?._id,
        message: "IndiaMART sync job queued successfully",
      })
    }

    // Synchronous execution (for test harnesses or immediate UI refresh)
    const result = await indiamartService.syncIndiaMartLeads(integration._id, {
      lookbackHours,
      tenantId,
    })

    return res.status(200).json({
      success: true,
      queued: false,
      summary: result,
    })
  } catch (err) {
    console.error("[IndiaMART Sync Error]:", err)
    return res.status(err.statusCode || 500).json({
      success: false,
      error: `IndiaMART sync failed: ${err.message}`,
      reconnectNeeded: Boolean(err.reconnectNeeded),
    })
  }
}

/**
 * POST /api/integrations/webhooks/indiamart
 * Public webhook intake for push-based lead delivery.
 */
const handleIndiaMartWebhook = async (req, res) => {
  try {
    const payload = req.body || {}
    const apiKey = req.headers["x-api-key"] || req.query.api_key

    if (!apiKey) {
      return res.status(401).json({
        success: false,
        error: "Unauthorized: Missing API key for IndiaMART webhook",
      })
    }

    // Locate integration by apiKey
    const { hashApiKey } = require("../utils/cryptoUtils")
    const keyHash = hashApiKey(apiKey)

    const integration = await Integration.findOne({
      apiKeyHash: keyHash,
      type: "indiamart",
      status: "active",
    }).setOptions({ skipTenantFilter: true })

    if (!integration) {
      return res.status(401).json({
        success: false,
        error: "Unauthorized: Invalid API key",
      })
    }

    const result = await indiamartService.processIndiaMartInquiry({
      inquiry: payload,
      integration,
      tenantId: integration.tenantId,
    })

    return res.status(200).json({
      success: true,
      message: "IndiaMART push inquiry ingested successfully",
      action: result.action,
      leadId: result.leadId,
    })
  } catch (err) {
    console.error("[IndiaMART Webhook Error]:", err)
    return res.status(500).json({
      success: false,
      error: `Failed to process webhook: ${err.message}`,
    })
  }
}

module.exports = {
  connectIndiaMartIntegration,
  getIndiaMartStatus,
  triggerIndiaMartSync,
  handleIndiaMartWebhook,
}
