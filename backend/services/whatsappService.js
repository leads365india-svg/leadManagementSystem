const crypto = require("crypto")
const { Integration } = require("../models/Integration")
const { WhatsAppMessage } = require("../models/WhatsAppMessage")
const { Activity } = require("../models/Activity")
const Lead = require("../models/Lead")
const Account = require("../models/Account")
const SystemConfig = require("../models/SystemConfig")
const { encrypt, decrypt, maskSecret } = require("../utils/cryptoUtils")
const { normalizePhoneE164 } = require("../utils/phoneNormalizer")
const { runWithTenantContext } = require("../middleware/tenantContext")

/**
 * WhatsApp Cloud API Service - Super-Admin-Controlled Multi-Tenant Integration
 * 
 * Provides:
 * 1. Global Meta App configuration management (Verify Token, encrypted App Secret, Graph Version)
 * 2. Timing-safe Webhook Handshake & X-Hub-Signature-256 validation
 * 3. Central Webhook router: maps Meta incoming messages to active tenants via phone_number_id
 * 4. Zero cross-tenant leakage: Drops unmapped numbers silently and isolates queries with runWithTenantContext
 * 5. Outbound Graph API messaging with 24h customer window detection
 * 6. Activity logging & timeline integration
 */

const CONFIG_KEY = "whatsapp_global_config"
const DEFAULT_GRAPH_VERSION = "v21.0"
const DEFAULT_VERIFY_TOKEN = "leadflow_whatsapp_verify_token_2026"
const GRAPH_BASE_URL = "https://graph.facebook.com"

/**
 * Retrieves the global Meta App WhatsApp configuration from SystemConfig with .env fallbacks.
 * Decrypts App Secret safely without ever exposing raw secrets in plain logs.
 */
async function getGlobalConfig() {
  try {
    const configDoc = await SystemConfig.findOne({ key: CONFIG_KEY })
    const configVal = configDoc?.value || {}

    let decryptedAppSecret = ""
    if (configVal.encryptedAppSecret) {
      try {
        decryptedAppSecret = decrypt(configVal.encryptedAppSecret)
      } catch (err) {
        console.error("Failed to decrypt stored WA_APP_SECRET:", err.message)
      }
    }

    const verifyToken =
      configVal.verifyToken ||
      process.env.WA_VERIFY_TOKEN ||
      process.env.META_VERIFY_TOKEN ||
      DEFAULT_VERIFY_TOKEN

    const appSecret =
      decryptedAppSecret ||
      process.env.WA_APP_SECRET ||
      process.env.META_APP_SECRET ||
      ""

    const graphApiVersion =
      configVal.graphApiVersion ||
      process.env.WA_GRAPH_VERSION ||
      DEFAULT_GRAPH_VERSION

    return {
      verifyToken,
      appSecret,
      graphApiVersion,
      hasAppSecret: Boolean(appSecret && appSecret.length > 0),
      appSecretMasked: appSecret ? maskSecret(appSecret) : "",
      updatedAt: configDoc?.updatedAt || null,
    }
  } catch (error) {
    console.error("Error reading global WhatsApp config:", error.message)
    return {
      verifyToken: process.env.WA_VERIFY_TOKEN || DEFAULT_VERIFY_TOKEN,
      appSecret: process.env.WA_APP_SECRET || "",
      graphApiVersion: DEFAULT_GRAPH_VERSION,
      hasAppSecret: Boolean(process.env.WA_APP_SECRET),
      appSecretMasked: process.env.WA_APP_SECRET ? maskSecret(process.env.WA_APP_SECRET) : "",
      updatedAt: null,
    }
  }
}

/**
 * Updates global Meta App settings in SystemConfig.
 * Encrypts WA_APP_SECRET via AES-256-GCM.
 */
async function updateGlobalConfig({ verifyToken, appSecret, graphApiVersion }) {
  const current = await getGlobalConfig()

  const payload = {
    verifyToken: verifyToken ? verifyToken.trim() : current.verifyToken,
    graphApiVersion: graphApiVersion ? graphApiVersion.trim() : current.graphApiVersion,
  }

  // Only update secret if explicitly supplied and non-empty
  if (appSecret && typeof appSecret === "string" && appSecret.trim().length > 0) {
    payload.encryptedAppSecret = encrypt(appSecret.trim())
  } else {
    // Preserve existing encrypted secret if not changing
    const existingDoc = await SystemConfig.findOne({ key: CONFIG_KEY })
    if (existingDoc?.value?.encryptedAppSecret) {
      payload.encryptedAppSecret = existingDoc.value.encryptedAppSecret
    }
  }

  await SystemConfig.findOneAndUpdate(
    { key: CONFIG_KEY },
    { $set: { key: CONFIG_KEY, value: payload } },
    { upsert: true, new: true, runValidators: true }
  )

  return getGlobalConfig()
}

/**
 * Verifies incoming Meta Webhook handshake (GET)
 */
async function verifyWebhookHandshake(query = {}) {
  const mode = query["hub.mode"]
  const token = query["hub.verify_token"]
  const challenge = query["hub.challenge"]

  const config = await getGlobalConfig()
  const expectedToken = config.verifyToken

  if (mode === "subscribe" && token && expectedToken && token.trim() === expectedToken.trim()) {
    return {
      isValid: true,
      challenge: challenge || "",
    }
  }

  return {
    isValid: false,
    challenge: null,
  }
}

/**
 * Validates Meta's X-Hub-Signature-256 header using timingSafeEqual
 */
function verifyWebhookSignature(rawBody, signatureHeader, appSecret) {
  if (!appSecret) {
    // If no app secret is configured anywhere, allow webhook in test/sandbox environments
    return true
  }

  if (!signatureHeader || !rawBody) {
    return false
  }

  const cleanHeader = String(signatureHeader).trim()
  if (!cleanHeader.startsWith("sha256=")) {
    return false
  }

  const incomingHash = cleanHeader.slice(7).trim()
  if (incomingHash.length !== 64) {
    return false
  }

  try {
    const rawBuffer = Buffer.isBuffer(rawBody)
      ? rawBody
      : Buffer.from(typeof rawBody === "string" ? rawBody : JSON.stringify(rawBody), "utf8")

    const expectedHash = crypto
      .createHmac("sha256", appSecret.trim())
      .update(rawBuffer)
      .digest("hex")

    const incomingBuf = Buffer.from(incomingHash, "hex")
    const expectedBuf = Buffer.from(expectedHash, "hex")

    if (incomingBuf.length !== expectedBuf.length) {
      return false
    }

    return crypto.timingSafeEqual(incomingBuf, expectedBuf)
  } catch (err) {
    console.error("Signature verification error:", err.message)
    return false
  }
}

/**
 * Looks up the active tenant owning an exact WhatsApp phoneNumberId.
 * ALWAYS bypasses tenant filter because webhook caller has no prior tenant context.
 */
async function findActiveTenantByPhoneNumberId(phoneNumberId) {
  if (!phoneNumberId) return null
  const cleanId = String(phoneNumberId).trim()

  const integration = await Integration.findOne({
    type: "whatsapp",
    phoneNumberId: cleanId,
    status: "active",
  }).setOptions({ skipTenantFilter: true })

  return integration
}

/**
 * Ingests incoming WhatsApp Cloud API webhook notifications.
 * Evaluates phone_number_id, drops unmapped numbers silently, and partitions data
 * under the owning tenant via runWithTenantContext.
 */
async function processWebhookPayload(body = {}) {
  const results = {
    processed: false,
    messagesCount: 0,
    statusesCount: 0,
    tenantsAffected: [],
    droppedUnmapped: 0,
  }

  if (!body || body.object !== "whatsapp_business_account" || !Array.isArray(body.entry)) {
    return results
  }

  for (const entry of body.entry) {
    const changes = entry.changes || []
    for (const change of changes) {
      if (change.field !== "messages") continue

      const val = change.value || {}
      const phoneNumberId = val.metadata?.phone_number_id
      if (!phoneNumberId) continue

      // Look up owning tenant
      const integration = await findActiveTenantByPhoneNumberId(phoneNumberId)

      // Silent drop if not found or inactive — NEVER route to default or Super Admin tenant
      if (!integration) {
        results.droppedUnmapped += 1
        continue
      }

      const tenantId = integration.tenantId
      if (!results.tenantsAffected.includes(tenantId)) {
        results.tenantsAffected.push(tenantId)
      }

      // Execute within target tenant isolation boundary
      await runWithTenantContext({ tenantId, isSuperAdmin: false }, async () => {
        // 1. Process Incoming Messages
        const incomingMessages = Array.isArray(val.messages) ? val.messages : []
        const contacts = Array.isArray(val.contacts) ? val.contacts : []

        for (const msg of incomingMessages) {
          if (!msg || !msg.id) continue

          // Idempotency check via externalMessageId
          const existing = await WhatsAppMessage.findOne({
            tenantId,
            externalMessageId: msg.id,
          }).setOptions({ skipTenantFilter: true })

          if (existing) {
            // Already processed this message id
            continue
          }

          const rawSender = String(msg.from || "").trim()
          const normalizedSender = normalizePhoneE164(rawSender)

          // Find or create Lead for this tenant
          let lead = null
          if (normalizedSender) {
            lead = await Lead.findOne({
              tenantId,
              $or: [
                { phoneNormalized: normalizedSender },
                { phone: normalizedSender },
                { phone: rawSender },
              ],
            }).setOptions({ skipTenantFilter: true })
          }

          if (!lead) {
            // Locate contact profile name if provided by Meta
            const contactObj = contacts.find(
              (c) => c.wa_id === rawSender || c.wa_id === normalizedSender?.replace(/^\+/, "")
            )
            const profileName = contactObj?.profile?.name?.trim() || "WhatsApp Lead"

            lead = new Lead({
              name: profileName,
              phone: normalizedSender || rawSender,
              phoneNormalized: normalizedSender || "",
              tenantId,
              source: "WhatsApp Cloud API",
              status: "New",
            })
            await lead.save({ skipTenantFilter: true })
          } else {
            lead.lastContactedAt = new Date()
            await lead.save({ skipTenantFilter: true })
          }

          // Extract body and message type
          let messageType = "text"
          let messageBody = ""

          if (msg.type === "text") {
            messageType = "text"
            messageBody = msg.text?.body || ""
          } else if (msg.type === "image") {
            messageType = "image"
            messageBody = msg.image?.caption || "[Image]"
          } else if (msg.type === "document") {
            messageType = "document"
            messageBody = msg.document?.filename || msg.document?.caption || "[Document]"
          } else if (msg.type === "audio") {
            messageType = "audio"
            messageBody = "[Voice Note / Audio]"
          } else if (msg.type === "video") {
            messageType = "video"
            messageBody = msg.video?.caption || "[Video]"
          } else if (msg.type === "interactive") {
            messageType = "interactive"
            messageBody =
              msg.interactive?.button_reply?.title ||
              msg.interactive?.list_reply?.title ||
              "[Interactive Selection]"
          } else if (msg.type === "template") {
            messageType = "template"
            messageBody = "[Template Message]"
          } else {
            messageType = "other"
            messageBody = `[${msg.type || "Message"}]`
          }

          const msgTimestamp = msg.timestamp
            ? new Date(Number(msg.timestamp) * 1000)
            : new Date()

          // Save WhatsAppMessage
          const savedMsg = new WhatsAppMessage({
            tenantId,
            leadId: lead._id,
            phoneNumberId,
            wabaId: integration.wabaId || "",
            externalMessageId: msg.id,
            direction: "inbound",
            senderPhone: normalizedSender || rawSender,
            recipientPhone: integration.displayPhoneNumber || phoneNumberId,
            messageType,
            body: messageBody,
            status: "received",
            timestamp: msgTimestamp,
            rawPayload: msg,
          })
          await savedMsg.save({ skipTenantFilter: true })

          // Append to Lead Activity Timeline
          const timelineActivity = new Activity({
            tenantId,
            leadId: lead._id,
            type: "whatsapp.message_received",
            actor: {
              name: lead.name || "WhatsApp Contact",
              role: "lead",
            },
            payload: {
              messageId: msg.id,
              text: messageBody,
              direction: "inbound",
              senderPhone: normalizedSender || rawSender,
              messageType,
            },
          })
          await timelineActivity.save({ skipTenantFilter: true })

          // Update integration intake stats
          integration.stats = integration.stats || {}
          integration.stats.totalReceived = (integration.stats.totalReceived || 0) + 1
          integration.stats.totalSuccess = (integration.stats.totalSuccess || 0) + 1
          integration.stats.lastReceivedAt = new Date()
          integration.stats.lastSuccessAt = new Date()
          await integration.save({ skipTenantFilter: true })

          results.messagesCount += 1
        }

        // 2. Process Delivery Statuses (sent, delivered, read, failed)
        const incomingStatuses = Array.isArray(val.statuses) ? val.statuses : []
        for (const st of incomingStatuses) {
          if (!st || !st.id || !st.status) continue

          const updated = await WhatsAppMessage.findOneAndUpdate(
            { tenantId, externalMessageId: st.id },
            { $set: { status: st.status } },
            { new: true }
          ).setOptions({ skipTenantFilter: true })

          if (updated) {
            results.statusesCount += 1
          }
        }
      })
    }
  }

  results.processed = true
  return results
}

/**
 * Sends an outbound WhatsApp text message to a lead using the tenant's credentials.
 */
async function sendOutboundMessage({ tenantId, leadId, text, userId, userName, userEmail }) {
  if (!tenantId) {
    throw new Error("Tenant ID is required to send WhatsApp message")
  }
  if (!leadId) {
    throw new Error("Lead ID is required to send WhatsApp message")
  }
  if (!text || typeof text !== "string" || !text.trim()) {
    throw new Error("Message text cannot be empty")
  }

  // 1. Locate tenant's active WhatsApp integration
  const integration = await Integration.findOne({
    tenantId,
    type: "whatsapp",
    status: "active",
  }).setOptions({ skipTenantFilter: true })

  if (!integration) {
    throw new Error(
      "WhatsApp Cloud API is not configured or active for your account. Please contact your Super Administrator."
    )
  }

  if (!integration.phoneNumberId) {
    throw new Error("Tenant WhatsApp integration is missing a valid Phone Number ID.")
  }

  // 2. Decrypt tenant's Access Token
  const creds = integration.getDecryptedCredentials()
  const accessToken = creds?.accessToken
  if (!accessToken) {
    throw new Error("Tenant WhatsApp Access Token is missing or corrupted. Please contact Super Admin.")
  }

  // 3. Find target lead
  const lead = await Lead.findOne({ _id: leadId, tenantId }).setOptions({ skipTenantFilter: true })
  if (!lead) {
    throw new Error("Lead not found in your tenant workspace.")
  }

  const rawPhone = lead.phoneNormalized || normalizePhoneE164(lead.phone) || lead.phone
  if (!rawPhone) {
    throw new Error("Lead does not have a valid phone number.")
  }

  // Meta Graph API expects digits only (E.164 without leading '+')
  const recipientDigits = rawPhone.replace(/\D/g, "")
  if (recipientDigits.length < 8) {
    throw new Error(`Invalid recipient phone digits: '${rawPhone}'`)
  }

  const globalConfig = await getGlobalConfig()
  const graphVersion = globalConfig.graphApiVersion || DEFAULT_GRAPH_VERSION

  const url = `${GRAPH_BASE_URL}/${graphVersion}/${integration.phoneNumberId}/messages`
  const requestBody = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: recipientDigits,
    type: "text",
    text: { body: text.trim() },
  }

  let metaResponse = null

  // Support Mocking in Test Mode
  if (process.env.NODE_ENV === "test" && process.env.MOCK_META_GRAPH === "true") {
    metaResponse = {
      messaging_product: "whatsapp",
      contacts: [{ input: recipientDigits, wa_id: recipientDigits }],
      messages: [{ id: `wamid.mock.${Date.now()}.${Math.floor(Math.random() * 10000)}` }],
    }
  } else {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      })

      const data = await response.json()

      if (!response.ok || data.error) {
        const err = data.error || {}
        let userFriendlyMsg = err.message || "Failed to deliver WhatsApp message"

        // Handle 24-hour service window expiration (code 131047 / Re-engagement)
        if (err.code === 131047 || String(err.message).toLowerCase().includes("24 hour")) {
          userFriendlyMsg =
            "WhatsApp 24-hour customer window has expired. You can only re-engage this customer using an approved message template."
        } else if (err.code === 190) {
          userFriendlyMsg =
            "Tenant WhatsApp Access Token has expired or was revoked. Please contact Super Admin to update credentials."
        }

        const customError = new Error(userFriendlyMsg)
        customError.metaError = err
        customError.statusCode = response.status || 400
        throw customError
      }

      metaResponse = data
    } catch (networkErr) {
      if (networkErr.metaError) throw networkErr
      throw new Error(`WhatsApp Graph API network failure: ${networkErr.message}`)
    }
  }

  const externalMessageId =
    metaResponse?.messages?.[0]?.id || `wamid.out.${Date.now()}`

  // 4. Record outbound message in WhatsAppMessage
  const outboundMessage = new WhatsAppMessage({
    tenantId,
    leadId: lead._id,
    phoneNumberId: integration.phoneNumberId,
    wabaId: integration.wabaId || "",
    externalMessageId,
    direction: "outbound",
    senderPhone: integration.displayPhoneNumber || integration.phoneNumberId,
    recipientPhone: rawPhone,
    messageType: "text",
    body: text.trim(),
    status: "sent",
    sentByUserId: userId || null,
    timestamp: new Date(),
    rawPayload: metaResponse,
  })
  await outboundMessage.save({ skipTenantFilter: true })

  // 5. Append outbound message to Lead Activity Timeline
  const activity = new Activity({
    tenantId,
    leadId: lead._id,
    type: "whatsapp.message_sent",
    actor: {
      id: userId || null,
      name: userName || "Staff",
      email: userEmail || "",
      role: "staff",
    },
    payload: {
      messageId: externalMessageId,
      text: text.trim(),
      direction: "outbound",
      recipientPhone: rawPhone,
    },
  })
  await activity.save({ skipTenantFilter: true })

  // 6. Update integration outbound stats
  integration.stats = integration.stats || {}
  integration.stats.totalSuccess = (integration.stats.totalSuccess || 0) + 1
  integration.stats.lastSuccessAt = new Date()
  await integration.save({ skipTenantFilter: true })

  return outboundMessage
}

/**
 * Fetches chronological WhatsApp chat messages for a lead strictly scoped to tenantId.
 */
async function getLeadMessages({ tenantId, leadId }) {
  if (!tenantId || !leadId) return []

  const messages = await WhatsAppMessage.find({
    tenantId,
    leadId,
  })
    .sort({ timestamp: 1 })
    .lean()

  return messages
}

/**
 * Super Admin: Get per-tenant WhatsApp connection status and masked credentials
 */
async function getTenantConfig(tenantId) {
  if (!tenantId) return null

  const integration = await Integration.findOne({
    tenantId,
    type: "whatsapp",
  }).setOptions({ skipTenantFilter: true })

  if (!integration) {
    return {
      configured: false,
      tenantId,
      status: "inactive",
    }
  }

  let creds = null
  try {
    creds = integration.getDecryptedCredentials()
  } catch (_) {}

  return {
    configured: true,
    id: integration._id,
    tenantId: integration.tenantId,
    name: integration.name,
    status: integration.status,
    phoneNumberId: integration.phoneNumberId || "",
    wabaId: integration.wabaId || "",
    displayPhoneNumber: integration.displayPhoneNumber || "",
    hasAccessToken: Boolean(creds?.accessToken),
    accessTokenMasked: creds?.accessToken ? maskSecret(creds.accessToken) : "",
    stats: integration.stats || {},
    updatedAt: integration.updatedAt,
  }
}

/**
 * Super Admin: Assign or update a tenant's WhatsApp Cloud API credentials
 */
async function saveTenantConfig(tenantId, payload = {}) {
  if (!tenantId) {
    throw new Error("Tenant ID is required")
  }

  const phoneNumberId = payload.phoneNumberId ? String(payload.phoneNumberId).trim() : ""
  if (!phoneNumberId) {
    throw new Error("Phone Number ID is required for WhatsApp integration")
  }

  const wabaId = payload.wabaId ? String(payload.wabaId).trim() : ""
  const displayPhoneNumber = payload.displayPhoneNumber ? String(payload.displayPhoneNumber).trim() : ""
  const status = payload.status === "inactive" ? "inactive" : "active"
  const accessToken = payload.accessToken ? String(payload.accessToken).trim() : ""

  // Ensure this phoneNumberId is not already assigned to another tenant
  const existingOther = await Integration.findOne({
    type: "whatsapp",
    phoneNumberId,
    tenantId: { $ne: tenantId },
    status: "active",
  }).setOptions({ skipTenantFilter: true })

  if (existingOther) {
    const conflictErr = new Error(
      `Phone Number ID '${phoneNumberId}' is already actively assigned to tenant '${existingOther.tenantId}'. Each WhatsApp phone number must belong to exactly one tenant.`
    )
    conflictErr.statusCode = 409
    throw conflictErr
  }

  let integration = await Integration.findOne({
    tenantId,
    type: "whatsapp",
  }).setOptions({ skipTenantFilter: true })

  if (!integration) {
    integration = new Integration({
      tenantId,
      type: "whatsapp",
      name: displayPhoneNumber ? `WhatsApp (${displayPhoneNumber})` : `WhatsApp (${phoneNumberId})`,
      status,
      phoneNumberId,
      wabaId,
      displayPhoneNumber,
    })
  } else {
    integration.name = displayPhoneNumber ? `WhatsApp (${displayPhoneNumber})` : `WhatsApp (${phoneNumberId})`
    integration.status = status
    integration.phoneNumberId = phoneNumberId
    integration.wabaId = wabaId
    integration.displayPhoneNumber = displayPhoneNumber
  }

  if (accessToken) {
    integration.setCredentials({
      accessToken,
      phoneNumberId,
      wabaId,
    })
  }

  await integration.save({ skipTenantFilter: true })

  return getTenantConfig(tenantId)
}

/**
 * Super Admin: Unlink / delete a tenant's WhatsApp Cloud API credentials
 */
async function deleteTenantConfig(tenantId) {
  if (!tenantId) throw new Error("Tenant ID is required")

  const deleted = await Integration.findOneAndDelete({
    tenantId,
    type: "whatsapp",
  }).setOptions({ skipTenantFilter: true })

  return Boolean(deleted)
}

/**
 * Super Admin: List all tenants with their WhatsApp connection status & stats
 */
async function listAllTenantConfigs() {
  const accounts = await Account.find({}).lean()
  const whatsappIntegrations = await Integration.find({
    type: "whatsapp",
  })
    .setOptions({ skipTenantFilter: true })
    .lean()

  const integrationMap = new Map()
  for (const it of whatsappIntegrations) {
    integrationMap.set(it.tenantId, it)
  }

  return accounts.map((acc) => {
    const integration = integrationMap.get(acc.accountId)
    return {
      tenantId: acc.accountId,
      companyName: acc.companyName,
      status: acc.status,
      whatsappConfigured: Boolean(integration),
      whatsappStatus: integration ? integration.status : "unconfigured",
      phoneNumberId: integration?.phoneNumberId || "",
      wabaId: integration?.wabaId || "",
      displayPhoneNumber: integration?.displayPhoneNumber || "",
      totalReceived: integration?.stats?.totalReceived || 0,
      totalSuccess: integration?.stats?.totalSuccess || 0,
      lastReceivedAt: integration?.stats?.lastReceivedAt || null,
      lastSuccessAt: integration?.stats?.lastSuccessAt || null,
    }
  })
}

module.exports = {
  getGlobalConfig,
  updateGlobalConfig,
  verifyWebhookHandshake,
  verifyWebhookSignature,
  findActiveTenantByPhoneNumberId,
  processWebhookPayload,
  sendOutboundMessage,
  getLeadMessages,
  getTenantConfig,
  saveTenantConfig,
  deleteTenantConfig,
  listAllTenantConfigs,
}
