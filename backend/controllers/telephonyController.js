const telephonyConfigService = require("../services/telephony/telephonyConfig.service")
const { getEffectiveTenant } = require("../middleware/tenantContext")
const { inboundCallRouter } = require("../services/telephony/inboundCallRouter.service")
const { getTelephonyAdapter } = require("../services/telephony/telephonyAdapterFactory")

/**
 * Leads365 AI Receptionist — Telephony Controller
 * 
 * Provides:
 * 1. Authenticated, tenant-isolated REST endpoints for telephony configuration.
 * 2. Inbound carrier webhook handlers (Twilio, Exotel, Mock).
 * 3. Human-first call routing & WebSocket streaming instruction generation.
 * 4. Call status & recording lifecycle webhooks.
 */

/**
 * GET /api/telephony/config
 * Retrieves the current telephony configuration for the authenticated tenant.
 * Plaintext credentials and encrypted ciphertexts are NEVER exposed in response.
 */
const getTelephonyConfig = async (req, res) => {
  try {
    const { tenantId } = getEffectiveTenant(req)
    if (!tenantId) {
      return res.status(400).json({
        success: false,
        error: "Tenant context not found on user session",
      })
    }

    const config = await telephonyConfigService.getTenantTelephonyConfig(tenantId)

    return res.status(200).json({
      success: true,
      data: config,
    })
  } catch (error) {
    console.error("❌ Failed to get telephony config:", error.message)
    return res.status(500).json({
      success: false,
      error: error.message || "Failed to retrieve telephony configuration",
    })
  }
}

/**
 * PUT /api/telephony/config
 * Updates telephony configuration and optionally rotates/encrypts provider credentials.
 * Enforces AES-256-GCM encryption, fail-closed validation, and audit logging.
 */
const updateTelephonyConfig = async (req, res) => {
  try {
    const { tenantId } = getEffectiveTenant(req)
    if (!tenantId) {
      return res.status(400).json({
        success: false,
        error: "Tenant context not found on user session",
      })
    }

    const updatedConfig = await telephonyConfigService.updateTenantTelephonyConfig(
      tenantId,
      req.body || {},
      req.user,
      req
    )

    return res.status(200).json({
      success: true,
      message: "Telephony configuration updated successfully",
      data: updatedConfig,
    })
  } catch (error) {
    console.error("❌ Failed to update telephony config:", error.message)
    const statusCode = error.message?.includes("Invalid") || error.message?.includes("must be") ? 400 : 500
    return res.status(statusCode).json({
      success: false,
      error: error.message || "Failed to update telephony configuration",
    })
  }
}

/**
 * POST /api/telephony/webhook/inbound
 * POST /api/telephony/webhook/inbound/:provider
 * 
 * Handles incoming call webhooks from carriers (Twilio, Exotel, Mock).
 * Resolves tenant identity from called/forwarded phone numbers.
 * Enforces human-first routing (unanswered-only call forwarding).
 * Returns provider-compliant streaming XML/JSON.
 */
const handleInboundCallWebhook = async (req, res) => {
  try {
    const provider = req.telephony?.provider || req.params.provider || req.body?.provider || "mock"
    const adapter = req.telephony?.adapter || getTelephonyAdapter(provider)
    const inboundEvent = req.telephony?.parsedEvent || adapter.parseInboundCallWebhook(req.body || {})

    // Evaluate Human-First Routing
    const routingResult = await inboundCallRouter.routeInboundCall(inboundEvent)

    // Handle Unmapped Numbers
    if (routingResult.decision === "rejected" && routingResult.reason === "unmapped_phone_number") {
      if (provider === "twilio") {
        res.type("text/xml").status(404).send(routingResult.responsePayload)
      } else {
        res.status(404).json({
          success: false,
          error: "Unmapped destination phone number",
          routingResult,
        })
      }
      return
    }

    // Return Provider-Compliant Stream Connection Instruction
    if (routingResult.contentType === "text/xml") {
      res.type("text/xml").status(200).send(routingResult.responsePayload)
    } else {
      res.status(200).json({
        success: true,
        ...routingResult,
      })
    }
  } catch (error) {
    console.error("❌ Error processing inbound telephony webhook:", error.message)
    return res.status(500).json({
      success: false,
      error: "Internal error processing inbound telephony call",
    })
  }
}

/**
 * POST /api/telephony/webhook/status
 * POST /api/telephony/webhook/status/:provider
 * 
 * Handles call status updates (ringing, answered, completed, failed, busy).
 */
const handleCallStatusWebhook = async (req, res) => {
  try {
    const provider = req.params.provider || req.body?.provider || "mock"
    const callSid = req.body?.CallSid || req.body?.callSid
    const status = req.body?.CallStatus || req.body?.status || req.body?.event

    if (callSid) {
      inboundCallRouter.handleLifecycleEvent({
        callSid,
        provider,
        status,
        durationSeconds: Number(req.body?.CallDuration || req.body?.duration || 0),
        failureReason: req.body?.Reason || req.body?.failureReason || null,
      })
    }

    return res.status(200).json({ success: true, callSid, status })
  } catch (error) {
    console.error("❌ Call status webhook error:", error.message)
    return res.status(500).json({ success: false, error: error.message })
  }
}

/**
 * POST /api/telephony/webhook/recording
 * POST /api/telephony/webhook/recording/:provider
 * 
 * Handles recording completion callback from carrier switches.
 */
const handleRecordingStatusWebhook = async (req, res) => {
  try {
    const provider = req.params.provider || req.body?.provider || "mock"
    const adapter = getTelephonyAdapter(provider)
    const recordingEvent = adapter.parseRecordingWebhook(req.body || {})

    inboundCallRouter.handleLifecycleEvent({
      callSid: recordingEvent.callSid,
      provider,
      status: "recording_completed",
      recordingUrl: recordingEvent.recordingUrl,
      durationSeconds: recordingEvent.durationSeconds,
    })

    return res.status(200).json({ success: true, recordingEvent })
  } catch (error) {
    console.error("❌ Recording status webhook error:", error.message)
    return res.status(500).json({ success: false, error: error.message })
  }
}

module.exports = {
  getTelephonyConfig,
  updateTelephonyConfig,
  handleInboundCallWebhook,
  handleCallStatusWebhook,
  handleRecordingStatusWebhook,
}
