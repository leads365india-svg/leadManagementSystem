const EventEmitter = require("events")
const { WebSocketServer } = require("ws")
const url = require("url")
const { verifyAndConsumeStreamToken } = require("./streamAuth.service")
const VoiceSession = require("./voiceSession.service")

/**
 * Real-Time Telephony WebSocket Voice Gateway
 * 
 * Manages WebSocket connections for live carrier voice streams:
 * - Listens on existing HTTP server under `/api/telephony/voice-stream`.
 * - Authenticates stream handshakes using single-use, cryptographically signed tokens.
 * - Rejects unauthorized, replayed, expired, or path-mismatched connections.
 * - Manages connection lifecycles, ping/pong heartbeats, and idle timeouts.
 * - Bridges normalized voice sessions to Phase 4 real-time AI engines.
 */
class VoiceGatewayService extends EventEmitter {
  constructor(options = {}) {
    super()
    this.path = options.path || "/api/telephony/voice-stream"
    this.idleTimeoutMs = options.idleTimeoutMs || 60000
    this.heartbeatIntervalMs = options.heartbeatIntervalMs || 30000

    this.httpServer = null
    this.wss = null
    this.activeSessions = new Map() // callSid -> VoiceSession
    this.heartbeatTimer = null
    this.idleCheckTimer = null
    this.upgradeHandler = null
  }

  /**
   * Attaches Voice Gateway to an existing Node.js HTTP server.
   * Uses noServer mode so WebSocket upgrades share the same port as the CRM.
   * 
   * @param {import('http').Server} httpServer - Node HTTP server instance
   */
  attach(httpServer) {
    if (!httpServer) {
      throw new Error("Cannot attach Voice Gateway: httpServer is required")
    }

    if (this.httpServer) {
      // Already attached
      return this
    }

    this.httpServer = httpServer
    this.wss = new WebSocketServer({ noServer: true })

    this.upgradeHandler = (req, socket, head) => {
      this.handleUpgrade(req, socket, head)
    }

    httpServer.on("upgrade", this.upgradeHandler)

    // Start background maintenance intervals
    this.startMaintenanceTimers()

    console.log(`✅ Voice Gateway attached to HTTP server on path '${this.path}'`)
    return this
  }

  /**
   * Handles HTTP Upgrade requests for WebSocket streams.
   */
  handleUpgrade(req, socket, head) {
    let parsedUrl
    try {
      parsedUrl = url.parse(req.url, true)
    } catch (_) {
      socket.write("HTTP/1.1 400 Bad Request\r\n\r\n")
      socket.destroy()
      return
    }

    const pathname = (parsedUrl.pathname || "").toLowerCase().replace(/\/+$/, "")
    const expectedPath = this.path.toLowerCase().replace(/\/+$/, "")

    // 1. Enforce Path Validation
    if (pathname !== expectedPath && !pathname.startsWith(`${expectedPath}/`)) {
      socket.write("HTTP/1.1 404 Not Found\r\n\r\n")
      socket.destroy()
      return
    }

    // 2. Extract Stream Token from Query String or Protocol Header
    const token =
      parsedUrl.query?.token ||
      parsedUrl.query?.streamToken ||
      req.headers["sec-websocket-protocol"] ||
      ""

    if (!token) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n")
      socket.destroy()
      return
    }

    // Optional provider hint from URL path /api/telephony/voice-stream/:provider
    const pathParts = pathname.replace(expectedPath, "").split("/").filter(Boolean)
    const providerHint = pathParts[0] || parsedUrl.query?.provider || null

    // 3. Cryptographically Verify & Consume Single-Use Token
    let tokenPayload
    try {
      tokenPayload = verifyAndConsumeStreamToken(token, {
        provider: providerHint,
        callSid: parsedUrl.query?.callSid || null,
        tenantId: parsedUrl.query?.tenantId || null,
      })
    } catch (authErr) {
      // Reject with 401 Unauthorized
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n")
      socket.destroy()
      return
    }

    // 4. Upgrade Socket to WebSocket
    this.wss.handleUpgrade(req, socket, head, (ws) => {
      this.onConnection(ws, tokenPayload)
    })
  }

  /**
   * Handles new authenticated WebSocket connection.
   * @param {import('ws').WebSocket} ws
   * @param {Object} tokenPayload - { callSid, tenantId, provider }
   */
  onConnection(ws, tokenPayload) {
    const { callSid, tenantId, provider } = tokenPayload

    // Heartbeat tracking
    ws.isAlive = true
    ws.on("pong", () => {
      ws.isAlive = true
    })

    // Instantiate Voice Session
    const session = new VoiceSession({
      callSid,
      tenantId,
      provider,
      ws,
    })

    this.activeSessions.set(callSid, session)

    ws.on("message", (data) => {
      session.handleIncomingMessage(data)
    })

    ws.on("error", (err) => {
      session.emit("error", err)
    })

    ws.on("close", (code, reason) => {
      this.activeSessions.delete(callSid)
      session.close(code, reason)
    })

    this.emit("session.created", session)
  }

  /**
   * Starts ping/pong and idle maintenance timers.
   */
  startMaintenanceTimers() {
    // Ping/Pong Heartbeat Interval
    this.heartbeatTimer = setInterval(() => {
      for (const [callSid, session] of this.activeSessions.entries()) {
        const ws = session.ws
        if (!ws || ws.readyState !== 1) continue

        if (ws.isAlive === false) {
          // Terminate unresponsive connection
          session.close(1001, "Heartbeat timeout (unresponsive client)")
          this.activeSessions.delete(callSid)
          continue
        }

        ws.isAlive = false
        ws.ping()
      }
    }, this.heartbeatIntervalMs)
    this.heartbeatTimer.unref?.()

    // Idle Timeout Check
    this.idleCheckTimer = setInterval(() => {
      const now = Date.now()
      for (const [callSid, session] of this.activeSessions.entries()) {
        if (now - session.lastActivityAt > this.idleTimeoutMs) {
          session.close(1000, "Idle stream timeout exceeded")
          this.activeSessions.delete(callSid)
        }
      }
    }, 15000)
    this.idleCheckTimer.unref?.()
  }

  /**
   * Retrieves an active session by callSid.
   * @param {string} callSid
   * @returns {VoiceSession|null}
   */
  getSession(callSid) {
    return this.activeSessions.get(callSid) || null
  }

  /**
   * Returns current active session count.
   */
  getActiveSessionCount() {
    return this.activeSessions.size
  }

  /**
   * Graceful Shutdown: Closes active streams and stops timers.
   */
  async shutdown() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
    if (this.idleCheckTimer) clearInterval(this.idleCheckTimer)

    // Close all active sessions
    for (const session of this.activeSessions.values()) {
      try {
        session.close(1001, "Server shutting down")
      } catch (_) {}
    }
    this.activeSessions.clear()

    if (this.httpServer && this.upgradeHandler) {
      this.httpServer.removeListener("upgrade", this.upgradeHandler)
      this.upgradeHandler = null
      this.httpServer = null
    }

    if (this.wss) {
      await new Promise((resolve) => {
        this.wss.close(() => resolve())
      })
      this.wss = null
    }

    console.log("✅ Voice Gateway shutdown complete.")
  }
}

// Export singleton
const voiceGateway = new VoiceGatewayService()

module.exports = {
  voiceGateway,
  VoiceGatewayService,
}
