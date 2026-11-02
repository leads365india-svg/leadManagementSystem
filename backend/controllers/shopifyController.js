const shopifyService = require("../services/shopifyService")
const { Integration } = require("../models/Integration")

/**
 * Leads-365 CRM - Shopify Controller (Phase 3A)
 *
 * Exposes:
 * - POST /api/integrations/webhooks/shopify (Public Webhook Endpoint)
 * - POST /api/integrations/shopify/connect (Authenticated Admin Endpoint)
 * - GET /api/integrations/shopify/status (Authenticated Admin Endpoint)
 */

/**
 * POST /api/integrations/webhooks/shopify
 *
 * Authenticates incoming Shopify webhooks via HMAC-SHA256,
 * deduplicates via X-Shopify-Webhook-Id, and ingests leads.
 */
const handleShopifyWebhook = async (req, res) => {
  try {
    const rawBody = req.rawBody || req.body
    const headers = req.headers || {}
    const body = req.body || {}
    const ip = req.ip || req.connection?.remoteAddress || "unknown"

    const result = await shopifyService.processShopifyWebhook({
      rawBody,
      headers,
      body,
      ip,
    })

    return res.status(result.status || 200).json(result)
  } catch (error) {
    console.error("[Shopify Webhook Error]:", error.message)
    return res.status(500).json({
      success: false,
      status: 500,
      error: "Internal server error while processing Shopify webhook",
    })
  }
}

/**
 * POST /api/integrations/shopify/connect
 *
 * Configures or updates a Shopify store integration for the authenticated tenant.
 */
const connectShopifyIntegration = async (req, res) => {
  try {
    const tenantId = req.user.tenantId
    const { shopDomain, sharedSecret, duplicateHandling, name } = req.body

    if (!shopDomain || !shopifyService.validateShopDomain(shopDomain)) {
      return res.status(400).json({
        success: false,
        error: "Valid shopDomain is required (e.g. your-store.myshopify.com)",
      })
    }

    if (!sharedSecret || typeof sharedSecret !== "string" || sharedSecret.trim().length < 8) {
      return res.status(400).json({
        success: false,
        error: "Shopify app shared secret is required (minimum 8 characters)",
      })
    }

    const cleanDomain = shopDomain.trim().toLowerCase()

    let integration = await Integration.findOne({
      tenantId,
      type: "shopify",
    })

    if (!integration) {
      integration = new Integration({
        tenantId,
        name: name || `Shopify (${cleanDomain})`,
        type: "shopify",
        status: "active",
        settings: {
          shopifyShopDomain: cleanDomain,
          shopifySharedSecret: sharedSecret.trim(),
          duplicateHandling: duplicateHandling || "reject",
        },
      })
    } else {
      integration.name = name || integration.name
      integration.status = "active"
      integration.settings.shopifyShopDomain = cleanDomain
      integration.settings.shopifySharedSecret = sharedSecret.trim()
      if (duplicateHandling) {
        integration.settings.duplicateHandling = duplicateHandling
      }
    }

    await integration.save()

    return res.status(200).json({
      success: true,
      message: "Shopify integration configured successfully",
      data: {
        id: integration._id,
        name: integration.name,
        type: "shopify",
        shopDomain: cleanDomain,
        status: integration.status,
        duplicateHandling: integration.settings.duplicateHandling,
        webhookUrl: "/api/integrations/webhooks/shopify",
      },
    })
  } catch (error) {
    console.error("[Shopify Connect Error]:", error)
    return res.status(500).json({
      success: false,
      error: "Failed to configure Shopify integration",
    })
  }
}

/**
 * GET /api/integrations/shopify/status
 */
const getShopifyStatus = async (req, res) => {
  try {
    const tenantId = req.user.tenantId
    const integration = await Integration.findOne({
      tenantId,
      type: "shopify",
    }).lean()

    if (!integration) {
      return res.status(200).json({
        success: true,
        configured: false,
        status: "not_configured",
      })
    }

    return res.status(200).json({
      success: true,
      configured: true,
      status: integration.status,
      data: {
        id: integration._id,
        name: integration.name,
        shopDomain: integration.settings?.shopifyShopDomain,
        duplicateHandling: integration.settings?.duplicateHandling,
        webhookUrl: "/api/integrations/webhooks/shopify",
        stats: integration.stats,
      },
    })
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: "Failed to retrieve Shopify status",
    })
  }
}

module.exports = {
  handleShopifyWebhook,
  connectShopifyIntegration,
  getShopifyStatus,
}
