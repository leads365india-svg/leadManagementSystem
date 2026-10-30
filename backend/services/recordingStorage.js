const mongoose = require("mongoose")
const crypto = require("crypto")
const fs = require("fs")
const path = require("path")
const os = require("os")
const Call = require("../models/Call")
const Lead = require("../models/Lead")
const audit = require("./auditService")
const audioConverter = require("./audioConverter")

/**
 * Recording Storage Service - Roadmap Phase 16 & MP3 Conversion Pipeline
 * 
 * Provides:
 * 1. Streamed GridFS upload for CRM lead calls with original file preservation.
 * 2. Automated server-side conversion of unsupported formats (M4A, AMR, 3GP, WAV, AAC) to MP3 (128 kbps, 44.1 kHz).
 * 3. Accurate duration extraction via FFmpeg/probe.
 * 4. Strict tenant isolation, agent ownership, and Do-Not-Record (DNR) checks.
 * 5. Range-request HTTP streaming (seeking support) with 206 Partial Content and audio/mpeg MIME.
 * 6. Automated purge removing both original and converted GridFS files and chunks.
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
  "application/octet-stream",
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
 * Downloads audio file from GridFS to a temp file, validates it, and converts it to MP3 if necessary.
 */
async function processAndConvertGridFSRecording({
  call,
  bucket,
  originalFileId,
  tenantId,
  cleanMime,
  bytesWritten,
  computedSha256,
  expiresAt,
}) {
  const tempInputPath = path.join(os.tmpdir(), `orig_${call._id}_${Date.now()}.bin`)
  let tempOutputPath = null

  try {
    // 1. Download original file from GridFS to temp file
    const downloadStream = bucket.openDownloadStream(originalFileId)
    const writeStream = fs.createWriteStream(tempInputPath)

    await new Promise((resolve, reject) => {
      downloadStream.pipe(writeStream)
      writeStream.on("finish", resolve)
      writeStream.on("error", reject)
      downloadStream.on("error", reject)
    })

    // 2. Probe audio with FFmpeg
    const probe = await audioConverter.probeAudio(tempInputPath)

    if (!probe.isValid) {
      call.recording = call.recording || {}
      call.recording.fileId = originalFileId
      call.recording.sizeBytes = bytesWritten
      call.recording.sha256 = computedSha256
      call.recording.status = "stored"
      call.recording.expiresAt = expiresAt
      call.recording.conversionStatus = "failed"
      call.recording.codec = probe.codec || "unknown"
      call.recording.format = probe.format || "unknown"
      call.recording.duration = 0
      call.markModified("recording")
      await call.save()
      return { conversionStatus: "failed", duration: 0 }
    }

    const duration = probe.duration || 0
    call.recording = call.recording || {}
    call.recording.fileId = originalFileId
    call.recording.sizeBytes = bytesWritten
    call.recording.sha256 = computedSha256
    call.recording.status = "stored"
    call.recording.expiresAt = expiresAt
    call.recording.duration = duration
    call.recording.codec = probe.codec
    call.recording.format = probe.format

    if (duration > 0) {
      call.duration = Math.round(duration)
    }

    // 3. Determine if transcoding to MP3 is required
    if (probe.isMp3) {
      // Input is already a browser-compatible MP3 file
      call.recording.mp3FileId = originalFileId
      call.recording.mp3SizeBytes = bytesWritten
      call.recording.mp3Sha256 = computedSha256
      call.recording.conversionStatus = "not_needed"
      call.recording.format = "mp3"
      call.recording.codec = "mp3"
    } else {
      // Transcode unsupported format (M4A, AMR, 3GP, WAV, AAC) to MP3 (128 kbps, 44.1 kHz)
      const convResult = await audioConverter.convertToMp3(tempInputPath)
      tempOutputPath = convResult.outputPath

      const mp3Filename = `call_${call._id}_${Date.now()}.mp3`
      const mp3UploadStream = bucket.openUploadStream(mp3Filename, {
        contentType: "audio/mpeg",
        metadata: {
          tenantId,
          callId: call._id,
          leadId: call.leadId,
          agentId: call.agentId,
          mimeType: "audio/mpeg",
          isConverted: true,
          originalFileId,
          duration: convResult.duration,
          expiresAt,
        },
      })

      const mp3ReadStream = fs.createReadStream(tempOutputPath)
      await new Promise((resolve, reject) => {
        mp3ReadStream.pipe(mp3UploadStream)
        mp3UploadStream.on("finish", resolve)
        mp3UploadStream.on("error", reject)
        mp3ReadStream.on("error", reject)
      })

      call.recording.mp3FileId = mp3UploadStream.id
      call.recording.mp3SizeBytes = convResult.sizeBytes
      call.recording.mp3Sha256 = convResult.sha256
      call.recording.conversionStatus = "completed"
      call.recording.duration = convResult.duration || duration
      call.recording.format = "mp3"
      call.recording.codec = "mp3"
    }

    // 4. Update compatible metadata for frontend
    call.metadata = call.metadata || {}
    call.metadata.recordingUrl = `/api/calls/${call._id}/recording`
    call.metadata.recordingMp3Url = `/api/calls/${call._id}/recording?format=mp3`
    call.metadata.recordingMimeType = "audio/mpeg"
    call.metadata.recordingSha256 = call.recording.mp3Sha256 || computedSha256
    call.metadata.recordingSizeBytes = call.recording.mp3SizeBytes || bytesWritten
    call.metadata.recordingUploadedAt = Date.now()
    call.metadata.duration = call.recording.duration
    call.hasRecording = true

    call.markModified("metadata")
    call.markModified("recording")
    await call.save()

    return {
      conversionStatus: call.recording.conversionStatus,
      duration: call.recording.duration,
      mp3FileId: call.recording.mp3FileId,
      sizeBytes: call.recording.mp3SizeBytes || bytesWritten,
    }
  } finally {
    // Safe cleanup of all temporary files
    if (fs.existsSync(tempInputPath)) {
      try {
        fs.unlinkSync(tempInputPath)
      } catch (_) {}
    }
    if (tempOutputPath && fs.existsSync(tempOutputPath)) {
      try {
        fs.unlinkSync(tempOutputPath)
      } catch (_) {}
    }
  }
}

/**
 * Streams audio upload directly into GridFS without in-memory buffering.
 * Automatically runs server-side MP3 conversion and duration extraction.
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
  const { call } = await validateUploadEligibility({ callId, tenantId, user, allowUnmatchedReview })

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
        sizeBytes: call.recording.mp3SizeBytes || existingFile.length,
        sha256: call.recording.mp3Sha256 || existingFile.metadata?.sha256 || call.recording.sha256,
        status: "stored",
        duration: call.recording.duration || 0,
        expiresAt: existingFile.metadata?.expiresAt || call.recording.expiresAt,
        isDuplicate: true,
      }
    }
  }

  const bucket = getBucket()
  await ensureGridFSIndexes()

  const safeFilename = filename || `call_${call._id}_${Date.now()}.m4a`
  const expiresAt = new Date(Date.now() + retentionDays * 24 * 60 * 60 * 1000)

  // Open upload stream to GridFS for original audio
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

        // Update original file metadata in recordings.files
        const db = mongoose.connection.db
        await db.collection("recordings.files").updateOne(
          { _id: uploadStream.id },
          { $set: { "metadata.sha256": computedSha256, "metadata.bytes": bytesWritten } }
        )

        // Run MP3 conversion and duration extraction
        let conversionResult = null
        try {
          conversionResult = await processAndConvertGridFSRecording({
            call,
            bucket,
            originalFileId: uploadStream.id,
            tenantId,
            cleanMime,
            bytesWritten,
            computedSha256,
            expiresAt,
          })
        } catch (convErr) {
          console.warn("[RecordingStorage] Post-upload conversion warning:", convErr.message)
          // Fallback: Ensure basic stored status and metadata are set even if conversion failed
          call.hasRecording = true
          call.recording = {
            fileId: uploadStream.id,
            sizeBytes: bytesWritten,
            sha256: computedSha256,
            status: "stored",
            expiresAt,
            conversionStatus: "failed",
          }
          call.metadata = call.metadata || {}
          call.metadata.recordingUrl = `/api/calls/${call._id}/recording`
          call.metadata.recordingSha256 = computedSha256
          call.metadata.recordingSizeBytes = bytesWritten
          call.metadata.recordingMimeType = cleanMime
          call.metadata.recordingUploadedAt = Date.now()
          call.markModified("metadata")
          call.markModified("recording")
          await call.save().catch(() => {})
        }

        // Audit log recording upload
        if (audit && typeof audit.log === "function") {
          audit.log({
            tenantId,
            action: "recording.upload",
            category: "recordings",
            entity: "Call",
            entityId: call._id,
            summary: `Uploaded call recording (${bytesWritten} bytes, duration: ${call.recording?.duration || 0}s)`,
            actor: user || { _id: call.agentId, name: "Mobile Agent", role: "agent" },
            target: { type: "Call", id: call._id },
            details: {
              fileId: uploadStream.id,
              mp3FileId: call.recording?.mp3FileId,
              bytes: bytesWritten,
              sha256: computedSha256,
              duration: call.recording?.duration || 0,
              conversionStatus: call.recording?.conversionStatus,
              leadId: call.leadId,
              expiresAt,
            },
          }).catch(() => {})
        }

        resolve({
          success: true,
          message: "Recording uploaded and stored successfully",
          fileId: uploadStream.id,
          mp3FileId: call.recording?.mp3FileId || uploadStream.id,
          sizeBytes: call.recording?.mp3SizeBytes || bytesWritten,
          sha256: call.recording?.mp3Sha256 || computedSha256,
          duration: call.recording?.duration || 0,
          status: "stored",
          conversionStatus: call.recording?.conversionStatus || "completed",
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
 * Serves converted MP3 (audio/mpeg) by default for guaranteed cross-browser compatibility.
 */
async function streamPlayback({ callId, tenantId, user, rangeHeader, res, query = {} }) {
  if (!callId) {
    return res.status(400).json({ success: false, error: "Call ID parameter is required" })
  }

  const trimmedCallId = (callId || "").toString().trim()
  const isObjectId = mongoose.Types.ObjectId.isValid(trimmedCallId)

  // 1. Fetch Call with tenant isolation (support clientCallId UUID or _id)
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
    return res.status(404).json({ success: false, error: "Call record not found" })
  }

  // 2. RBAC & ownership check
  const isPrivileged = user && (user.role === "account_admin" || user.role === "super_admin")
  const currentUserId = (user?._id || user?.id || "").toString()
  const isCallAgent = call.agentId && currentUserId && (call.agentId.toString() === currentUserId)
  if (!isPrivileged && user && !isCallAgent) {
    const { checkDirectObjectAccess } = require("../utils/rbacScope")
    const access = await checkDirectObjectAccess(user, call, "calls", "view")
    if (!access.allowed) {
      return res.status(403).json({ success: false, error: "Forbidden: You do not have permission to access this recording" })
    }
  }

  // 3. Expiration / Purged check
  if (call.recording && (call.recording.status === "expired" || call.recording.status === "purged")) {
    return res.status(410).json({
      success: false,
      error: "Recording has expired and was purged per retention policy",
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

  const bucket = getBucket()
  let fileToStream = null
  let mimeType = "audio/mpeg"

  // 5. Select appropriate file (MP3 vs original source)
  const wantsOriginal = query && query.format === "original"

  if (wantsOriginal && call.recording?.fileId) {
    // Client explicitly asked for original unconverted format (e.g. download)
    try {
      fileToStream = await bucket.find({ _id: call.recording.fileId, "metadata.tenantId": tenantId }).next()
      if (fileToStream) {
        mimeType = fileToStream.contentType || fileToStream.metadata?.mimeType || "audio/m4a"
      }
    } catch (_) {}
  } else if (call.recording?.mp3FileId) {
    // Converted MP3 is available
    try {
      fileToStream = await bucket.find({ _id: call.recording.mp3FileId, "metadata.tenantId": tenantId }).next()
      mimeType = "audio/mpeg"
    } catch (_) {}
  }

  // If MP3 file not found or not yet converted, check original file in GridFS
  if (!fileToStream && call.recording?.fileId) {
    try {
      const origFile = await bucket.find({ _id: call.recording.fileId, "metadata.tenantId": tenantId }).next()
      if (origFile && origFile.length > 0) {
        const isAlreadyMp3 = origFile.contentType === "audio/mpeg" || origFile.contentType === "audio/mp3"
        if (isAlreadyMp3) {
          fileToStream = origFile
          mimeType = "audio/mpeg"
          call.recording.mp3FileId = origFile._id
          call.recording.conversionStatus = "not_needed"
          await call.save().catch(() => {})
        } else {
          // Perform on-the-fly conversion with de-duplication
          let convertedMp3 = null
          try {
            await audioConverter.runDeduplicatedConversion(`convert_${call._id}`, async () => {
              await processAndConvertGridFSRecording({
                call,
                bucket,
                originalFileId: origFile._id,
                tenantId,
                cleanMime: origFile.contentType || "audio/mp4",
                bytesWritten: origFile.length,
                computedSha256: origFile.metadata?.sha256 || call.recording.sha256,
                expiresAt: origFile.metadata?.expiresAt || call.recording.expiresAt,
              })
            })
            // Re-fetch converted MP3
            if (call.recording?.mp3FileId) {
              convertedMp3 = await bucket.find({ _id: call.recording.mp3FileId, "metadata.tenantId": tenantId }).next()
            }
          } catch (convErr) {
            console.warn(`[RecordingStorage] On-the-fly conversion notice for call ${call._id}:`, convErr.message)
          }

          if (convertedMp3) {
            fileToStream = convertedMp3
            mimeType = "audio/mpeg"
          } else {
            // Fall back to original file if conversion was not completed (e.g. test dummy payloads)
            fileToStream = origFile
            mimeType = origFile.contentType || origFile.metadata?.mimeType || "audio/mp4"
          }
        }
      }
    } catch (lookupErr) {
      console.warn("[RecordingStorage Playback] GridFS lookup error:", lookupErr.message)
    }
  }

  // 6. Serve from GridFS
  if (fileToStream && fileToStream.length > 0) {
    const totalLength = fileToStream.length
    const streamMime = mimeType || fileToStream.contentType || "audio/mpeg"

    // Audit playback action
    if (audit && typeof audit.log === "function") {
      audit.log({
        tenantId,
        action: "recording.listen",
        category: "recordings",
        entity: "Call",
        entityId: call._id,
        summary: `Streamed playback for Call ${call._id} (${streamMime})`,
        actor: user,
        target: { type: "Call", id: call._id },
        details: { fileId: fileToStream._id, duration: call.duration },
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
        "Content-Type": streamMime,
        "Cross-Origin-Resource-Policy": "cross-origin",
        "Cache-Control": "private, no-cache, no-store, must-revalidate",
      })

      const downloadStream = bucket.openDownloadStream(fileToStream._id, {
        start,
        end: end + 1,
      })
      return downloadStream.pipe(res)
    } else {
      res.writeHead(200, {
        "Content-Length": totalLength,
        "Content-Type": streamMime,
        "Accept-Ranges": "bytes",
        "Cross-Origin-Resource-Policy": "cross-origin",
        "Cache-Control": "private, no-cache, no-store, must-revalidate",
      })

      const downloadStream = bucket.openDownloadStream(fileToStream._id)
      return downloadStream.pipe(res)
    }
  }

  // 7. Backward Compatibility: Fallback to local filesystem if legacy file exists
  const rawPath = call.metadata?.recordingUrl || call.recordingUrl
  if (rawPath) {
    const safeTenantId = (tenantId || "default").replace(/[^a-zA-Z0-9_-]/g, "")
    const fileName = path.basename(rawPath)
    const baseUploadDir = path.resolve(__dirname, "../uploads/recordings")
    const resolvedPath = path.resolve(baseUploadDir, safeTenantId, fileName)

    if (resolvedPath.startsWith(baseUploadDir) && fs.existsSync(resolvedPath)) {
      const stats = fs.statSync(resolvedPath)
      if (stats.size > 0) {
        const mobileController = require("../controllers/mobileController")
        if (typeof mobileController.streamAudioFile === "function") {
          return mobileController.streamAudioFile(
            { headers: { range: rangeHeader } },
            res,
            resolvedPath,
            call.metadata?.recordingMimeType || "audio/mpeg"
          )
        }
      }
    }
  }

  return res.status(404).json({
    success: false,
    error: "No audio recording available for this call",
    status: call.recording?.status || "none",
  })
}

/**
 * Purges recordings older than retentionDays (default 30 days).
 * Completely deletes both original and converted GridFS files and chunks.
 */
async function purgeExpiredRecordings({ tenantId = null, retentionDays = DEFAULT_RETENTION_DAYS } = {}) {
  const bucket = getBucket()
  const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000)
  const now = new Date()

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
    const mp3FileId = call.recording?.mp3FileId

    if (fileId) {
      try {
        await bucket.delete(fileId)
        purgedFileIds.push(fileId.toString())
      } catch (err) {
        console.warn(`[Purge] Could not delete original GridFS file ${fileId}:`, err.message)
      }
    }

    if (mp3FileId && mp3FileId.toString() !== fileId?.toString()) {
      try {
        await bucket.delete(mp3FileId)
        purgedFileIds.push(mp3FileId.toString())
      } catch (err) {
        console.warn(`[Purge] Could not delete converted MP3 GridFS file ${mp3FileId}:`, err.message)
      }
    }

    call.hasRecording = false
    call.recording = {
      fileId: null,
      mp3FileId: null,
      sizeBytes: 0,
      mp3SizeBytes: 0,
      sha256: "",
      mp3Sha256: "",
      status: "expired",
      conversionStatus: "not_needed",
      expiresAt: null,
    }
    await call.save()
    purgedCount++
  }

  return {
    purgedCount,
    purgedFileIds,
    retentionDays,
    cutoffDate,
  }
}

module.exports = {
  getBucket,
  ensureGridFSIndexes,
  validateUploadEligibility,
  processAndConvertGridFSRecording,
  streamUpload,
  streamPlayback,
  purgeExpiredRecordings,
}
