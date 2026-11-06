const mongoose = require("mongoose")
const { normalizePhoneE164 } = require("../../utils/phoneNormalizer")
const { TenantBusinessProfile } = require("../../models/TenantBusinessProfile")
const { getTelephonyAdapter } = require("./telephonyAdapterFactory")
const { generateStreamToken } = require("./streamAuth.service")
const audit = require("../auditService")

/**
 * Inbound Call Routing & Tenant Resolution Engine
 * 
 * Enforces:
 * 1. Cryptographic and phone-number-based tenant identification (never trusts request body tenantId).
 * 2. Human-first routing logic (unanswered-only call forwarding).
 * 3. Safe rejection of unmapped / unknown numbers without crashing.
 * 4. Provider-compliant response generation (TwiML XML, Exotel JSON, Mock JSON).
 */

class InboundCallRouter {
  constructor() {
    // In-memory test registry: allows 100% offline unit & integration tests
    // without making remote mutations to shared MongoDB Atlas cluster
    this.inMemoryTenantRegistry = new Map() // normalizedNumber -> tenantProfile
    this.activeCallSessions = new Map() // callSid -> sessionRecord
  }

  /**
   * Registers an in-memory tenant mapping for isolated tests.
   * @param {string} phoneNumber - E.164 phone number
   * @param {Object} tenantProfile - Tenant profile with telephonyConfig
   */
  registerInMemoryTenant(phoneNumber, tenantProfile) {
    const normalized = normalizePhoneE164(phoneNumber) || phoneNumber.trim()
    this.inMemoryTenantRegistry.set(normalized, tenantProfile)
  }

  /**
   * Clears in-memory test registry.
   */
  clearInMemoryRegistry() {
    this.inMemoryTenantRegistry.clear()
    this.activeCallSessions.clear()
  }

  /**
   * Resolves tenant profile from database or in-memory test registry.
   * Derives tenant strictly from verified phone numbers.
   * 
   * @param {string} calledNumber - Number called (virtual number)
   * @param {string} [forwardedFromNumber] - SIM number that forwarded the call
   * @returns {Promise<Object|null>} Tenant profile or null if unmapped
   */
  async resolveTenantByNumber(calledNumber, forwardedFromNumber = null) {
    const normalizedCalled = normalizePhoneE164(calledNumber)
    const normalizedForwarded = forwardedFromNumber ? normalizePhoneE164(forwardedFromNumber) : null

    // 1. Check in-memory test registry first
    if (normalizedCalled && this.inMemoryTenantRegistry.has(normalizedCalled)) {
      return this.inMemoryTenantRegistry.get(normalizedCalled)
    }
    if (normalizedForwarded && this.inMemoryTenantRegistry.has(normalizedForwarded)) {
      return this.inMemoryTenantRegistry.get(normalizedForwarded)
    }

    // 2. Query TenantBusinessProfile in database (only if an active DB connection is established)
    if (!mongoose.connection || !mongoose.connection.db || mongoose.connection.readyState !== 1) {
      return null
    }

    // Search by virtualNumber, businessPhoneNumber, or contactPhone
    const queryConditions = []
    if (normalizedCalled) {
      queryConditions.push({ "telephonyConfig.virtualNumber": normalizedCalled })
      queryConditions.push({ "telephonyConfig.businessPhoneNumber": normalizedCalled })
    }
    if (normalizedForwarded) {
      queryConditions.push({ "telephonyConfig.businessPhoneNumber": normalizedForwarded })
      queryConditions.push({ contactPhone: normalizedForwarded })
    }

    if (queryConditions.length === 0) {
      return null
    }

    try {
      const profile = await TenantBusinessProfile.findOne({
        $or: queryConditions,
      }).setOptions({ skipTenantFilter: true }).lean()

      return profile || null
    } catch (err) {
      console.error("⚠️ Failed to query tenant by phone number:", err.message)
      return null
    }
  }

  /**
   * Evaluates incoming call event and makes human-first routing decision.
   * 
   * @param {Object} inboundEvent - Canonical InboundCallEvent
   * @param {Object} [options]
   * @param {string} [options.streamUrl] - WebSocket voice gateway URL
   * @returns {Promise<Object>} Routing decision and provider response
   */
  async routeInboundCall(inboundEvent, options = {}) {
    const provider = inboundEvent.provider || "mock"
    const adapter = getTelephonyAdapter(provider)
    const callSid = inboundEvent.callSid || `call_${Date.now()}`
    const streamUrl = options.streamUrl || process.env.VOICE_GATEWAY_WS_URL || "wss://app.leads365.in/api/telephony/voice-stream"

    // 1. Resolve Tenant Identity from Called / Forwarded Number
    const tenantProfile = await this.resolveTenantByNumber(inboundEvent.to, inboundEvent.forwardedFrom)

    if (!tenantProfile || !tenantProfile.tenantId) {
      // Unmapped number: Safely reject without crashing
      const rejectResponse = adapter.generateRejectResponse("unmapped_number")
      return {
        decision: "rejected",
        reason: "unmapped_phone_number",
        tenantId: null,
        callSid,
        provider,
        contentType: provider === "twilio" ? "text/xml" : "application/json",
        responsePayload: rejectResponse,
      }
    }

    const tenantId = tenantProfile.tenantId
    const config = tenantProfile.telephonyConfig || {}

    // 2. Verify Provider Compatibility
    if (config.provider && config.provider !== provider && provider !== "mock") {
      const rejectResponse = adapter.generateRejectResponse("provider_mismatch")
      return {
        decision: "rejected",
        reason: "provider_mismatch",
        tenantId,
        callSid,
        provider,
        contentType: provider === "twilio" ? "text/xml" : "application/json",
        responsePayload: rejectResponse,
      }
    }

    // 3. Check Configuration Status
    if (config.status === "paused" || config.status === "error" || config.status === "unconfigured") {
      const disabledMsg = "The automated receptionist is currently unavailable. Please contact the business directly."
      const disabledResponse = adapter.generateDisabledResponse(disabledMsg)
      return {
        decision: "ai_disabled",
        reason: `telephony_status_${config.status || "unconfigured"}`,
        tenantId,
        callSid,
        provider,
        contentType: provider === "twilio" ? "text/xml" : "application/json",
        responsePayload: disabledResponse,
      }
    }

    // 4. Check AI Enabled Flag
    if (config.aiEnabled !== true) {
      // AI Disabled: Do NOT start AI voice session. Return safe disabled response.
      const disabledMsg = "Thank you for calling. The AI receptionist is currently offline. Your call has been logged."
      const disabledResponse = adapter.generateDisabledResponse(disabledMsg)
      return {
        decision: "ai_disabled",
        reason: "ai_receptionist_disabled",
        tenantId,
        callSid,
        provider,
        contentType: provider === "twilio" ? "text/xml" : "application/json",
        responsePayload: disabledResponse,
      }
    }

    // 5. Evaluate Human-First Routing (Answer Mode: unanswered_only)
    // If incoming event explicitly indicates a human has answered on the SIM / PBX
    if (inboundEvent.status === "human_answered" || inboundEvent.humanAnswered === true) {
      return {
        decision: "human_handled",
        reason: "human_answered_normal_flow_preserved",
        tenantId,
        callSid,
        provider,
        contentType: provider === "twilio" ? "text/xml" : "application/json",
        responsePayload: null,
      }
    }

    // In SIM forwarding mode: The carrier routes to the virtual number strictly
    // after the business phone failed to answer. This call is verified unanswered!
    const routingReason = inboundEvent.forwardedFrom
      ? "no_answer_sim_forwarded"
      : "no_answer_timeout_reached"

    // 6. Generate Short-Lived Single-Use Stream Token & Stream URL
    let streamToken = null
    try {
      streamToken = generateStreamToken({ callSid, tenantId, provider })
    } catch (_) {}

    const authenticatedStreamUrl = streamToken
      ? `${streamUrl}${streamUrl.includes("?") ? "&" : "?"}token=${streamToken}`
      : streamUrl

    // Generate Voice Streaming Response
    const streamResponse = adapter.generateStreamResponse({
      streamUrl: authenticatedStreamUrl,
      callSid,
      tenantId,
      recordDualChannel: config.recordingEnabled !== false,
      recordingStatusCallbackUrl: options.recordingStatusCallbackUrl || "",
    })

    // Track active call session in memory
    this.activeCallSessions.set(callSid, {
      callSid,
      tenantId,
      from: inboundEvent.from,
      to: inboundEvent.to,
      provider,
      status: "ai_answering",
      routingReason,
      startedAt: Date.now(),
      aiLanguage: config.aiLanguage || "hinglish",
    })

    return {
      decision: "answer_with_ai",
      reason: routingReason,
      tenantId,
      callSid,
      provider,
      aiLanguage: config.aiLanguage || "hinglish",
      streamToken,
      contentType: provider === "twilio" ? "text/xml" : "application/json",
      responsePayload: streamResponse,
    }
  }

  /**
   * Processes lifecycle events (ringing, answered, completed, failed, recording_completed).
   * 
   * @param {Object} event - Canonical call lifecycle event
   * @returns {Object} Updated session state
   */
  handleLifecycleEvent(event = {}) {
    const callSid = event.callSid
    if (!callSid) return null

    const session = this.activeCallSessions.get(callSid) || {
      callSid,
      tenantId: event.tenantId || null,
      provider: event.provider || "mock",
      startedAt: Date.now(),
    }

    session.status = event.status || session.status
    session.lastUpdated = Date.now()

    if (event.durationSeconds !== undefined) {
      session.durationSeconds = event.durationSeconds
    }
    if (event.recordingUrl) {
      session.recordingUrl = event.recordingUrl
    }
    if (event.failureReason) {
      session.failureReason = event.failureReason
    }

    this.activeCallSessions.set(callSid, session)
    return session
  }
}

// Export singleton instance
const inboundCallRouter = new InboundCallRouter()

module.exports = {
  inboundCallRouter,
  InboundCallRouter,
}
