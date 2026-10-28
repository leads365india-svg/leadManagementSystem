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
  if (!mongoose.Types.ObjectId.isValid(callId)) {
    const err = new Error("Invalid Call ID format")
    err.statusCode = 400
    throw err
  }

  // 1. Fetch Call ensuring tenant isolation
  const call = await Call.findOne({ _id: callId, tenantId })
    .setOptions({ skipTenantFilter: true })

  if (!call) {
    const err = new Error("Call not found or does not belong to this tenant")
    err.statusCode = 404
    throw err
  }

  // 2. Ownership check: agent must own the call unless admin
  const isPrivileged = user && (user.role === "account_admin" || user.role === "super_admin")
  if (!isPrivileged && user && call.agentId.toString() !== user._id.toString()) {
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

        // Update Call document
        call.recording = {
          fileId: uploadStream.id,
          sizeBytes: bytesWritten,
          sha256: computedSha256,
          status: "stored",
          expiresAt,
        }
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
  if (!mongoose.Types.ObjectId.isValid(callId)) {
    return res.status(400).json({ success: false, error: "Invalid Call ID format" })
  }

  // 1. Fetch Call with tenant isolation
  const call = await Call.findOne({ _id: callId, tenantId })
    .setOptions({ skipTenantFilter: true })

  if (!call) {
    return res.status(404).json({ success: false, error: "Call record not found" })
  }

  // 2. RBAC & ownership check
  const isPrivileged = user && (user.role === "account_admin" || user.role === "super_admin")
  if (!isPrivileged && user) {
    const { checkDirectObjectAccess } = require("../utils/rbacScope")
    const access = await checkDirectObjectAccess(user, call, "calls", "view")
    if (!access.allowed && call.agentId.toString() !== user._id.toString()) {
      return res.status(403).json({ success: false, error: "Forbidden: You do not have permission to access this recording" })
    }
  }

  // 3. Expiration / Purged check
  if (!call.recording || call.recording.status === "expired" || call.recording.status === "purged") {
    return res.status(410).json({
      success: false,
      error: "Recording has expired and was purged per 30-day retention policy",
      status: "expired",
    })
  }

  // 4. Server-Side DNR Enforcement during playback
  if (call.leadId) {
    const lead = await Lead.findOne({ _id: call.leadId, tenantId }).setOptions({ skipTenantFilter: true }).lean()
    const privacyService = require("./privacyService")
    const privacyCheck = await privacyService.evaluateRecordingEligibility({
      tenantId,
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

  if (call.recording.status !== "stored" || !call.recording.fileId) {
    return res.status(404).json({
      success: false,
      error: "No audio recording available for this call",
      status: call.recording?.status || "none",
    })
  }

  const bucket = getBucket()
  const file = await bucket.find({ _id: call.recording.fileId, "metadata.tenantId": tenantId }).next()

  if (!file) {
    return res.status(404).json({ success: false, error: "Audio file not found in storage" })
  }

  const totalLength = file.length
  const mimeType = file.contentType || file.metadata?.mimeType || "audio/mp4"

  // Audit playback action
  if (audit && typeof audit.log === "function") {
    audit.log({
      tenantId,
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

  // HTTP Range Request handling for seeking
  if (rangeHeader) {
    const parts = rangeHeader.replace(/bytes=/, "").split("-")
    const start = parseInt(parts[0], 10)
    const end = parts[1] ? parseInt(parts[1], 10) : totalLength - 1

    if (start >= totalLength || end >= totalLength) {
      res.setHeader("Content-Range", `bytes */${totalLength}`)
      return res.status(416).send("Requested Range Not Satisfiable")
    }

    const chunksize = end - start + 1
    res.writeHead(206, {
      "Content-Range": `bytes ${start}-${end}/${totalLength}`,
      "Accept-Ranges": "bytes",
      "Content-Length": chunksize,
      "Content-Type": mimeType,
    })

    const downloadStream = bucket.openDownloadStream(file._id, {
      start,
      end: end + 1,
    })
    downloadStream.pipe(res)
  } else {
    res.writeHead(200, {
      "Content-Length": totalLength,
      "Content-Type": mimeType,
      "Accept-Ranges": "bytes",
    })

    const downloadStream = bucket.openDownloadStream(file._id)
    downloadStream.pipe(res)
  }
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

module.exports = {
  getBucket,
  ensureGridFSIndexes,
  validateUploadEligibility,
  streamUpload,
  streamPlayback,
  purgeExpiredRecordings,
  ALLOWED_MIME_TYPES,
  DEFAULT_RETENTION_DAYS,
  MAX_UPLOAD_BYTES,
}
