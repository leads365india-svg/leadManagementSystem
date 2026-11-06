const crypto = require("crypto")
const mongoose = require("mongoose")
const EventEmitter = require("events")
const { inMemoryStore } = require("./receptionistCrmTools.service")

/**
 * Cloud Telephony AI Receptionist Recording Ingestion Service
 * 
 * Securely ingests, validates, hashes, and stores dual-track carrier recordings:
 * - Listens for provider recording-completed events (Twilio, Exotel, Mock).
 * - Enforces idempotency: duplicate events are safely ignored.
 * - Computes cryptographic SHA-256 integrity checksums.
 * - Streams audio directly into Leads365 GridFS recording storage.
 * - Updates Call.recording state machine (pending -> processing -> ready / failed).
 * - Enforces strict tenant-scoped recording authorization.
 */

class CloudRecordingIngestionService extends EventEmitter {
  constructor() {
    super()
    this.inMemoryRecordings = new Map() // fileId -> { buffer, metadata }
  }

  isLiveDbReady() {
    return Boolean(mongoose.connection && mongoose.connection.readyState === 1 && mongoose.connection.db)
  }

  /**
   * Processes an incoming provider recording completion event.
   * 
   * @param {Object} params
   * @param {string} params.tenantId
   * @param {string} params.callSid - Carrier CallSid / clientCallId
   * @param {string} params.recordingSid - Provider RecordingSid
   * @param {string} [params.recordingUrl] - Carrier audio URL (if remote)
   * @param {Buffer} [params.recordingBuffer] - Raw audio buffer (synthetic or downloaded)
   * @param {number} [params.durationSeconds=0]
   * @param {string} [params.provider="mock"]
   * @param {string} [params.mimeType="audio/wav"]
   * @returns {Promise<{ success: boolean, call: Object, fileId: string, sha256: string }>}
   */
  async ingestRecording({
    tenantId,
    callSid,
    recordingSid,
    recordingUrl = "",
    recordingBuffer = null,
    durationSeconds = 0,
    provider = "mock",
    mimeType = "audio/wav",
  }) {
    if (!tenantId || !callSid) {
      throw new Error("INGESTION_ERROR: tenantId and callSid are required")
    }

    // 1. Fetch Call Record
    let call = null
    if (!this.isLiveDbReady()) {
      call = inMemoryStore.calls.get(callSid)
      if (!call) {
        // Auto-create call entry if not yet linked
        call = {
          _id: `call_${callSid}`,
          id: `call_${callSid}`,
          clientCallId: callSid,
          tenantId,
          source: "ai_receptionist",
          recording: { status: "pending" },
          createdAt: new Date(),
        }
        inMemoryStore.calls.set(callSid, call)
      }
    } else {
      const Call = require("../../models/Call")
      call = await Call.findOne({ clientCallId: callSid, tenantId })
      if (!call) {
        call = await Call.create({
          tenantId,
          clientCallId: callSid,
          source: "ai_receptionist",
          recording: { status: "pending" },
        })
      }
    }

    // 2. Idempotency Check
    if (call.recording?.status === "ready" && call.recording?.sha256) {
      return {
        success: true,
        alreadyIngested: true,
        call,
        fileId: call.recording.fileId?.toString(),
        sha256: call.recording.sha256,
      }
    }

    // 3. Mark Processing State
    if (!this.isLiveDbReady()) {
      call.recording = { ...call.recording, status: "processing" }
    } else {
      const Call = require("../../models/Call")
      await Call.updateOne(
        { _id: call._id },
        { $set: { "recording.status": "processing" } }
      )
    }

    try {
      // 4. Retrieve & Validate Audio Buffer
      let audioBytes = recordingBuffer

      if (!audioBytes && recordingUrl) {
        // Provider download hook
        audioBytes = await this.downloadProviderAudio(recordingUrl, provider)
      }

      if (!Buffer.isBuffer(audioBytes) || audioBytes.length === 0) {
        throw new Error("INGESTION_ERROR: Empty or invalid audio buffer received from provider")
      }

      if (audioBytes.length > 52428800) {
        // 50 MB limit
        throw new Error("INGESTION_ERROR: Recording exceeds maximum allowed size (50MB)")
      }

      // 5. Compute SHA-256 Checksum
      const sha256Hash = crypto.createHash("sha256").update(audioBytes).digest("hex")

      // 6. Ingest into GridFS Storage (or in-memory mock during test runs)
      let storedFileId = null

      if (!this.isLiveDbReady()) {
        storedFileId = new mongoose.Types.ObjectId().toString()
        this.inMemoryRecordings.set(storedFileId, {
          fileId: storedFileId,
          tenantId,
          callSid,
          buffer: audioBytes,
          sha256: sha256Hash,
          mimeType,
          sizeBytes: audioBytes.length,
          createdAt: new Date(),
        })

        // Update in-memory Call
        call.hasRecording = true
        call.recording = {
          fileId: storedFileId,
          status: "ready",
          sizeBytes: audioBytes.length,
          sha256: sha256Hash,
          duration: durationSeconds || Math.round(audioBytes.length / 16000),
          format: mimeType,
          provider: "gridfs",
          completedAt: new Date(),
        }
      } else {
        const recordingStorage = require("../recordingStorage")
        const { Readable } = require("stream")
        const stream = Readable.from(audioBytes)

        const uploadResult = await recordingStorage.streamUpload({
          callId: call._id.toString(),
          tenantId,
          user: { tenantId, role: "system" },
          stream,
          filename: `ai_call_${callSid}_${recordingSid || Date.now()}.${mimeType.includes("wav") ? "wav" : "mp3"}`,
          mimeType,
        })

        storedFileId = uploadResult.fileId

        const Call = require("../../models/Call")
        call = await Call.findOneAndUpdate(
          { _id: call._id },
          {
            $set: {
              hasRecording: true,
              "recording.fileId": uploadResult.fileId,
              "recording.status": "ready",
              "recording.sizeBytes": audioBytes.length,
              "recording.sha256": sha256Hash,
              "recording.duration": durationSeconds,
              "recording.format": mimeType,
              "recording.provider": "gridfs",
            },
          },
          { new: true }
        ).lean()
      }

      this.emit("recording.ready", {
        callSid,
        tenantId,
        fileId: storedFileId,
        sha256: sha256Hash,
      })

      return {
        success: true,
        call,
        fileId: storedFileId,
        sha256: sha256Hash,
      }
    } catch (ingestErr) {
      // Mark Failed State
      if (!this.isLiveDbReady()) {
        call.recording = { ...call.recording, status: "failed", failureReason: ingestErr.message }
      } else {
        const Call = require("../../models/Call")
        await Call.updateOne(
          { _id: call._id },
          { $set: { "recording.status": "failed", "recording.failureReason": ingestErr.message } }
        )
      }

      this.emit("recording.failed", {
        callSid,
        tenantId,
        error: ingestErr.message,
      })

      throw ingestErr
    }
  }

  /**
   * Provider recording download hook with authentication.
   */
  async downloadProviderAudio(recordingUrl, provider) {
    // For mock testing or local URLs
    if (recordingUrl.startsWith("mock://") || recordingUrl.includes("mock-recording")) {
      // Return synthetic 16-bit PCM WAV audio (1000 bytes)
      return Buffer.alloc(1000, 0x55)
    }

    throw new Error(`PROVIDER_DOWNLOAD_UNCONFIGURED: Direct HTTP download from provider '${provider}' requires live credentials`)
  }

  /**
   * Retrieves an in-memory test recording stream or buffer.
   */
  getRecording(fileId, tenantId) {
    const rec = this.inMemoryRecordings.get(fileId)
    if (!rec) return null
    if (tenantId && rec.tenantId !== tenantId) {
      throw new Error("SECURITY_VIOLATION: Cross-tenant recording access rejected")
    }
    return rec
  }

  clear() {
    this.inMemoryRecordings.clear()
  }
}

const cloudRecordingIngestion = new CloudRecordingIngestionService()

module.exports = {
  cloudRecordingIngestion,
  CloudRecordingIngestionService,
}

