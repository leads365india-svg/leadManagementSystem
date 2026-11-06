/**
 * Exotel WebSocket Stream Adapter
 * 
 * Normalizes bidirectional media messages between Exotel Voicebot AgentStream
 * and the Leads365 Voice Gateway.
 */
class ExotelStreamAdapter {
  constructor() {
    this.provider = "exotel"
  }

  getProvider() {
    return "exotel"
  }

  /**
   * Parses raw incoming WebSocket message from Exotel into normalized internal event.
   * @param {string|Buffer} rawMessage
   * @returns {Object} Normalized event
   */
  parseIncomingMessage(rawMessage) {
    let data
    try {
      const text = typeof rawMessage === "string" ? rawMessage : rawMessage.toString("utf8")
      data = JSON.parse(text)
    } catch (_) {
      throw new Error("MALFORMED_EXOTEL_FRAME: Invalid JSON structure")
    }

    const event = data.event || data.action

    switch (event) {
      case "connected":
        return {
          type: "connection.ready",
          provider: "exotel",
        }

      case "start": {
        const streamSid = data.stream_sid || data.streamSid || data.streamId
        const callSid = data.call_sid || data.callSid || data.callId || ""
        if (!streamSid) {
          throw new Error("MALFORMED_EXOTEL_FRAME: Missing stream_sid in start event")
        }
        return {
          type: "session.started",
          provider: "exotel",
          streamSid,
          callSid,
          mediaFormat: {
            encoding: data.format || "audio/x-mulaw",
            sampleRate: data.rate || 8000,
            channels: 1,
          },
        }
      }

      case "media": {
        const streamSid = data.stream_sid || data.streamSid
        const media = data.media || data
        if (!streamSid || !media || typeof media.payload !== "string") {
          throw new Error("MALFORMED_EXOTEL_FRAME: Invalid media payload structure")
        }

        const rawPayload = media.payload.trim()
        if (!/^[A-Za-z0-9+/=]+$/.test(rawPayload) && rawPayload.length > 0) {
          throw new Error("MALFORMED_EXOTEL_FRAME: Invalid base64 audio payload")
        }

        const audioBuffer = Buffer.from(rawPayload, "base64")
        const codec = (media.format || "").includes("pcm") ? "pcm16" : "pcmu"

        return {
          type: "audio.input",
          provider: "exotel",
          streamSid,
          payload: audioBuffer,
          codec,
          sampleRate: Number(media.rate || 8000),
          channels: 1,
          sequence: Number(media.sequence || media.chunk || 0),
          timestamp: Number(media.timestamp || 0),
        }
      }

      case "mark":
        return {
          type: "audio.mark",
          provider: "exotel",
          streamSid: data.stream_sid || data.streamSid,
          markName: data.mark?.name || data.name || "",
        }

      case "clear":
        return {
          type: "audio.clear",
          provider: "exotel",
          streamSid: data.stream_sid || data.streamSid,
        }

      case "stop":
        return {
          type: "session.ended",
          provider: "exotel",
          streamSid: data.stream_sid || data.streamSid,
          callSid: data.call_sid || data.callSid || "",
        }

      default:
        return {
          type: "provider.custom",
          provider: "exotel",
          rawEvent: event,
          data,
        }
    }
  }

  /**
   * Formats outbound audio chunk for Exotel Voicebot stream.
   */
  formatMediaMessage(streamSid, base64Audio, format = "audio/x-mulaw;rate=8000") {
    return JSON.stringify({
      event: "media",
      stream_sid: streamSid,
      media: {
        payload: base64Audio,
        format,
      },
    })
  }

  /**
   * Formats clear message to flush Exotel playback buffer upon interruption.
   */
  formatClearMessage(streamSid) {
    return JSON.stringify({
      event: "clear",
      stream_sid: streamSid,
    })
  }

  /**
   * Formats mark message for Exotel.
   */
  formatMarkMessage(streamSid, markName) {
    return JSON.stringify({
      event: "mark",
      stream_sid: streamSid,
      mark: {
        name: markName,
      },
    })
  }
}

module.exports = ExotelStreamAdapter

