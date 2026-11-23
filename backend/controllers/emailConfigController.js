const TenantEmailConfig = require("../models/TenantEmailConfig")
const { encrypt, decrypt } = require("../utils/cryptoUtils")
const { getEffectiveTenant } = require("../middleware/tenantContext")
const { sendEmail } = require("../services/emailProvider.service")

/**
 * Get tenant email configuration (password masked).
 */
async function getEmailConfigHandler(req, res) {
  try {
    const { tenantId, isSuperAdmin } = getEffectiveTenant(req)

    if (!tenantId && !isSuperAdmin) {
      return res.status(401).json({ success: false, error: "Authentication required" })
    }

    let config = await TenantEmailConfig.findOne({ tenantId })
      .setOptions({ skipTenantFilter: true })

    if (!config) {
      config = new TenantEmailConfig({ tenantId })
    }

    return res.status(200).json({
      success: true,
      data: { config: config.toJSON() },
    })
  } catch (err) {
    console.error("Error in getEmailConfigHandler:", err)
    return res.status(500).json({ success: false, error: err.message })
  }
}

/**
 * Update tenant email configuration with AES-256-GCM encrypted SMTP credentials.
 */
async function updateEmailConfigHandler(req, res) {
  try {
    const { tenantId, isSuperAdmin } = getEffectiveTenant(req)

    if (!tenantId && !isSuperAdmin) {
      return res.status(401).json({ success: false, error: "Authentication required" })
    }

    const {
      senderName,
      senderEmail,
      replyToEmail,
      smtpHost,
      smtpPort,
      smtpSecure,
      smtpUser,
      smtpPassword,
      isActive,
      templates,
    } = req.body

    let config = await TenantEmailConfig.findOne({ tenantId })
      .setOptions({ skipTenantFilter: true })

    if (!config) {
      config = new TenantEmailConfig({ tenantId })
    }

    if (senderName !== undefined) config.senderName = senderName.trim()
    if (senderEmail !== undefined) config.senderEmail = senderEmail.trim().toLowerCase()
    if (replyToEmail !== undefined) config.replyToEmail = replyToEmail.trim().toLowerCase()
    if (smtpHost !== undefined) config.smtpHost = smtpHost.trim()
    if (smtpPort !== undefined) config.smtpPort = Number(smtpPort) || 587
    if (smtpSecure !== undefined) config.smtpSecure = Boolean(smtpSecure)
    if (smtpUser !== undefined) config.smtpUser = smtpUser.trim()

    // Encrypt password if new password provided
    if (smtpPassword && typeof smtpPassword === "string" && smtpPassword.trim()) {
      const encrypted = encrypt(smtpPassword.trim())
      config.smtpPasswordEncrypted = encrypted.serialized
    }

    if (isActive !== undefined) config.isActive = Boolean(isActive)

    if (templates && typeof templates === "object") {
      config.templates = {
        ...config.templates,
        ...templates,
      }
    }

    await config.save()

    return res.status(200).json({
      success: true,
      data: { config: config.toJSON() },
      message: "Email configuration saved successfully",
    })
  } catch (err) {
    console.error("Error in updateEmailConfigHandler:", err)
    return res.status(500).json({ success: false, error: err.message })
  }
}

/**
 * Test SMTP connection and dispatch verification test email.
 */
async function testEmailConnectionHandler(req, res) {
  try {
    const { tenantId, isSuperAdmin } = getEffectiveTenant(req)
    const { testRecipient } = req.body

    if (!tenantId && !isSuperAdmin) {
      return res.status(401).json({ success: false, error: "Authentication required" })
    }

    const recipient = (testRecipient || req.user?.email || "").trim()
    if (!recipient || !recipient.includes("@")) {
      return res.status(400).json({ success: false, error: "Valid test recipient email is required" })
    }

    const result = await sendEmail({
      tenantId,
      to: recipient,
      subject: `[Leads365] SMTP Configuration Test for Tenant ${tenantId}`,
      body: `Hello,\n\nThis is a verification test email dispatched from your Leads365 CRM email configuration.\n\nTimestamp: ${new Date().toISOString()}\nTenant: ${tenantId}\n\nYour email integration is functioning properly!`,
    })

    return res.status(200).json({
      success: true,
      data: result,
      message: `Test email sent successfully to ${recipient}`,
    })
  } catch (err) {
    console.error("Error in testEmailConnectionHandler:", err)
    return res.status(500).json({
      success: false,
      error: err.message || "Failed to send test email",
    })
  }
}

module.exports = {
  getEmailConfigHandler,
  updateEmailConfigHandler,
  testEmailConnectionHandler,
}
