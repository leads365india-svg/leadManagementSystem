const mongoose = require("mongoose")
const crypto = require("crypto")
const Call = require("../models/Call")
const Lead = require("../models/Lead")
const audit = require("./auditService")

/**
 * Recording Storage Service - Roadmap Phase 16: Complete GridFS Recording Storage
 * 
 * Provides:
 * 1. Streamed GridFS upload for CRM lead calls only (no in-memory buffering).
 * 2. Strict tenant, agent ownership, and Do-Not-Record (DNR) checks.
 * 3. Range-request HTTP streaming (seeking support) with RBAC authorization.
 * 4. 30-day automated purge removing both GridFS files and chunks while preserving Call history.
 */

const ALLOWED_MIME_TYPES = new Set([
  "audio/mp4",
  "audio/m4a",
  "audio/x-m4a",
  "audio/aac",
  "audio/mpeg",
  "audio/mp3",
  "audio/amr",
  "audio/wav",
  "audio/x-wav",
  "audio/3gpp",
  "audio/3gp",
])

const DEFAULT_RETENTION_DAYS = parseInt(process.env.RECORDING_RETENTION_DAYS, 10) || 30
const MAX_UPLOAD_BYTES = 52428800 // 50 MB

let bucketInstance = null

/**
 * Returns or initializes the GridFSBucket for recordings.
 */
function getBucket() {
  if (!mongoose.connection || mongoose.connection.readyState !== 1) {
    throw new Error("MongoDB connection is not ready for GridFS operations")
  }
  if (!bucketInstance || bucketInstance.s.db !== mongoose.connection.db) {
    bucketInstance = new mongoose.mongo.GridFSBucket(mongoose.connection.db, {
      bucketName: "recordings",
    })
  }
  return bucketInstance
}

/**
 * Ensures indexes on the recordings.files collection.
 */
async function ensureGridFSIndexes() {
  try {
    const db = mongoose.connection.db
    if (!db) return
    const filesCollection = db.collection("recordings.files")
    await filesCollection.createIndex({ "metadata.tenantId": 1, "metadata.callId": 1 })
    await filesCollection.createIndex({ "metadata.tenantId": 1, "metadata.leadId": 1 })
    await filesCollection.createIndex({ "metadata.expiresAt": 1 })
    await filesCollection.createIndex({ "metadata.sha256": 1 })
  } catch (err) {
    console.warn("[GridFS] Index initialization notice:", err.message)
  }
}

/**
 * Validates whether a call is eligible for recording storage.
 */
async function validateUploadEligibility({ callId, tenantId, user, allowUnmatchedReview = false }) {
  if (!callId) {
    const err = new Error("Call ID is required")
    err.statusCode = 400
    throw err
  }

  const trimmedCallId = (callId || "").toString().trim()
  const isObjectId = mongoose.Types.ObjectId.isValid(trimmedCallId)

  // 1. Fetch Call ensuring tenant isolation (support clientCallId UUID or _id)
  const callQuery = {
    tenantId,
    $or: [
      { clientCallId: trimmedCallId },
      ...(isObjectId ? [{ _id: trimmedCallId }] : [])
    ]
  }
  const call = await Call.findOne(callQuery)
    .setOptions({ skipTenantFilter: true })

  if (!call) {
    const err = new Error("Call not found or does not belong to this tenant")
    err.statusCode = 404
    throw err
  }

  // 2. Ownership check: agent must own the call unless admin
  const isPrivileged = user && (user.role === "account_admin" || user.role === "super_admin")
  const currentUserId = (user?._id || user?.id || "").toString()
  const isCallAgent = call.agentId && currentUserId && (call.agentId.toString() === currentUserId)
  if (!isPrivileged && user && !isCallAgent) {
    const err = new Error("Forbidden: You can only upload recordings for your own calls")
    err.statusCode = 403
    throw err
  }

  // 3. Must be linked to a CRM Lead (No personal or unlinked calls unless staged in manual review queue)
  if ((!call.leadId && !allowUnmatchedReview) || call.isPersonal) {
    const err = new Error("Recordings are permitted only for verified CRM leads. Personal calls are rejected.")
    err.statusCode = 403
    err.code = "NON_LEAD_RECORDING_REJECTED"
    throw err
  }

  // 4. Evaluate DNR and Consent eligibility via PrivacyService
  let lead = null
  if (call.leadId) {
    lead = await Lead.findOne({ _id: call.leadId, tenantId })
      .setOptions({ skipTenantFilter: true })
      .lean()
  }

  const privacyService = require("./privacyService")
  const privacyCheck = await privacyService.evaluateRecordingEligibility({
    tenantId,
    lead,
    phoneNumber: call.number,
  })

  if (!privacyCheck.allowed) {
    call.recording = call.recording || {}
    call.recording.status = "skipped_dnr"
    await call.save()

    const err = new Error(privacyCheck.message || "Recording rejected: Lead has Do-Not-Record (DNR) enabled")
    err.statusCode = 403
    err.code = privacyCheck.reason || "RECORDING_FORBIDDEN_DNR"
    throw err
  }

  return { call, lead }
}

/**
 * Streams audio upload directly into GridFS without in-memory buffering.
 * 
 * @param {Object} options
 * @param {string} options.callId
 * @param {string} options.tenantId
 * @param {Object} options.user
 * @param {ReadableStream} options.readStream
 * @param {string} options.mimeType
 * @param {string} [options.filename]
 * @param {number} [options.contentLength]
 * @param {string} [options.expectedSha256]
 * @param {number} [options.retentionDays]
 * @param {boolean} [options.allowUnmatchedReview]
 */
async function streamUpload({
  callId,
  tenantId,
  user,
  readStream,
  mimeType = "audio/mp4",
  filename = null,
  contentLength = 0,
  expectedSha256 = null,
  retentionDays = DEFAULT_RETENTION_DAYS,
  allowUnmatchedReview = false,
}) {
  // Validate eligibility before reading any audio stream
  const { call, lead } = await validateUploadEligibility({ callId, tenantId, user, allowUnmatchedReview })

  // Clean and validate mimeType
  const cleanMime = (mimeType || "audio/mp4").split(";")[0].trim().toLowerCase()
  if (!ALLOWED_MIME_TYPES.has(cleanMime)) {
    const err = new Error(`Unsupported audio format: ${cleanMime}. Allowed formats: MP4, M4A, AAC, MP3, AMR, WAV, 3GP`)
    err.statusCode = 415
    throw err
  }

  if (contentLength && contentLength > MAX_UPLOAD_BYTES) {
    const err = new Error(`Recording exceeds maximum upload limit of ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB`)
    err.statusCode = 413
    throw err
  }

  // Idempotency: If this call already has a stored recording, return existing without duplication
  if (call.recording && call.recording.status === "stored" && call.recording.fileId) {
    const bucket = getBucket()
    const existingFile = await bucket.find({ _id: call.recording.fileId, "metadata.tenantId": tenantId }).next()
    if (existingFile) {
      return {
        success: true,
        message: "Recording already uploaded (idempotent submission)",
        fileId: existingFile._id,
        sizeBytes: existingFile.length,
        sha256: existingFile.metadata?.sha256 || call.recording.sha256,
        status: "stored",
        expiresAt: existingFile.metadata?.expiresAt || call.recording.expiresAt,
        isDuplicate: true,
      }
    }
  }

  const bucket = getBucket()
  await ensureGridFSIndexes()

  const safeFilename = filename || `call_${call._id}_${Date.now()}.m4a`
  const expiresAt = new Date(Date.now() + retentionDays * 24 * 60 * 60 * 1000)

  // Open upload stream to GridFS
  const uploadStream = bucket.openUploadStream(safeFilename, {
    contentType: cleanMime,
    metadata: {
      tenantId,
      callId: call._id,
      leadId: call.leadId,
      agentId: call.agentId,
      mimeType: cleanMime,
      retentionDays,
      expiresAt,
      uploadedBy: user?._id || call.agentId,
    },
  })

  const hash = crypto.createHash("sha256")
  let bytesWritten = 0

  return new Promise((resolve, reject) => {
    let aborted = false

    const cleanupAndReject = async (err) => {
      if (aborted) return
      aborted = true
      try {
        uploadStream.destroy()
        await bucket.delete(uploadStream.id).catch(() => {})
      } catch (_) {}
      reject(err)
    }

    readStream.on("data", (chunk) => {
      if (aborted) return
      bytesWritten += chunk.length
      if (bytesWritten > MAX_UPLOAD_BYTES) {
        const err = new Error(`Upload aborted: File exceeded ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB limit`)
        err.statusCode = 413
        return cleanupAndReject(err)
      }
      hash.update(chunk)
    })

    readStream.on("error", (err) => {
      cleanupAndReject(err)
    })

    uploadStream.on("error", (err) => {
      cleanupAndReject(err)
    })

    uploadStream.on("finish", async () => {
      if (aborted) return
      try {
        const computedSha256 = hash.digest("hex")

        // Verify SHA-256 integrity if client provided header
        if (expectedSha256 && expectedSha256.trim().toLowerCase() !== computedSha256.toLowerCase()) {
          const err = new Error("SHA-256 integrity mismatch. File was corrupted during transmission.")
          err.statusCode = 400
          return cleanupAndReject(err)
        }

        // Update file metadata with computed SHA-256
        const db = mongoose.connection.db
        await db.collection("recordings.files").updateOne(
          { _id: uploadStream.id },
          { $set: { "metadata.sha256": computedSha256, "metadata.bytes": bytesWritten } }
        )

        // Update Call document with canonical recording reference and compatible metadata
        call.hasRecording = true
        call.recording = {
          fileId: uploadStream.id,
          sizeBytes: bytesWritten,
          sha256: computedSha256,
          status: "stored",
          expiresAt,
        }
        call.metadata = call.metadata || {}
        call.metadata.recordingUrl = `/api/calls/${call._id}/recording`
        call.metadata.recordingSha256 = computedSha256
        call.metadata.recordingSizeBytes = bytesWritten
        call.metadata.recordingMimeType = cleanMime
        call.metadata.recordingUploadedAt = Date.now()
        call.markModified("metadata")
        call.markModified("recording")
        await call.save()

        // Audit log recording upload
        if (audit && typeof audit.log === "function") {
          audit.log({
            tenantId,
            action: "recording.upload",
            category: "recordings",
            entity: "Call",
            entityId: call._id,
            summary: `Uploaded call recording (${bytesWritten} bytes)`,
            actor: user || { _id: call.agentId, name: "Mobile Agent", role: "agent" },
            target: { type: "Call", id: call._id },
            details: {
              fileId: uploadStream.id,
              bytes: bytesWritten,
              sha256: computedSha256,
              leadId: call.leadId,
              expiresAt,
            },
          }).catch(() => {})
        }

        resolve({
          success: true,
          message: "Recording uploaded and stored successfully",
          fileId: uploadStream.id,
          sizeBytes: bytesWritten,
          sha256: computedSha256,
          status: "stored",
          expiresAt,
          isDuplicate: false,
        })
      } catch (err) {
        cleanupAndReject(err)
      }
    })

    readStream.pipe(uploadStream)
  })
}

/**
 * Handles secure streaming playback from GridFS with HTTP Range support.
 */
async function streamPlayback({ callId, tenantId, user, rangeHeader, res }) {
  if (!callId) {
    return res.status(400).json({ success: false, error: "Call ID parameter is required" })
  }

  const trimmedCallId = (callId || "").toString().trim()
  const isObjectId = mongoose.Types.ObjectId.isValid(trimmedCallId)

  // 1. Fetch Call with tenant isolation (support clientCallId UUID or _id)
  const isSuperAdmin = user && user.role === "super_admin"
  const callQuery = {
    $or: [
      { clientCallId: trimmedCallId },
      ...(isObjectId ? [{ _id: trimmedCallId }] : [])
    ]
  }
  if (!isSuperAdmin) {
    callQuery.tenantId = tenantId
  }

  const call = await Call.findOne(callQuery)
    .setOptions({ skipTenantFilter: true })

  if (!call) {
    return res.status(404).json({
      success: false,
      error: "Call record not found",
      code: "CALL_NOT_FOUND",
    })
  }

  const effectiveTenantId = isSuperAdmin ? (call.tenantId || tenantId) : tenantId

  // 2. RBAC & ownership check
  const isPrivileged = user && (user.role === "account_admin" || user.role === "super_admin")
  const currentUserId = (user?._id || user?.id || "").toString()
  const isCallAgent = call.agentId && currentUserId && (call.agentId.toString() === currentUserId)
  if (!isPrivileged && user && !isCallAgent) {
    const { checkDirectObjectAccess } = require("../utils/rbacScope")
    const access = await checkDirectObjectAccess(user, call, "calls", "view")
    if (!access.allowed) {
      return res.status(403).json({
        success: false,
        error: "Forbidden: You do not have permission to access this recording",
        code: "FORBIDDEN_RECORDING_ACCESS",
      })
    }
  }

  // 3. Expiration / Purged check
  if (call.recording && (call.recording.status === "expired" || call.recording.status === "purged")) {
    return res.status(410).json({
      success: false,
      error: "Recording has expired and was purged per retention policy",
      code: "RECORDING_PURGED",
      status: "expired",
    })
  }

  // 4. Server-Side DNR Enforcement during playback
  if (call.leadId) {
    const lead = await Lead.findOne({ _id: call.leadId, tenantId: effectiveTenantId }).setOptions({ skipTenantFilter: true }).lean()
    const privacyService = require("./privacyService")
    const privacyCheck = await privacyService.evaluateRecordingEligibility({
      tenantId: effectiveTenantId,
      lead,
      phoneNumber: call.number,
    })
    if (!privacyCheck.allowed && privacyCheck.reason?.startsWith("RECORDING_FORBIDDEN_DNR")) {
      return res.status(403).json({
        success: false,
        error: "Playback forbidden: This contact is restricted by Do-Not-Record compliance policy",
        code: privacyCheck.reason || "RECORDING_FORBIDDEN_DNR",
      })
    }
  }

  // 5. GridFS Primary Storage Playback
  let file = null
  let bucket = null
  if (call.recording?.fileId && call.recording.status === "stored") {
    try {
      bucket = getBucket()
      file = await bucket.find({ _id: call.recording.fileId, "metadata.tenantId": effectiveTenantId }).next()
    } catch (bucketErr) {
      console.warn("[RecordingStorage Playback] GridFS lookup error:", bucketErr.message)
    }
  }

  if (file && file.length > 0) {
    const totalLength = file.length
    const mimeType = file.contentType || file.metadata?.mimeType || "audio/m4a"

    // Audit playback action
    if (audit && typeof audit.log === "function") {
      audit.log({
        tenantId: effectiveTenantId,
        action: "recording.listen",
        category: "recordings",
        entity: "Call",
        entityId: call._id,
        summary: `Streamed playback for Call ${call._id}`,
        actor: user,
        target: { type: "Call", id: call._id },
        details: { fileId: file._id, duration: call.duration },
      }).catch(() => {})
    }

    if (rangeHeader) {
      const parts = rangeHeader.replace(/bytes=/, "").split("-")
      const start = parseInt(parts[0], 10)
      const end = parts[1] ? parseInt(parts[1], 10) : totalLength - 1

      if (isNaN(start) || start >= totalLength || (parts[1] && end >= totalLength) || start > end) {
        res.setHeader("Content-Range", `bytes */${totalLength}`)
        return res.status(416).send("Requested Range Not Satisfiable")
      }

      const chunksize = end - start + 1
      res.writeHead(206, {
        "Content-Range": `bytes ${start}-${end}/${totalLength}`,
        "Accept-Ranges": "bytes",
        "Content-Length": chunksize,
        "Content-Type": mimeType,
        "Cross-Origin-Resource-Policy": "cross-origin",
        "Cache-Control": "private, no-cache, no-store, must-revalidate",
      })

      const downloadStream = bucket.openDownloadStream(file._id, {
        start,
        end: end + 1,
      })
      return downloadStream.pipe(res)
    } else {
      res.writeHead(200, {
        "Content-Length": totalLength,
        "Content-Type": mimeType,
        "Accept-Ranges": "bytes",
        "Cross-Origin-Resource-Policy": "cross-origin",
        "Cache-Control": "private, no-cache, no-store, must-revalidate",
      })

      const downloadStream = bucket.openDownloadStream(file._id)
      return downloadStream.pipe(res)
    }
  }

  // 6. Backward Compatibility: Fallback to local filesystem if legacy file exists
  const rawPath = call.metadata?.recordingUrl || call.recordingUrl
  if (rawPath) {
    const path = require("path")
    const fs = require("fs")
    const safeTenantId = (effectiveTenantId || "default").replace(/[^a-zA-Z0-9_-]/g, "")
    const fileName = path.basename(rawPath)
    const baseUploadDir = path.resolve(__dirname, "../uploads/recordings")
    const resolvedPath = path.resolve(baseUploadDir, safeTenantId, fileName)

    // Security: Strict path traversal prevention ensuring path stays within uploads directory
    if (resolvedPath.startsWith(baseUploadDir) && fs.existsSync(resolvedPath)) {
      const stats = fs.statSync(resolvedPath)
      if (stats.size > 0) {
        const mobileController = require("../controllers/mobileController")
        if (typeof mobileController.streamAudioFile === "function") {
          return mobileController.streamAudioFile(
            { headers: { range: rangeHeader } },
            res,
            resolvedPath,
            call.metadata?.recordingMimeType
          )
        }
      }
    }
  }

  // 7. Precise diagnostic return when audio bytes are unavailable
  if (call.recording?.fileId && call.recording.status === "stored") {
    return res.status(404).json({
      success: false,
      error: "Recording audio file not found in persistent storage",
      code: "GRIDFS_FILE_MISSING",
      status: "stored",
      reason: "storage_file_missing",
    })
  }

  if (call.hasRecording || call.recording?.status === "ready" || rawPath) {
    return res.status(404).json({
      success: false,
      error: "Audio recording is no longer available (legacy storage expired)",
      code: "LEGACY_FILE_EXPIRED",
      status: call.recording?.status || "ready",
      reason: "legacy_ephemeral_storage_expired",
    })
  }

  return res.status(404).json({
    success: false,
    error: "No audio recording available for this call",
    code: "NO_RECORDING_ATTACHED",
    status: call.recording?.status || "none",
  })
}

/**
 * Purges recordings older than retentionDays (default 30 days).
 * Completely deletes both GridFS file documents AND their binary chunks,
 * while preserving the Call log, notes, and timeline.
 * 
 * @param {Object} options
 * @param {string} [options.tenantId] - Optional specific tenant or null for all
 * @param {number} [options.retentionDays] - Retention window in days
 */
async function purgeExpiredRecordings({ tenantId = null, retentionDays = DEFAULT_RETENTION_DAYS } = {}) {
  const bucket = getBucket()
  const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000)
  const now = new Date()

  // Find eligible expired calls
  const callQuery = {
    "recording.status": "stored",
    $or: [
      { "recording.expiresAt": { $lte: now } },
      { startedAt: { $lte: cutoffDate } },
      { createdAt: { $lte: cutoffDate } },
    ],
  }
  if (tenantId && tenantId !== "__all__" && tenantId !== "__system__") {
    callQuery.tenantId = tenantId
  }

  const expiredCalls = await Call.find(callQuery)
    .setOptions({ skipTenantFilter: true })
    .select("_id tenantId recording")

  let purgedCount = 0
  const purgedFileIds = []

  for (const call of expiredCalls) {
    const fileId = call.recording?.fileId
    if (fileId) {
      try {
        // bucket.delete deletes the file document in recordings.files AND all binary chunks in recordings.chunks
        await bucket.delete(fileId)
        purgedFileIds.push(fileId.toString())
      } catch (delErr) {
        // If file already deleted or missing from GridFS, proceed safely
        console.warn(`[Purge] GridFS delete notice for ${fileId}:`, delErr.message)
      }
    }

    // Preserve call record, update recording status to expired
    call.recording.status = "expired"
    call.recording.fileId = null
    await call.save()
    purgedCount++
  }

  // Also sweep any orphaned recordings.files in GridFS whose expiresAt has passed
  try {
    const db = mongoose.connection.db
    if (db) {
      const fileQuery = {
        $or: [
          { "metadata.expiresAt": { $lte: now } },
          { uploadDate: { $lte: cutoffDate } },
        ],
      }
      if (tenantId && tenantId !== "__all__" && tenantId !== "__system__") {
        fileQuery["metadata.tenantId"] = tenantId
      }

      const orphanedFiles = await db.collection("recordings.files").find(fileQuery).project({ _id: 1 }).toArray()
      for (const orphan of orphanedFiles) {
        try {
          await bucket.delete(orphan._id)
          purgedCount++
        } catch (_) {}
      }
    }
  } catch (orphanErr) {
    console.warn("[Purge] Orphaned file sweep notice:", orphanErr.message)
  }

  return {
    purgedCount,
    purgedFileIds,
    cutoffDate,
    retentionDays,
  }
}

/**
 * Verifies whether a legacy file is still present on local disk.
 * Returns diagnostic metadata without performing any database write or fabricating files.
 *
 * @param {Object} options
 * @param {string} options.callId - Target call ID
 * @param {string} options.tenantId - Tenant identifier
 */
async function checkLegacyRecordingAvailability({ callId, tenantId }) {
  if (!callId) {
    return { available: false, reason: "Call ID is required" }
  }
  const trimmedCallId = (callId || "").toString().trim()
  const isObjectId = mongoose.Types.ObjectId.isValid(trimmedCallId)
  const call = await Call.findOne({
    tenantId,
    $or: [
      { clientCallId: trimmedCallId },
      ...(isObjectId ? [{ _id: trimmedCallId }] : [])
    ]
  }).setOptions({ skipTenantFilter: true })

  if (!call) {
    return { available: false, reason: "Call record not found", code: "CALL_NOT_FOUND" }
  }

  const rawPath = call.metadata?.recordingUrl || call.recordingUrl
  if (!rawPath) {
    return { available: false, reason: "No legacy recording path recorded", code: "NO_RECORDING_ATTACHED" }
  }

  const path = require("path")
  const fs = require("fs")
  const safeTenantId = (tenantId || "default").replace(/[^a-zA-Z0-9_-]/g, "")
  const fileName = path.basename(rawPath)
  const baseUploadDir = path.resolve(__dirname, "../uploads/recordings")
  const resolvedPath = path.resolve(baseUploadDir, safeTenantId, fileName)

  if (!resolvedPath.startsWith(baseUploadDir) || !fs.existsSync(resolvedPath)) {
    return {
      available: false,
      reason: "Legacy recording file does not exist on disk (ephemeral storage expired)",
      code: "LEGACY_FILE_EXPIRED",
      callId: call._id.toString(),
      fileName,
    }
  }

  const stats = fs.statSync(resolvedPath)
  return {
    available: true,
    sizeBytes: stats.size,
    callId: call._id.toString(),
    fileName,
    filePath: resolvedPath,
  }
}

/**
 * Safely migrates an existing legacy recording file from local disk to GridFS.
 * Requires explicit authorized=true confirmation; will NOT fabricate or execute if file is missing.
 *
 * @param {Object} options
 * @param {string} options.callId - Target call ID
 * @param {string} options.tenantId - Tenant identifier
 * @param {Object} options.user - Actor performing migration
 * @param {boolean} [options.authorized=false] - Explicit admin authorization
 */
async function migrateLegacyFileToGridFS({ callId, tenantId, user, authorized = false }) {
  if (!authorized) {
    const authErr = new Error("Explicit authorization required to migrate legacy recording to GridFS")
    authErr.statusCode = 403
    throw authErr
  }

  const availability = await checkLegacyRecordingAvailability({ callId, tenantId })
  if (!availability.available) {
    const missingErr = new Error(`Cannot migrate legacy recording: ${availability.reason}`)
    missingErr.statusCode = 404
    missingErr.code = availability.code || "LEGACY_FILE_EXPIRED"
    throw missingErr
  }

  const fs = require("fs")
  const readStream = fs.createReadStream(availability.filePath)
  const result = await streamUpload({
    callId: availability.callId,
    tenantId,
    user,
    stream: readStream,
    filename: availability.fileName,
    mimeType: "audio/m4a",
  })

  return {
    migrated: true,
    callId: availability.callId,
    fileId: result.fileId,
    sizeBytes: result.sizeBytes,
  }
}

module.exports = {
  getBucket,
  ensureGridFSIndexes,
  validateUploadEligibility,
  streamUpload,
  streamPlayback,
  purgeExpiredRecordings,
  checkLegacyRecordingAvailability,
  migrateLegacyFileToGridFS,
  ALLOWED_MIME_TYPES,
  DEFAULT_RETENTION_DAYS,
  MAX_UPLOAD_BYTES,
}
