const EventEmitter = require("events")
const { normalizeInboundAudio, encodeOutboundAudio } = require("./audioResampler")
const TwilioStreamAdapter = require("./twilioStreamAdapter")
const ExotelStreamAdapter = require("./exotelStreamAdapter")
const MockStreamAdapter = require("./mockStreamAdapter")

/**
 * Normalized Real-Time Voice Session
 * 
 * Manages an individual real-time call audio stream:
 * - Decouples provider protocol specifics (Twilio, Exotel, Mock).
 * - Transcodes 8kHz u-law <-> 16kHz PCM16 in real-time.
 * - Handles backpressure, bounded queues, and packet ordering.
 * - Manages barge-in / speech interruption buffer clearing.
 * - Distinguishes inbound caller audio from outbound AI audio for recording taps.
 */
class VoiceSession extends EventEmitter {
  constructor({ callSid, tenantId, provider, ws, options = {} }) {
    super()
    this.callSid = callSid
    this.tenantId = tenantId
    this.provider = (provider || "mock").toLowerCase()
    this.ws = ws
    this.streamSid = null
    this.status = "initializing"
    this.createdAt = Date.now()
    this.lastActivityAt = Date.now()
    this.options = options

    // Bounded audio queues (max 100 packets to protect memory from backpressure)
    this.maxQueueSize = options.maxQueueSize || 100
    this.inboundQueue = []
    this.outboundQueue = []

    // Metrics
    this.metrics = {
      packetsIn: 0,
      packetsOut: 0,
      bytesIn: 0,
      bytesOut: 0,
      marksReceived: 0,
      marksSent: 0,
      interruptions: 0,
    }

    // Audio Tap / Recording Observation Observers
    this.inboundAudioTaps = []
    this.outboundAudioTaps = []

    // Select Protocol Adapter
    if (this.provider === "twilio") {
      this.adapter = new TwilioStreamAdapter()
    } else if (this.provider === "exotel") {
      this.adapter = new ExotelStreamAdapter()
    } else {
      this.adapter = new MockStreamAdapter()
    }
  }

  /**
   * Registers a tap listener for inbound caller audio (for recording / analysis).
   */
  addInboundAudioTap(listener) {
    if (typeof listener === "function") {
      this.inboundAudioTaps.push(listener)
    }
  }

  /**
   * Registers a tap listener for outbound AI audio (for recording / analysis).
   */
  addOutboundAudioTap(listener) {
    if (typeof listener === "function") {
      this.outboundAudioTaps.push(listener)
    }
  }

  /**
   * Processes an incoming raw frame from the WebSocket.
   * @param {string|Buffer} rawMessage
   */
  handleIncomingMessage(rawMessage) {
    this.lastActivityAt = Date.now()

    // Enforce max raw frame payload size (64KB)
    const messageSize = Buffer.isBuffer(rawMessage) ? rawMessage.length : Buffer.byteLength(rawMessage)
    if (messageSize > 65536) {
      this.emit("error", new Error("PAYLOAD_TOO_LARGE: Audio frame exceeds 64KB limit"))
      this.close(1009, "Message too large")
      return
    }

    let event
    try {
      event = this.adapter.parseIncomingMessage(rawMessage)
    } catch (parseErr) {
      this.emit("error", parseErr)
      return
    }

    switch (event.type) {
      case "connection.ready":
        this.emit("connection.ready", event)
        break

      case "session.started":
        this.streamSid = event.streamSid
        this.status = "active"
        this.emit("session.started", {
          callSid: this.callSid,
          tenantId: this.tenantId,
          provider: this.provider,
          streamSid: this.streamSid,
          mediaFormat: event.mediaFormat,
        })
        break

      case "audio.input": {
        this.metrics.packetsIn++
        this.metrics.bytesIn += event.payload.length

        // Tap raw inbound caller audio
        for (const tap of this.inboundAudioTaps) {
          try {
            tap(event.payload, event.codec, event.sampleRate)
          } catch (_) {}
        }

        // Transcode to normalized 16kHz PCM16 for Phase 4 AI engine
        const pcm16 = normalizeInboundAudio({
          payload: event.payload,
          codec: event.codec,
          sampleRate: event.sampleRate,
          targetSampleRate: 16000,
        })

        // Bounded queue management with backpressure protection
        if (this.inboundQueue.length >= this.maxQueueSize) {
          this.inboundQueue.shift() // Drop oldest packet to prevent memory saturation
        }
        this.inboundQueue.push(pcm16)

        // Emit normalized audio event to session consumers (e.g. Gemini Live in Phase 4)
        this.emit("audio.input", {
          callSid: this.callSid,
          tenantId: this.tenantId,
          provider: this.provider,
          streamSid: this.streamSid,
          rawPayload: event.payload,
          pcm16Payload: pcm16,
          sampleRate: 16000,
          channels: 1,
          sequence: event.sequence,
          timestamp: event.timestamp,
        })
        break
      }

      case "audio.mark":
        this.metrics.marksReceived++
        this.emit("audio.mark", event.markName)
        break

      case "audio.clear":
        this.emit("audio.clear")
        break

      case "session.ended":
        this.status = "ended"
        this.emit("session.ended", {
          callSid: this.callSid,
          tenantId: this.tenantId,
          provider: this.provider,
          streamSid: this.streamSid,
        })
        this.close(1000, "Session ended by carrier")
        break

      default:
        this.emit("provider.custom", event)
        break
    }
  }

  /**
   * Sends AI-generated audio back to the caller through the carrier WebSocket stream.
   * 
   * @param {Buffer} pcm16Buffer - 16-bit linear PCM audio chunk (e.g. from Gemini Live)
   * @param {number} [sourceSampleRate=16000] - Sample rate of input PCM
   * @returns {boolean} Success indicator
   */
  sendAudioOutput(pcm16Buffer, sourceSampleRate = 16000) {
    if (!this.ws || this.ws.readyState !== 1 /* WebSocket.OPEN */) {
      return false
    }

    if (!pcm16Buffer || pcm16Buffer.length === 0) {
      return false
    }

    // Tap raw outbound AI audio
    for (const tap of this.outboundAudioTaps) {
      try {
        tap(pcm16Buffer, "pcm16", sourceSampleRate)
      } catch (_) {}
    }

    // Encode to carrier format (e.g. 8kHz u-law for Twilio/Exotel)
    const targetCodec = this.options.targetCodec || (this.provider === "mock" ? "pcm16" : "pcmu")
    const targetRate = this.options.targetRate || (this.provider === "mock" ? sourceSampleRate : 8000)

    const encoded = encodeOutboundAudio({
      payload: pcm16Buffer,
      sourceSampleRate,
      targetCodec,
      targetSampleRate: targetRate,
    })

    const base64Audio = encoded.toString("base64")
    const formattedMessage = this.adapter.formatMediaMessage(this.streamSid || "stream_1", base64Audio)

    // Check WebSocket bufferedAmount for backpressure
    if (this.ws.bufferedAmount > 65536) {
      // High backpressure: enqueue packet in bounded outbound queue
      if (this.outboundQueue.length >= this.maxQueueSize) {
        this.outboundQueue.shift()
      }
      this.outboundQueue.push(formattedMessage)
    } else {
      this.ws.send(formattedMessage)
    }

    this.metrics.packetsOut++
    this.metrics.bytesOut += encoded.length
    this.lastActivityAt = Date.now()
    return true
  }

  /**
   * Handles user barge-in / speech interruption:
   * Flushes local outbound queues and transmits provider clear event to stop carrier playback.
   */
  interrupt() {
    this.metrics.interruptions++
    this.outboundQueue = [] // Clear pending outbound buffers

    if (this.ws && this.ws.readyState === 1 && this.streamSid) {
      const clearMsg = this.adapter.formatClearMessage(this.streamSid)
      this.ws.send(clearMsg)
    }

    this.emit("audio.interrupted", {
      callSid: this.callSid,
      tenantId: this.tenantId,
      streamSid: this.streamSid,
    })
  }

  /**
   * Sends a sync mark to track audio playback progress.
   * @param {string} markName
   */
  sendMark(markName) {
    if (!this.ws || this.ws.readyState !== 1 || !this.streamSid) return
    const markMsg = this.adapter.formatMarkMessage(this.streamSid, markName)
    this.ws.send(markMsg)
    this.metrics.marksSent++
  }

  /**
   * Closes the session and tears down resources cleanly.
   * @param {number} [code=1000]
   * @param {string} [reason="Normal Closure"]
   */
  close(code = 1000, reason = "Normal Closure") {
    if (this.status === "closed") return
    this.status = "closed"

    this.inboundQueue = []
    this.outboundQueue = []

    if (this.ws && this.ws.readyState <= 1) {
      try {
        this.ws.close(code, reason)
      } catch (_) {}
    }

    this.emit("session.closed", {
      callSid: this.callSid,
      tenantId: this.tenantId,
      metrics: this.metrics,
      code,
      reason,
    })
  }
}

module.exports = VoiceSession

