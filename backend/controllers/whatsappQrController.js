const whatsappQrService = require("../services/whatsappQrService")
const { getEffectiveTenant } = require("../middleware/tenantContext")
const audit = require("../services/auditService")

/**
 * Controller for Multi-Tenant WhatsApp Web QR Sync
 */

/**
 * GET /api/integrations/whatsapp-qr/status
 * Retrieves current WhatsApp Web QR sync connection state for tenant
 */
const getQrStatus = async (req, res) => {
  try {
    const { tenantId } = getEffectiveTenant(req)
    if (!tenantId) {
      return res.status(400).json({
        success: false,
        error: "Missing required tenant context",
      })
    }

    const statusData = await whatsappQrService.getSessionStatus(tenantId)
    return res.status(200).json({
      success: true,
      data: statusData,
    })
  } catch (error) {
    console.error("[WhatsAppQR] Error in getQrStatus:", error)
    return res.status(500).json({
      success: false,
      error: error.message || "Failed to retrieve WhatsApp QR status",
    })
  }
}

/**
 * POST /api/integrations/whatsapp-qr/connect
 * Initiates Baileys socket connection and generates QR code for tenant
 */
const connectQrSession = async (req, res) => {
  try {
    const { tenantId } = getEffectiveTenant(req)
    if (!tenantId) {
      return res.status(400).json({
        success: false,
        error: "Missing required tenant context",
      })
    }

    const sessionData = await whatsappQrService.startSession(tenantId)

    // Audit log
    try {
      await audit.log({
        tenantId,
        actor: req.user,
        action: "whatsapp.qr_connect_initiated",
        entity: "integration",
        entityId: tenantId,
        summary: `WhatsApp QR session initiated for tenant ${tenantId}`,
        req,
      })
    } catch (_) {}

    return res.status(200).json({
      success: true,
      data: sessionData,
      message: "WhatsApp QR session initiated. Please scan the QR code from WhatsApp on your phone.",
    })
  } catch (error) {
    console.error("[WhatsAppQR] Error in connectQrSession:", error)
    return res.status(500).json({
      success: false,
      error: error.message || "Failed to initiate WhatsApp QR session",
    })
  }
}

/**
 * POST /api/integrations/whatsapp-qr/disconnect
 * Cleanly logs out and disconnects WhatsApp Web session for tenant
 */
const disconnectQrSession = async (req, res) => {
  try {
    const { tenantId } = getEffectiveTenant(req)
    if (!tenantId) {
      return res.status(400).json({
        success: false,
        error: "Missing required tenant context",
      })
    }

    const result = await whatsappQrService.disconnectSession(tenantId)

    // Audit log
    try {
      await audit.log({
        tenantId,
        actor: req.user,
        action: "whatsapp.qr_disconnected",
        entity: "integration",
        entityId: tenantId,
        summary: `WhatsApp QR session disconnected for tenant ${tenantId}`,
        req,
      })
    } catch (_) {}

    return res.status(200).json({
      success: true,
      data: result.data || null,
      message: "WhatsApp session disconnected successfully.",
    })
  } catch (error) {
    console.error("[WhatsAppQR] Error in disconnectQrSession:", error)
    return res.status(500).json({
      success: false,
      error: error.message || "Failed to disconnect WhatsApp session",
    })
  }
}

/**
 * POST /api/integrations/whatsapp-qr/sync-contacts
 * Syncs mobile device contacts for a tenant.
 * Accepts: { phones: string[] } or { contacts: [{ phone, name }] }
 * Normalizes each phone number and upserts into TenantPhoneContact for this tenantId.
 */
const syncContacts = async (req, res) => {
  try {
    const { tenantId: effectiveTenantId } = getEffectiveTenant(req)
    const tenantId = effectiveTenantId || req.tenantId || req.body?.tenantId
    if (!tenantId) {
      return res.status(400).json({
        success: false,
        error: "Missing required tenant context",
      })
    }

    const { phones, contacts, replaceAll = false } = req.body || {}
    const rawList = Array.isArray(contacts)
      ? contacts
      : Array.isArray(phones)
      ? phones.map((p) => (typeof p === "string" ? { phone: p } : p))
      : []

    if (!Array.isArray(rawList) || rawList.length === 0) {
      return res.status(400).json({
        success: false,
        error: "An array of phones or contacts is required",
      })
    }

    const TenantPhoneContact = require("../models/TenantPhoneContact")
    const { normalizePhoneE164 } = require("../utils/phoneNormalizer")

    if (replaceAll) {
      await TenantPhoneContact.deleteMany({ tenantId }).setOptions({ skipTenantFilter: true })
    }

    const bulkOps = []
    let validCount = 0

    for (const item of rawList) {
      const rawPhone = typeof item === "string" ? item : item.phone || item.number || ""
      const name = typeof item === "object" && item.name ? String(item.name).trim() : ""
      if (!rawPhone || typeof rawPhone !== "string") continue

      const normalizedPhone = normalizePhoneE164(rawPhone) || rawPhone.trim()
      if (!normalizedPhone) continue

      bulkOps.push({
        updateOne: {
          filter: { tenantId, normalizedPhone },
          update: {
            $set: {
              tenantId,
              name: name || undefined,
              phone: rawPhone.trim(),
              normalizedPhone,
              updatedAt: new Date(),
            },
          },
          upsert: true,
        },
      })
      validCount++
    }

    if (bulkOps.length > 0) {
      await TenantPhoneContact.bulkWrite(bulkOps)
    }

    return res.status(200).json({
      success: true,
      data: {
        syncedCount: validCount,
        tenantId,
      },
      message: `Successfully synced ${validCount} contact(s) for tenant`,
    })
  } catch (error) {
    console.error("[WhatsAppQR] Error in syncContacts:", error)
    return res.status(500).json({
      success: false,
      error: error.message || "Failed to sync tenant phone contacts",
    })
  }
}

module.exports = {
  getQrStatus,
  connectQrSession,
  disconnectQrSession,
  syncContacts,
}
