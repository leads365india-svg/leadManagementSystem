const whatsappService = require("../services/whatsappService")

/**
 * Super Admin WhatsApp Controller
 * 
 * Provides centralized administration of:
 * 1. Global Meta App credentials (Verify Token, encrypted App Secret, Graph Version)
 * 2. Per-tenant WhatsApp Business Account & Phone Number mappings
 * 3. Health & ingestion stats across all tenants
 */

/**
 * GET /api/super-admin/whatsapp/config
 * Retrieves global Meta App WhatsApp settings & central webhook URL
 */
const getWhatsAppGlobalConfig = async (req, res) => {
  try {
    const config = await whatsappService.getGlobalConfig()

    // Determine central webhook URL dynamically
    const protocol = req.headers["x-forwarded-proto"] || req.protocol || "https"
    const host = req.get("host") || "localhost:5000"
    const webhookUrl = `${protocol}://${host}/api/integrations/webhooks/whatsapp`

    return res.status(200).json({
      success: true,
      data: {
        ...config,
        webhookUrl,
      },
    })
  } catch (error) {
    console.error("Super Admin getWhatsAppGlobalConfig error:", error)
    return res.status(500).json({
      success: false,
      error: error.message || "Failed to load global WhatsApp configuration",
    })
  }
}

/**
 * PUT /api/super-admin/whatsapp/config
 * Updates global Meta App WhatsApp settings (Verify Token, App Secret, Graph Version)
 */
const updateWhatsAppGlobalConfig = async (req, res) => {
  try {
    const { verifyToken, appSecret, graphApiVersion } = req.body || {}

    const updated = await whatsappService.updateGlobalConfig({
      verifyToken,
      appSecret,
      graphApiVersion,
    })

    const protocol = req.headers["x-forwarded-proto"] || req.protocol || "https"
    const host = req.get("host") || "localhost:5000"
    const webhookUrl = `${protocol}://${host}/api/integrations/webhooks/whatsapp`

    return res.status(200).json({
      success: true,
      message: "Global WhatsApp configuration updated successfully",
      data: {
        ...updated,
        webhookUrl,
      },
    })
  } catch (error) {
    console.error("Super Admin updateWhatsAppGlobalConfig error:", error)
    return res.status(500).json({
      success: false,
      error: error.message || "Failed to update global WhatsApp configuration",
    })
  }
}

/**
 * GET /api/super-admin/whatsapp/tenants
 * Lists all tenant accounts with their WhatsApp connection status and health stats
 */
const listTenantWhatsAppConfigs = async (_req, res) => {
  try {
    const tenants = await whatsappService.listAllTenantConfigs()
    return res.status(200).json({
      success: true,
      data: tenants,
    })
  } catch (error) {
    console.error("Super Admin listTenantWhatsAppConfigs error:", error)
    return res.status(500).json({
      success: false,
      error: error.message || "Failed to list tenant WhatsApp configurations",
    })
  }
}

/**
 * GET /api/super-admin/whatsapp/tenants/:tenantId
 * Retrieves a single tenant's WhatsApp configuration & masked credentials
 */
const getTenantWhatsAppConfig = async (req, res) => {
  try {
    const { tenantId } = req.params
    const config = await whatsappService.getTenantConfig(tenantId)

    if (!config) {
      return res.status(404).json({
        success: false,
        error: `Tenant '${tenantId}' not found`,
      })
    }

    return res.status(200).json({
      success: true,
      data: config,
    })
  } catch (error) {
    console.error("Super Admin getTenantWhatsAppConfig error:", error)
    return res.status(500).json({
      success: false,
      error: error.message || "Failed to load tenant WhatsApp configuration",
    })
  }
}

/**
 * POST /api/super-admin/whatsapp/tenants/:tenantId
 * Assigns or updates a tenant's WhatsApp Cloud API credentials
 */
const saveTenantWhatsAppConfig = async (req, res) => {
  try {
    const { tenantId } = req.params
    const payload = req.body || {}

    const saved = await whatsappService.saveTenantConfig(tenantId, payload)

    return res.status(200).json({
      success: true,
      message: `WhatsApp Cloud API configuration saved for tenant '${tenantId}'`,
      data: saved,
    })
  } catch (error) {
    console.error("Super Admin saveTenantWhatsAppConfig error:", error)
    const statusCode = error.statusCode || 400
    return res.status(statusCode).json({
      success: false,
      error: error.message || "Failed to save tenant WhatsApp configuration",
    })
  }
}

/**
 * DELETE /api/super-admin/whatsapp/tenants/:tenantId
 * Unlinks / removes a tenant's WhatsApp Cloud API integration
 */
const deleteTenantWhatsAppConfig = async (req, res) => {
  try {
    const { tenantId } = req.params
    await whatsappService.deleteTenantConfig(tenantId)

    return res.status(200).json({
      success: true,
      message: `WhatsApp Cloud API unlinked for tenant '${tenantId}'`,
    })
  } catch (error) {
    console.error("Super Admin deleteTenantWhatsAppConfig error:", error)
    return res.status(500).json({
      success: false,
      error: error.message || "Failed to unlink tenant WhatsApp configuration",
    })
  }
}

module.exports = {
  getWhatsAppGlobalConfig,
  updateWhatsAppGlobalConfig,
  listTenantWhatsAppConfigs,
  getTenantWhatsAppConfig,
  saveTenantWhatsAppConfig,
  deleteTenantWhatsAppConfig,
}
