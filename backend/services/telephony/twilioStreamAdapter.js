/**
 * Twilio WebSocket Stream Adapter
 * 
 * Normalizes bidirectional media messages between Twilio Voice Stream and the Leads365 Voice Gateway.
 * Twilio bidirectional streams use 8kHz G.711 u-law audio payload over WebSocket.
 * Note: Twilio sends the caller's inbound audio to us, and plays our outbound audio to the caller.
 */
class TwilioStreamAdapter {
  constructor() {
    this.provider = "twilio"
  }

  getProvider() {
    return "twilio"
  }

  /**
   * Parses raw incoming WebSocket message from Twilio into normalized internal event.
   * @param {string|Buffer} rawMessage - Message from WebSocket
   * @returns {Object} Normalized event
   */
  parseIncomingMessage(rawMessage) {
    let data
    try {
      const text = typeof rawMessage === "string" ? rawMessage : rawMessage.toString("utf8")
      data = JSON.parse(text)
    } catch (_) {
      throw new Error("MALFORMED_TWILIO_FRAME: Invalid JSON structure")
    }

    const event = data.event

    switch (event) {
      case "connected":
        return {
          type: "connection.ready",
          provider: "twilio",
          protocolVersion: data.protocol || "1.0",
        }

      case "start":
        if (!data.streamSid || !data.start?.callSid) {
          throw new Error("MALFORMED_TWILIO_FRAME: Missing streamSid or callSid in start event")
        }
        return {
          type: "session.started",
          provider: "twilio",
          streamSid: data.streamSid,
          callSid: data.start.callSid,
          tracks: data.start.tracks || ["inbound"],
          customParameters: data.start.customParameters || {},
          mediaFormat: {
            encoding: "audio/x-mulaw",
            sampleRate: 8000,
            channels: 1,
          },
        }

      case "media": {
        const streamSid = data.streamSid
        const media = data.media
        if (!streamSid || !media || typeof media.payload !== "string") {
          throw new Error("MALFORMED_TWILIO_FRAME: Invalid media payload structure")
        }

        // Validate base64 format and decode to buffer
        const rawPayload = media.payload.trim()
        if (!/^[A-Za-z0-9+/=]+$/.test(rawPayload) && rawPayload.length > 0) {
          throw new Error("MALFORMED_TWILIO_FRAME: Invalid base64 audio payload")
        }

        const audioBuffer = Buffer.from(rawPayload, "base64")

        return {
          type: "audio.input",
          provider: "twilio",
          streamSid,
          payload: audioBuffer,
          codec: "pcmu",
          sampleRate: 8000,
          channels: 1,
          sequence: Number(media.chunk || 0),
          timestamp: Number(media.timestamp || 0),
        }
      }

      case "mark":
        return {
          type: "audio.mark",
          provider: "twilio",
          streamSid: data.streamSid,
          markName: data.mark?.name || "",
        }

      case "clear":
        return {
          type: "audio.clear",
          provider: "twilio",
          streamSid: data.streamSid,
        }

      case "stop":
        return {
          type: "session.ended",
          provider: "twilio",
          streamSid: data.streamSid,
          callSid: data.stop?.callSid || "",
        }

      default:
        return {
          type: "provider.custom",
          provider: "twilio",
          rawEvent: event,
          data,
        }
    }
  }

  /**
   * Formats outbound audio chunk to send to caller via Twilio Voice Stream.
   * @param {string} streamSid - Active Twilio stream SID
   * @param {string} base64Audio - Base64 encoded 8kHz u-law audio
   * @returns {string} JSON message string
   */
  formatMediaMessage(streamSid, base64Audio) {
    return JSON.stringify({
      event: "media",
      streamSid,
      media: {
        payload: base64Audio,
      },
    })
  }

  /**
   * Formats buffer clear message to immediately flush Twilio's audio playback queue upon interruption.
   * @param {string} streamSid - Active Twilio stream SID
   * @returns {string} JSON message string
   */
  formatClearMessage(streamSid) {
    return JSON.stringify({
      event: "clear",
      streamSid,
    })
  }

  /**
   * Formats mark message to track audio playback progress.
   * @param {string} streamSid - Active Twilio stream SID
   * @param {string} markName - Identifier for the playback checkpoint
   * @returns {string} JSON message string
   */
  formatMarkMessage(streamSid, markName) {
    return JSON.stringify({
      event: "mark",
      streamSid,
      mark: {
        name: markName,
      },
    })
  }
}

module.exports = TwilioStreamAdapter

