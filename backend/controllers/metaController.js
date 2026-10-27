const crypto = require("crypto")
const { Integration } = require("../models/Integration")
const { IntegrationEvent } = require("../models/IntegrationEvent")
const Lead = require("../models/Lead")
const Account = require("../models/Account")
const queue = require("../services/queueService")
const audit = require("../services/auditService")
const metaService = require("../services/metaService")
const { generateApiKey, hashApiKey, maskSecret } = require("../utils/cryptoUtils")

/**
 * Leads-365 CRM - Meta Lead Ads Controller (Phase 12)
 * 
 * Handles:
 * - GET /api/integrations/webhooks/meta (Handshake verification)
 * - POST /api/integrations/webhooks/meta (Signature verification & fast queueing)
 * - POST /api/integrations/meta/connect (Connect Page & store encrypted token)
 * - GET /api/integrations/meta/auth-url (OAuth Connect flow URL)
 * - POST /api/integrations/meta/:id/backfill (Trigger historical backfill/reconciliation)
 */

/**
 * GET /api/integrations/webhooks/meta
 * Answers Meta's verification handshake challenge
 */
const handleMetaWebhookHandshake = async (req, res) => {
  const result = metaService.verifyWebhookHandshake(req.query)
  if (result.isValid) {
    return res.status(200).send(result.challenge)
  }
  return res.status(403).json({
    success: false,
    error: "Forbidden: Invalid verify token or handshake mode",
  })
}

/**
 * POST /api/integrations/webhooks/meta
 * Ingests incoming leadgen notifications from Meta
 */
const handleMetaWebhookNotification = async (req, res) => {
  const body = req.body || {}
  const signature = req.headers["x-hub-signature-256"]

  // Validate top-level object
  if (body.object !== "page" || !Array.isArray(body.entry) || body.entry.length === 0) {
    return res.status(400).json({
      success: false,
      error: "Invalid Meta webhook payload format. Expected object: 'page' with entries",
    })
  }

  // 1. Locate relevant pageId from first entry
  const firstEntry = body.entry[0]
  const pageId = firstEntry.id

  // 2. Identify tenant & integration from Page ID
  // Query Integration collection for active Meta connector with this pageId
  const allMetaIntegrations = await Integration.find({
    type: "meta",
    status: { $in: ["active", "error"] },
  }).setOptions({ skipTenantFilter: true })

  let targetIntegration = null
  let decryptedCreds = null

  for (const integration of allMetaIntegrations) {
    try {
      const creds = integration.getDecryptedCredentials()
      if (creds && creds.pageId === pageId) {
        targetIntegration = integration
        decryptedCreds = creds
        break
      }
    } catch (_) {}
  }

  // Fallback to app-level secret if per-integration secret not matched
  const appSecret =
    decryptedCreds?.appSecret ||
    process.env.META_APP_SECRET ||
    ""

  // 3. Cryptographically verify X-Hub-Signature-256
  // (In test environments without appSecret configured, verify if signature check is bypassed or provided)
  if (appSecret) {
    const rawBody = req.rawBody || JSON.stringify(body)
    const isAuthentic = metaService.verifyWebhookSignature(rawBody, signature, appSecret)
    if (!isAuthentic) {
      return res.status(403).json({
        success: false,
        error: "Forbidden: Invalid X-Hub-Signature-256",
      })
    }
  } else if (signature) {
    // If signature provided but appSecret missing in environment
    return res.status(403).json({
      success: false,
      error: "Forbidden: Signature provided but Meta App Secret is not configured in CRM",
    })
  }

  if (!targetIntegration) {
    // Page is not connected to any active tenant CRM account
    return res.status(404).json({
      success: false,
      error: `No active CRM integration found for Facebook Page ID: ${pageId}`,
    })
  }

  const tenantId = targetIntegration.tenantId

  // Verify tenant account is active
  const account = await Account.findOne({ accountId: tenantId }).lean()
  if (account && account.status === "suspended") {
    return res.status(403).json({
      success: false,
      error: "Integration disabled: Account is suspended",
    })
  }

  // 4. Process entries and queue lead intake
  let queuedCount = 0

  for (const entry of body.entry) {
    const changes = entry.changes || []
    for (const change of changes) {
      if (change.field === "leadgen") {
        const val = change.value || {}
        const leadgenId = val.leadgen_id
        const formId = val.form_id
        const adId = val.ad_id
        const createdTime = val.created_time

        if (!leadgenId) continue

        // Check idempotency on Meta lead ID
        const existingLead = await Lead.findOne({
          tenantId,
          "metadata.metaLeadId": leadgenId,
        }).lean()

        if (existingLead) {
          // Already imported, skip duplicate queueing
          continue
        }

        // Record append-only IntegrationEvent in 'queued' state
        const event = await IntegrationEvent.create({
          tenantId,
          integrationId: targetIntegration._id,
          integrationType: "meta",
          idempotencyKey: `meta_lead_${leadgenId}`,
          headers: req.headers,
          rawPayload: change,
          source: "Facebook",
          status: "queued",
          httpStatus: 202,
        })

        // Enqueue background processing job
        await queue.addJob({
          name: "meta.lead_process",
          tenantId,
          idempotencyKey: `meta_lead_${leadgenId}`,
          payload: {
            eventId: event._id.toString(),
            tenantId,
            integrationId: targetIntegration._id.toString(),
            leadgenId,
            formId,
            pageId: entry.id,
            adId,
            createdTime,
          },
        })

        queuedCount++
      }
    }
  }

  // Fast 200 OK return required by Meta within seconds
  return res.status(200).json({
    success: true,
    message: "Meta webhook notifications accepted and queued",
    queuedCount,
  })
}

/**
 * POST /api/integrations/meta/connect
 * Authenticated (requireAccountAdmin): Connect or configure Meta Page & Lead Forms
 */
const connectMetaIntegration = async (req, res) => {
  try {
    const tenantId = req.user.tenantId
    const {
      name = "Meta Lead Ads",
      pageId,
      pageName,
      pageAccessToken,
      appSecret,
      verifyToken,
      forms = [],
      duplicateHandling = "update",
      assignedStaffId = "unassigned",
      customFetch = null,
    } = req.body

    if (!pageId || !pageAccessToken) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: pageId and pageAccessToken are required to connect Meta Lead Ads",
      })
    }

    // Attempt to subscribe page to leadgen events via Graph API
    let subscribed = false
    try {
      await metaService.subscribePageToLeadgen(pageId, pageAccessToken, customFetch)
      subscribed = true
    } catch (subErr) {
      console.warn(`Could not automatically subscribe Page ${pageId} to leadgen:`, subErr.message)
    }

    // Upsert Integration document
    let integration = await Integration.findOne({
      tenantId,
      type: "meta",
    })

    const rawApiKey = generateApiKey()
    const apiKeyHash = hashApiKey(rawApiKey)
    const apiKeyMasked = maskSecret(rawApiKey)

    if (!integration) {
      integration = new Integration({
        tenantId,
        name: name.trim(),
        type: "meta",
        status: "active",
        apiKeyHash,
        apiKeyMasked,
        assignedStaffId,
        settings: {
          duplicateHandling,
          forms: Array.isArray(forms) ? forms : [],
          pageName: pageName || `Page ${pageId}`,
        },
      })
    } else {
      integration.name = name.trim()
      integration.status = "active"
      integration.assignedStaffId = assignedStaffId
      integration.settings = {
        ...integration.settings,
        duplicateHandling,
        forms: Array.isArray(forms) ? forms : integration.settings?.forms || [],
        pageName: pageName || integration.settings?.pageName || `Page ${pageId}`,
      }
    }

    // Encrypt Page Access Token and Secrets
    integration.setCredentials({
      pageId,
      pageName: pageName || `Page ${pageId}`,
      pageAccessToken,
      appSecret: appSecret || process.env.META_APP_SECRET || "",
      verifyToken: verifyToken || process.env.META_VERIFY_TOKEN || metaService.DEFAULT_VERIFY_TOKEN,
      subscribed,
      reconnectNeeded: false,
      reconnectReason: "",
      connectedAt: new Date(),
    })

    await integration.save()

    await audit.log({
      tenantId,
      actor: req.user,
      action: "integration.meta_connected",
      entity: "integration",
      entityId: integration._id,
      summary: `Connected Facebook Page ${pageName || pageId} for Meta Lead Ads`,
      details: { pageId, pageName, subscribed },
      req,
    })

    return res.status(200).json({
      success: true,
      message: "Meta Lead Ads connected successfully",
      subscribed,
      data: integration,
    })
  } catch (err) {
    console.error("Error connecting Meta integration:", err)
    return res.status(500).json({
      success: false,
      error: err.message || "Failed to connect Meta integration",
    })
  }
}

/**
 * GET /api/integrations/meta/auth-url
 * Returns Facebook Login authorization URL for starting OAuth flow
 */
const getMetaAuthUrl = async (req, res) => {
  const appId = process.env.META_APP_ID
  const redirectUri = process.env.META_REDIRECT_URI || `${req.protocol}://${req.get("host")}/api/integrations/meta/callback`
  const tenantId = req.user.tenantId

  if (!appId) {
    return res.status(200).json({
      success: false,
      configured: false,
      message: "Meta App ID (META_APP_ID) is not configured in environment.",
      setupInstructions: {
        step1: "Create a Meta App in Meta for Developers (https://developers.facebook.com).",
        step2: "Add 'Facebook Login' and 'Webhooks' products.",
        step3: "Request permissions: leads_retrieval, pages_manage_ads, pages_manage_metadata, pages_show_list, pages_read_engagement, ads_management.",
        step4: "Set META_APP_ID and META_APP_SECRET in backend .env.",
      },
    })
  }

  // Create CSRF state token tied to tenant
  const state = crypto.randomBytes(16).toString("hex") + `:${tenantId}`
  const scope = "leads_retrieval,pages_manage_ads,pages_manage_metadata,pages_show_list,pages_read_engagement,ads_management"
  const authUrl = `https://www.facebook.com/v19.0/dialog/oauth?client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}&scope=${scope}`

  return res.status(200).json({
    success: true,
    configured: true,
    authUrl,
  })
}

/**
 * POST /api/integrations/meta/:id/backfill
 * Authenticated: Trigger reconciliation or historical backfill of form leads
 */
const triggerMetaBackfill = async (req, res) => {
  try {
    const tenantId = req.user.tenantId
    const integrationId = req.params.id
    const { days = 7 } = req.body

    const integration = await Integration.findOne({ _id: integrationId, tenantId })
    if (!integration || integration.type !== "meta") {
      return res.status(404).json({ success: false, error: "Meta integration not found" })
    }

    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    const result = await metaService.reconcileMetaLeads(integrationId, { since })

    await audit.log({
      tenantId,
      actor: req.user,
      action: "integration.meta_backfill",
      entity: "integration",
      entityId: integration._id,
      summary: `Triggered Meta Lead backfill (last ${days} days): ${result.imported} imported, ${result.skipped} skipped`,
      details: result,
      req,
    })

    return res.status(200).json({
      success: true,
      message: `Backfill completed: ${result.imported} leads imported, ${result.skipped} duplicates skipped`,
      data: result,
    })
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err.message || "Failed to execute Meta backfill",
    })
  }
}

module.exports = {
  handleMetaWebhookHandshake,
  handleMetaWebhookNotification,
  connectMetaIntegration,
  getMetaAuthUrl,
  triggerMetaBackfill,
}
