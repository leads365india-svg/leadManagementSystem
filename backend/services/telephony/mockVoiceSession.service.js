/**
 * Mock Voice Session Service
 * 
 * Deterministic multi-turn conversation simulator for testing AI Receptionist
 * flows (Hindi/English greetings, requirement gathering, lead lookup/creation tool calls,
 * follow-up scheduling, conversation termination) without invoking the paid Gemini Live API.
 */

class MockVoiceSession {
  constructor(options = {}) {
    this.tenantId = options.tenantId || "test_tenant"
    this.callerNumber = options.callerNumber || ""
    this.language = options.language || "hi-IN" // "hi-IN", "en-IN", "hinglish"
    this.turns = []
    this.toolCallsExecuted = []
    this.isCompleted = false
    this.metadata = {
      customerNeeds: [],
      productInterests: [],
      callOutcome: "FOLLOW_UP_REQUIRED",
    }
  }

  /**
   * Generates opening greeting based on configured tenant language.
   */
  getGreeting() {
    let text = ""
    if (this.language === "hi-IN" || this.language === "hinglish") {
      text = "Namaste! Leads365 me aapka swagat hai. Main aapki kya sahayata kar sakta hoon?"
    } else {
      text = "Hello! Thank you for calling Leads365. How may I assist you today?"
    }

    const turn = {
      turnNumber: 1,
      speaker: "ai",
      text,
      timestampMs: Date.now(),
    }
    this.turns.push(turn)
    return turn
  }

  /**
   * Simulates caller input and AI reasoning / tool call execution.
   */
  processCallerTurn(callerUtterance) {
    if (this.isCompleted) {
      throw new Error("Cannot process turn: Conversation session has already completed.")
    }

    const turnIndex = this.turns.length + 1
    this.turns.push({
      turnNumber: turnIndex,
      speaker: "caller",
      text: callerUtterance,
      timestampMs: Date.now(),
    })

    const lower = (callerUtterance || "").toLowerCase()
    let aiResponse = ""
    let generatedToolCalls = []

    // 1. Customer requirement / product inquiry
    if (lower.includes("price") || lower.includes("pricing") || lower.includes("rate") || lower.includes("cost") || lower.includes("flat") || lower.includes("product")) {
      this.metadata.customerNeeds.push(callerUtterance)
      this.metadata.productInterests.push("General Inquiry")
      this.metadata.callOutcome = "INTERESTED"

      if (this.language === "hi-IN" || this.language === "hinglish") {
        aiResponse = "Bilkul, hamare paas sabhi options available hain. Kya main aapka naam aur requirement note kar sakta hoon?"
      } else {
        aiResponse = "Certainly, we have multiple options available. May I take your name and preferred requirements?"
      }
    }
    // 2. Lead registration / contact details
    else if (lower.includes("naam") || lower.includes("name is") || lower.includes("i am") || lower.includes("sharma") || lower.includes("kumar") || lower.includes("singh")) {
      const toolCall = {
        name: "create_or_update_lead",
        args: {
          phone: this.callerNumber,
          rawRequirement: callerUtterance,
          source: "AI Receptionist",
          status: "New",
        },
        id: `tool_${Date.now()}`,
      }
      generatedToolCalls.push(toolCall)
      this.toolCallsExecuted.push(toolCall)

      if (this.language === "hi-IN" || this.language === "hinglish") {
        aiResponse = "Dhanyawad! Maine aapki details note kar li hain. Kya hamari team aapko follow-up ke liye contact kare?"
      } else {
        aiResponse = "Thank you! I have recorded your details. Would you like our sales team to follow up with you?"
      }
    }
    // 3. Follow-up scheduling
    else if (lower.includes("call back") || lower.includes("kal") || lower.includes("tomorrow") || lower.includes("follow up") || lower.includes("shaam") || lower.includes("evening")) {
      const toolCall = {
        name: "schedule_followup",
        args: {
          phone: this.callerNumber,
          preferredTiming: callerUtterance,
          priority: "high",
        },
        id: `tool_fu_${Date.now()}`,
      }
      generatedToolCalls.push(toolCall)
      this.toolCallsExecuted.push(toolCall)
      this.metadata.callOutcome = "CALL_BACK_LATER"

      if (this.language === "hi-IN" || this.language === "hinglish") {
        aiResponse = "Maine hamare sales manager ke saath aapka callback schedule kar diya hai. Kuch aur jaankari chahiye?"
      } else {
        aiResponse = "I have scheduled a callback for you with our sales team. Is there anything else I can assist you with?"
      }
    }
    // 4. Wrap up / Goodbye
    else if (lower.includes("bye") || lower.includes("alvida") || lower.includes("thank you") || lower.includes("shukriya") || lower.includes("nahi") || lower.includes("no thanks")) {
      this.isCompleted = true
      if (this.language === "hi-IN" || this.language === "hinglish") {
        aiResponse = "Dhanyawad Leads365 me call karne ke liye. Aapka din shubh ho! Alvida."
      } else {
        aiResponse = "Thank you for calling Leads365. Have a great day ahead! Goodbye."
      }
    }
    // 5. Default conversational fallback
    else {
      aiResponse = this.language === "hi-IN" || this.language === "hinglish"
        ? "Ji, main samajh raha hoon. Kripya apni zaroorat vistaar se batayein."
        : "I understand. Could you please share more details about your requirement?"
    }

    const aiTurn = {
      turnNumber: turnIndex + 1,
      speaker: "ai",
      text: aiResponse,
      toolCalls: generatedToolCalls,
      timestampMs: Date.now(),
    }
    this.turns.push(aiTurn)

    return aiTurn
  }

  /**
   * Finalizes session and generates structured call summary.
   */
  completeSession() {
    this.isCompleted = true
    return {
      tenantId: this.tenantId,
      callerNumber: this.callerNumber,
      totalTurns: this.turns.length,
      transcript: this.turns.map((t) => `${t.speaker.toUpperCase()}: ${t.text}`).join("\n"),
      toolCalls: this.toolCallsExecuted,
      metadata: this.metadata,
      completedAt: Date.now(),
    }
  }
}

module.exports = MockVoiceSession

