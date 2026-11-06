const crypto = require("crypto")
const TelephonyAdapterInterface = require("./telephonyAdapter.interface")
const { createSyntheticWavBuffer } = require("./fixtures/syntheticAudioFixture")

/**
 * Mock Telephony Provider Adapter
 * 
 * Free, deterministic local simulator for testing telephony lifecycle,
 * webhooks, audio recordings, and call routing without paid accounts.
 */
class MockTelephonyAdapter extends TelephonyAdapterInterface {
  constructor(options = {}) {
    super()
    this.name = "mock"
    this.isAvailable = options.isAvailable !== false
    this.virtualNumberRegistry = new Map() // virtualNumber -> tenantId
    this.activeCalls = new Map() // callSid -> callRecord
    this.recordings = new Map() // recordingSid -> recordingRecord
    this.eventListeners = []
    this.secretKey = options.secretKey || "mock-telephony-secret-key-365"
  }

  getProviderName() {
    return "mock"
  }

  setAvailability(available) {
    this.isAvailable = Boolean(available)
  }

  registerVirtualNumber(virtualNumber, tenantId) {
    const normalized = (virtualNumber || "").trim()
    this.virtualNumberRegistry.set(normalized, tenantId)
  }

  getTenantForNumber(virtualNumber) {
    const normalized = (virtualNumber || "").trim()
    return this.virtualNumberRegistry.get(normalized) || null
  }

  onEvent(listener) {
    if (typeof listener === "function") {
      this.eventListeners.push(listener)
    }
  }

  emitEvent(eventName, payload) {
    for (const listener of this.eventListeners) {
      try {
        listener(eventName, payload)
      } catch (_) {}
    }
  }

  /**
   * Generates mock signature for webhook testing.
   */
  generateSignature(payload, secret = this.secretKey) {
    const data = typeof payload === "string" ? payload : JSON.stringify(payload)
    return crypto.createHmac("sha256", secret).update(data).digest("hex")
  }

  validateWebhookSignature({ body, headers = {}, authToken = this.secretKey }) {
    if (!this.isAvailable) return false
    const signature = headers["x-mock-signature"] || headers["x-telephony-signature"]
    if (!signature || typeof signature !== "string") return false
    const expected = this.generateSignature(body, authToken)
    const sigBuf = Buffer.from(signature, "utf-8")
    const expBuf = Buffer.from(expected, "utf-8")
    if (sigBuf.length !== expBuf.length) return false
    return crypto.timingSafeEqual(sigBuf, expBuf)
  }

  parseInboundCallWebhook(rawPayload) {
    const callSid = rawPayload.callSid || rawPayload.CallSid || `mock_call_${crypto.randomBytes(8).toString("hex")}`
    const from = rawPayload.from || rawPayload.From || ""
    const to = rawPayload.to || rawPayload.To || ""
    const tenantId = rawPayload.tenantId || this.getTenantForNumber(to)

    return {
      provider: "mock",
      callSid,
      from,
      to,
      tenantId: tenantId || null,
      direction: "inbound",
      timestampMs: rawPayload.timestampMs || Date.now(),
      status: "ringing",
      forwardedFrom: rawPayload.forwardedFrom || null,
    }
  }

  generateStreamResponse({ streamUrl, callSid, recordDualChannel = true, recordingStatusCallbackUrl = "" }) {
    return {
      action: "connect_stream",
      provider: "mock",
      callSid,
      streamUrl,
      record: recordDualChannel ? "record-from-answer-dual" : "none",
      recordingStatusCallbackUrl,
      instructions: {
        audioFormat: "audio/pcm;rate=8000;bits=16;channels=1",
        bidiWebSocketUrl: streamUrl,
      },
    }
  }

  generateRejectResponse(reason = "rejected") {
    return {
      action: "reject",
      provider: "mock",
      reason,
    }
  }

  generateDisabledResponse(message = "Automated receptionist is disabled") {
    return {
      action: "say_and_hangup",
      provider: "mock",
      message,
    }
  }

  parseRecordingWebhook(rawPayload) {
    const recordingSid = rawPayload.recordingSid || rawPayload.RecordingSid || `rec_mock_${crypto.randomBytes(8).toString("hex")}`
    const callSid = rawPayload.callSid || rawPayload.CallSid
    const duration = Number(rawPayload.duration || rawPayload.Duration || 0)
    const recordingUrl = rawPayload.recordingUrl || rawPayload.RecordingUrl || `http://mock-telephony.local/recordings/${recordingSid}.wav`
    const status = rawPayload.status || rawPayload.RecordingStatus || "completed"

    return {
      provider: "mock",
      recordingSid,
      callSid,
      duration,
      recordingUrl,
      status, // "completed", "failed"
      channels: Number(rawPayload.channels || 2),
      timestampMs: Date.now(),
    }
  }

  async fetchRecordingAudio({ recordingUrl, recordingSid }) {
    if (!this.isAvailable) {
      throw new Error("Mock telephony provider is currently unavailable")
    }

    const sid = recordingSid || (recordingUrl ? recordingUrl.split("/").pop().replace(".wav", "") : null)
    let record = this.recordings.get(sid)

    if (!record) {
      // Generate synthetic WAV buffer on-demand for test reproducibility
      const fixture = createSyntheticWavBuffer({ durationSeconds: 2 })
      record = {
        recordingSid: sid || `rec_mock_${crypto.randomBytes(8).toString("hex")}`,
        buffer: fixture.buffer,
        sizeBytes: fixture.sizeBytes,
        sha256: fixture.sha256,
        durationSeconds: fixture.durationSeconds,
        mimeType: fixture.mimeType,
      }
      if (sid) this.recordings.set(sid, record)
    }

    return record.buffer
  }

  /**
   * High-Level Call Lifecycle Simulator for Local Tests
   */
  async simulateIncomingCall({
    callerNumber,
    virtualNumber,
    tenantId,
    humanAnswered = false,
    ringDurationSeconds = 15,
    conversationDurationSeconds = 10,
    disconnectUnexpectedly = false,
  }) {
    if (!this.isAvailable) {
      throw new Error("Telephony provider unavailable: Mock adapter is offline")
    }

    const callSid = `mock_call_${crypto.randomBytes(8).toString("hex")}`
    const resolvedTenant = tenantId || this.getTenantForNumber(virtualNumber)

    if (!resolvedTenant) {
      const unmappedEvent = {
        callSid,
        from: callerNumber,
        to: virtualNumber,
        error: "Unmapped virtual number: No tenant found for dialed number",
        status: "rejected_unmapped_tenant",
      }
      this.emitEvent("call.rejected", unmappedEvent)
      return unmappedEvent
    }

    const callState = {
      callSid,
      from: callerNumber,
      to: virtualNumber,
      tenantId: resolvedTenant,
      humanAnswered,
      status: "ringing",
      startedAt: Date.now(),
      durationSeconds: 0,
      recording: null,
    }

    this.activeCalls.set(callSid, callState)
    this.emitEvent("call.ringing", { ...callState })

    // Case 1: Human Answers call before no-answer routing engages
    if (humanAnswered) {
      callState.status = "answered_human"
      callState.durationSeconds = conversationDurationSeconds
      this.emitEvent("call.answered_human", { ...callState })
      callState.status = "completed"
      this.emitEvent("call.completed", { ...callState })
      return {
        ...callState,
        aiAnswered: false,
        message: "Call answered normally by human staff; AI did not answer.",
      }
    }

    // Case 2: Human does not answer -> Forward to AI Receptionist
    callState.status = "answered_ai"
    this.emitEvent("call.answered_ai", { ...callState })

    if (disconnectUnexpectedly) {
      callState.status = "failed"
      callState.failureReason = "caller_hung_up_unexpectedly"
      this.emitEvent("call.failed", { ...callState })
      return {
        ...callState,
        aiAnswered: true,
        message: "Call disconnected unexpectedly before conversation completion.",
      }
    }

    // Call successfully completed conversation
    callState.status = "completed"
    callState.durationSeconds = conversationDurationSeconds
    this.emitEvent("call.completed", { ...callState })

    // Simulate switch dual-channel recording completion
    const recordingSid = `rec_${callSid}`
    const audioFixture = createSyntheticWavBuffer({ durationSeconds: conversationDurationSeconds })
    
    const recordingPayload = {
      recordingSid,
      callSid,
      duration: conversationDurationSeconds,
      recordingUrl: `http://mock-telephony.local/recordings/${recordingSid}.wav`,
      status: "completed",
      sizeBytes: audioFixture.sizeBytes,
      sha256: audioFixture.sha256,
      mimeType: audioFixture.mimeType,
      channels: 2,
    }

    this.recordings.set(recordingSid, {
      ...recordingPayload,
      buffer: audioFixture.buffer,
    })

    callState.recording = recordingPayload
    this.emitEvent("recording.completed", recordingPayload)

    return {
      ...callState,
      aiAnswered: true,
      recording: recordingPayload,
      message: "Call answered by AI Receptionist and recorded successfully.",
    }
  }
}

module.exports = MockTelephonyAdapter
