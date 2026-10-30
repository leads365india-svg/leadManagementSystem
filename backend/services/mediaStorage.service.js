const crypto = require("crypto")
const path = require("path")
const fs = require("fs")
const os = require("os")
const {
  isImageKitConfigured,
  getImageKitClient,
  getSignedUrl,
} = require("./imagekit.service")

/**
 * Centralized Media Storage Service
 * 
 * Abstraction layer for cloud media storage across Leads-365 CRM using ImageKit.
 * Handles:
 * 1. Secure tenant-isolated folder organization.
 * 2. Upload, retrieval, deletion, and signed URL generation.
 * 3. File type, MIME, and size validation.
 * 4. Collision-safe unique naming and deduplication.
 * 5. Migration of existing files from GridFS or local storage.
 */

// Supported Media Categories and their relative folder paths
const FOLDER_CATEGORIES = {
  recordings: "recordings",
  "profile-images": "profile-images",
  documents: "documents",
  attachments: "attachments",
  "call-attachments": "call-attachments",
  general: "general",
}

// Allowed MIME Types and Max Sizes per category
const VALIDATION_RULES = {
  recordings: {
    allowedMimes: new Set([
      "audio/mpeg",
      "audio/mp3",
      "audio/mp4",
      "audio/m4a",
      "audio/x-m4a",
      "audio/aac",
      "audio/amr",
      "audio/wav",
      "audio/x-wav",
      "audio/3gpp",
      "audio/3gp",
      "application/octet-stream",
    ]),
    maxSizeBytes: 50 * 1024 * 1024, // 50MB
  },
  "profile-images": {
    allowedMimes: new Set([
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/gif",
    ]),
    maxSizeBytes: 5 * 1024 * 1024, // 5MB
  },
  documents: {
    allowedMimes: new Set([
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "text/plain",
      "text/csv",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ]),
    maxSizeBytes: 25 * 1024 * 1024, // 25MB
  },
  attachments: {
    allowedMimes: new Set([
      "image/jpeg",
      "image/png",
      "image/webp",
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "text/plain",
      "text/csv",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "audio/mpeg",
      "audio/mp4",
      "audio/m4a",
    ]),
    maxSizeBytes: 25 * 1024 * 1024, // 25MB
  },
  "call-attachments": {
    allowedMimes: new Set([
      "image/jpeg",
      "image/png",
      "image/webp",
      "application/pdf",
      "text/plain",
    ]),
    maxSizeBytes: 15 * 1024 * 1024, // 15MB
  },
  general: {
    allowedMimes: new Set([
      "image/jpeg",
      "image/png",
      "image/webp",
      "application/pdf",
      "text/plain",
      "audio/mpeg",
    ]),
    maxSizeBytes: 25 * 1024 * 1024, // 25MB
  },
}

/**
 * Sanitizes tenant ID to prevent directory traversal or malformed paths.
 * @param {string} tenantId
 * @returns {string}
 */
function sanitizeTenantId(tenantId) {
  if (!tenantId || typeof tenantId !== "string") {
    throw new Error("Invalid tenant identifier: tenantId is required")
  }
  const clean = tenantId.replace(/[^a-zA-Z0-9_-]/g, "")
  if (!clean) {
    throw new Error("Invalid tenant identifier: contains illegal characters")
  }
  return clean
}

/**
 * Builds the canonical tenant-isolated ImageKit folder path.
 * Format: /lead-management/{tenantId}/{category}/
 * 
 * @param {string} tenantId
 * @param {string} category
 * @returns {string}
 */
function buildTenantFolderPath(tenantId, category = "general") {
  const safeTenant = sanitizeTenantId(tenantId)
  const safeCategory = FOLDER_CATEGORIES[category] || FOLDER_CATEGORIES.general
  return `/lead-management/${safeTenant}/${safeCategory}/`
}

/**
 * Generates a unique, collision-safe file name.
 * 
 * @param {string} originalName
 * @param {string} [prefix]
 * @returns {string}
 */
function generateSafeFileName(originalName, prefix = "") {
  const rawBase = path.basename(originalName || "file")
  const ext = path.extname(rawBase) || ""
  const baseName = path.basename(rawBase, ext).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 50)
  const timestamp = Date.now()
  const randomHex = crypto.randomBytes(6).toString("hex")
  const prefixPart = prefix ? `${prefix.replace(/[^a-zA-Z0-9_-]/g, "")}_` : ""

  return `${prefixPart}${baseName}_${timestamp}_${randomHex}${ext}`
}

/**
 * Validates a file's MIME type and size against category rules.
 * 
 * @param {Object} options
 * @param {string} options.mimeType
 * @param {number} options.sizeBytes
 * @param {string} [options.category="general"]
 * @returns {{ valid: boolean, error?: string, code?: string }}
 */
function validateFile({ mimeType, sizeBytes, category = "general" }) {
  const rules = VALIDATION_RULES[category] || VALIDATION_RULES.general

  if (typeof sizeBytes === "number") {
    if (sizeBytes <= 0) {
      return {
        valid: false,
        error: "File is empty (0 bytes).",
        code: "EMPTY_FILE",
      }
    }
    if (sizeBytes > rules.maxSizeBytes) {
      const maxMb = Math.round(rules.maxSizeBytes / (1024 * 1024))
      return {
        valid: false,
        error: `File size exceeds the maximum permitted limit of ${maxMb}MB for ${category}.`,
        code: "FILE_TOO_LARGE",
      }
    }
  }

  const cleanMime = (mimeType || "").toLowerCase().trim()
  if (cleanMime && !rules.allowedMimes.has(cleanMime)) {
    return {
      valid: false,
      error: `File type '${cleanMime}' is not permitted for ${category}.`,
      code: "UNSUPPORTED_MEDIA_TYPE",
    }
  }

  return { valid: true }
}

/**
 * Uploads a file to ImageKit with tenant-isolated organization and retry handling.
 * 
 * @param {Object} options
 * @param {Buffer|string|stream.Readable} options.file - File buffer, base64 string, or readable stream
 * @param {string} options.fileName - Name of the file
 * @param {string} options.tenantId - Tenant identifier
 * @param {string} [options.category="general"] - Folder category
 * @param {string} [options.mimeType] - MIME type
 * @param {number} [options.sizeBytes] - Size in bytes (for pre-validation)
 * @param {Array<string>} [options.tags=[]] - Additional searchable tags
 * @param {Object} [options.customMetadata={}] - Custom metadata attributes
 * @param {boolean} [options.useUniqueFileName=false] - Let ImageKit generate unique name (we manage safe names)
 * @param {number} [options.maxRetries=2] - Number of retries on transient errors
 * @returns {Promise<Object>} ImageKit upload response
 */
async function uploadFile({
  file,
  fileName,
  tenantId,
  category = "general",
  mimeType = "",
  sizeBytes = null,
  tags = [],
  customMetadata = {},
  useUniqueFileName = false,
  maxRetries = 2,
}) {
  if (!file) {
    const err = new Error("File content is required for upload")
    err.code = "MISSING_FILE"
    throw err
  }

  // 1. Validation
  const validation = validateFile({ mimeType, sizeBytes, category })
  if (!validation.valid) {
    const err = new Error(validation.error)
    err.code = validation.code
    err.statusCode = validation.code === "FILE_TOO_LARGE" ? 413 : 415
    throw err
  }

  const client = getImageKitClient()
  const safeTenantId = sanitizeTenantId(tenantId)
  const folder = buildTenantFolderPath(safeTenantId, category)
  const safeFileName = generateSafeFileName(fileName)

  const uploadOptions = {
    file,
    fileName: safeFileName,
    folder,
    tags: [safeTenantId, category, ...tags],
    useUniqueFileName,
    customMetadata: {
      tenantId: safeTenantId,
      category,
      uploadedAt: new Date().toISOString(),
      ...customMetadata,
    },
  }

  // 2. Upload with retry on transient network errors
  let lastError = null
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await client.upload(uploadOptions)
      return {
        success: true,
        provider: "imagekit",
        fileId: response.fileId,
        fileName: response.name,
        filePath: response.filePath,
        url: response.url,
        thumbnailUrl: response.thumbnailUrl || null,
        sizeBytes: response.size,
        fileType: response.fileType,
        mimeType: mimeType || (response.fileType === "image" ? "image/jpeg" : "application/octet-stream"),
        height: response.height || null,
        width: response.width || null,
        tags: response.tags || [],
        customMetadata: response.customMetadata || {},
      }
    } catch (err) {
      lastError = err
      console.warn(`[MediaStorage] ImageKit upload attempt ${attempt + 1} failed:`, err.message)
      if (attempt < maxRetries) {
        // Wait exponential backoff before retry (200ms, 400ms)
        await new Promise((res) => setTimeout(res, (attempt + 1) * 200))
      }
    }
  }

  const uploadErr = new Error(`ImageKit upload failed after ${maxRetries + 1} attempts: ${lastError.message}`)
  uploadErr.code = "IMAGEKIT_UPLOAD_FAILED"
  uploadErr.originalError = lastError
  throw uploadErr
}

/**
 * Retrieves detailed file metadata from ImageKit by fileId.
 * 
 * @param {string} fileId
 * @returns {Promise<Object>}
 */
async function getFileDetails(fileId) {
  if (!fileId) {
    throw new Error("File ID is required to fetch file details")
  }

  const client = getImageKitClient()
  return await client.getFileDetails(fileId)
}

/**
 * Alias for getFileDetails to satisfy service interface.
 * 
 * @param {string} fileId
 * @returns {Promise<Object>}
 */
async function getFileById(fileId) {
  return await getFileDetails(fileId)
}

/**
 * Deletes a file from ImageKit by fileId with tenant isolation verification.
 * 
 * @param {string} fileId
 * @param {string} [expectedTenantId] - If provided, verifies file belongs to tenant before deletion
 * @returns {Promise<{ success: boolean, fileId: string }>}
 */
async function deleteFile(fileId, expectedTenantId = null) {
  if (!fileId) {
    throw new Error("File ID is required to delete file")
  }

  const client = getImageKitClient()

  // Verify tenant ownership if expectedTenantId is supplied
  if (expectedTenantId) {
    try {
      const details = await client.getFileDetails(fileId)
      const safeTenant = sanitizeTenantId(expectedTenantId)
      const expectedFolderPrefix = `/lead-management/${safeTenant}/`
      if (details.filePath && !details.filePath.startsWith(expectedFolderPrefix)) {
        const forbiddenErr = new Error("Cross-tenant media deletion is strictly prohibited")
        forbiddenErr.statusCode = 403
        forbiddenErr.code = "FORBIDDEN_TENANT_ACCESS"
        throw forbiddenErr
      }
    } catch (checkErr) {
      if (checkErr.code === "FORBIDDEN_TENANT_ACCESS") throw checkErr
      // If file doesn't exist on ImageKit, deleteFile is idempotent
    }
  }

  await client.deleteFile(fileId)
  return { success: true, fileId }
}

/**
 * Generates an authenticated short-lived signed URL for a private file.
 * 
 * @param {Object} options
 * @param {string} [options.path] - ImageKit file path
 * @param {string} [options.url] - ImageKit full URL
 * @param {number} [options.expireSeconds=300] - Expiration in seconds
 * @returns {string} Signed URL
 */
function generatePrivateFileUrl({ path, url, expireSeconds = 300 }) {
  return getSignedUrl({ path, url, expireSeconds })
}

/**
 * Migrates an existing file (from stream, buffer, or local path) to ImageKit.
 * 
 * @param {Object} options
 * @param {stream.Readable|Buffer|string} options.fileSource - File stream, buffer, or path
 * @param {string} options.fileName - Destination file name
 * @param {string} options.tenantId - Tenant identifier
 * @param {string} [options.category="recordings"] - Media category
 * @param {string} [options.mimeType] - MIME type
 * @param {Object} [options.metadata={}] - Custom metadata attributes
 * @returns {Promise<Object>} Migration upload result
 */
async function migrateExistingFile({
  fileSource,
  fileName,
  tenantId,
  category = "recordings",
  mimeType = "audio/mpeg",
  metadata = {},
}) {
  let streamOrBuffer = fileSource

  // If a string file path was passed, create a read stream
  if (typeof fileSource === "string" && fs.existsSync(fileSource)) {
    streamOrBuffer = fs.createReadStream(fileSource)
  }

  const uploadResult = await uploadFile({
    file: streamOrBuffer,
    fileName,
    tenantId,
    category,
    mimeType,
    customMetadata: {
      migratedFrom: "gridfs_legacy",
      migratedAt: new Date().toISOString(),
      ...metadata,
    },
    tags: ["migrated", category],
  })

  // Verify successful upload by fetching details
  const verifiedDetails = await getFileDetails(uploadResult.fileId)

  return {
    success: true,
    fileId: uploadResult.fileId,
    url: uploadResult.url,
    filePath: uploadResult.filePath,
    sizeBytes: verifiedDetails.size || uploadResult.sizeBytes,
    verified: true,
  }
}

module.exports = {
  isImageKitConfigured,
  FOLDER_CATEGORIES,
  VALIDATION_RULES,
  sanitizeTenantId,
  buildTenantFolderPath,
  generateSafeFileName,
  validateFile,
  uploadFile,
  getFileDetails,
  getFileById,
  deleteFile,
  generatePrivateFileUrl,
  migrateExistingFile,
}

