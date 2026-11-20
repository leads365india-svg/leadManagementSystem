const qrcode = require("qrcode")
const WhatsAppQrSession = require("../models/WhatsAppQrSession")
const WhatsAppQrAuth = require("../models/WhatsAppQrAuth")
const { WhatsAppMessage } = require("../models/WhatsAppMessage")
const Lead = require("../models/Lead")
const TenantPhoneContact = require("../models/TenantPhoneContact")
const WhatsAppSuppressedNumber = require("../models/WhatsAppSuppressedNumber")
const { normalizePhoneE164 } = require("../utils/phoneNormalizer")
const { activity } = require("./activityService")

/**
 * Multi-Tenant WhatsApp QR Sync Service (using @whiskeysockets/baileys)
 * 
 * Enables tenants to scan a QR code from WhatsApp / WhatsApp Business App on their phone
 * to mirror both incoming customer messages and phone-sent outbound messages in CRM Leads.
 * 
 * Features:
 * - Multi-tenant in-memory socket registry (Map<tenantId, ...>)
 * - MongoDB-backed Baileys auth state adapter (survives container redeploys & restarts)
 * - Auto-reconnection on transient network disconnects
 * - Auto-clean on DisconnectReason.loggedOut
 * - Automatic Lead matching/creation and chronological message mirroring
 */

// In-memory active sockets registry: Map<tenantId, { sock, qrDataUrl, reconnectTimer, isConnecting, intentionalDisconnect }>
const activeSessions = new Map()

// Silent logger for Baileys to keep console clean
const silentLogger = {
  level: "silent",
  trace: () => {},
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  fatal: () => {},
  child: () => silentLogger,
}

/**
 * MongoDB-backed Baileys Auth State Adapter
 */
async function useMongoAuthState(tenantId) {
  const baileys = await import("@whiskeysockets/baileys")
  const { initAuthCreds, BufferJSON, proto } = baileys

  let creds
  const credsDoc = await WhatsAppQrAuth.findOne({ tenantId, keyId: "creds" })
    .setOptions({ skipTenantFilter: true })
    .lean()

  if (credsDoc && credsDoc.data) {
    try {
      creds = JSON.parse(credsDoc.data, BufferJSON.reviver)
    } catch (e) {
      console.warn(`[WhatsAppQR] Failed to parse stored creds for tenant ${tenantId}, re-initializing:`, e.message)
      creds = initAuthCreds()
    }
  } else {
    creds = initAuthCreds()
  }

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data = {}
          await Promise.all(
            ids.map(async (id) => {
              const keyId = `${type}:${id}`
              const doc = await WhatsAppQrAuth.findOne({ tenantId, keyId })
                .setOptions({ skipTenantFilter: true })
                .lean()

              if (doc && doc.data) {
                try {
                  let value = JSON.parse(doc.data, BufferJSON.reviver)
                  if (type === "app-state-sync-key" && value && proto) {
                    value = proto.Message.AppStateSyncKeyData.fromObject(value)
                  }
                  data[id] = value
                } catch (parseErr) {
                  console.warn(`[WhatsAppQR] Key parse error for ${keyId}:`, parseErr.message)
                }
              }
            })
          )
          return data
        },
        set: async (data) => {
          const tasks = []
          for (const category in data) {
            for (const id in data[category]) {
              const value = data[category][id]
              const keyId = `${category}:${id}`
              if (value) {
                tasks.push(
                  WhatsAppQrAuth.findOneAndUpdate(
                    { tenantId, keyId },
                    { tenantId, keyId, data: JSON.stringify(value, BufferJSON.replacer) },
                    { upsert: true, new: true }
                  ).setOptions({ skipTenantFilter: true })
                )
              } else {
                tasks.push(
                  WhatsAppQrAuth.deleteOne({ tenantId, keyId }).setOptions({ skipTenantFilter: true })
                )
              }
            }
          }
          await Promise.all(tasks)
        },
      },
    },
    saveCreds: async () => {
      await WhatsAppQrAuth.findOneAndUpdate(
        { tenantId, keyId: "creds" },
        { tenantId, keyId: "creds", data: JSON.stringify(creds, BufferJSON.replacer) },
        { upsert: true, new: true }
      ).setOptions({ skipTenantFilter: true })
    },
  }
}

/**
 * Extracts plain-text representation from Baileys message content
 */
function extractMessageContent(msg) {
  if (!msg || !msg.message) return { body: "", type: "other" }

  const m = msg.message

  if (m.conversation) {
    return { body: m.conversation, type: "text" }
  }
  if (m.extendedTextMessage?.text) {
    return { body: m.extendedTextMessage.text, type: "text" }
  }
  if (m.imageMessage) {
    return { body: m.imageMessage.caption || "[Image]", type: "image" }
  }
  if (m.videoMessage) {
    return { body: m.videoMessage.caption || "[Video]", type: "video" }
  }
  if (m.documentMessage) {
    return {
      body: m.documentMessage.fileName || m.documentMessage.caption || "[Document]",
      type: "document",
    }
  }
  if (m.audioMessage) {
    return { body: "[Voice Note / Audio]", type: "audio" }
  }
  if (m.stickerMessage) {
    return { body: "[Sticker]", type: "other" }
  }
  if (m.contactMessage || m.contactsArrayMessage) {
    return { body: "[Contact Card]", type: "contacts" }
  }
  if (m.locationMessage || m.liveLocationMessage) {
    return { body: "[Location]", type: "location" }
  }
  if (m.buttonsResponseMessage?.selectedDisplayText) {
    return { body: m.buttonsResponseMessage.selectedDisplayText, type: "interactive" }
  }
  if (m.listResponseMessage?.title) {
    return { body: m.listResponseMessage.title, type: "interactive" }
  }
  if (m.templateButtonReplyMessage?.selectedDisplayText) {
    return { body: m.templateButtonReplyMessage.selectedDisplayText, type: "template" }
  }

  // Handle ephemeral, viewOnce, or forwarded wrappers
  if (m.ephemeralMessage?.message) {
    return extractMessageContent({ message: m.ephemeralMessage.message })
  }
  if (m.viewOnceMessage?.message) {
    return extractMessageContent({ message: m.viewOnceMessage.message })
  }
  if (m.viewOnceMessageV2?.message) {
    return extractMessageContent({ message: m.viewOnceMessageV2.message })
  }

  return { body: "[WhatsApp Message]", type: "other" }
}

/**
 * Resolves phone number digits from JID
 */
function extractPhoneFromJid(jid, altJid) {
  const targetJid = jid && !jid.endsWith("@lid") ? jid : (altJid || jid || "")
  const digits = targetJid.split("@")[0].split(":")[0].replace(/\D/g, "")
  if (!digits) return ""
  return normalizePhoneE164(`+${digits}`, "+91") || `+${digits}`
}

/**
 * Handles incoming and phone-sent messages (upsert event)
 */
async function handleMessagesUpsert(tenantId, messages, sessionDoc) {
  if (!Array.isArray(messages) || messages.length === 0) return

  for (const msg of messages) {
    try {
      if (!msg.key || !msg.message) continue

      const remoteJid = msg.key.remoteJid || ""

      // Filter out groups, broadcasts, newsletters, status updates, and protocol messages
      if (
        !remoteJid ||
        remoteJid.endsWith("@g.us") ||
        remoteJid === "status@broadcast" ||
        remoteJid.endsWith("@newsletter") ||
        msg.message.protocolMessage ||
        msg.message.reactionMessage ||
        msg.message.senderKeyDistributionMessage
      ) {
        continue
      }

      const externalMessageId = msg.key.id
      if (!externalMessageId) continue

      // Direction: fromMe === true means outbound from phone; false means inbound from customer
      const direction = msg.key.fromMe ? "outbound" : "inbound"
      const { body: messageBody, type: messageType } = extractMessageContent(msg)

      if (!messageBody || !messageBody.trim()) continue

      // Resolve peer phone number and generate search variants
      const peerPhone = extractPhoneFromJid(remoteJid, msg.key.remoteJidAlt)
      if (!peerPhone) continue

      const normalizedPeerPhone = normalizePhoneE164(peerPhone) || peerPhone.trim()
      const peerDigits = normalizedPeerPhone.replace(/\D/g, "")
      const last10Digits = peerDigits.length >= 10 ? peerDigits.slice(-10) : peerDigits
      const phoneVariants = Array.from(new Set([
        normalizedPeerPhone,
        `+91${last10Digits}`,
        last10Digits,
        peerDigits,
        peerPhone,
      ])).filter(Boolean)

      const connectedPhone = sessionDoc?.phoneNumber || ""
      const senderPhone = direction === "inbound" ? normalizedPeerPhone : connectedPhone
      const recipientPhone = direction === "inbound" ? connectedPhone : normalizedPeerPhone

      const timestamp = msg.messageTimestamp
        ? new Date(Number(msg.messageTimestamp) * 1000)
        : new Date()

      // 1. Check if an active Lead already exists in this tenant
      let lead = await Lead.findOne({
        tenantId,
        $or: [
          { phoneNormalized: { $in: phoneVariants } },
          { phone: { $in: phoneVariants } },
        ],
        deletedAt: null,
      }).setOptions({ skipTenantFilter: true })

      if (lead) {
        // IF Lead EXISTS: ALWAYS save message and link to that Lead (even if in TenantPhoneContact)
        lead.lastContactedAt = new Date()
        await lead.save({ skipTenantFilter: true })
      } else {
        // IF Lead DOES NOT exist:
        // 1. Check WhatsAppSuppressedNumber: if present -> IGNORE (do not auto-create Lead)
        const isSuppressed = await WhatsAppSuppressedNumber.findOne({
          tenantId,
          normalizedPhone: { $in: phoneVariants },
        }).setOptions({ skipTenantFilter: true }).lean()

        if (isSuppressed) {
          continue
        }

        // 2. Check TenantPhoneContact (synced from Android app): if present -> IGNORE (saved contact)
        const isPhoneContact = await TenantPhoneContact.findOne({
          tenantId,
          normalizedPhone: { $in: phoneVariants },
        }).setOptions({ skipTenantFilter: true }).lean()

        if (isPhoneContact) {
          continue
        }

        // 3. Otherwise (unknown unsaved number) -> Create new Lead (source: 'WhatsApp')
        const callerName = msg.pushName || `WhatsApp Lead (${last10Digits.slice(-4)})`
        lead = new Lead({
          name: callerName,
          phone: normalizedPeerPhone,
          phoneNormalized: normalizedPeerPhone,
          tenantId,
          source: "WhatsApp",
          status: "New",
        })
        await lead.save({ skipTenantFilter: true })

        // Re-link any historical messages unlinked from deleted leads
        try {
          await WhatsAppMessage.updateMany(
            {
              tenantId,
              leadId: null,
              normalizedPhone: { $in: phoneVariants },
            },
            {
              $set: {
                leadId: lead._id,
                normalizedPhone: normalizedPeerPhone,
              },
            }
          ).setOptions({ skipTenantFilter: true })
        } catch (_) {}
      }

      // Upsert into WhatsAppMessage with tenantId and externalMessageId idempotency
      const messageDoc = await WhatsAppMessage.findOneAndUpdate(
        { tenantId, externalMessageId },
        {
          $setOnInsert: {
            tenantId,
            leadId: lead ? lead._id : null,
            normalizedPhone: normalizedPeerPhone,
            phoneNumberId: connectedPhone || "qr-sync",
            externalMessageId,
            direction,
            senderPhone,
            recipientPhone,
            messageType,
            body: messageBody,
            status: direction === "outbound" ? "sent" : "received",
            timestamp,
            rawPayload: {
              key: msg.key,
              pushName: msg.pushName,
              messageTimestamp: msg.messageTimestamp,
            },
          },
        },
        { upsert: true, new: true }
      ).setOptions({ skipTenantFilter: true })

      // Record Activity Timeline event for lead if lead exists
      if (lead) {
        try {
          await activity.record({
            tenantId,
            leadId: lead._id,
            type: direction === "inbound" ? "whatsapp.message_received" : "whatsapp.message_sent",
            actor: {
              name: direction === "inbound" ? (msg.pushName || "WhatsApp Customer") : "WhatsApp Phone Sync",
              role: "system",
            },
            payload: {
              externalMessageId,
              direction,
              body: messageBody.length > 100 ? `${messageBody.slice(0, 97)}...` : messageBody,
              messageType,
              peerPhone: normalizedPeerPhone,
              timestamp,
              syncType: "baileys_qr",
            },
          })
        } catch (actErr) {
          // Non-blocking activity recording
        }
      }
    } catch (msgErr) {
      console.warn(`[WhatsAppQR] Error processing message for tenant ${tenantId}:`, msgErr.message)
    }
  }
}

/**
 * Starts or retrieves WhatsApp Baileys session for a tenant
 */
async function startSession(tenantId, options = {}) {
  const cleanTenantId = String(tenantId).trim()
  if (!cleanTenantId) throw new Error("A valid tenantId is required")

  // Return existing active connection if already connected
  const existing = activeSessions.get(cleanTenantId)
  if (existing?.sock && existing.status === "connected") {
    const sessionDoc = await WhatsAppQrSession.findOne({ tenantId: cleanTenantId })
      .setOptions({ skipTenantFilter: true })
      .lean()
    return sessionDoc || {
      tenantId: cleanTenantId,
      status: "connected",
      phoneNumber: existing.phoneNumber || "",
      pushName: existing.pushName || "",
      connectedAt: existing.connectedAt || new Date(),
    }
  }

  // Clear existing reconnect timer if any
  if (existing?.reconnectTimer) {
    clearTimeout(existing.reconnectTimer)
  }

  // Ensure WhatsAppQrSession document exists in connecting state
  let sessionDoc = await WhatsAppQrSession.findOneAndUpdate(
    { tenantId: cleanTenantId },
    {
      $set: {
        status: "connecting",
        lastError: null,
      },
    },
    { upsert: true, new: true }
  ).setOptions({ skipTenantFilter: true })

  // Dynamically import Baileys and initialize auth
  const baileys = await import("@whiskeysockets/baileys")
  const { makeWASocket, DisconnectReason } = baileys
  const createSocket = makeWASocket || baileys.default

  const { state, saveCreds } = await useMongoAuthState(cleanTenantId)

  const sock = createSocket({
    auth: state,
    printQRInTerminal: false,
    markOnlineOnConnect: false,
    syncFullHistory: false,
    logger: silentLogger,
  })

  // Store in memory
  const sessionEntry = {
    sock,
    status: "connecting",
    qrDataUrl: "",
    phoneNumber: sessionDoc.phoneNumber || "",
    pushName: sessionDoc.pushName || "",
    intentionalDisconnect: false,
    reconnectTimer: null,
  }
  activeSessions.set(cleanTenantId, sessionEntry)

  // Listen for credential updates and persist to MongoDB
  sock.ev.on("creds.update", saveCreds)

  // Connection update event (QR, open, close)
  sock.ev.on("connection.update", async (update) => {
    try {
      const { connection, lastDisconnect, qr } = update

      // 1. QR Code generated
      if (qr) {
        try {
          const qrDataUrl = await qrcode.toDataURL(qr, {
            margin: 2,
            width: 300,
            color: { dark: "#0f172a", light: "#ffffff" },
          })

          sessionEntry.status = "qr_ready"
          sessionEntry.qrDataUrl = qrDataUrl

          await WhatsAppQrSession.findOneAndUpdate(
            { tenantId: cleanTenantId },
            {
              $set: {
                status: "qr_ready",
                qrDataUrl,
                lastError: null,
              },
            }
          ).setOptions({ skipTenantFilter: true })

          console.log(`[WhatsAppQR] QR generated and ready for tenant: ${cleanTenantId}`)
        } catch (qrErr) {
          console.error(`[WhatsAppQR] QR conversion error for tenant ${cleanTenantId}:`, qrErr.message)
        }
      }

      // 2. Connected successfully
      if (connection === "open") {
        sessionEntry.status = "connected"
        sessionEntry.qrDataUrl = ""

        const rawJid = sock.user?.id || ""
        const rawDigits = rawJid.split("@")[0].split(":")[0].replace(/\D/g, "")
        const phoneNumber = rawDigits ? `+${rawDigits}` : ""
        const pushName = sock.user?.name || sock.user?.notify || ""

        sessionEntry.phoneNumber = phoneNumber
        sessionEntry.pushName = pushName
        sessionEntry.connectedAt = new Date()

        await WhatsAppQrSession.findOneAndUpdate(
          { tenantId: cleanTenantId },
          {
            $set: {
              status: "connected",
              qrDataUrl: "",
              phoneNumber,
              pushName,
              connectedAt: new Date(),
              lastError: null,
            },
          }
        ).setOptions({ skipTenantFilter: true })

        console.log(`✅ [WhatsAppQR] Connected successfully for tenant: ${cleanTenantId} (${phoneNumber} - ${pushName})`)
      }

      // 3. Connection closed
      if (connection === "close") {
        const error = lastDisconnect?.error
        const statusCode = error?.output?.statusCode || error?.statusCode

        console.warn(`[WhatsAppQR] Connection closed for tenant ${cleanTenantId}. Status code: ${statusCode}, reason:`, error?.message)

        if (sessionEntry.intentionalDisconnect || statusCode === DisconnectReason.loggedOut) {
          // Logged out from WhatsApp app on phone
          console.log(`[WhatsAppQR] Device logged out for tenant: ${cleanTenantId}`)
          sessionEntry.status = "disconnected"
          activeSessions.delete(cleanTenantId)

          // Delete stored auth credentials
          await WhatsAppQrAuth.deleteMany({ tenantId: cleanTenantId }).setOptions({ skipTenantFilter: true })

          await WhatsAppQrSession.findOneAndUpdate(
            { tenantId: cleanTenantId },
            {
              $set: {
                status: "disconnected",
                qrDataUrl: "",
                phoneNumber: "",
                pushName: "",
                connectedAt: null,
                lastError: "Device logged out from phone. Please scan QR to reconnect.",
              },
            }
          ).setOptions({ skipTenantFilter: true })
        } else {
          // Transient network disconnect or 515 restartRequired -> auto-reconnect
          sessionEntry.status = "connecting"
          await WhatsAppQrSession.findOneAndUpdate(
            { tenantId: cleanTenantId },
            {
              $set: {
                status: "connecting",
                lastError: error?.message || "Connection lost. Reconnecting...",
              },
            }
          ).setOptions({ skipTenantFilter: true })

          // Schedule reconnection with backoff
          if (!sessionEntry.intentionalDisconnect) {
            sessionEntry.reconnectTimer = setTimeout(() => {
              console.log(`[WhatsAppQR] Attempting automatic reconnection for tenant: ${cleanTenantId}`)
              startSession(cleanTenantId).catch((reErr) => {
                console.warn(`[WhatsAppQR] Auto-reconnect failed for tenant ${cleanTenantId}:`, reErr.message)
              })
            }, 3500)
          }
        }
      }
    } catch (updateErr) {
      console.error(`[WhatsAppQR] Error handling connection.update for tenant ${cleanTenantId}:`, updateErr)
    }
  })

  // Listen for messages.upsert
  sock.ev.on("messages.upsert", async (upsert) => {
    try {
      const currentSessionDoc = await WhatsAppQrSession.findOne({ tenantId: cleanTenantId })
        .setOptions({ skipTenantFilter: true })
        .lean()
      await handleMessagesUpsert(cleanTenantId, upsert.messages, currentSessionDoc)
    } catch (upsertErr) {
      console.error(`[WhatsAppQR] messages.upsert processing error for tenant ${cleanTenantId}:`, upsertErr)
    }
  })

  return WhatsAppQrSession.findOne({ tenantId: cleanTenantId })
    .setOptions({ skipTenantFilter: true })
    .lean()
}

/**
 * Disconnects and logs out a tenant's WhatsApp Web session cleanly
 */
async function disconnectSession(tenantId) {
  const cleanTenantId = String(tenantId).trim()
  if (!cleanTenantId) return { success: false, error: "tenantId required" }

  const entry = activeSessions.get(cleanTenantId)
  if (entry) {
    entry.intentionalDisconnect = true
    if (entry.reconnectTimer) clearTimeout(entry.reconnectTimer)
    try {
      if (entry.sock && typeof entry.sock.logout === "function") {
        await entry.sock.logout().catch(() => {})
      } else if (entry.sock && typeof entry.sock.end === "function") {
        entry.sock.end()
      }
    } catch (e) {
      // Ignore socket closing errors
    }
    activeSessions.delete(cleanTenantId)
  }

  // Delete all auth state from MongoDB
  await WhatsAppQrAuth.deleteMany({ tenantId: cleanTenantId }).setOptions({ skipTenantFilter: true })

  // Update session document
  const updatedSession = await WhatsAppQrSession.findOneAndUpdate(
    { tenantId: cleanTenantId },
    {
      $set: {
        status: "disconnected",
        qrDataUrl: "",
        phoneNumber: "",
        pushName: "",
        connectedAt: null,
        lastError: null,
      },
    },
    { upsert: true, new: true }
  ).setOptions({ skipTenantFilter: true }).lean()

  console.log(`[WhatsAppQR] Session cleanly disconnected for tenant: ${cleanTenantId}`)

  return {
    success: true,
    data: updatedSession,
  }
}

/**
 * Retrieves the connection status and QR code for a tenant
 */
async function getSessionStatus(tenantId) {
  const cleanTenantId = String(tenantId).trim()
  if (!cleanTenantId) return { status: "disconnected" }

  const sessionDoc = await WhatsAppQrSession.findOne({ tenantId: cleanTenantId })
    .setOptions({ skipTenantFilter: true })
    .lean()

  if (!sessionDoc) {
    return {
      tenantId: cleanTenantId,
      status: "disconnected",
      qrDataUrl: "",
      phoneNumber: "",
      pushName: "",
      connectedAt: null,
      lastError: null,
    }
  }

  return {
    tenantId: cleanTenantId,
    status: sessionDoc.status || "disconnected",
    qrDataUrl: sessionDoc.qrDataUrl || "",
    phoneNumber: sessionDoc.phoneNumber || "",
    pushName: sessionDoc.pushName || "",
    connectedAt: sessionDoc.connectedAt || null,
    lastError: sessionDoc.lastError || null,
  }
}

/**
 * Restores previously connected WhatsApp sessions on server startup
 */
async function restoreConnectedSessions() {
  try {
    const connectedSessions = await WhatsAppQrSession.find({ status: "connected" })
      .setOptions({ skipTenantFilter: true })
      .lean()

    if (!connectedSessions || connectedSessions.length === 0) {
      console.log("ℹ️ [WhatsAppQR] No active WhatsApp QR sessions to restore on startup.")
      return
    }

    console.log(`ℹ️ [WhatsAppQR] Restoring ${connectedSessions.length} active WhatsApp QR session(s)...`)

    for (const session of connectedSessions) {
      try {
        console.log(`ℹ️ [WhatsAppQR] Reconnecting session for tenant: ${session.tenantId} (${session.phoneNumber})`)
        await startSession(session.tenantId, { isAutoRestore: true })
      } catch (sessErr) {
        console.warn(`⚠️ [WhatsAppQR] Failed to restore session for tenant ${session.tenantId}:`, sessErr.message)
      }
    }
  } catch (err) {
    console.error("⚠️ [WhatsAppQR] Error restoring connected sessions:", err.message)
  }
}

module.exports = {
  startSession,
  disconnectSession,
  getSessionStatus,
  restoreConnectedSessions,
  handleMessagesUpsert,
  extractMessageContent,
  extractPhoneFromJid,
  useMongoAuthState,
  activeSessions,
}
