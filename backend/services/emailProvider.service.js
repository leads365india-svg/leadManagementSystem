const nodemailer = require("nodemailer")
const TenantEmailConfig = require("../models/TenantEmailConfig")
const { encrypt, decrypt } = require("../utils/cryptoUtils")

/**
 * Email Provider Service - Phase 3: Tenant Email Provider Integration
 * 
 * Manages tenant-specific SMTP dispatch with:
 * 1. AES-256-GCM credential decryption.
 * 2. Secure PDF attachment handling.
 * 3. Provider Message-ID capture.
 * 4. Failure handling and retry resilience.
 * 5. Simulation / fallback mode for test environments.
 */

/**
 * Resolves active email configuration for a tenant.
 */
async function getTenantEmailTransporter(tenantId) {
  if (!tenantId) {
    throw new Error("tenantId is required to resolve email configuration")
  }

  const cleanTenantId = String(tenantId).trim()
  const config = await TenantEmailConfig.findOne({ tenantId: cleanTenantId })
    .setOptions({ skipTenantFilter: true })
    .lean()

  // If tenant has an explicitly configured and active SMTP setup
  if (config && config.isActive && config.smtpHost && config.senderEmail) {
    if (!config.smtpHost.includes("leads365-test") && config.provider !== "simulated") {
      let decryptedPassword = ""
      if (config.smtpPasswordEncrypted) {
        try {
          decryptedPassword = decrypt(config.smtpPasswordEncrypted)
        } catch (decErr) {
          console.warn(`[EmailProvider] Could not decrypt SMTP password for tenant ${cleanTenantId}:`, decErr.message)
        }
      }

      const transporter = nodemailer.createTransport({
        host: config.smtpHost,
        port: config.smtpPort || 587,
        secure: Boolean(config.smtpSecure),
        auth: {
          user: config.smtpUser || config.senderEmail,
          pass: decryptedPassword,
        },
        tls: {
          rejectUnauthorized: process.env.NODE_ENV === "production",
        },
      })

      return {
        transporter,
        senderName: config.senderName || "Leads365 CRM",
        senderEmail: config.senderEmail,
        replyToEmail: config.replyToEmail || config.senderEmail,
        isConfigured: true,
        provider: "smtp",
        templates: config.templates || {},
      }
    } else {
      // Valid active test configuration for tenant
      return {
        transporter: null,
        senderName: config.senderName || "Leads365 CRM",
        senderEmail: config.senderEmail,
        replyToEmail: config.replyToEmail || config.senderEmail,
        isConfigured: true,
        provider: "simulated_smtp",
        templates: config.templates || {},
      }
    }
  }

  // Check if system-wide fallback SMTP is configured in environment
  const envHost = process.env.SMTP_HOST
  const envUser = process.env.SMTP_USER
  const envPass = process.env.SMTP_PASS
  const envFrom = process.env.SMTP_FROM || process.env.EMAIL_FROM

  if (envHost && envUser && envPass) {
    const transporter = nodemailer.createTransport({
      host: envHost,
      port: parseInt(process.env.SMTP_PORT || "587", 10),
      secure: process.env.SMTP_SECURE === "true",
      auth: {
        user: envUser,
        pass: envPass,
      },
    })

    return {
      transporter,
      senderName: process.env.SMTP_SENDER_NAME || "Leads365 System",
      senderEmail: envFrom || envUser,
      replyToEmail: envFrom || envUser,
      isConfigured: true,
      provider: "system_smtp",
      templates: {},
    }
  }

  // Fallback: Test / Mock email provider for development and testing environments
  return {
    transporter: null,
    senderName: config?.senderName || "Leads365 CRM",
    senderEmail: config?.senderEmail || "no-reply@leads365.local",
    replyToEmail: config?.replyToEmail || "support@leads365.local",
    isConfigured: false,
    provider: "simulated_smtp",
    templates: config?.templates || {},
  }
}

/**
 * Dispatches an email with optional PDF attachments.
 * 
 * @param {Object} options
 * @param {string} options.tenantId
 * @param {string} options.to
 * @param {string} options.subject
 * @param {string} options.body
 * @param {Array<{ filename: string, content: Buffer, contentType?: string }>} [options.attachments=[]]
 * @param {boolean} [options.requireLiveSmtp=false] - If true, throws if no live SMTP is configured
 * @returns {Promise<{ success: boolean, messageId: string, provider: string }>}
 */
async function sendEmail({
  tenantId,
  to,
  subject,
  body,
  attachments = [],
  requireLiveSmtp = false,
}) {
  if (!to || !to.includes("@")) {
    const err = new Error(`Invalid recipient email address: '${to}'`)
    err.statusCode = 400
    throw err
  }

  if (!subject) {
    const err = new Error("Email subject is required")
    err.statusCode = 400
    throw err
  }

  const { transporter, senderName, senderEmail, replyToEmail, isConfigured, provider } = await getTenantEmailTransporter(tenantId)

  if (requireLiveSmtp && !isConfigured) {
    const err = new Error("Email integration is not configured. Please configure SMTP in Settings before sending.")
    err.statusCode = 422
    err.code = "EMAIL_NOT_CONFIGURED"
    throw err
  }

  const fromAddress = senderName ? `"${senderName}" <${senderEmail}>` : senderEmail

  const mailOptions = {
    from: fromAddress,
    to: to.trim().toLowerCase(),
    replyTo: replyToEmail || senderEmail,
    subject,
    text: body,
    html: body.replace(/\n/g, "<br>"),
    attachments: attachments.map((att) => ({
      filename: att.filename,
      content: att.content,
      contentType: att.contentType || "application/pdf",
    })),
  }

  if (transporter && isConfigured) {
    try {
      const info = await transporter.sendMail(mailOptions)
      return {
        success: true,
        messageId: info.messageId || `<smtp_${Date.now()}@leads365.com>`,
        provider,
      }
    } catch (sendErr) {
      const err = new Error(`Email provider transmission failed: ${sendErr.message}`)
      err.originalError = sendErr
      err.provider = provider
      throw err
    }
  }

  // Simulated provider for test/unconfigured setups
  const mockMessageId = `<sim_${Date.now()}_${Math.random().toString(36).substring(2, 9)}@leads365.local>`
  return {
    success: true,
    messageId: mockMessageId,
    provider: "simulated_smtp",
    simulated: true,
  }
}

function encryptPassword(text) {
  if (!text) return ""
  const enc = encrypt(text)
  return enc.serialized || enc
}

function decryptPassword(ciphertext) {
  if (!ciphertext) return ""
  return decrypt(ciphertext)
}

module.exports = {
  getTenantEmailTransporter,
  sendEmail,
  encryptPassword,
  decryptPassword,
}
