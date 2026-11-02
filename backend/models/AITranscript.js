const mongoose = require("mongoose")
const tenantIsolationPlugin = require("../plugins/tenantIsolationPlugin")

/**
 * AITranscript Model - Phase 3: AI Call Intelligence
 * 
 * Stores speech-to-text transcriptions for recorded CRM calls.
 * Supports:
 * - Segment-level timestamps and speaker identification (Agent, Customer, unknown)
 * - Hindi, English, and Hinglish multi-language conversation transcription
 * - Strict tenant isolation and compound indexes
 * - Versioning to preserve historical transcriptions on re-processing
 */

const transcriptSegmentSchema = new mongoose.Schema(
  {
    speaker: {
      type: String,
      default: "unknown",
      trim: true,
    },
    startTime: {
      type: Number,
      default: 0,
      min: 0,
    },
    endTime: {
      type: Number,
      default: 0,
      min: 0,
    },
    text: {
      type: String,
      required: true,
      trim: true,
    },
  },
  { _id: false }
)

const aiTranscriptSchema = new mongoose.Schema(
  {
    tenantId: {
      type: String,
      required: [true, "Tenant ID is required"],
      index: true,
      trim: true,
    },
    callId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Call",
      required: [true, "Call ID is required"],
      index: true,
    },
    recordingReference: {
      fileId: { type: mongoose.Schema.Types.Mixed, default: null },
      mp3FileId: { type: mongoose.Schema.Types.Mixed, default: null },
      sizeBytes: { type: Number, default: 0 },
      storageProvider: { type: String, default: "gridfs" },
    },
    recordingChecksum: {
      type: String,
      default: "",
      trim: true,
    },
    provider: {
      type: String,
      default: "gemini",
      trim: true,
    },
    model: {
      type: String,
      default: "gemini-3.8-flash",
      trim: true,
    },
    language: {
      type: String,
      default: "auto",
      trim: true,
    },
    transcriptText: {
      type: String,
      default: "",
    },
    segments: [transcriptSegmentSchema],
    duration: {
      type: Number,
      default: 0,
      min: 0,
    },
    status: {
      type: String,
      enum: ["PENDING", "PROCESSING", "COMPLETED", "FAILED"],
      default: "PENDING",
      index: true,
    },
    processingStartedAt: {
      type: Date,
      default: null,
    },
    completedAt: {
      type: Date,
      default: null,
    },
    errorCode: {
      type: String,
      default: null,
    },
    safeErrorMessage: {
      type: String,
      default: null,
    },
    version: {
      type: Number,
      default: 1,
      min: 1,
    },
  },
  {
    timestamps: true,
  }
)

// Compound Indexes for fast tenant-scoped queries & version ordering
aiTranscriptSchema.index({ tenantId: 1, callId: 1, version: -1 })
aiTranscriptSchema.index({ tenantId: 1, status: 1, createdAt: -1 })
aiTranscriptSchema.index({ tenantId: 1, createdAt: -1 })

// Text search on full transcript text (with language_override: "none" to allow arbitrary language codes like "hi-en")
aiTranscriptSchema.index({ transcriptText: "text" }, { default_language: "none", language_override: "none" })

// Apply strict tenant isolation plugin
aiTranscriptSchema.plugin(tenantIsolationPlugin)

const AITranscript = mongoose.model("AITranscript", aiTranscriptSchema)

module.exports = AITranscript
module.exports.AITranscript = AITranscript
