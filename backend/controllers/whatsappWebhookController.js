const whatsappService = require("../services/whatsappService")

/**
 * WhatsApp Cloud API Central Multi-Tenant Webhook Controller
 * 
 * Serves as the single central webhook endpoint for all CRM tenants:
 * - GET: Meta verification handshake
 * - POST: Signature verification, fast 200 response, and multi-tenant routing
 */

/**
 * GET /api/integrations/webhooks/whatsapp
 * Answers Meta's verification handshake challenge
 */
const handleWhatsAppWebhookHandshake = async (req, res) => {
  try {
    const handshake = await whatsappService.verifyWebhookHandshake(req.query)

    if (handshake.isValid) {
      // Must respond with the raw challenge string as text/plain HTTP 200
      return res.status(200).type("text/plain").send(handshake.challenge)
    }

    return res.status(403).send("Forbidden: Invalid verify token or handshake mode")
  } catch (error) {
    console.error("WhatsApp webhook handshake error:", error)
    return res.status(500).send("Handshake processing error")
  }
}

/**
 * POST /api/integrations/webhooks/whatsapp
 * Central webhook ingest for all tenant WhatsApp numbers
 */
const handleWhatsAppWebhookNotification = async (req, res) => {
  const body = req.body || {}
  const signature = req.headers["x-hub-signature-256"]

  // 1. Fail closed unless App Secret is configured AND X-Hub-Signature-256 validates cryptographically
  try {
    const globalConfig = await whatsappService.getGlobalConfig()
    if (!globalConfig.appSecret) {
      return res.status(403).json({
        success: false,
        error: "Forbidden: WhatsApp App Secret is not configured; webhook signature cannot be verified",
      })
    }

    const rawBody = req.rawBody || JSON.stringify(body)
    const isAuthentic = whatsappService.verifyWebhookSignature(
      rawBody,
      signature,
      globalConfig.appSecret
    )

    if (!isAuthentic) {
      return res.status(403).json({
        success: false,
        error: "Forbidden: Invalid or missing X-Hub-Signature-256 HMAC signature",
      })
    }
  } catch (sigErr) {
    console.error("Error during WhatsApp webhook signature check:", sigErr)
    return res.status(403).json({ success: false, error: "Signature verification failed" })
  }

  // 2. Respond HTTP 200 immediately to prevent Meta webhook retry timeouts
  // We process synchronously or quickly before ending, but ensure status 200 is always sent
  try {
    const results = await whatsappService.processWebhookPayload(body)
    return res.status(200).json({
      success: true,
      data: results,
    })
  } catch (processErr) {
    console.error("Error processing WhatsApp webhook payload:", processErr)
    // Return 200 even on unexpected parsing errors so Meta doesn't retry invalid payloads endlessly
    return res.status(200).json({
      success: false,
      error: processErr.message,
    })
  }
}

module.exports = {
  handleWhatsAppWebhookHandshake,
  handleWhatsAppWebhookNotification,
}
