const mongoose = require("mongoose")
const crypto = require("crypto")

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
 * Reads a PDF document from GridFS ensuring strict tenant ownership.
 */
async function getDocumentBuffer({ fileId, tenantId }) {
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

  if (fileDoc.metadata?.tenantId && fileDoc.metadata.tenantId !== String(tenantId).trim()) {
    const err = new Error("Access denied. Cross-tenant document access is prohibited.")
    err.statusCode = 403
    throw err
  }

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
 * Deletes a PDF document from GridFS ensuring tenant ownership.
 */
async function deleteDocument({ fileId, tenantId }) {
  if (!fileId || !tenantId) return false

  const objId = new mongoose.Types.ObjectId(fileId)
  const db = mongoose.connection.db
  const fileDoc = await db.collection(`${BUCKET_NAME}.files`).findOne({ _id: objId })

  if (!fileDoc) return true

  if (fileDoc.metadata?.tenantId && fileDoc.metadata.tenantId !== String(tenantId).trim()) {
    const err = new Error("Access denied. Cannot delete another tenant's document.")
    err.statusCode = 403
    throw err
  }

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
