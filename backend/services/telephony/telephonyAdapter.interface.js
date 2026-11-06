/**
 * Telephony Provider Adapter Interface
 * 
 * Standard abstraction contract for all telephony providers
 * (MockTelephonyAdapter, TwilioAdapter, ExotelAdapter, AirtelIqAdapter, SipAdapter).
 * 
 * Enforces unified handling of:
 * 1. Inbound webhook verification & signature checking.
 * 2. Inbound webhook parsing (mapping provider-specific payload to canonical InboundCallEvent).
 * 3. Stream connection response generation (TwiML / Exotel Passthru / JSON).
 * 4. Dual-channel call recording trigger and status callback parsing.
 * 5. Audio recording stream download abstraction.
 */

class TelephonyAdapterInterface {
  /**
   * Returns provider identifier (e.g. 'mock', 'twilio', 'exotel', 'airtel_iq')
   */
  getProviderName() {
    throw new Error("getProviderName() must be implemented")
  }

  /**
   * Validates provider cryptographic webhook signature.
   * @param {Object} params
   * @param {string} params.url - Full webhook URL
   * @param {Object} params.headers - HTTP headers
   * @param {Object|string} params.body - Request body
   * @param {string} params.authToken - Tenant/provider secret key
   * @returns {boolean}
   */
  validateWebhookSignature(params) {
    throw new Error("validateWebhookSignature() must be implemented")
  }

  /**
   * Parses incoming call webhook into canonical Leads365 InboundCallEvent.
   * @param {Object} rawPayload - Raw provider webhook body
   * @returns {CanonicalCallEvent}
   */
  parseInboundCallWebhook(rawPayload) {
    throw new Error("parseInboundCallWebhook() must be implemented")
  }

  /**
   * Generates telephony response instructing the switch to connect bi-directional audio stream.
   * @param {Object} options
   * @param {string} options.streamUrl - WebSocket Voice Gateway URL
   * @param {string} options.callSid - Unique provider call identifier
   * @param {boolean} [options.recordDualChannel] - Whether switch should record dual channels
   * @param {string} [options.recordingStatusCallbackUrl] - Webhook for recording ready event
   * @returns {string|Object} Provider response (e.g. XML TwiML or JSON Passthru)
   */
  generateStreamResponse(options) {
    throw new Error("generateStreamResponse() must be implemented")
  }

  /**
   * Parses recording completed callback webhook into canonical RecordingEvent.
   * @param {Object} rawPayload - Provider callback payload
   * @returns {CanonicalRecordingEvent}
   */
  parseRecordingWebhook(rawPayload) {
    throw new Error("parseRecordingWebhook() must be implemented")
  }

  /**
   * Fetches/streams completed audio recording from provider.
   * @param {Object} params
   * @param {string} params.recordingUrl - Remote provider audio URL
   * @param {Object} [params.credentials] - Provider credentials
   * @returns {Promise<ReadableStream|Buffer>}
   */
  fetchRecordingAudio(params) {
    throw new Error("fetchRecordingAudio() must be implemented")
  }
}

module.exports = TelephonyAdapterInterface

