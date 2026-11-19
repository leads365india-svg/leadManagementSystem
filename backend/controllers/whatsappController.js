const whatsappService = require("../services/whatsappService")

/**
 * Tenant WhatsApp Messaging Controller
 * 
 * Provides endpoints for CRM users to view lead conversation history
 * and send outbound replies via WhatsApp Cloud API.
 * All operations are strictly scoped by req.tenantId.
 */

/**
 * GET /api/leads/:id/whatsapp-messages
 * Retrieves chronological WhatsApp chat history for a specific lead
 */
const getLeadWhatsAppMessages = async (req, res) => {
  try {
    const tenantId = req.tenantId || req.user?.tenantId
    const leadId = req.params.id

    if (!tenantId) {
      return res.status(401).json({
        success: false,
        error: "Tenant context is required",
      })
    }

    const messages = await whatsappService.getLeadMessages({
      tenantId,
      leadId,
    })

    return res.status(200).json({
      success: true,
      data: messages,
    })
  } catch (error) {
    console.error("getLeadWhatsAppMessages error:", error)
    return res.status(500).json({
      success: false,
      error: error.message || "Failed to load WhatsApp messages",
    })
  }
}

/**
 * POST /api/leads/:id/whatsapp-messages
 * Sends an outbound WhatsApp text message to the lead
 */
const sendLeadWhatsAppMessage = async (req, res) => {
  try {
    const tenantId = req.tenantId || req.user?.tenantId
    const leadId = req.params.id
    const { message, text, body } = req.body || {}
    const messageContent = message || text || body

    if (!tenantId) {
      return res.status(401).json({
        success: false,
        error: "Tenant context is required",
      })
    }

    if (!messageContent || typeof messageContent !== "string" || !messageContent.trim()) {
      return res.status(400).json({
        success: false,
        error: "Message text is required",
      })
    }

    const outbound = await whatsappService.sendOutboundMessage({
      tenantId,
      leadId,
      text: messageContent.trim(),
      userId: req.user?._id || req.user?.id,
      userName: req.user?.name || "Staff",
      userEmail: req.user?.email || "",
    })

    return res.status(200).json({
      success: true,
      message: "WhatsApp message sent successfully",
      data: outbound,
    })
  } catch (error) {
    console.error("sendLeadWhatsAppMessage error:", error)
    const statusCode = error.statusCode || 400
    return res.status(statusCode).json({
      success: false,
      error: error.message || "Failed to send WhatsApp message",
      metaError: error.metaError || null,
    })
  }
}

module.exports = {
  getLeadWhatsAppMessages,
  sendLeadWhatsAppMessage,
}
