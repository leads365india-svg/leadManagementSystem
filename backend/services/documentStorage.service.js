const mongoose = require("mongoose")
const crypto = require("crypto")
const { getTenantContext } = require("../middleware/tenantContext")

/**
 * Document Storage Service - Phase 1 & 2: Quotations & Brochures
 * 
 * Provides secure, tenant-isolated PDF document storage using MongoDB GridFS.
 * Ensures:
 * 1. Strict PDF MIME & magic-bytes validation (%PDF-).
 * 2. SHA-256 cryptographic checksum calculation.
 * 3. Multi-tenant access controls preventing cross-tenant document exposure.
 * 4. Streamed upload and download preventing memory leaks.
 */

const BUCKET_NAME = "crm_documents"
const MAX_DOCUMENT_SIZE_BYTES = 25 * 1024 * 1024 // 25 MB

let bucketInstance = null

function getDocumentBucket() {
  if (!mongoose.connection || mongoose.connection.readyState !== 1) {
    throw new Error("MongoDB connection is not ready for document storage operations")
  }
  if (!bucketInstance || bucketInstance.s.db !== mongoose.connection.db) {
    bucketInstance = new mongoose.mongo.GridFSBucket(mongoose.connection.db, {
      bucketName: BUCKET_NAME,
    })
  }
  return bucketInstance
}

/**
 * Validates that the provided buffer is a legitimate, non-empty PDF.
 */
function validatePdfBuffer(buffer, originalName = "") {
  if (!buffer || !Buffer.isBuffer(buffer)) {
    const err = new Error("Document buffer is missing or invalid")
    err.statusCode = 400
    throw err
  }

  if (buffer.length === 0) {
    const err = new Error("Document file is empty (0 bytes)")
    err.statusCode = 400
    throw err
  }

  if (buffer.length > MAX_DOCUMENT_SIZE_BYTES) {
    const err = new Error("Document exceeds the maximum allowed size of 25MB")
    err.statusCode = 413
    throw err
  }

  // Validate PDF magic bytes: %PDF- (hex: 25 50 44 46 2d)
  const header = buffer.subarray(0, 5).toString("utf8")
  if (!header.startsWith("%PDF")) {
    const err = new Error("Invalid document format. Only valid PDF files are permitted.")
    err.statusCode = 415
    throw err
  }

  return true
}

/**
 * Stores a PDF document in GridFS with tenant metadata.
 */
async function storeDocument({ buffer, originalName, tenantId, category = "quotation", metadata = {} }) {
  if (!tenantId) {
    const err = new Error("Tenant ID is required for document storage")
    err.statusCode = 400
    throw err
  }

  validatePdfBuffer(buffer, originalName)

  const sha256 = crypto.createHash("sha256").update(buffer).digest("hex")
  const safeBase = (originalName || "document.pdf").replace(/[^a-zA-Z0-9._-]/g, "_")
  const timestamp = Date.now()
  const randomHex = crypto.randomBytes(4).toString("hex")
  const storedFileName = `${tenantId}_${category}_${timestamp}_${randomHex}_${safeBase}`

  const bucket = getDocumentBucket()
  const uploadStream = bucket.openUploadStream(storedFileName, {
    contentType: "application/pdf",
    metadata: {
      tenantId: String(tenantId).trim(),
      originalName,
      category,
      sha256,
      sizeBytes: buffer.length,
      uploadedAt: new Date(),
      ...metadata,
    },
  })

  await new Promise((resolve, reject) => {
    uploadStream.on("finish", resolve)
    uploadStream.on("error", reject)
    uploadStream.end(buffer)
  })

  return {
    fileId: uploadStream.id.toString(),
    fileName: storedFileName,
    originalName,
    fileSize: buffer.length,
    mimeType: "application/pdf",
    sha256,
    storageProvider: "gridfs",
  }
}

/**
 * Verifies ownership of a GridFS document in crm_documents.files.
 * For legacy files missing metadata.tenantId, resolves ownership strictly and unambiguously
 * via parent Quotation or Brochure records (never from fileId alone and without rewriting GridFS).
 */
async function verifyDocumentOwnership({ fileDoc, objId, tenantId, workspaceId = null, action = "access" }) {
  const cleanTenantId = String(tenantId || "").trim()
  if (!cleanTenantId) {
    const err = new Error("Access denied. Authenticated tenantId is required.")
    err.statusCode = 403
    throw err
  }

  const ctx = getTenantContext()
  const effectiveWorkspaceId = workspaceId || (ctx?.mode === "single_workspace" ? ctx.workspaceId : null)

  // Fast path: metadata.tenantId exists on GridFS file
  if (fileDoc.metadata?.tenantId) {
    if (String(fileDoc.metadata.tenantId).trim() !== cleanTenantId) {
      const err = new Error(`Access denied. Cross-tenant document ${action} is prohibited.`)
      err.statusCode = 403
      throw err
    }
    if (
      effectiveWorkspaceId &&
      fileDoc.metadata?.workspaceId &&
      String(fileDoc.metadata.workspaceId).trim() !== String(effectiveWorkspaceId).trim()
    ) {
      const err = new Error(`Access denied. Cross-workspace document ${action} is prohibited.`)
      err.statusCode = 403
      throw err
    }
    return { source: "gridfs_metadata", tenantId: cleanTenantId }
  }

  // Legacy path: metadata.tenantId missing -> resolve unambiguously via parent Quotation or Brochure
  const Quotation = mongoose.models.Quotation || require("../models/Quotation")
  const Brochure = mongoose.models.Brochure || require("../models/Brochure")

  const fileIdStr = objId.toString()
  const [matchingQuotations, matchingBrochures] = await Promise.all([
    Quotation.find({ $or: [{ fileId: objId }, { fileId: fileIdStr }] })
      .setOptions({ skipTenantFilter: true })
      .select("_id tenantId workspaceId")
      .lean(),
    Brochure.find({ $or: [{ fileId: objId }, { fileId: fileIdStr }] })
      .setOptions({ skipTenantFilter: true })
      .select("_id tenantId workspaceId")
      .lean(),
  ])

  const parents = [...matchingQuotations, ...matchingBrochures]
  if (parents.length === 0) {
    console.warn(`[DocumentStorage Security] Orphaned legacy GridFS file ${fileIdStr} (missing metadata.tenantId and no parent Quotation/Brochure). Failing closed.`)
    const err = new Error(`Access denied. Legacy document ${action} failed closed: unowned GridFS file ${fileIdStr}.`)
    err.statusCode = 403
    err.code = "LEGACY_GRIDFS_UNOWNED"
    throw err
  }

  const uniqueTenants = [...new Set(parents.map((p) => String(p.tenantId || "").trim()).filter(Boolean))]
  if (uniqueTenants.length !== 1 || uniqueTenants[0] !== cleanTenantId) {
    console.warn(
      `[DocumentStorage Security] Ambiguous or cross-tenant legacy GridFS file ${fileIdStr}: parentTenants=[${uniqueTenants.join(",")}], caller=${cleanTenantId}. Failing closed.`
    )
    const err = new Error(`Access denied. Legacy document ${action} failed closed due to ambiguous or cross-tenant parent ownership.`)
    err.statusCode = 403
    err.code = "LEGACY_GRIDFS_AMBIGUOUS"
    throw err
  }

  if (effectiveWorkspaceId) {
    const cleanWs = String(effectiveWorkspaceId).trim()
    const parentWorkspaces = parents.map((p) => (p.workspaceId ? String(p.workspaceId).trim() : null))
    const hasExplicitMismatch = parentWorkspaces.some((ws) => ws && ws !== cleanWs)
    const hasAnyMatchingWs = parentWorkspaces.some((ws) => ws === cleanWs)
    if (hasExplicitMismatch || !hasAnyMatchingWs) {
      console.warn(
        `[DocumentStorage Security] Workspace boundary blocked legacy GridFS file ${fileIdStr}: parentWorkspaces=[${parentWorkspaces.join(",")}], callerWs=${cleanWs}.`
      )
      const err = new Error(`Access denied. Cross-workspace legacy document ${action} is prohibited.`)
      err.statusCode = 403
      err.code = "LEGACY_GRIDFS_WORKSPACE_MISMATCH"
      throw err
    }
  }

  return { source: "legacy_parent_record", tenantId: cleanTenantId }
}

/**
 * Reads a PDF document from GridFS ensuring strict tenant & workspace ownership.
 */
async function getDocumentBuffer({ fileId, tenantId, workspaceId = null }) {
  if (!fileId || !tenantId) {
    const err = new Error("fileId and tenantId are required")
    err.statusCode = 400
    throw err
  }

  const objId = new mongoose.Types.ObjectId(fileId)
  const db = mongoose.connection.db
  const fileDoc = await db.collection(`${BUCKET_NAME}.files`).findOne({ _id: objId })

  if (!fileDoc) {
    const err = new Error("Document not found")
    err.statusCode = 404
    throw err
  }

  await verifyDocumentOwnership({ fileDoc, objId, tenantId, workspaceId, action: "access" })

  const bucket = getDocumentBucket()
  const downloadStream = bucket.openDownloadStream(objId)

  const chunks = []
  await new Promise((resolve, reject) => {
    downloadStream.on("data", (chunk) => chunks.push(chunk))
    downloadStream.on("end", resolve)
    downloadStream.on("error", reject)
  })

  const buffer = Buffer.concat(chunks)
  return {
    buffer,
    fileName: fileDoc.filename,
    originalName: fileDoc.metadata?.originalName || fileDoc.filename,
    mimeType: fileDoc.contentType || "application/pdf",
    sizeBytes: fileDoc.length,
    sha256: fileDoc.metadata?.sha256 || "",
  }
}

/**
 * Deletes a PDF document from GridFS ensuring tenant & workspace ownership.
 */
async function deleteDocument({ fileId, tenantId, workspaceId = null }) {
  if (!fileId || !tenantId) return false

  const objId = new mongoose.Types.ObjectId(fileId)
  const db = mongoose.connection.db
  const fileDoc = await db.collection(`${BUCKET_NAME}.files`).findOne({ _id: objId })

  if (!fileDoc) return true

  await verifyDocumentOwnership({ fileDoc, objId, tenantId, workspaceId, action: "delete" })

  const bucket = getDocumentBucket()
  await bucket.delete(objId)
  return true
}

module.exports = {
  validatePdfBuffer,
  storeDocument,
  getDocumentBuffer,
  deleteDocument,
}
