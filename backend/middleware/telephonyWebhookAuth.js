const { getTelephonyAdapter } = require("../services/telephony/telephonyAdapterFactory")
const { inboundCallRouter } = require("../services/telephony/inboundCallRouter.service")
const telephonyConfigService = require("../services/telephony/telephonyConfig.service")

/**
 * Telephony Webhook Signature & Security Middleware
 * 
 * Verifies carrier cryptographic webhook signatures (Twilio HMAC-SHA1, Exotel token/HMAC, Mock HMAC-SHA256).
 * Fails closed if signature does not match or if called number is unknown.
 */
async function telephonyWebhookAuth(req, res, next) {
  try {
    // 1. Determine Provider
    let provider = (req.params.provider || "").toLowerCase().trim()
    if (!provider) {
      if (req.headers["x-mock-signature"]) {
        provider = "mock"
      } else if (req.headers["x-twilio-signature"]) {
        provider = "twilio"
      } else if (req.headers["x-exotel-signature"] || req.headers["x-exotel-token"]) {
        provider = "exotel"
      } else {
        provider = req.body?.provider || "mock"
      }
    }

    let adapter
    try {
      adapter = getTelephonyAdapter(provider)
    } catch (_) {
      return res.status(400).json({
        success: false,
        error: `Unsupported telephony provider webhook: '${provider}'`,
      })
    }

    // 2. Extract Phone Numbers to Identify Owning Tenant
    const parsedEvent = adapter.parseInboundCallWebhook(req.body || {})
    const tenantProfile = await inboundCallRouter.resolveTenantByNumber(parsedEvent.to, parsedEvent.forwardedFrom)

    // 3. Resolve Decrypted Credentials
    let authToken = ""
    if (provider === "mock") {
      authToken = process.env.MOCK_TELEPHONY_SECRET || "mock-telephony-secret-key-365"
    } else if (tenantProfile?.telephonyConfig?.authToken || tenantProfile?.telephonyConfig?.apiToken) {
      authToken = tenantProfile.telephonyConfig.authToken || tenantProfile.telephonyConfig.apiToken
    } else if (tenantProfile?.tenantId) {
      try {
        const creds = await telephonyConfigService.getDecryptedTelephonyCredentials(tenantProfile.tenantId)
        if (provider === "twilio") {
          authToken = creds?.authToken || ""
        } else if (provider === "exotel") {
          authToken = creds?.apiToken || creds?.apiKey || ""
        }
      } catch (err) {
        console.error("⚠️ Failed to decrypt provider credentials during webhook auth:", err.message)
      }
    }

    // 4. Validate Webhook Cryptographic Signature
    const protocol = req.headers["x-forwarded-proto"] || req.protocol || "http"
    const host = req.headers["x-forwarded-host"] || req.headers.host
    const fullUrl = `${protocol}://${host}${req.originalUrl}`

    const isValid = adapter.validateWebhookSignature({
      url: fullUrl,
      headers: req.headers,
      body: req.body,
      authToken,
    })

    if (!isValid) {
      return res.status(401).json({
        success: false,
        error: "Telephony webhook signature verification failed",
      })
    }

    // Attach verified context
    req.telephony = {
      provider,
      adapter,
      parsedEvent,
      tenantProfile,
    }

    next()
  } catch (err) {
    console.error("❌ Telephony webhook authentication error:", err.message)
    return res.status(500).json({
      success: false,
      error: "Internal webhook security validation failure",
    })
  }
}

module.exports = telephonyWebhookAuth
