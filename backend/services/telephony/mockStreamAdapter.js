/**
 * Mock WebSocket Stream Adapter
 * 
 * Protocol adapter for local in-memory testing without paid carriers.
 */
class MockStreamAdapter {
  constructor() {
    this.provider = "mock"
  }

  getProvider() {
    return "mock"
  }

  parseIncomingMessage(rawMessage) {
    let data
    try {
      const text = typeof rawMessage === "string" ? rawMessage : rawMessage.toString("utf8")
      data = JSON.parse(text)
    } catch (_) {
      throw new Error("MALFORMED_MOCK_FRAME: Invalid JSON structure")
    }

    const event = data.event

    switch (event) {
      case "start": {
        const streamSid = data.streamSid || "mock_stream_1"
        const callSid = data.callSid || ""
        return {
          type: "session.started",
          provider: "mock",
          streamSid,
          callSid,
          mediaFormat: {
            encoding: data.codec || "audio/x-mulaw",
            sampleRate: data.sampleRate || 8000,
            channels: 1,
          },
        }
      }

      case "media": {
        const streamSid = data.streamSid || "mock_stream_1"
        const payloadStr = data.payload || data.media?.payload
        if (!payloadStr || typeof payloadStr !== "string") {
          throw new Error("MALFORMED_MOCK_FRAME: Missing audio payload")
        }

        const raw = payloadStr.trim()
        if (!/^[A-Za-z0-9+/=]+$/.test(raw) && raw.length > 0) {
          throw new Error("MALFORMED_MOCK_FRAME: Invalid base64 audio payload")
        }

        const audioBuffer = Buffer.from(raw, "base64")
        return {
          type: "audio.input",
          provider: "mock",
          streamSid,
          payload: audioBuffer,
          codec: data.codec || "pcmu",
          sampleRate: Number(data.sampleRate || 8000),
          channels: 1,
          sequence: Number(data.sequence || 0),
          timestamp: Number(data.timestamp || Date.now()),
        }
      }

      case "mark":
        return {
          type: "audio.mark",
          provider: "mock",
          streamSid: data.streamSid,
          markName: data.mark?.name || data.name || "",
        }

      case "clear":
        return {
          type: "audio.clear",
          provider: "mock",
          streamSid: data.streamSid,
        }

      case "stop":
        return {
          type: "session.ended",
          provider: "mock",
          streamSid: data.streamSid,
          callSid: data.callSid || "",
        }

      default:
        return {
          type: "provider.custom",
          provider: "mock",
          rawEvent: event,
          data,
        }
    }
  }

  formatMediaMessage(streamSid, base64Audio) {
    return JSON.stringify({
      event: "media",
      streamSid,
      payload: base64Audio,
    })
  }

  formatClearMessage(streamSid) {
    return JSON.stringify({
      event: "clear",
      streamSid,
    })
  }

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

module.exports = MockStreamAdapter

