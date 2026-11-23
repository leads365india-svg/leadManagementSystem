const mongoose = require("mongoose")
const Quotation = require("../models/Quotation")
const Brochure = require("../models/Brochure")
const EmailCommunication = require("../models/EmailCommunication")
const { Activity } = require("../models/Activity")
const Lead = require("../models/Lead")
const BusinessProduct = require("../models/BusinessProduct")
const { storeDocument, getDocumentBuffer, deleteDocument } = require("./documentStorage.service")
const { sendEmail, getTenantEmailTransporter } = require("./emailProvider.service")
const { getTenantProductKnowledge } = require("./tenantProductKnowledge.service")

/**
 * Quotation & Brochure Management Service - Phases 1, 2, 4
 * 
 * Orchestrates:
 * 1. Lead-specific quotation uploads and manual approval sending.
 * 2. Tenant-wide global brochure catalog management.
 * 3. Autonomous qualifying brochure email dispatch.
 * 4. Unified communication timeline and audit activities.
 */

// In-memory locks for duplicate send and delete prevention
const activeSendLocks = new Set()
const activeDeleteLocks = new Set()

/**
 * Uploads a quotation document linked to a specific lead and tenant.
 */
async function uploadLeadQuotation({ leadId, buffer, originalName, user, tenantId, notes = "" }) {
  if (!leadId || !tenantId) {
    const err = new Error("leadId and tenantId are required")
    err.statusCode = 400
    throw err
  }

  const cleanTenantId = String(tenantId).trim()
  const lead = await Lead.findOne({ _id: leadId, tenantId: cleanTenantId })
    .setOptions({ skipTenantFilter: true })

  if (!lead) {
    const err = new Error("Lead not found or does not belong to this tenant")
    err.statusCode = 404
    throw err
  }

  // Count existing quotations for this lead to compute next version number
  const existingCount = await Quotation.countDocuments({ leadId, tenantId: cleanTenantId })
    .setOptions({ skipTenantFilter: true })

  const version = existingCount + 1

  // 1. Store PDF in GridFS
  const stored = await storeDocument({
    buffer,
    originalName,
    tenantId: cleanTenantId,
    category: "quotation",
    metadata: {
      leadId: lead._id.toString(),
      version,
      uploadedBy: user?._id?.toString() || user?.id,
    },
  })

  // 2. Create Quotation Document
  const quotation = new Quotation({
    tenantId: cleanTenantId,
    leadId: lead._id,
    fileName: stored.fileName,
    originalName: stored.originalName,
    fileId: stored.fileId,
    fileSize: stored.fileSize,
    mimeType: stored.mimeType,
    sha256: stored.sha256,
    version,
    status: "uploaded",
    uploadedBy: user?._id || user?.id || null,
    uploadedByName: user?.name || user?.email || "Agent",
    uploadedAt: new Date(),
    notes,
  })

  await quotation.save()

  // 3. Update Lead Quotation Status
  lead.quotationStatus = "Uploaded"
  await lead.save().catch(() => {})

  // 4. Log discrete Activity
  await Activity.create({
    tenantId: cleanTenantId,
    leadId: lead._id,
    type: "quotation.uploaded",
    actor: {
      id: user?._id || user?.id || null,
      name: user?.name || "Agent",
      email: user?.email || "",
      role: user?.role || "agent",
    },
    payload: {
      quotationId: quotation._id,
      fileName: stored.originalName,
      version,
      fileSize: stored.fileSize,
      uploadedAt: quotation.uploadedAt,
    },
  }).catch((actErr) => {
    console.warn("[QuotationBrochure] Activity log notice:", actErr.message)
  })

  return quotation
}

/**
 * Manually sends an approved quotation PDF via email to a lead.
 * Enforces duplicate send protection and records transaction history.
 */
async function sendQuotationEmail({
  quotationId,
  leadId,
  recipientEmail,
  subject,
  body,
  user,
  tenantId,
  idempotencyKey = null,
}) {
  if (!quotationId || !leadId || !tenantId) {
    const err = new Error("quotationId, leadId, and tenantId are required")
    err.statusCode = 400
    throw err
  }

  const cleanTenantId = String(tenantId).trim()
  const lockKey = idempotencyKey || `${cleanTenantId}_${leadId}_${quotationId}_${recipientEmail}`

  // Prevent duplicate sends from accidental double-clicks
  if (activeSendLocks.has(lockKey)) {
    const err = new Error("Quotation email dispatch is already in progress. Please wait.")
    err.statusCode = 409
    err.code = "DUPLICATE_SEND_IN_PROGRESS"
    throw err
  }

  activeSendLocks.add(lockKey)

  try {
    // 1. Fetch Lead & Quotation
    const [lead, quotation] = await Promise.all([
      Lead.findOne({ _id: leadId, tenantId: cleanTenantId }).setOptions({ skipTenantFilter: true }),
      Quotation.findOne({ _id: quotationId, leadId, tenantId: cleanTenantId }).setOptions({ skipTenantFilter: true }),
    ])

    if (!lead) {
      const err = new Error("Lead not found or tenant mismatch")
      err.statusCode = 404
      throw err
    }

    if (!quotation) {
      const err = new Error("Quotation document not found or does not belong to this lead")
      err.statusCode = 404
      throw err
    }

    const targetEmail = (recipientEmail || lead.email || "").trim().toLowerCase()
    if (!targetEmail || !targetEmail.includes("@")) {
      const err = new Error("A valid recipient email address is required to send quotation")
      err.statusCode = 400
      throw err
    }

    // 2. Fetch PDF document buffer
    const docData = await getDocumentBuffer({ fileId: quotation.fileId, tenantId: cleanTenantId })

    const finalSubject = subject || `Quotation from ${cleanTenantId}`
    const finalBody = body || `Dear ${lead.name},\n\nPlease find attached the requested quotation document.\n\nBest regards,\n${user?.name || "Team"}`

    // 3. Dispatch Email via Provider
    let sendResult
    let sendError = null

    try {
      sendResult = await sendEmail({
        tenantId: cleanTenantId,
        to: targetEmail,
        subject: finalSubject,
        body: finalBody,
        attachments: [
          {
            filename: quotation.originalName || "Quotation.pdf",
            content: docData.buffer,
            contentType: "application/pdf",
          },
        ],
        requireLiveSmtp: true,
      })
    } catch (err) {
      sendError = err
    }

    const sendRecord = {
      sentAt: new Date(),
      sentBy: user?._id || user?.id || null,
      sentByName: user?.name || user?.email || "Agent",
      recipientEmail: targetEmail,
      subject: finalSubject,
      body: finalBody,
      messageId: sendResult?.messageId || "",
      provider: sendResult?.provider || "smtp",
      status: sendResult?.success ? "sent" : "failed",
      error: sendError ? sendError.message : null,
    }

    // 4. Update Quotation Model
    quotation.sentHistory.push(sendRecord)
    if (sendResult?.success) {
      quotation.status = "sent"
      quotation.sentCount = (quotation.sentCount || 0) + 1
      quotation.lastSentAt = sendRecord.sentAt
      lead.quotationStatus = "Sent"
      await lead.save().catch(() => {})
    }
    await quotation.save()

    // 5. Create EmailCommunication entry
    const commLog = new EmailCommunication({
      tenantId: cleanTenantId,
      leadId: lead._id,
      emailType: "MANUAL_QUOTATION",
      documentType: "quotation",
      documentId: quotation._id,
      attachmentFileName: quotation.originalName,
      attachmentFileId: quotation.fileId,
      recipientEmail: targetEmail,
      subject: finalSubject,
      body: finalBody,
      provider: sendResult?.provider || "smtp",
      providerMessageId: sendResult?.messageId || "",
      status: sendResult?.success ? "sent" : "failed",
      failureReason: sendError ? sendError.message : null,
      sentBy: user?._id || user?.id || null,
      sentByName: user?.name || "Agent",
      sentAt: sendRecord.sentAt,
      idempotencyKey: lockKey,
    })
    await commLog.save()

    // 6. Record Activity
    await Activity.create({
      tenantId: cleanTenantId,
      leadId: lead._id,
      type: sendResult?.success ? "quotation.sent" : "email.failed",
      actor: {
        id: user?._id || user?.id || null,
        name: user?.name || "Agent",
        email: user?.email || "",
        role: user?.role || "agent",
      },
      payload: {
        quotationId: quotation._id,
        recipientEmail: targetEmail,
        messageId: sendResult?.messageId || null,
        fileName: quotation.originalName,
        status: sendResult?.success ? "sent" : "failed",
        error: sendError?.message || null,
      },
    }).catch(() => {})

    if (sendError) {
      throw sendError
    }

    return {
      success: true,
      quotation,
      messageId: sendResult.messageId,
      sentAt: sendRecord.sentAt,
    }
  } finally {
    // Release in-memory lock
    activeSendLocks.delete(lockKey)
  }
}

/**
 * Uploads or replaces a tenant-wide global brochure.
 */
async function uploadTenantBrochure({
  title,
  productId = null,
  productName = "",
  isDefault = false,
  buffer,
  originalName,
  user,
  tenantId,
}) {
  if (!title || !tenantId) {
    const err = new Error("title and tenantId are required")
    err.statusCode = 400
    throw err
  }

  const cleanTenantId = String(tenantId).trim()

  // 1. Store PDF in GridFS
  const stored = await storeDocument({
    buffer,
    originalName,
    tenantId: cleanTenantId,
    category: "brochure",
    metadata: {
      title,
      productId: productId ? String(productId) : null,
      uploadedBy: user?._id?.toString() || user?.id,
    },
  })

  // If this is set as default, unset other defaults for this tenant
  if (isDefault) {
    await Brochure.updateMany(
      { tenantId: cleanTenantId, isDefault: true },
      { $set: { isDefault: false } }
    ).setOptions({ skipTenantFilter: true })
  }

  // 2. Create Brochure record
  const brochure = new Brochure({
    tenantId: cleanTenantId,
    title: title.trim(),
    productId: productId ? new mongoose.Types.ObjectId(productId) : null,
    productName: productName ? productName.trim() : "",
    isDefault: Boolean(isDefault),
    fileName: stored.fileName,
    originalName: stored.originalName,
    fileId: stored.fileId,
    fileSize: stored.fileSize,
    mimeType: stored.mimeType,
    sha256: stored.sha256,
    version: 1,
    isActive: true,
    uploadedBy: user?._id || user?.id || null,
    uploadedByName: user?.name || user?.email || "Admin",
    uploadedAt: new Date(),
  })

  await brochure.save()
  return brochure
}

/**
 * Autonomous Qualifying Brochure Email Dispatch - Phase 2
 * 
 * Verifies all 5 conditions before sending:
 * 1. Customer requested product is SUPPORTED by tenant.
 * 2. Requested channel is email (not WhatsApp / phone).
 * 3. Valid customer email exists on lead or transcript.
 * 4. Active product brochure or default brochure exists for tenant.
 * 5. Tenant email configuration exists.
 */
async function autoSendBrochureEmail({
  lead,
  call = {},
  productInterest = "",
  customerEmail = null,
  transcriptEvidence = "",
  channel = "email",
  tenantId,
}) {
  const cleanTenantId = String(tenantId || lead?.tenantId || call?.tenantId || "").trim()
  if (!cleanTenantId || !lead) {
    return { sent: false, reason: "MISSING_LEAD_OR_TENANT" }
  }

  // 1. Channel check: Do NOT send if customer requested WhatsApp or another channel
  const normalizedChannel = (channel || "email").toLowerCase().trim()
  if (normalizedChannel.includes("whatsapp") || normalizedChannel.includes("wa")) {
    await Activity.create({
      tenantId: cleanTenantId,
      leadId: lead._id,
      type: "brochure.requested",
      actor: { name: "AI Call Intelligence", role: "system" },
      payload: {
        productInterest,
        channel: "whatsapp",
        transcriptEvidence,
        notice: "Customer requested brochure via WhatsApp. Manual dispatch required.",
      },
    }).catch(() => {})
    return { sent: false, reason: "CHANNEL_WHATSAPP_REQUESTED" }
  }

  // 2. Email verification
  const targetEmail = (customerEmail || lead.email || "").trim().toLowerCase()
  if (!targetEmail || !targetEmail.includes("@")) {
    await Activity.create({
      tenantId: cleanTenantId,
      leadId: lead._id,
      type: "brochure.requested",
      actor: { name: "AI Call Intelligence", role: "system" },
      payload: {
        productInterest,
        channel: "email",
        transcriptEvidence,
        notice: "Customer requested brochure, but no email address is on file.",
      },
    }).catch(() => {})
    return { sent: false, reason: "NO_CUSTOMER_EMAIL_ON_FILE" }
  }

  // 3. Select matching active brochure: product-specific or default
  let brochure = null
  if (productInterest) {
    // Try matching product-specific brochure
    brochure = await Brochure.findOne({
      tenantId: cleanTenantId,
      isActive: true,
      $or: [
        { productName: new RegExp(productInterest.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") },
        { title: new RegExp(productInterest.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") },
      ],
    }).setOptions({ skipTenantFilter: true })
  }

  // Fallback to tenant's default active brochure
  if (!brochure) {
    brochure = await Brochure.findOne({
      tenantId: cleanTenantId,
      isActive: true,
      isDefault: true,
    }).setOptions({ skipTenantFilter: true })
  }

  // Fallback to any active brochure for this tenant
  if (!brochure) {
    brochure = await Brochure.findOne({
      tenantId: cleanTenantId,
      isActive: true,
    }).setOptions({ skipTenantFilter: true })
  }

  if (!brochure) {
    await Activity.create({
      tenantId: cleanTenantId,
      leadId: lead._id,
      type: "brochure.requested",
      actor: { name: "AI Call Intelligence", role: "system" },
      payload: {
        productInterest,
        channel: "email",
        transcriptEvidence,
        notice: "Brochure requested, but tenant has no active brochure uploaded.",
      },
    }).catch(() => {})
    return { sent: false, reason: "NO_ACTIVE_BROCHURE_CONFIGURED" }
  }

  // 4. Resolve Tenant Email Config and templates
  const { senderName, senderEmail, templates } = await getTenantEmailTransporter(cleanTenantId)
  const knowledge = await getTenantProductKnowledge(cleanTenantId).catch(() => ({}))
  const tenantBusinessName = knowledge.companyName || senderName || "Our Team"
  const productName = brochure.productName || productInterest || "our software platform"

  // Fill template placeholders
  let subject = templates.brochureSubject || "{{tenantBusinessName}} – Requested Product Brochure"
  subject = subject.replace(/\{\{tenantBusinessName\}\}/g, tenantBusinessName)
    .replace(/\{\{customerName\}\}/g, lead.name || "Customer")
    .replace(/\{\{productName\}\}/g, productName)

  let body = templates.brochureBody || `Namaste {{customerName}},\n\nAs discussed during our recent conversation, please find attached the product brochure for {{productName}}.\n\nThe brochure contains information about the product and its available features.\n\nPlease review it and let us know if you have any questions.\n\nRegards,\n{{tenantBusinessName}}`
  body = body.replace(/\{\{tenantBusinessName\}\}/g, tenantBusinessName)
    .replace(/\{\{customerName\}\}/g, lead.name || "Customer")
    .replace(/\{\{productName\}\}/g, productName)
    .replace(/\{\{tenantContactDetails\}\}/g, senderEmail || "")

  // 5. Fetch PDF buffer and dispatch email
  const docData = await getDocumentBuffer({ fileId: brochure.fileId, tenantId: cleanTenantId })

  const sendResult = await sendEmail({
    tenantId: cleanTenantId,
    to: targetEmail,
    subject,
    body,
    attachments: [
      {
        filename: brochure.originalName || `${brochure.title}.pdf`,
        content: docData.buffer,
        contentType: "application/pdf",
      },
    ],
  })

  // 6. Record transaction in EmailCommunication
  const commLog = new EmailCommunication({
    tenantId: cleanTenantId,
    leadId: lead._id,
    emailType: "AUTO_BROCHURE",
    documentType: "brochure",
    documentId: brochure._id,
    attachmentFileName: brochure.originalName,
    attachmentFileId: brochure.fileId,
    recipientEmail: targetEmail,
    subject,
    body,
    provider: sendResult.provider,
    providerMessageId: sendResult.messageId,
    status: sendResult.success ? "sent" : "failed",
    sentBy: null,
    sentByName: "AI Call Intelligence (Automated)",
    sentAt: new Date(),
    callId: call?._id || null,
    transcriptEvidence,
  })
  await commLog.save()

  // 7. Increment brochure sent count
  brochure.sentCount = (brochure.sentCount || 0) + 1
  await brochure.save()

  // 8. Add Activity to Lead Timeline
  await Activity.create({
    tenantId: cleanTenantId,
    leadId: lead._id,
    type: "brochure.sent",
    actor: { name: "AI Call Intelligence", role: "system" },
    payload: {
      brochureId: brochure._id,
      brochureTitle: brochure.title,
      fileName: brochure.originalName,
      recipientEmail: targetEmail,
      messageId: sendResult.messageId,
      productInterest,
      evidence: transcriptEvidence,
    },
  }).catch(() => {})

  return {
    sent: true,
    messageId: sendResult.messageId,
    brochureTitle: brochure.title,
    recipientEmail: targetEmail,
  }
}

/**
 * Toggles active status of a tenant brochure.
 */
async function toggleBrochureStatus(tenantId, brochureId, isActive) {
  const cleanTenantId = String(tenantId).trim()
  const brochure = await Brochure.findOne({ _id: brochureId, tenantId: cleanTenantId })
    .setOptions({ skipTenantFilter: true })

  if (!brochure) {
    const err = new Error("Brochure not found or tenant mismatch")
    err.statusCode = 404
    throw err
  }

  brochure.isActive = Boolean(isActive)
  await brochure.save()
  return brochure
}

/**
 * Returns unified communication timeline for a lead.
 */
async function getLeadCommunicationHistory(leadId, tenantId) {
  const cleanTenantId = String(tenantId).trim()
  const history = await EmailCommunication.find({ leadId, tenantId: cleanTenantId })
    .sort({ sentAt: -1 })
    .setOptions({ skipTenantFilter: true })
    .lean()

  return history
}

/**
 * Deletes or voids a quotation document linked to a lead.
 * - For unsent/draft quotations: permanently removes MongoDB record and GridFS file.
 * - For already-sent quotations: marks as voided/archived to preserve compliance and audit history.
 */
async function deleteLeadQuotation({ quotationId, user, tenantId, isSuperAdmin = false }) {
  if (!quotationId) {
    const err = new Error("quotationId is required")
    err.statusCode = 400
    throw err
  }

  const cleanTenantId = tenantId ? String(tenantId).trim() : null
  const lockKey = `${cleanTenantId || "super"}_${quotationId}`

  if (activeDeleteLocks.has(lockKey)) {
    const err = new Error("Quotation deletion is already in progress. Please wait.")
    err.statusCode = 409
    err.code = "DUPLICATE_DELETE_IN_PROGRESS"
    throw err
  }

  activeDeleteLocks.add(lockKey)

  try {
    // 1. Query quotation ensuring tenant boundary
    const query = { _id: quotationId }
    if (!isSuperAdmin || cleanTenantId) {
      query.tenantId = cleanTenantId
    }

    const quotation = await Quotation.findOne(query).setOptions({ skipTenantFilter: true })
    if (!quotation) {
      const err = new Error("Quotation document not found or does not belong to this tenant")
      err.statusCode = 404
      throw err
    }

    const leadId = quotation.leadId
    const effectiveTenantId = quotation.tenantId
    const isSent = (quotation.sentCount > 0) || quotation.status === "sent" || (Array.isArray(quotation.sentHistory) && quotation.sentHistory.length > 0)

    let isVoided = false
    let finalStatus = ""

    if (isSent) {
      // Sent quotation protection: DO NOT destroy audit trail. Void/Archive document.
      quotation.status = "voided"
      quotation.voidedAt = new Date()
      quotation.voidedBy = user?._id || user?.id || null
      quotation.voidedByName = user?.name || user?.email || "Agent"
      quotation.voidReason = "Voided by user from CRM Lead Drawer"
      await quotation.save()
      isVoided = true
      finalStatus = "voided"

      // Record Activity
      await Activity.create({
        tenantId: effectiveTenantId,
        leadId,
        type: "quotation.voided",
        actor: {
          id: user?._id || user?.id || null,
          name: user?.name || "Agent",
          email: user?.email || "",
          role: user?.role || "agent",
        },
        payload: {
          quotationId: quotation._id,
          fileName: quotation.originalName,
          version: quotation.version,
          voidedAt: quotation.voidedAt,
          sentCount: quotation.sentCount,
        },
      }).catch(() => {})
    } else {
      // Unsent / Draft quotation: Remove from GridFS and delete MongoDB document
      if (quotation.fileId) {
        try {
          await deleteDocument({ fileId: quotation.fileId, tenantId: effectiveTenantId })
        } catch (gridFsErr) {
          console.warn(`[Quotation] GridFS file deletion notice for fileId ${quotation.fileId}:`, gridFsErr.message)
        }
      }

      await Quotation.deleteOne({ _id: quotation._id }).setOptions({ skipTenantFilter: true })
      finalStatus = "deleted"

      // Record Activity
      await Activity.create({
        tenantId: effectiveTenantId,
        leadId,
        type: "quotation.deleted",
        actor: {
          id: user?._id || user?.id || null,
          name: user?.name || "Agent",
          email: user?.email || "",
          role: user?.role || "agent",
        },
        payload: {
          quotationId: quotation._id,
          fileName: quotation.originalName,
          version: quotation.version,
          fileSize: quotation.fileSize,
        },
      }).catch(() => {})
    }

    // Update parent Lead quotationStatus based on remaining active quotations
    const lead = await Lead.findOne({ _id: leadId, tenantId: effectiveTenantId }).setOptions({ skipTenantFilter: true })
    let newLeadQuotationStatus = "None"
    if (lead) {
      const remainingActive = await Quotation.find({
        leadId,
        tenantId: effectiveTenantId,
        status: { $nin: ["voided", "archived"] },
      })
        .sort({ version: -1 })
        .setOptions({ skipTenantFilter: true })
        .lean()

      if (remainingActive.some((q) => (q.sentCount > 0) || q.status === "sent")) {
        newLeadQuotationStatus = "Sent"
      } else if (remainingActive.length > 0) {
        newLeadQuotationStatus = "Uploaded"
      } else {
        newLeadQuotationStatus = lead.quotationRequested ? "Requested" : "None"
      }

      lead.quotationStatus = newLeadQuotationStatus
      await lead.save().catch(() => {})
    }

    return {
      success: true,
      quotationId,
      leadId,
      isVoided,
      status: finalStatus,
      leadQuotationStatus: newLeadQuotationStatus,
      message: isVoided
        ? "Quotation has been voided and archived to protect delivery audit history."
        : "Quotation document deleted successfully.",
    }
  } finally {
    activeDeleteLocks.delete(lockKey)
  }
}

module.exports = {
  uploadLeadQuotation,
  sendQuotationEmail,
  uploadTenantBrochure,
  toggleBrochureStatus,
  autoSendBrochureEmail,
  getLeadCommunicationHistory,
  deleteLeadQuotation,
}
