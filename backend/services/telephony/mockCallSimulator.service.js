const crypto = require("crypto")
const MockTelephonyAdapter = require("./mockTelephonyAdapter.service")
const MockVoiceSession = require("./mockVoiceSession.service")

/**
 * Mock Call Simulator Test Harness
 * 
 * Orchestrates full lifecycle simulations for Leads365 AI Receptionist:
 * - Human-answer vs AI-answer routing
 * - Multi-turn conversational flow (Hindi & English)
 * - CRM lead matching and provisional auto-lead creation
 * - Call and recording persistence contract
 * - Idempotency and deduplication
 * - Error and disconnection resilience
 * 
 * Strict Production Safety:
 * Completely disabled in production unless ALLOW_TELEPHONY_TEST_HARNESS is explicitly set.
 */
class MockCallSimulator {
  constructor(options = {}) {
    if (process.env.NODE_ENV === "production" && process.env.ALLOW_TELEPHONY_TEST_HARNESS !== "true") {
      throw new Error("MockCallSimulator is strictly disabled in production environments.")
    }

    this.adapter = new MockTelephonyAdapter(options)
    this.inMemoryLeads = new Map() // leadId -> leadDoc
    this.inMemoryCalls = new Map() // callId -> callDoc
    this.processedWebhookIds = new Set()
  }

  // Seed test leads in isolated in-memory store
  seedLead(lead) {
    this.inMemoryLeads.set(lead._id || lead.id, { ...lead })
  }

  findLeadByPhone(phone, tenantId) {
    for (const lead of this.inMemoryLeads.values()) {
      if (lead.tenantId === tenantId && (lead.phone === phone || lead.phoneNormalized === phone)) {
        return lead
      }
    }
    return null
  }

  registerVirtualNumber(virtualNumber, tenantId) {
    this.adapter.registerVirtualNumber(virtualNumber, tenantId)
  }

  /**
   * Simulates full Inbound Call with Decision Routing:
   * 1. Check if human answers on physical SIM/handset.
   * 2. If human answers: Call completes normally, AI does not answer.
   * 3. If human does not answer: Routed to AI Receptionist.
   * 4. AI engages caller, checks/creates lead, generates recording.
   */
  async simulateInboundCall({
    callerNumber,
    virtualNumber,
    tenantId,
    humanAnswered = false,
    callerScript = [],
    language = "hi-IN",
    disconnectUnexpectedly = false,
  }) {
    // 1. Simulate telephony carrier inbound event
    const callResult = await this.adapter.simulateIncomingCall({
      callerNumber,
      virtualNumber,
      tenantId,
      humanAnswered,
      disconnectUnexpectedly,
    })

    if (callResult.error) {
      return {
        success: false,
        phase: "routing",
        error: callResult.error,
        callResult,
      }
    }

    const resolvedTenant = callResult.tenantId

    // 2. Human Answer Outcome: AI does not engage
    if (callResult.humanAnswered) {
      const callRecord = {
        callId: callResult.callSid,
        tenantId: resolvedTenant,
        phoneNumber: callerNumber,
        source: "manual",
        status: "completed",
        answeredBy: "human",
        aiAnswered: false,
        durationSeconds: callResult.durationSeconds,
        hasRecording: false,
        createdAt: new Date(),
      }
      this.inMemoryCalls.set(callResult.callSid, callRecord)
      return {
        success: true,
        aiAnswered: false,
        callRecord,
        message: "Human answered call; AI receptionist stood down as required.",
      }
    }

    // 3. Unexpected Disconnection Outcome
    if (disconnectUnexpectedly) {
      const callRecord = {
        callId: callResult.callSid,
        tenantId: resolvedTenant,
        phoneNumber: callerNumber,
        source: "ai_receptionist",
        status: "failed",
        failureReason: callResult.failureReason,
        aiAnswered: true,
        durationSeconds: 2,
        hasRecording: false,
        createdAt: new Date(),
      }
      this.inMemoryCalls.set(callResult.callSid, callRecord)
      return {
        success: false,
        aiAnswered: true,
        callRecord,
        error: "Call dropped unexpectedly before conversation completed.",
      }
    }

    // 4. AI Answers: Run Mock Voice Session
    const session = new MockVoiceSession({
      tenantId: resolvedTenant,
      callerNumber,
      language,
    })

    const greeting = session.getGreeting()

    // Execute scripted caller responses
    for (const utterance of callerScript) {
      session.processCallerTurn(utterance)
    }

    const sessionSummary = session.completeSession()

    // 5. CRM Lead Association / Auto-Lead Creation
    let lead = this.findLeadByPhone(callerNumber, resolvedTenant)
    let leadCreated = false

    if (!lead) {
      // New unknown caller becomes a CRM Lead
      lead = {
        _id: `lead_auto_${Date.now()}`,
        name: `Inbound Caller (${callerNumber})`,
        phone: callerNumber,
        phoneNormalized: callerNumber,
        tenantId: resolvedTenant,
        status: "New",
        source: "AI Receptionist",
        notes: `AI Call Requirement: ${sessionSummary.metadata.customerNeeds.join("; ")}`,
        createdAt: new Date(),
      }
      this.inMemoryLeads.set(lead._id, lead)
      leadCreated = true
    } else {
      // Existing lead updated
      lead.notes = `${lead.notes || ""}\n[AI Call]: ${sessionSummary.metadata.customerNeeds.join("; ")}`.trim()
    }

    // 6. Persist Call Record with Recording Metadata
    const recordingData = callResult.recording
    const callRecord = {
      callId: callResult.callSid,
      tenantId: resolvedTenant,
      leadId: lead._id,
      phoneNumber: callerNumber,
      source: "ai_receptionist",
      status: "completed",
      callOutcome: sessionSummary.metadata.callOutcome,
      answeredBy: "ai_receptionist",
      aiAnswered: true,
      durationSeconds: callResult.durationSeconds,
      hasRecording: Boolean(recordingData),
      recording: recordingData
        ? {
            recordingSid: recordingData.recordingSid,
            recordingUrl: recordingData.recordingUrl,
            status: recordingData.status,
            sizeBytes: recordingData.sizeBytes,
            sha256: recordingData.sha256,
            duration: recordingData.duration,
            provider: "mock",
          }
        : null,
      transcript: sessionSummary.transcript,
      toolCalls: sessionSummary.toolCalls,
      createdAt: new Date(),
    }
    this.inMemoryCalls.set(callResult.callSid, callRecord)

    return {
      success: true,
      aiAnswered: true,
      lead,
      leadCreated,
      callRecord,
      sessionSummary,
      greetingText: greeting.text,
    }
  }

  /**
   * Tests Idempotency: Processing the same call or recording webhook twice
   */
  processWebhookWithIdempotency(webhookId, payload) {
    if (this.processedWebhookIds.has(webhookId)) {
      return {
        processed: false,
        duplicate: true,
        message: `Webhook ${webhookId} already processed. Idempotent skip.`,
      }
    }
    this.processedWebhookIds.add(webhookId)
    return {
      processed: true,
      duplicate: false,
      payload,
    }
  }
}

module.exports = MockCallSimulator

