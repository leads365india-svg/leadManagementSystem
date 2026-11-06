const { TenantBusinessProfile } = require("../../models/TenantBusinessProfile")
const Account = require("../../models/Account")
const { encrypt, decrypt, maskSecret } = require("../../utils/cryptoUtils")
const audit = require("../auditService")
const { runWithTenantContext } = require("../../middleware/tenantContext")

/**
 * Leads365 AI Receptionist — Multi-Tenant Telephony Configuration Service
 * 
 * Manages tenant-scoped telephony configuration, credential encryption (AES-256-GCM),
 * safe credential masking, fail-closed security, and audit logging.
 */

const DEFAULT_TELEPHONY_CONFIG = {
  provider: "mock",
  connectionMode: "sim_forwarding",
  businessPhoneNumber: "",
  virtualNumber: "",
  answerMode: "unanswered_only",
  noAnswerTimeoutSeconds: 20,
  aiEnabled: false,
  aiLanguage: "hinglish",
  aiGreeting: "Namaste, thank you for calling. How can I help you today?",
  humanHandoverNumber: "",
  recordingEnabled: true,
  status: "unconfigured",
  credentialsConfigured: false,
  credentialsLastUpdated: null,
  credentialsMasked: {},
}

/**
 * Safely masks credential key-value pairs based on provider type.
 * Ensures raw credentials or auth tokens are never stored in plaintext or exposed in API responses.
 * 
 * @param {string} provider - mock | twilio | exotel | airtel_iq | sip
 * @param {Object} credentials - Raw provider credentials object
 * @returns {Object} Masked credentials object
 */
function maskCredentials(provider, credentials) {
  if (!credentials || typeof credentials !== "object") {
    return {}
  }

  const masked = {}

  for (const [key, value] of Object.entries(credentials)) {
    if (value === null || value === undefined) {
      continue
    }

    const strVal = String(value).trim()

    // Non-sensitive configuration fields can remain visible
    if (["sipServer", "host", "port", "region", "subAccount"].includes(key)) {
      masked[key] = strVal
      continue
    }

    // Mask sensitive tokens, secrets, passwords, sids, and api keys
    masked[key] = maskSecret(strVal, 4)
  }

  return masked
}

/**
 * Sanitizes telephony configuration document for safe API responses.
 * Strictly excludes encrypted ciphertext and internal storage keys.
 * 
 * @param {Object} rawConfig - Telephony subdocument
 * @returns {Object} Safe client-facing configuration
 */
function sanitizeTelephonyConfig(rawConfig) {
  const config = rawConfig || {}
  return {
    provider: config.provider || DEFAULT_TELEPHONY_CONFIG.provider,
    connectionMode: config.connectionMode || DEFAULT_TELEPHONY_CONFIG.connectionMode,
    businessPhoneNumber: config.businessPhoneNumber || DEFAULT_TELEPHONY_CONFIG.businessPhoneNumber,
    virtualNumber: config.virtualNumber || DEFAULT_TELEPHONY_CONFIG.virtualNumber,
    answerMode: config.answerMode || DEFAULT_TELEPHONY_CONFIG.answerMode,
    noAnswerTimeoutSeconds:
      typeof config.noAnswerTimeoutSeconds === "number"
        ? config.noAnswerTimeoutSeconds
        : DEFAULT_TELEPHONY_CONFIG.noAnswerTimeoutSeconds,
    aiEnabled: Boolean(config.aiEnabled),
    aiLanguage: config.aiLanguage || DEFAULT_TELEPHONY_CONFIG.aiLanguage,
    aiGreeting: config.aiGreeting || DEFAULT_TELEPHONY_CONFIG.aiGreeting,
    humanHandoverNumber: config.humanHandoverNumber || DEFAULT_TELEPHONY_CONFIG.humanHandoverNumber,
    recordingEnabled: config.recordingEnabled !== undefined ? Boolean(config.recordingEnabled) : true,
    status: config.status || DEFAULT_TELEPHONY_CONFIG.status,
    credentialsConfigured: Boolean(config.credentialsConfigured),
    credentialsLastUpdated: config.credentialsLastUpdated || null,
    credentialsMasked: config.credentialsMasked || {},
  }
}

/**
 * Retrieves the telephony configuration for a tenant.
 * 
 * @param {string} tenantId - Tenant identifier
 * @returns {Promise<Object>} Sanitized telephony configuration
 */
async function getTenantTelephonyConfig(tenantId) {
  if (!tenantId || typeof tenantId !== "string") {
    throw new Error("Invalid tenant identifier provided")
  }

  const profile = await runWithTenantContext(tenantId, async () => {
    return await TenantBusinessProfile.findOne({ tenantId }).lean()
  })

  if (!profile || !profile.telephonyConfig) {
    return { ...DEFAULT_TELEPHONY_CONFIG }
  }

  return sanitizeTelephonyConfig(profile.telephonyConfig)
}

/**
 * Updates or creates telephony configuration for a tenant.
 * Encrypts sensitive credentials via AES-256-GCM, fails closed if encryption keys are missing,
 * enforces multi-tenant boundaries, and records audit logs.
 * 
 * @param {string} tenantId - Tenant identifier
 * @param {Object} updateData - Configuration fields to update
 * @param {Object} actor - Authenticated user performing the update
 * @param {Object} [req] - Express request object for audit logging
 * @returns {Promise<Object>} Sanitized updated configuration
 */
async function updateTenantTelephonyConfig(tenantId, updateData = {}, actor = null, req = null) {
  if (!tenantId || typeof tenantId !== "string") {
    throw new Error("Invalid tenant identifier provided")
  }

  const {
    provider,
    connectionMode,
    businessPhoneNumber,
    virtualNumber,
    answerMode,
    noAnswerTimeoutSeconds,
    aiEnabled,
    aiLanguage,
    aiGreeting,
    humanHandoverNumber,
    recordingEnabled,
    status,
    credentials,
    clearCredentials,
  } = updateData

  // 1. Validation
  const validProviders = ["mock", "twilio", "exotel", "airtel_iq", "sip"]
  if (provider && !validProviders.includes(provider)) {
    throw new Error(`Invalid telephony provider: '${provider}'. Allowed: ${validProviders.join(", ")}`)
  }

  const validModes = ["sim_forwarding", "cloud_number", "sip_pbx"]
  if (connectionMode && !validModes.includes(connectionMode)) {
    throw new Error(`Invalid connection mode: '${connectionMode}'. Allowed: ${validModes.join(", ")}`)
  }

  const validLanguages = ["hindi", "english", "hinglish", "both"]
  if (aiLanguage && !validLanguages.includes(aiLanguage)) {
    throw new Error(`Invalid AI language: '${aiLanguage}'. Allowed: ${validLanguages.join(", ")}`)
  }

  const validStatuses = ["unconfigured", "active", "paused", "error"]
  if (status && !validStatuses.includes(status)) {
    throw new Error(`Invalid telephony status: '${status}'. Allowed: ${validStatuses.join(", ")}`)
  }

  if (noAnswerTimeoutSeconds !== undefined) {
    const timeout = Number(noAnswerTimeoutSeconds)
    if (isNaN(timeout) || timeout < 10 || timeout > 60) {
      throw new Error("noAnswerTimeoutSeconds must be a number between 10 and 60 seconds")
    }
  }

  // 2. Load existing profile or prepare baseline
  let existingProfile = await runWithTenantContext(tenantId, async () => {
    return await TenantBusinessProfile.findOne({ tenantId })
  })

  let baselineBusinessName = "My Business"
  if (!existingProfile) {
    const account = await Account.findOne({ accountId: tenantId }).lean()
    if (account?.companyName) {
      baselineBusinessName = account.companyName
    }
  }

  const currentConfig = existingProfile?.telephonyConfig || {}

  // 3. Prepare config updates
  const updatedTelephonyConfig = {
    provider: provider !== undefined ? provider : (currentConfig.provider || "mock"),
    connectionMode: connectionMode !== undefined ? connectionMode : (currentConfig.connectionMode || "sim_forwarding"),
    businessPhoneNumber:
      businessPhoneNumber !== undefined ? String(businessPhoneNumber).trim() : (currentConfig.businessPhoneNumber || ""),
    virtualNumber:
      virtualNumber !== undefined ? String(virtualNumber).trim() : (currentConfig.virtualNumber || ""),
    answerMode: answerMode !== undefined ? answerMode : (currentConfig.answerMode || "unanswered_only"),
    noAnswerTimeoutSeconds:
      noAnswerTimeoutSeconds !== undefined
        ? Number(noAnswerTimeoutSeconds)
        : (currentConfig.noAnswerTimeoutSeconds || 20),
    aiEnabled: aiEnabled !== undefined ? Boolean(aiEnabled) : Boolean(currentConfig.aiEnabled),
    aiLanguage: aiLanguage !== undefined ? aiLanguage : (currentConfig.aiLanguage || "hinglish"),
    aiGreeting:
      aiGreeting !== undefined
        ? String(aiGreeting).trim()
        : (currentConfig.aiGreeting || "Namaste, thank you for calling. How can I help you today?"),
    humanHandoverNumber:
      humanHandoverNumber !== undefined ? String(humanHandoverNumber).trim() : (currentConfig.humanHandoverNumber || ""),
    recordingEnabled:
      recordingEnabled !== undefined ? Boolean(recordingEnabled) : (currentConfig.recordingEnabled !== false),
    status: status !== undefined ? status : (currentConfig.status || "unconfigured"),
    credentialsEncrypted: currentConfig.credentialsEncrypted || null,
    credentialsConfigured: Boolean(currentConfig.credentialsConfigured),
    credentialsLastUpdated: currentConfig.credentialsLastUpdated || null,
    credentialsMasked: currentConfig.credentialsMasked || {},
  }

  let credentialsModified = false

  // 4. Handle Credentials
  if (clearCredentials === true || credentials === null) {
    updatedTelephonyConfig.credentialsEncrypted = null
    updatedTelephonyConfig.credentialsConfigured = false
    updatedTelephonyConfig.credentialsLastUpdated = null
    updatedTelephonyConfig.credentialsMasked = {}
    credentialsModified = true
  } else if (credentials && typeof credentials === "object" && Object.keys(credentials).length > 0) {
    // Fail-closed AES-256-GCM encryption
    // If ENCRYPTION_KEY or JWT_SECRET is not available, encrypt() throws fail-closed error
    const activeProvider = updatedTelephonyConfig.provider
    const encryptedResult = encrypt(credentials)

    updatedTelephonyConfig.credentialsEncrypted = encryptedResult.serialized
    updatedTelephonyConfig.credentialsConfigured = true
    updatedTelephonyConfig.credentialsLastUpdated = new Date()
    updatedTelephonyConfig.credentialsMasked = maskCredentials(activeProvider, credentials)
    credentialsModified = true
  }

  // 5. Persist to TenantBusinessProfile
  const savedProfile = await runWithTenantContext(tenantId, async () => {
    return await TenantBusinessProfile.findOneAndUpdate(
      { tenantId },
      {
        $set: { telephonyConfig: updatedTelephonyConfig },
        $setOnInsert: {
          tenantId,
          businessName: baselineBusinessName,
          industry: "Other",
          languages: ["English", "Hindi"],
          status: "active",
        },
      },
      {
        new: true,
        upsert: true,
        runValidators: true,
        setDefaultsOnInsert: true,
      }
    )
  })

  // 6. Record Audit Log
  try {
    await audit.log({
      tenantId,
      actor,
      action: "telephony.config_update",
      entity: "TenantBusinessProfile",
      entityId: savedProfile._id,
      summary: `Updated telephony configuration for tenant '${tenantId}' (provider: ${updatedTelephonyConfig.provider}, AI: ${updatedTelephonyConfig.aiEnabled ? "enabled" : "disabled"})`,
      details: {
        provider: updatedTelephonyConfig.provider,
        connectionMode: updatedTelephonyConfig.connectionMode,
        aiEnabled: updatedTelephonyConfig.aiEnabled,
        aiLanguage: updatedTelephonyConfig.aiLanguage,
        status: updatedTelephonyConfig.status,
        credentialsModified,
        credentialsConfigured: updatedTelephonyConfig.credentialsConfigured,
      },
      req,
    })
  } catch (auditErr) {
    console.error("⚠️ Failed to record telephony audit log:", auditErr.message)
  }

  return sanitizeTelephonyConfig(savedProfile.telephonyConfig)
}

/**
 * Decrypts telephony credentials for internal telephony workers / voice gateways.
 * NEVER expose this function directly to API routes or client responses.
 * 
 * @param {string} tenantId - Tenant identifier
 * @returns {Promise<Object|null>} Decrypted credentials or null
 */
async function getDecryptedTelephonyCredentials(tenantId) {
  if (!tenantId || typeof tenantId !== "string") {
    throw new Error("Invalid tenant identifier provided")
  }

  const profile = await runWithTenantContext(tenantId, async () => {
    return await TenantBusinessProfile.findOne({ tenantId }).lean()
  })

  const encryptedSerialized = profile?.telephonyConfig?.credentialsEncrypted
  if (!encryptedSerialized) {
    return null
  }

  return decrypt(encryptedSerialized)
}

module.exports = {
  DEFAULT_TELEPHONY_CONFIG,
  maskCredentials,
  sanitizeTelephonyConfig,
  getTenantTelephonyConfig,
  updateTenantTelephonyConfig,
  getDecryptedTelephonyCredentials,
}

