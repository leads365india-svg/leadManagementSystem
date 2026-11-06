const { normalizePhoneE164 } = require("../../utils/phoneNormalizer")
const { inMemoryStore, scheduleFollowup, linkCallToLead } = require("./receptionistCrmTools.service")
const { getTelephonyAdapter } = require("./telephonyAdapterFactory")
const mongoose = require("mongoose")

/**
 * Human Handover & Failure Recovery Service
 * 
 * Safely manages human escalation and recovery from communication faults:
 * - Validates tenant-configured human handover destination number.
 * - Enforces anti-loop protections (caller === destination, max hop count).
 * - Issues provider-specific call transfer instructions (Twilio Dial, Exotel, Mock).
 * - Records escalation trajectory in Call and FollowUp records.
 * - Provides graceful conversational fallbacks for unconfigured destinations, timeouts, or disconnection.
 */

// Tracking transfer attempts per callSid to prevent transfer bounce loops
const callTransferRegistry = new Map() // callSid -> { attempts: number, transferredAt: Date }

function isLiveDbReady() {
  return Boolean(mongoose.connection && mongoose.connection.readyState === 1 && mongoose.connection.db)
}

/**
 * Initiates human escalation transfer for an active AI Receptionist call.
 * 
 * @param {Object} params
 * @param {string} params.tenantId
 * @param {string} params.callSid
 * @param {string} [params.callerPhone]
 * @param {string} [params.reason="Customer requested human agent"]
 * @param {string} [params.provider="mock"]
 * @returns {Promise<Object>} Handover result with provider instructions or fallback message
 */
async function initiateHumanHandover({
  tenantId,
  callSid,
  callerPhone = "",
  reason = "Customer requested human agent",
  provider = "mock",
}) {
  if (!tenantId || !callSid) {
    throw new Error("HANDOVER_ERROR: tenantId and callSid are required")
  }

  // 1. Anti-Loop Protection: Transfer Hop Count Limit
  const existingTransfer = callTransferRegistry.get(callSid)
  if (existingTransfer && existingTransfer.attempts >= 1) {
    return {
      status: "loop_blocked",
      success: false,
      message: "Call has already been transferred once. Additional transfers are blocked to prevent routing loops.",
      fallbackSpokenText: "I have already connected this call to our support line. Please hold while the line rings.",
    }
  }

  // 2. Resolve Tenant Configuration
  let handoverNumber = null
  let businessName = "the business"

  if (!isLiveDbReady()) {
    // In-Memory config resolution (null if not explicitly provided or deleted)
    handoverNumber = process.env.TEST_HANDOVER_NUMBER || null
  } else {
    const TenantBusinessProfile = require("../../models/TenantBusinessProfile")
    const profile = await TenantBusinessProfile.findOne({ tenantId }).lean()
    handoverNumber = profile?.telephonyConfig?.humanHandoverNumber || null
    businessName = profile?.businessName || businessName
  }

  // 3. Unconfigured Destination Handling
  if (!handoverNumber || !handoverNumber.trim()) {
    // Graceful fallback: log callback task in CRM and inform caller
    try {
      await scheduleFollowup({
        tenantId,
        leadId: `lead_call_${callSid}`,
        scheduledAt: Date.now() + 15 * 60 * 1000, // 15 min callback
        note: `URGENT CALLBACK: Caller requested human agent (${reason}), but no live transfer number was configured.`,
        type: "call",
      })
    } catch (_) {}

    return {
      status: "no_destination",
      success: false,
      message: "No human handover number configured for this tenant.",
      fallbackSpokenText: "Our team members are currently assisting other callers. I have logged an urgent callback request with your phone number, and an executive will call you back shortly.",
    }
  }

  // 4. Forwarding Loop Protection: Caller === Destination
  const callerNorm = callerPhone ? normalizePhoneE164(callerPhone) : ""
  const destNorm = normalizePhoneE164(handoverNumber)

  if (callerNorm && destNorm && callerNorm === destNorm) {
    return {
      status: "loop_prevented",
      success: false,
      message: "Cannot transfer call: Destination number is identical to the caller's number.",
      fallbackSpokenText: "I am unable to transfer to that number as it matches your current calling number. I will notify our support team to reach out to you directly.",
    }
  }

  // 5. Generate Provider-Specific Transfer Directives
  let providerDirective = null
  if (provider === "twilio") {
    providerDirective = `<?xml version="1.0" encoding="UTF-8"?><Response><Say language="hi-IN">Kripya pratiksha karein, hum aapki call hamare executive ko transfer kar rahe hain.</Say><Dial timeout="25">${destNorm || handoverNumber}</Dial></Response>`
  } else if (provider === "exotel") {
    providerDirective = {
      action: "transfer",
      destination: destNorm || handoverNumber,
      timeout: 25,
      announcement: "Please hold while we transfer your call.",
    }
  } else {
    // Mock Telephony Provider
    providerDirective = {
      action: "transfer",
      destination: destNorm || handoverNumber,
      provider: "mock",
      reason,
      status: "initiated",
    }
  }

  // Record transfer attempt in registry
  callTransferRegistry.set(callSid, {
    attempts: (existingTransfer?.attempts || 0) + 1,
    transferredAt: new Date(),
    destination: destNorm || handoverNumber,
  })

  // 6. Update Call Outcome in CRM
  try {
    await linkCallToLead({
      tenantId,
      callSid,
      phone: callerPhone,
      durationSeconds: 0,
      callOutcome: "Escalated",
      notes: `Call transferred to human destination: ${destNorm || handoverNumber}. Reason: ${reason}`,
    })
  } catch (_) {}

  return {
    status: "transferred",
    success: true,
    destination: destNorm || handoverNumber,
    providerDirective,
    fallbackSpokenText: "Please hold for a moment while I transfer your call to our human representative.",
  }
}

/**
 * Generates safe fallback text for technical disconnection or AI fault.
 */
function getSystemFailureFallbackMessage(language = "hinglish") {
  if (language === "hindi") {
    return "Takneeki samasya ke kaaran baat cheet asuvidhaajanak ho gayi hai. Hamari team aapko jald hi call karegi. Dhanyavaad."
  } else if (language === "english") {
    return "We are experiencing a temporary network issue. Your details have been recorded and our team member will call you back right away. Thank you."
  }
  return "Kshama chahte hain, network samasya ke kaaran call connect nahi ho pa rahi hai. Aapka number record ho chuka hai, hamari team jald hi call karegi."
}

function clearTransferRegistry() {
  callTransferRegistry.clear()
}

module.exports = {
  initiateHumanHandover,
  getSystemFailureFallbackMessage,
  clearTransferRegistry,
}
