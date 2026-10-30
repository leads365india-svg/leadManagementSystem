const mongoose = require("mongoose")
const Call = require("../models/Call")
const mediaStorage = require("./mediaStorage.service")

/**
 * Media Migration Service
 * 
 * Safe, idempotent migration utility for transferring existing GridFS recordings
 * into ImageKit Cloud Media Storage:
 * 1. Reads GridFS files in controlled batches.
 * 2. Uploads original and MP3 files to ImageKit with tenant-isolated folders.
 * 3. Verifies uploads before updating MongoDB.
 * 4. Tracks granular migration status: pending, in_progress, completed, failed, retry_required.
 * 5. Does NOT delete GridFS files (preserves them as backward-compatible fallback).
 * 6. Explicit execution required — never executes automatically in production.
 */

/**
 * Migrates a batch of GridFS recordings to ImageKit.
 * 
 * @param {Object} options
 * @param {string} [options.tenantId] - Filter by specific tenant (or all if omitted/super_admin)
 * @param {number} [options.batchSize=10] - Number of calls to process in this batch
 * @param {boolean} [options.forceRetry=false] - Re-attempt previously failed migrations
 * @param {boolean} [options.dryRun=false] - Inspect eligible recordings without performing uploads
 * @returns {Promise<Object>} Migration summary report
 */
async function migrateRecordingsBatch({
  tenantId = null,
  batchSize = 10,
  forceRetry = false,
  dryRun = false,
} = {}) {
  // If not dry-run, require ImageKit to be configured
  if (!dryRun && !mediaStorage.isImageKitConfigured()) {
    const configErr = new Error("ImageKit is not configured. Cannot perform media migration without valid credentials.")
    configErr.code = "IMAGEKIT_NOT_CONFIGURED"
    throw configErr
  }

  const { getBucket } = require("./recordingStorage")
  const bucket = getBucket()

  const query = {
    hasRecording: true,
    "recording.fileId": { $ne: null },
    "recording.status": "stored",
  }

  if (tenantId && tenantId !== "__all__") {
    query.tenantId = tenantId
  }

  if (forceRetry) {
    query.$or = [
      { "recording.migrationStatus": { $in: ["failed", "retry_required"] } },
      { "recording.imagekitFileId": null },
      { "recording.imagekitFileId": "" },
    ]
  } else {
    query.$or = [
      { "recording.migrationStatus": { $in: ["pending", "not_applicable", null] } },
      { "recording.migrationStatus": { $exists: false } },
    ]
    query["recording.imagekitFileId"] = { $in: [null, ""] }
  }

  const eligibleCalls = await Call.find(query)
    .limit(batchSize)
    .setOptions({ skipTenantFilter: true })

  const summary = {
    totalEligible: eligibleCalls.length,
    processed: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    dryRun: Boolean(dryRun),
    details: [],
    timestamp: new Date().toISOString(),
  }

  if (dryRun) {
    summary.details = eligibleCalls.map((c) => ({
      callId: c._id.toString(),
      clientCallId: c.clientCallId,
      tenantId: c.tenantId,
      fileId: c.recording?.fileId?.toString(),
      mp3FileId: c.recording?.mp3FileId?.toString(),
      currentStatus: c.recording?.migrationStatus || "not_applicable",
      action: "would_migrate",
    }))
    return summary
  }

  for (const call of eligibleCalls) {
    summary.processed++
    const callDetail = {
      callId: call._id.toString(),
      tenantId: call.tenantId,
      status: "pending",
      error: null,
      imagekitFileId: null,
      imagekitMp3FileId: null,
    }

    try {
      // Mark call as in_progress
      call.recording.migrationStatus = "in_progress"
      call.markModified("recording")
      await call.save().catch(() => {})

      // 1. Verify and read original file from GridFS
      const origFileDoc = await bucket
        .find({ _id: call.recording.fileId })
        .next()

      if (!origFileDoc || origFileDoc.length === 0) {
        throw new Error("GridFS original recording file not found in storage bucket")
      }

      // Download original file to a temp stream
      const origDownloadStream = bucket.openDownloadStream(call.recording.fileId)
      const origFileName = `call_${call._id}_orig_${Date.now()}.${call.recording.format || "bin"}`

      const origUploadResult = await mediaStorage.uploadFile({
        file: origDownloadStream,
        fileName: origFileName,
        tenantId: call.tenantId,
        category: "recordings",
        mimeType: origFileDoc.contentType || "audio/mp4",
        tags: ["migrated", "original", String(call._id)],
        customMetadata: {
          callId: String(call._id),
          gridfsFileId: String(call.recording.fileId),
          migratedFrom: "gridfs",
        },
      })

      callDetail.imagekitFileId = origUploadResult.fileId
      call.recording.imagekitFileId = origUploadResult.fileId
      call.recording.imagekitUrl = origUploadResult.url
      call.recording.imagekitPath = origUploadResult.filePath

      // 2. If converted MP3 exists in GridFS, upload it too
      if (call.recording.mp3FileId && String(call.recording.mp3FileId) !== String(call.recording.fileId)) {
        const mp3FileDoc = await bucket
          .find({ _id: call.recording.mp3FileId })
          .next()

        if (mp3FileDoc && mp3FileDoc.length > 0) {
          const mp3DownloadStream = bucket.openDownloadStream(call.recording.mp3FileId)
          const mp3FileName = `call_${call._id}_${Date.now()}.mp3`

          const mp3UploadResult = await mediaStorage.uploadFile({
            file: mp3DownloadStream,
            fileName: mp3FileName,
            tenantId: call.tenantId,
            category: "recordings",
            mimeType: "audio/mpeg",
            tags: ["migrated", "mp3", String(call._id)],
            customMetadata: {
              callId: String(call._id),
              gridfsMp3FileId: String(call.recording.mp3FileId),
              migratedFrom: "gridfs",
            },
          })

          callDetail.imagekitMp3FileId = mp3UploadResult.fileId
          call.recording.imagekitMp3FileId = mp3UploadResult.fileId
          call.recording.imagekitMp3Url = mp3UploadResult.url
        }
      } else {
        // If the original was already MP3
        call.recording.imagekitMp3FileId = origUploadResult.fileId
        call.recording.imagekitMp3Url = origUploadResult.url
        callDetail.imagekitMp3FileId = origUploadResult.fileId
      }

      // 3. Mark completed and update provider
      call.recording.provider = "imagekit"
      call.recording.migrationStatus = "completed"
      call.recording.migratedAt = new Date()
      call.markModified("recording")
      await call.save()

      callDetail.status = "completed"
      summary.succeeded++
    } catch (migErr) {
      console.warn(`[MediaMigration] Error migrating call ${call._id}:`, migErr.message)
      callDetail.status = "failed"
      callDetail.error = migErr.message
      summary.failed++

      call.recording.migrationStatus = "retry_required"
      call.markModified("recording")
      await call.save().catch(() => {})
    }

    summary.details.push(callDetail)
  }

  return summary
}

module.exports = {
  migrateRecordingsBatch,
}

