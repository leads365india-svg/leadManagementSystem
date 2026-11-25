const mongoose = require("mongoose")
const multer = require("multer")
const Quotation = require("../models/Quotation")
const {
  uploadLeadQuotation,
  sendQuotationEmail,
  getLeadCommunicationHistory,
  deleteLeadQuotation,
} = require("../services/quotationBrochure.service")
const { getDocumentBuffer } = require("../services/documentStorage.service")
const { getEffectiveTenant, applyWorkspaceScope } = require("../middleware/tenantContext")

// Configure multer memory storage for PDF upload (max 25MB)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === "application/pdf" || file.originalname.toLowerCase().endsWith(".pdf")) {
      cb(null, true)
    } else {
      const err = new Error("Only PDF files are permitted for quotation upload")
      err.statusCode = 415
      cb(err, false)
    }
  },
})

/**
 * Upload a quotation PDF for a specific lead.
 */
async function uploadQuotationHandler(req, res) {
  try {
    const { leadId } = req.params
    const { notes = "" } = req.body
    const { tenantId, isSuperAdmin } = getEffectiveTenant(req)

    if (!tenantId && !isSuperAdmin) {
      return res.status(401).json({ success: false, error: "Authentication required" })
    }

    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ success: false, error: "PDF file is required" })
    }

    const quotation = await uploadLeadQuotation({
      leadId,
      buffer: req.file.buffer,
      originalName: req.file.originalname,
      user: req.user,
      tenantId,
      notes,
    })

    return res.status(201).json({
      success: true,
      data: { quotation },
      message: "Quotation uploaded successfully",
    })
  } catch (err) {
    console.error("Error in uploadQuotationHandler:", err)
    return res.status(err.statusCode || 500).json({
      success: false,
      error: err.message || "Failed to upload quotation",
    })
  }
}

/**
 * Manually sends an approved quotation via email.
 */
async function sendQuotationHandler(req, res) {
  try {
    const { id: quotationId } = req.params
    const { leadId, recipientEmail, subject, body, emailSubject, emailBody, idempotencyKey } = req.body
    const { tenantId, isSuperAdmin } = getEffectiveTenant(req)

    if (!tenantId && !isSuperAdmin) {
      return res.status(401).json({ success: false, error: "Authentication required" })
    }

    // Resolve quotation strictly scoped to caller tenant & workspace
    const quotationQuery = { _id: quotationId }
    if (!isSuperAdmin || tenantId) {
      quotationQuery.tenantId = tenantId
    }
    applyWorkspaceScope(quotationQuery, req)

    const quotation = await Quotation.findOne(quotationQuery)
    if (!quotation) {
      return res.status(404).json({ success: false, error: "Quotation document not found" })
    }

    if (!isSuperAdmin && quotation.tenantId !== tenantId) {
      return res.status(403).json({ success: false, error: "Access denied. Cross-tenant quotation access is prohibited." })
    }

    const effectiveTenant = tenantId || quotation.tenantId
    const effectiveLeadId = leadId || quotation.leadId

    const targetRecipient = (recipientEmail || "").trim()
    if (!targetRecipient || !targetRecipient.includes("@")) {
      return res.status(400).json({ success: false, error: "Valid recipient email is required" })
    }

    const result = await sendQuotationEmail({
      quotationId,
      leadId: effectiveLeadId,
      recipientEmail: targetRecipient,
      subject: subject || emailSubject,
      body: body || emailBody,
      user: req.user,
      tenantId: effectiveTenant,
      idempotencyKey,
    })

    return res.status(200).json({
      success: true,
      data: result,
      message: "Quotation sent successfully",
    })
  } catch (err) {
    console.error("Error in sendQuotationHandler:", err)
    return res.status(err.statusCode || 500).json({
      success: false,
      error: err.message || "Failed to send quotation email",
      code: err.code || null,
    })
  }
}

/**
 * List all quotations for a lead.
 */
async function listLeadQuotationsHandler(req, res) {
  try {
    const { leadId } = req.params
    const { tenantId, isSuperAdmin } = getEffectiveTenant(req)

    if (!tenantId && !isSuperAdmin) {
      return res.status(401).json({ success: false, error: "Authentication required" })
    }

    const query = {
      leadId: mongoose.Types.ObjectId.isValid(leadId) ? new mongoose.Types.ObjectId(leadId) : leadId,
    }
    if (!isSuperAdmin || tenantId) {
      query.tenantId = tenantId
    }
    applyWorkspaceScope(query, req)

    const quotations = await Quotation.find(query)
      .sort({ createdAt: -1 })
      .lean()

    return res.status(200).json({
      success: true,
      data: { quotations },
      quotations,
    })
  } catch (err) {
    console.error("Error in listLeadQuotationsHandler:", err)
    return res.status(500).json({ success: false, error: err.message })
  }
}

/**
 * Download a quotation PDF with tenant access verification.
 */
async function downloadQuotationHandler(req, res) {
  try {
    const { id } = req.params
    const { tenantId, isSuperAdmin } = getEffectiveTenant(req)

    if (!tenantId && !isSuperAdmin) {
      return res.status(401).json({ success: false, error: "Authentication required" })
    }

    const query = { _id: id }
    if (!isSuperAdmin || tenantId) {
      query.tenantId = tenantId
    }
    applyWorkspaceScope(query, req)

    const quotation = await Quotation.findOne(query)

    if (!quotation) {
      return res.status(404).json({ success: false, error: "Quotation not found" })
    }

    const eff = getEffectiveTenant(req)
    const doc = await getDocumentBuffer({
      fileId: quotation.fileId,
      tenantId: quotation.tenantId,
      workspaceId: eff.mode === "single_workspace" ? eff.workspaceId : null,
    })

    res.setHeader("Content-Type", "application/pdf")
    res.setHeader("Content-Disposition", `inline; filename="${quotation.originalName}"`)
    res.setHeader("Content-Length", doc.buffer.length)
    return res.send(doc.buffer)
  } catch (err) {
    console.error("Error in downloadQuotationHandler:", err)
    return res.status(err.statusCode || 500).json({ success: false, error: err.message })
  }
}

/**
 * Get unified communication and email history for a lead.
 */
async function getCommunicationTimelineHandler(req, res) {
  try {
    const { leadId } = req.params
    const { tenantId, isSuperAdmin } = getEffectiveTenant(req)

    if (!tenantId && !isSuperAdmin) {
      return res.status(401).json({ success: false, error: "Authentication required" })
    }

    const history = await getLeadCommunicationHistory(leadId, tenantId)
    return res.status(200).json({
      success: true,
      data: { history },
      history,
    })
  } catch (err) {
    console.error("Error in getCommunicationTimelineHandler:", err)
    return res.status(500).json({ success: false, error: err.message })
  }
}

/**
 * Delete or void a quotation document.
 */
async function deleteQuotationHandler(req, res) {
  try {
    const { id: quotationId } = req.params
    const { tenantId, isSuperAdmin } = getEffectiveTenant(req)

    if (!tenantId && !isSuperAdmin) {
      return res.status(401).json({ success: false, error: "Authentication required" })
    }

    const result = await deleteLeadQuotation({
      quotationId,
      user: req.user,
      tenantId,
      isSuperAdmin,
    })

    return res.status(200).json({
      success: true,
      message: result.message,
      data: result,
    })
  } catch (err) {
    console.error("Error in deleteQuotationHandler:", err)
    return res.status(err.statusCode || 500).json({
      success: false,
      error: err.message || "Failed to delete quotation",
      code: err.code || null,
    })
  }
}

module.exports = {
  upload,
  uploadQuotationHandler,
  sendQuotationHandler,
  listLeadQuotationsHandler,
  downloadQuotationHandler,
  getCommunicationTimelineHandler,
  deleteQuotationHandler,
}
