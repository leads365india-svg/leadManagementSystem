const mongoose = require("mongoose")
const multer = require("multer")
const Brochure = require("../models/Brochure")
const { uploadTenantBrochure } = require("../services/quotationBrochure.service")
const { getDocumentBuffer } = require("../services/documentStorage.service")
const { getEffectiveTenant, applyWorkspaceScope } = require("../middleware/tenantContext")

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === "application/pdf" || file.originalname.toLowerCase().endsWith(".pdf")) {
      cb(null, true)
    } else {
      const err = new Error("Only PDF files are permitted for brochure upload")
      err.statusCode = 415
      cb(err, false)
    }
  },
})

/**
 * Upload a tenant-wide global brochure.
 */
async function uploadBrochureHandler(req, res) {
  try {
    const { title, productId, productName, isDefault } = req.body
    const { tenantId, isSuperAdmin } = getEffectiveTenant(req)

    if (!tenantId && !isSuperAdmin) {
      return res.status(401).json({ success: false, error: "Authentication required" })
    }

    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ success: false, error: "Brochure PDF file is required" })
    }

    if (!title || !title.trim()) {
      return res.status(400).json({ success: false, error: "Brochure title is required" })
    }

    const brochure = await uploadTenantBrochure({
      title,
      productId: productId && mongoose.Types.ObjectId.isValid(productId) ? productId : null,
      productName: productName || "",
      isDefault: isDefault === "true" || isDefault === true,
      buffer: req.file.buffer,
      originalName: req.file.originalname,
      user: req.user,
      tenantId,
    })

    return res.status(201).json({
      success: true,
      data: { brochure },
      message: "Brochure uploaded successfully",
    })
  } catch (err) {
    console.error("Error in uploadBrochureHandler:", err)
    return res.status(err.statusCode || 500).json({
      success: false,
      error: err.message || "Failed to upload brochure",
    })
  }
}

/**
 * List brochures for the authenticated tenant.
 */
async function listBrochuresHandler(req, res) {
  try {
    const { tenantId, isSuperAdmin } = getEffectiveTenant(req)
    const { activeOnly = "false", productId } = req.query

    if (!tenantId && !isSuperAdmin) {
      return res.status(401).json({ success: false, error: "Authentication required" })
    }

    const filter = {}
    if (!isSuperAdmin || tenantId) {
      filter.tenantId = tenantId
    }
    if (activeOnly === "true") {
      filter.isActive = true
    }
    if (productId && mongoose.Types.ObjectId.isValid(productId)) {
      filter.productId = new mongoose.Types.ObjectId(productId)
    }
    applyWorkspaceScope(filter, req)

    const brochures = await Brochure.find(filter)
      .sort({ isDefault: -1, createdAt: -1 })
      .lean()

    return res.status(200).json({
      success: true,
      data: { brochures },
    })
  } catch (err) {
    console.error("Error in listBrochuresHandler:", err)
    return res.status(500).json({ success: false, error: err.message })
  }
}

/**
 * Toggle active/inactive status of a brochure.
 */
async function toggleBrochureStatusHandler(req, res) {
  try {
    const { id } = req.params
    const { isActive, isDefault } = req.body
    const { tenantId, isSuperAdmin } = getEffectiveTenant(req)

    if (!tenantId && !isSuperAdmin) {
      return res.status(401).json({ success: false, error: "Authentication required" })
    }

    const query = { _id: id }
    if (!isSuperAdmin || tenantId) {
      query.tenantId = tenantId
    }
    applyWorkspaceScope(query, req)

    const brochure = await Brochure.findOne(query)

    if (!brochure) {
      return res.status(404).json({ success: false, error: "Brochure not found" })
    }

    if (typeof isActive === "boolean") {
      brochure.isActive = isActive
    }

    if (isDefault === true) {
      await Brochure.updateMany(
        { tenantId: brochure.tenantId, isDefault: true },
        { $set: { isDefault: false } }
      )
      brochure.isDefault = true
    } else if (isDefault === false) {
      brochure.isDefault = false
    }

    await brochure.save()

    return res.status(200).json({
      success: true,
      data: { brochure },
      message: "Brochure status updated",
    })
  } catch (err) {
    console.error("Error in toggleBrochureStatusHandler:", err)
    return res.status(err.statusCode || 500).json({ success: false, error: err.message })
  }
}

/**
 * Download a brochure PDF.
 */
async function downloadBrochureHandler(req, res) {
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

    const brochure = await Brochure.findOne(query)

    if (!brochure) {
      return res.status(404).json({ success: false, error: "Brochure not found" })
    }

    const doc = await getDocumentBuffer({ fileId: brochure.fileId, tenantId: brochure.tenantId })

    res.setHeader("Content-Type", "application/pdf")
    res.setHeader("Content-Disposition", `inline; filename="${brochure.originalName}"`)
    res.setHeader("Content-Length", doc.buffer.length)
    return res.send(doc.buffer)
  } catch (err) {
    console.error("Error in downloadBrochureHandler:", err)
    return res.status(err.statusCode || 500).json({ success: false, error: err.message })
  }
}

module.exports = {
  upload,
  uploadBrochureHandler,
  listBrochuresHandler,
  toggleBrochureStatusHandler,
  downloadBrochureHandler,
}
