const EventEmitter = require("events")
const { GoogleGenAI } = require("@google/genai")

/**
 * Gemini Live Real-Time Voice AI Integration Service
 * 
 * Manages low-latency bidirectional voice sessions between the Leads365 Voice Gateway
 * and Google's Gemini Live API:
 * 
 * - Model: Uses `LIVE_VOICE_MODEL` (default: 'gemini-3.8-live').
 * - Preserves existing post-call analysis model in `aiProvider.service.js` ('gemini-3.8-flash').
 * - Bridges VoiceSession normalized 16kHz PCM audio to Gemini Live input.
 * - Bridges Gemini Live 24kHz PCM audio output back to VoiceSession and carrier adapters.
 * - Full barge-in / speech interruption handling: flushes pending output and triggers carrier clear.
 * - Bilingual receptionist personality (Hindi / English / Hinglish).
 * - Function calling boundary prepared for CRM events (zero direct MongoDB access).
 * - Multi-tenant isolation: strictly 1 live session per authorized telephone call.
 */

const DEFAULT_LIVE_VOICE_MODEL = "gemini-3.8-live"

/**
 * Sanitizes strings, URLs, and errors to prevent leaking API keys, secrets, or sensitive tokens.
 */
function sanitizeErrorMessage(msg) {
  if (!msg || typeof msg !== "string") return ""
  return msg
    .replace(/key=[^&\s]+/gi, "key=[REDACTED]")
    .replace(/AIza[0-9A-Za-z-_]{35}/g, "[REDACTED_API_KEY]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]")
    .replace(/x-goog-api-key:\s*[^\s,]+/gi, "x-goog-api-key: [REDACTED]")
}

/**
 * Resolves the active Gemini Live model.
 * Defaults to 'gemini-3.8-live', allow override via process.env.LIVE_VOICE_MODEL.
 */
function resolveLiveVoiceModel() {
  const model = (process.env.LIVE_VOICE_MODEL || DEFAULT_LIVE_VOICE_MODEL).trim()
  if (!model || !/^gemini-[a-zA-Z0-9_.-]+$/.test(model)) {
    throw new Error(`Invalid Gemini Live model configuration '${model}'. Model name must be a valid gemini identifier.`)
  }
  return model
}

/**
 * Resolves the Gemini Live API key safely.
 * Prefers GEMINI_LIVE_API_KEY, falls back to GEMINI_API_KEY.
 */
function getLiveApiKey() {
  return (
    process.env.GEMINI_LIVE_API_KEY ||
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_AI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    null
  )
}

/**
 * Checks whether Gemini Live is explicitly enabled for live connections.
 */
function isLiveEnabled() {
  return process.env.GEMINI_LIVE_ENABLED === "true"
}

/**
 * Builds the Phase 4 initial receptionist prompt.
 */
function buildInitialReceptionistPrompt({ businessName = "the business", language = "hinglish", greeting = "" } = {}) {
  let langInstruction = ""
  if (language === "hindi") {
    langInstruction = "Always speak politely in Hindi (Devanagari or clean phonetic Hindi). Respond in Hindi."
  } else if (language === "english") {
    langInstruction = "Always speak politely in professional, natural English."
  } else {
    langInstruction = "Speak in natural, conversational Hinglish (a mix of Hindi and English commonly spoken in India)."
  }

  return `You are an AI Incoming Call Receptionist for ${businessName}.
${greeting ? `Your standard greeting is: "${greeting}"` : "Greet the caller politely and ask how you can assist them today."}
Language instruction: ${langInstruction}

Strict behavioral rules:
1. Introduce yourself clearly as an AI receptionist.
2. Listen carefully to the caller. Do not speak over or interrupt the caller while they are speaking.
3. Ask concise, relevant follow-up questions to understand their inquiry (e.g., caller's name, requirement, and preferred callback time).
4. Do NOT hallucinate or invent business details, specific product prices, guarantees, or inventory availability that you have not been explicitly given.
5. Do NOT promise or claim that a lead, order, or follow-up is confirmed or saved in the CRM until confirmed by the backend system.
6. If the caller asks a question you cannot answer or asks for a human, politely inform them that you will take their details and have a team member call them back.
7. End the call politely and warmly when the customer says goodbye or asks to end the call.`
}

/**
 * Deterministic Mock Gemini Live Session for zero-cost, local offline testing.
 */
class MockGeminiLiveSession extends EventEmitter {
  constructor(options = {}) {
    super()
    this.model = options.model || DEFAULT_LIVE_VOICE_MODEL
    this.systemInstruction = options.systemInstruction || ""
    this.voiceName = options.voiceName || "Puck"
    this.closed = false
    this.receivedMediaChunks = []
    this.toolResponses = []
  }

  sendRealtimeInput(params) {
    if (this.closed) throw new Error("MOCK_LIVE_ERROR: Cannot send on closed session")
    const media = params?.media || params?.audio
    if (media?.data) {
      this.receivedMediaChunks.push(media)
      this.emit("media.received", media)
    }
  }

  sendClientContent(params) {
    if (this.closed) throw new Error("MOCK_LIVE_ERROR: Cannot send on closed session")
    this.emit("clientContent.received", params)
  }

  sendToolResponse(params) {
    if (this.closed) throw new Error("MOCK_LIVE_ERROR: Cannot send on closed session")
    this.toolResponses.push(params)
    this.emit("toolResponse.received", params)
  }

  // Simulated triggers for automated test scenarios
  simulateModelAudioOutput(pcm24kBuffer, textTranscript = null) {
    const base64Audio = pcm24kBuffer.toString("base64")
    const parts = [
      {
        inlineData: {
          mimeType: "audio/pcm;rate=24000",
          data: base64Audio,
        },
      },
    ]
    if (textTranscript) {
      parts.push({ text: textTranscript })
    }

    this.emit("message", {
      serverContent: {
        modelTurn: {
          parts,
        },
      },
    })
  }

  simulateTurnComplete() {
    this.emit("message", {
      serverContent: {
        turnComplete: true,
      },
    })
  }

  simulateInterruption() {
    this.emit("message", {
      serverContent: {
        interrupted: true,
      },
    })
  }

  simulateToolCall(functionCalls = []) {
    this.emit("message", {
      toolCall: {
        functionCalls,
      },
    })
  }

  close() {
    this.closed = true
    this.emit("close", 1000, "Mock session closed")
  }
}

/**
 * Manages an individual call's Gemini Live voice session.
 */
class GeminiLiveSession extends EventEmitter {
  constructor({ callSid, tenantId, voiceSession, config = {} }) {
    super()
    if (!callSid || !tenantId || !voiceSession) {
      throw new Error("Cannot instantiate GeminiLiveSession: callSid, tenantId, and voiceSession are required")
    }

    this.callSid = callSid
    this.tenantId = tenantId
    this.voiceSession = voiceSession
    this.config = config
    this.model = config.model || resolveLiveVoiceModel()
    this.status = "uninitialized"
    this.createdAt = Date.now()
    this.lastActivityAt = Date.now()

    // Bounded outbound queue for backpressure protection (max 50 packets)
    this.maxQueueSize = config.maxQueueSize || 50
    this.outboundAudioQueue = []

    this.metrics = {
      inputAudioPackets: 0,
      outputAudioPackets: 0,
      inputBytes: 0,
      outputBytes: 0,
      turnsCompleted: 0,
      interruptions: 0,
      transcripts: 0,
    }

    this.geminiSession = null
    this.audioInputHandler = null
    this.useMock = config.useMock !== undefined ? config.useMock : !isLiveEnabled()
  }

  /**
   * Connects to Gemini Live API (or Mock session in test/offline mode).
   */
  async start() {
    if (this.status === "active" || this.status === "connecting") return this
    this.status = "connecting"

    try {
      const { buildTenantReceptionistPrompt, fetchTenantGroundingData } = require("./receptionistPromptBuilder.service")
      let groundingData = {
        profile: this.config.profile || null,
        products: this.config.products || [],
        knowledgeSources: this.config.knowledgeSources || [],
      }
      if (!groundingData.profile && groundingData.knowledgeSources.length === 0) {
        const fetched = await fetchTenantGroundingData(this.tenantId)
        groundingData.profile = fetched.profile
        groundingData.products = fetched.products
        groundingData.knowledgeSources = fetched.knowledgeSources
      }

      const systemInstruction = buildTenantReceptionistPrompt({
        tenantId: this.tenantId,
        profile: groundingData.profile || { businessName: this.config.businessName },
        products: groundingData.products,
        knowledgeSources: groundingData.knowledgeSources,
        language: this.config.language,
        greeting: this.config.greeting,
      })

      if (this.useMock) {
        // Mock session mode
        const mockSession = new MockGeminiLiveSession({
          model: this.model,
          systemInstruction,
          voiceName: this.config.voiceName || "Puck",
        })

        mockSession.on("message", (msg) => this.handleGeminiMessage(msg))
        mockSession.on("close", (code, reason) => this.handleGeminiClose(code, reason))
        mockSession.on("error", (err) => this.handleGeminiError(err))

        this.geminiSession = mockSession
        this.status = "active"
      } else {
        // Real Live API mode via official @google/genai SDK
        const apiKey = getLiveApiKey()
        if (!apiKey) {
          throw new Error("GEMINI_LIVE_AUTH_ERROR: Missing Gemini API key for Live session")
        }

        const ai = new GoogleGenAI({ apiKey })

        let rejectConnectEarly
        const earlyClosePromise = new Promise((_, reject) => {
          rejectConnectEarly = reject
        })

        const timeoutPromise = new Promise((_, reject) => {
          const timer = setTimeout(() => {
            if (this.status === "connecting") {
              reject(new Error("GEMINI_LIVE_TIMEOUT: Handshake with Gemini Live timed out after 15s"))
            }
          }, 15000)
          timer.unref?.()
        })

        const liveConfig = {
          model: this.model,
          config: {
            responseModalities: ["AUDIO"],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: {
                  voiceName: this.config.voiceName || "Puck",
                },
              },
            },
            systemInstruction: {
              parts: [{ text: systemInstruction }],
            },
          },
          callbacks: {
            onmessage: (msg) => this.handleGeminiMessage(msg),
            onerror: (err) => {
              if (this.status === "connecting") {
                rejectConnectEarly(new Error(`GEMINI_LIVE_ERROR: ${err?.message || "Connection error"}`))
              }
              this.handleGeminiError(err)
            },
            onclose: (closeEvt, maybeReason) => {
              const code = typeof closeEvt === "number" ? closeEvt : (closeEvt?.code || 1000)
              const reason = typeof maybeReason === "string" ? maybeReason : (closeEvt?.reason || "Session closed")
              if (this.status === "connecting" && code !== 1000) {
                rejectConnectEarly(new Error(`GEMINI_LIVE_CONNECTION_CLOSED (${code}): ${reason}`))
              }
              this.handleGeminiClose(code, reason)
            },
          },
        }

        const connectPromise = ai.live.connect(liveConfig)
        this.geminiSession = await Promise.race([connectPromise, earlyClosePromise, timeoutPromise])
        this.status = "active"
      }

      // Attach voiceSession inbound audio listener
      this.audioInputHandler = (audioEvent) => {
        this.handleVoiceSessionAudioInput(audioEvent)
      }
      this.voiceSession.on("audio.input", this.audioInputHandler)

      this.emit("session.started", {
        callSid: this.callSid,
        tenantId: this.tenantId,
        model: this.model,
        mode: this.useMock ? "mock" : "live",
      })

      return this
    } catch (err) {
      this.status = "error"
      const sanitizedErr = new Error(sanitizeErrorMessage(err.message))
      this.emit("error", sanitizedErr)
      throw sanitizedErr
    }
  }

  /**
   * Forwards normalized 16kHz PCM audio from VoiceSession into Gemini Live.
   * @param {Object} audioEvent - { pcm16Payload, sampleRate }
   */
  handleVoiceSessionAudioInput(audioEvent) {
    if (this.status !== "active" || !this.geminiSession) return

    const { pcm16Payload, sampleRate } = audioEvent

    // 16kHz PCM input validation
    if (!Buffer.isBuffer(pcm16Payload) || pcm16Payload.length === 0) {
      return
    }

    if (sampleRate && sampleRate !== 16000) {
      this.emit("error", new Error(`INVALID_AUDIO_INPUT: Expected 16kHz audio, got ${sampleRate}Hz`))
      return
    }

    this.metrics.inputAudioPackets++
    this.metrics.inputBytes += pcm16Payload.length
    this.lastActivityAt = Date.now()

    const base64Audio = pcm16Payload.toString("base64")

    try {
      this.geminiSession.sendRealtimeInput({
        media: {
          mimeType: "audio/pcm;rate=16000",
          data: base64Audio,
        },
      })
    } catch (sendErr) {
      this.emit("error", new Error(sanitizeErrorMessage(sendErr.message)))
    }
  }

  /**
   * Processes incoming server messages from Gemini Live.
   * @param {Object} msg - LiveServerMessage
   */
  handleGeminiMessage(msg) {
    this.lastActivityAt = Date.now()
    if (!msg) return

    // 1. Detect Customer Barge-in / Interruption
    if (msg.serverContent?.interrupted) {
      this.metrics.interruptions++
      this.outboundAudioQueue = [] // Clear pending outbound chunks

      // Trigger provider playback buffer clear via VoiceSession
      if (this.voiceSession && typeof this.voiceSession.interrupt === "function") {
        this.voiceSession.interrupt()
      }

      this.emit("ai.interrupted", {
        callSid: this.callSid,
        tenantId: this.tenantId,
      })
      return
    }

    // 2. Process Model Turn Output (Audio Chunks & Transcripts)
    if (msg.serverContent?.modelTurn?.parts) {
      for (const part of msg.serverContent.modelTurn.parts) {
        // Output Audio Chunk (24kHz linear PCM LE)
        if (part.inlineData?.data) {
          const rawBase64 = part.inlineData.data
          const pcm24kBuffer = Buffer.from(rawBase64, "base64")

          // Validate non-empty 24kHz PCM chunk
          if (pcm24kBuffer.length > 0) {
            this.metrics.outputAudioPackets++
            this.metrics.outputBytes += pcm24kBuffer.length

            // Bounded queue backpressure protection
            if (this.outboundAudioQueue.length >= this.maxQueueSize) {
              this.outboundAudioQueue.shift() // Evict oldest
            }
            this.outboundAudioQueue.push(pcm24kBuffer)

            // Forward to VoiceSession (VoiceSession will downsample 24kHz -> provider rate/codec)
            if (this.voiceSession && typeof this.voiceSession.sendAudioOutput === "function") {
              this.voiceSession.sendAudioOutput(pcm24kBuffer, 24000)
            }

            this.emit("ai.audio", {
              callSid: this.callSid,
              pcm24kBuffer,
              sampleRate: 24000,
            })
          }
        }

        // Text Transcript Part
        if (part.text) {
          this.metrics.transcripts++
          this.emit("transcript.output", {
            callSid: this.callSid,
            tenantId: this.tenantId,
            text: part.text,
          })
        }
      }
    }

    // 3. Turn Completion Signal
    if (msg.serverContent?.turnComplete) {
      this.metrics.turnsCompleted++
      this.emit("turn.completed", {
        callSid: this.callSid,
        tenantId: this.tenantId,
      })
    }

    // 4. Controlled CRM Tool Execution Boundary
    if (msg.toolCall?.functionCalls) {
      const functionCalls = msg.toolCall.functionCalls
      this.emit("tool.call", {
        callSid: this.callSid,
        tenantId: this.tenantId,
        functionCalls,
      })

      const { executeCrmTool } = require("./receptionistCrmTools.service")

      Promise.all(
        functionCalls.map(async (fc) => {
          try {
            const toolResult = await executeCrmTool({
              tenantId: this.tenantId,
              name: fc.name,
              args: fc.args || {},
            })
            return {
              id: fc.id || "call_1",
              name: fc.name || "unknown",
              response: toolResult,
            }
          } catch (err) {
            return {
              id: fc.id || "call_1",
              name: fc.name || "unknown",
              response: { error: err.message },
            }
          }
        })
      )
        .then((functionResponses) => {
          if (typeof this.geminiSession?.sendToolResponse === "function") {
            this.geminiSession.sendToolResponse({ functionResponses })
          }
        })
        .catch(() => {})
    }
  }

  /**
   * Handles Gemini Live connection errors.
   */
  handleGeminiError(err) {
    this.status = "error"
    const sanitizedMsg = sanitizeErrorMessage(err?.message || "Unknown Gemini Live error")
    this.emit("error", new Error(sanitizedMsg))
  }

  /**
   * Handles Gemini Live session closure.
   */
  handleGeminiClose(code, reason) {
    if (this.status === "closed") return
    this.status = "closed"

    if (this.audioInputHandler && this.voiceSession) {
      this.voiceSession.removeListener("audio.input", this.audioInputHandler)
      this.audioInputHandler = null
    }

    this.outboundAudioQueue = []
    this.emit("session.closed", {
      callSid: this.callSid,
      tenantId: this.tenantId,
      metrics: this.metrics,
      code,
      reason,
    })
  }

  /**
   * Cleanly closes the Gemini Live session.
   */
  close() {
    if (this.status === "closed") return
    this.status = "closed"

    if (this.audioInputHandler && this.voiceSession) {
      this.voiceSession.removeListener("audio.input", this.audioInputHandler)
      this.audioInputHandler = null
    }

    if (this.geminiSession && typeof this.geminiSession.close === "function") {
      try {
        this.geminiSession.close()
      } catch (_) {}
    }

    this.outboundAudioQueue = []
    this.emit("session.closed", {
      callSid: this.callSid,
      tenantId: this.tenantId,
      metrics: this.metrics,
    })
  }
}

/**
 * Manager Service for Gemini Live Sessions
 * Maintains strict 1:1 call session isolation and prevents cross-tenant leaks.
 */
class GeminiLiveManager extends EventEmitter {
  constructor() {
    super()
    this.activeSessions = new Map() // callSid -> GeminiLiveSession
  }

  /**
   * Creates and registers a new Gemini Live session for an incoming call.
   * @param {Object} params - { callSid, tenantId, voiceSession, config }
   * @returns {GeminiLiveSession}
   */
  createSession({ callSid, tenantId, voiceSession, config = {} }) {
    if (!callSid || !tenantId || !voiceSession) {
      throw new Error("Cannot create Gemini Live session: callSid, tenantId, and voiceSession are required")
    }

    // Check if session already exists for this callSid
    const existing = this.activeSessions.get(callSid)
    if (existing) {
      // Ensure cross-tenant access is rejected
      if (existing.tenantId !== tenantId) {
        throw new Error(`SECURITY_VIOLATION: Cross-tenant session reuse forbidden (requested ${tenantId}, owned by ${existing.tenantId})`)
      }
      return existing
    }

    const session = new GeminiLiveSession({
      callSid,
      tenantId,
      voiceSession,
      config,
    })

    session.on("session.closed", () => {
      this.activeSessions.delete(callSid)
    })

    this.activeSessions.set(callSid, session)
    this.emit("session.created", session)
    return session
  }

  /**
   * Retrieves an active session by callSid, with optional tenant verification.
   * @param {string} callSid
   * @param {string} [expectedTenantId]
   * @returns {GeminiLiveSession|null}
   */
  getSession(callSid, expectedTenantId = null) {
    const session = this.activeSessions.get(callSid) || null
    if (session && expectedTenantId && session.tenantId !== expectedTenantId) {
      throw new Error(`SECURITY_VIOLATION: Cross-tenant session access rejected`)
    }
    return session
  }

  /**
   * Closes an active session.
   */
  closeSession(callSid) {
    const session = this.activeSessions.get(callSid)
    if (session) {
      session.close()
      this.activeSessions.delete(callSid)
      return true
    }
    return false
  }

  /**
   * Returns current active live session count.
   */
  getActiveSessionCount() {
    return this.activeSessions.size
  }

  /**
   * Closes all active sessions cleanly.
   */
  closeAll() {
    for (const session of this.activeSessions.values()) {
      try {
        session.close()
      } catch (_) {}
    }
    this.activeSessions.clear()
  }

  /**
   * Automatically attaches to a VoiceGateway instance to manage life-cycles.
   * @param {import('./voiceGateway.service').VoiceGatewayService} voiceGateway
   */
  attachToVoiceGateway(voiceGateway, sessionConfig = {}) {
    if (!voiceGateway) return

    voiceGateway.on("session.created", (voiceSession) => {
      try {
        const liveSession = this.createSession({
          callSid: voiceSession.callSid,
          tenantId: voiceSession.tenantId,
          voiceSession,
          config: sessionConfig,
        })
        liveSession.start().catch((err) => {
          console.error(`⚠️ Failed to start Gemini Live for call ${voiceSession.callSid}:`, err.message)
        })
      } catch (err) {
        console.error(`⚠️ Failed to initialize Gemini Live session for call ${voiceSession.callSid}:`, err.message)
      }
    })
  }
}

// Export singleton manager and components
const geminiLiveManager = new GeminiLiveManager()

module.exports = {
  geminiLiveManager,
  GeminiLiveManager,
  GeminiLiveSession,
  MockGeminiLiveSession,
  DEFAULT_LIVE_VOICE_MODEL,
  resolveLiveVoiceModel,
  getLiveApiKey,
  isLiveEnabled,
  buildInitialReceptionistPrompt,
  sanitizeErrorMessage,
}

