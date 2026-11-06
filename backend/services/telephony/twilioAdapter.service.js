const crypto = require("crypto")
const TelephonyAdapterInterface = require("./telephonyAdapter.interface")

/**
 * Twilio Voice Telephony Provider Adapter
 * 
 * Complies with TelephonyAdapterInterface.
 * Manages Twilio webhook signature verification (HMAC-SHA1),
 * TwiML bidirection stream connection generation, and dual-channel call recording.
 */
class TwilioAdapter extends TelephonyAdapterInterface {
  getProviderName() {
    return "twilio"
  }

  /**
   * Validates Twilio's X-Twilio-Signature header.
   * Standard Twilio signature calculation:
   * 1. Take the full URL (including https:// and query parameters).
   * 2. Sort all POST body parameters alphabetically by key.
   * 3. Append each key-value pair to the URL string without delimiters.
   * 4. Compute HMAC-SHA1 with the tenant's Auth Token and Base64 encode.
   * 5. Constant-time comparison against X-Twilio-Signature.
   * 
   * @param {Object} params
   * @param {string} params.url - Full public webhook URL
   * @param {Object} params.headers - HTTP request headers
   * @param {Object} [params.body] - Form-encoded POST body parameters
   * @param {string} params.authToken - Tenant Twilio Auth Token
   * @returns {boolean}
   */
  validateWebhookSignature({ url = "", headers = {}, body = {}, authToken = "" }) {
    if (!authToken || typeof authToken !== "string") {
      return false
    }

    const signature = headers["x-twilio-signature"] || headers["X-Twilio-Signature"]
    if (!signature || typeof signature !== "string") {
      return false
    }

    let data = url
    if (body && typeof body === "object") {
      const keys = Object.keys(body).sort()
      for (const key of keys) {
        data += key + (body[key] !== undefined && body[key] !== null ? body[key] : "")
      }
    }

    const expected = crypto.createHmac("sha1", authToken).update(data, "utf8").digest("base64")

    const sigBuf = Buffer.from(signature, "utf8")
    const expBuf = Buffer.from(expected, "utf8")

    if (sigBuf.length !== expBuf.length) {
      return false
    }

    return crypto.timingSafeEqual(sigBuf, expBuf)
  }

  /**
   * Parses Twilio webhook parameters into canonical Leads365 InboundCallEvent.
   * @param {Object} rawPayload - Twilio POST form parameters
   * @returns {Object} Canonical InboundCallEvent
   */
  parseInboundCallWebhook(rawPayload = {}) {
    const callSid = rawPayload.CallSid || rawPayload.callSid || ""
    const from = rawPayload.From || rawPayload.from || rawPayload.Caller || ""
    const to = rawPayload.To || rawPayload.to || rawPayload.Called || ""
    const forwardedFrom = rawPayload.ForwardedFrom || rawPayload.forwardedFrom || null
    const callStatus = rawPayload.CallStatus || rawPayload.callStatus || "ringing"

    return {
      provider: "twilio",
      callSid,
      from,
      to,
      forwardedFrom,
      status: callStatus,
      direction: "inbound",
      timestampMs: Date.now(),
      rawPayload,
    }
  }

  /**
   * Generates Twilio TwiML instructions for bi-directional WebSocket streaming and recording.
   * 
   * @param {Object} options
   * @param {string} options.streamUrl - WebSocket Voice Gateway endpoint (wss://...)
   * @param {string} options.callSid - Unique Twilio CallSid
   * @param {string} [options.tenantId] - Owning tenant identifier
   * @param {boolean} [options.recordDualChannel=true] - Whether to record both caller & AI tracks
   * @param {string} [options.recordingStatusCallbackUrl] - Webhook for recording completion
   * @returns {string} XML TwiML
   */
  generateStreamResponse({
    streamUrl = "",
    callSid = "",
    tenantId = "",
    recordDualChannel = true,
    recordingStatusCallbackUrl = "",
  }) {
    let twiml = `<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n`

    // Optional native Twilio dual-channel recording trigger
    if (recordDualChannel && recordingStatusCallbackUrl) {
      twiml += `  <Record recordingStatusCallback="${recordingStatusCallbackUrl}" recordingStatusCallbackMethod="POST" trim="trim-silence" dualChannel="true"/>\n`
    }

    // Connect bi-directional WebSocket stream
    twiml += `  <Connect>\n`
    twiml += `    <Stream url="${streamUrl}">\n`
    if (callSid) {
      twiml += `      <Parameter name="callSid" value="${callSid}" />\n`
    }
    if (tenantId) {
      twiml += `      <Parameter name="tenantId" value="${tenantId}" />\n`
    }
    twiml += `    </Stream>\n`
    twiml += `  </Connect>\n`
    twiml += `</Response>`

    return twiml
  }

  /**
   * Generates TwiML rejecting the incoming call.
   * @param {string} [reason="rejected"] - rejected | busy
   * @returns {string} XML TwiML
   */
  generateRejectResponse(reason = "rejected") {
    return `<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n  <Reject reason="${reason}" />\n</Response>`
  }

  /**
   * Generates polite message when AI receptionist is disabled.
   * @param {string} message - Spoken greeting
   * @returns {string} XML TwiML
   */
  generateDisabledResponse(message = "Thank you for calling. The automated receptionist is currently offline. Please try again later.") {
    return `<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n  <Say language="en-IN">${message}</Say>\n  <Hangup />\n</Response>`
  }

  /**
   * Parses Twilio recording completion webhook.
   */
  parseRecordingWebhook(rawPayload = {}) {
    return {
      provider: "twilio",
      callSid: rawPayload.CallSid || rawPayload.callSid || "",
      recordingSid: rawPayload.RecordingSid || rawPayload.recordingSid || "",
      recordingUrl: rawPayload.RecordingUrl || rawPayload.recordingUrl || "",
      durationSeconds: Number(rawPayload.RecordingDuration || rawPayload.duration || 0),
      channels: Number(rawPayload.RecordingChannels || 2),
      status: "completed",
      rawPayload,
    }
  }
}

module.exports = TwilioAdapter

