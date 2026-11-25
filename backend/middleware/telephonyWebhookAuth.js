const mongoose = require("mongoose")
const { getTelephonyAdapter } = require("../services/telephony/telephonyAdapterFactory")
const { inboundCallRouter } = require("../services/telephony/inboundCallRouter.service")
const telephonyConfigService = require("../services/telephony/telephonyConfig.service")
const { TenantBusinessProfile } = require("../models/TenantBusinessProfile")
const Call = require("../models/Call")

/**
 * Telephony Webhook Signature & Security Middleware
 * 
 * Verifies carrier cryptographic webhook signatures (Twilio HMAC-SHA1, Exotel token/HMAC, Mock HMAC-SHA256)
 * for BOTH inbound calls and status/recording lifecycle callbacks.
 * Fails closed if tenant/credentials cannot be verified or signature does not match.
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

    // 2. Identify Owning Tenant via called/forwarded number (inbound) OR CallSid (status/recording)
    const parsedEvent = adapter.parseInboundCallWebhook(req.body || {})
    let tenantProfile = await inboundCallRouter.resolveTenantByNumber(parsedEvent.to, parsedEvent.forwardedFrom)

    const callSid =
      parsedEvent.callSid ||
      req.body?.CallSid ||
      req.body?.callSid ||
      req.body?.Sid ||
      req.body?.Call?.Sid ||
      null

    if ((!tenantProfile || !tenantProfile.tenantId) && callSid) {
      const activeSession = inboundCallRouter.activeCallSessions.get(callSid)
      let resolvedTenantId = activeSession?.tenantId || null

      if (!resolvedTenantId && mongoose.connection?.readyState === 1) {
        const callDoc = await Call.findOne({
          $or: [
            { clientCallId: callSid },
            { "metadata.callSid": callSid },
            ...(mongoose.Types.ObjectId.isValid(callSid) ? [{ _id: callSid }] : []),
          ],
        })
          .setOptions({ skipTenantFilter: true })
          .select("tenantId workspaceId")
          .lean()
        if (callDoc?.tenantId) {
          resolvedTenantId = callDoc.tenantId
        }
      }

      if (resolvedTenantId) {
        if (mongoose.connection?.readyState === 1) {
          tenantProfile = await TenantBusinessProfile.findOne({ tenantId: resolvedTenantId })
            .setOptions({ skipTenantFilter: true })
            .lean()
        }
        if (!tenantProfile) {
          tenantProfile = { tenantId: resolvedTenantId }
        }
      }
    }

    // Fail closed for real providers if tenant could not be resolved from verified number or CallSid
    if (provider !== "mock" && (!tenantProfile || !tenantProfile.tenantId)) {
      return res.status(401).json({
        success: false,
        error: "Telephony webhook authentication failed: unable to resolve verified tenant",
      })
    }

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

    if (!authToken) {
      return res.status(401).json({
        success: false,
        error: "Telephony webhook authentication failed: missing provider credentials",
      })
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
      callSid,
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
