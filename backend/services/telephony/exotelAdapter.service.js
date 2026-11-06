const crypto = require("crypto")
const TelephonyAdapterInterface = require("./telephonyAdapter.interface")

/**
 * Exotel Voice Telephony Provider Adapter
 * 
 * Complies with TelephonyAdapterInterface.
 * Manages Indian cloud telephony routing, Exophone virtual numbers,
 * webhook authentication, and bi-directional audio passthru instructions.
 */
class ExotelAdapter extends TelephonyAdapterInterface {
  getProviderName() {
    return "exotel"
  }

  /**
   * Validates Exotel webhook authentication.
   * Exotel sends authentication token in HTTP headers or signed HMAC parameter.
   * 
   * @param {Object} params
   * @param {Object} params.headers - HTTP request headers
   * @param {string} params.authToken - Configured Exotel API Token
   * @returns {boolean}
   */
  validateWebhookSignature({ headers = {}, body = {}, authToken = "" }) {
    if (!authToken || typeof authToken !== "string") {
      return false
    }

    // 1. Direct header token match (Exotel webhook basic auth or header token)
    const tokenHeader = headers["x-exotel-token"] || headers["authorization"] || headers["x-api-key"]
    if (tokenHeader) {
      const cleanHeader = tokenHeader.replace(/^Basic\s+/i, "").replace(/^Bearer\s+/i, "").trim()
      if (cleanHeader === authToken.trim()) {
        return true
      }
    }

    // 2. HMAC signature check if Exotel HMAC is configured
    const signature = headers["x-exotel-signature"]
    if (signature && body) {
      const data = typeof body === "string" ? body : JSON.stringify(body)
      const expected = crypto.createHmac("sha256", authToken).update(data, "utf8").digest("hex")
      const sigBuf = Buffer.from(signature, "utf8")
      const expBuf = Buffer.from(expected, "utf8")
      if (sigBuf.length === expBuf.length && crypto.timingSafeEqual(sigBuf, expBuf)) {
        return true
      }
    }

    return false
  }

  /**
   * Parses Exotel webhook parameters into canonical Leads365 InboundCallEvent.
   * Exotel fields: CallSid/Sid, CallFrom/From, DialWhomNumber/To/ExoPhone, Status/CallStatus.
   * 
   * @param {Object} rawPayload - Exotel webhook parameters
   * @returns {Object} Canonical InboundCallEvent
   */
  parseInboundCallWebhook(rawPayload = {}) {
    const callSid = rawPayload.CallSid || rawPayload.Sid || rawPayload.callSid || ""
    const from = rawPayload.CallFrom || rawPayload.From || rawPayload.from || ""
    const to = rawPayload.DialWhomNumber || rawPayload.ExoPhone || rawPayload.To || rawPayload.to || ""
    const forwardedFrom = rawPayload.ForwardedFrom || rawPayload.forwardedFrom || null
    const status = rawPayload.Status || rawPayload.CallStatus || rawPayload.status || "ringing"

    return {
      provider: "exotel",
      callSid,
      from,
      to,
      forwardedFrom,
      status,
      direction: "inbound",
      timestampMs: Date.now(),
      rawPayload,
    }
  }

  /**
   * Generates Exotel Passthru / Stream Connection Response.
   * 
   * @param {Object} options
   * @param {string} options.streamUrl - WebSocket Voice Gateway endpoint
   * @param {string} options.callSid - Unique Exotel CallSid
   * @param {string} [options.tenantId] - Owning tenant identifier
   * @returns {Object} JSON Passthru response for Exotel Applet
   */
  generateStreamResponse({
    streamUrl = "",
    callSid = "",
    tenantId = "",
    recordDualChannel = true,
  }) {
    return {
      select: "stream",
      stream: {
        url: streamUrl,
        callSid,
        tenantId,
        record: recordDualChannel ? "dual" : "none",
        format: "audio/x-mulaw;rate=8000",
      },
    }
  }

  /**
   * Generates Exotel response rejecting the incoming call.
   */
  generateRejectResponse(reason = "rejected") {
    return {
      select: "hangup",
      reason,
    }
  }

  /**
   * Generates Exotel response when AI receptionist is disabled.
   */
  generateDisabledResponse(message = "Thank you for calling. The automated receptionist is currently offline.") {
    return {
      select: "say_and_hangup",
      text: message,
      language: "en-IN",
    }
  }

  /**
   * Parses Exotel recording callback webhook.
   */
  parseRecordingWebhook(rawPayload = {}) {
    return {
      provider: "exotel",
      callSid: rawPayload.CallSid || rawPayload.Sid || "",
      recordingSid: rawPayload.RecordingSid || rawPayload.recordingSid || rawPayload.RecordingUrl || "",
      recordingUrl: rawPayload.RecordingUrl || rawPayload.recordingUrl || "",
      durationSeconds: Number(rawPayload.RecordingDuration || rawPayload.Duration || 0),
      channels: 2,
      status: "completed",
      rawPayload,
    }
  }
}

module.exports = ExotelAdapter

