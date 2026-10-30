const mongoose = require("mongoose")
const tenantIsolationPlugin = require("../plugins/tenantIsolationPlugin")
const { normalizePhoneE164 } = require("../utils/phoneNormalizer")

/**
 * Call Model - Roadmap Phase 14 & Mobile Sync Call Model
 * 
 * Shared data structure for phone call tracking, telephony logging,
 * and audio recording metadata across manual and Android mobile syncs.
 */

const recordingSubSchema = new mongoose.Schema(
  {
    fileId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    sizeBytes: {
      type: Number,
      default: 0,
      min: 0,
    },
    sha256: {
      type: String,
      default: "",
      trim: true,
    },
    status: {
      type: String,
      enum: ["pending", "ready", "stored", "expired", "failed", "none", "skipped_dnr"],
      default: "pending",
      index: true,
    },
    expiresAt: {
      type: Date,
      default: null,
    },
    mp3FileId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    mp3SizeBytes: {
      type: Number,
      default: 0,
      min: 0,
    },
    mp3Sha256: {
      type: String,
      default: "",
      trim: true,
    },
    conversionStatus: {
      type: String,
      enum: ["not_needed", "pending", "processing", "completed", "failed"],
      default: "not_needed",
      index: true,
    },
    duration: {
      type: Number,
      default: 0,
      min: 0,
    },
    format: {
      type: String,
      default: "",
      trim: true,
    },
    codec: {
      type: String,
      default: "",
      trim: true,
    },
    provider: {
      type: String,
      enum: ["imagekit", "gridfs", "local"],
      default: "gridfs",
      index: true,
    },
    imagekitFileId: {
      type: String,
      default: null,
      trim: true,
    },
    imagekitUrl: {
      type: String,
      default: null,
      trim: true,
    },
    imagekitMp3FileId: {
      type: String,
      default: null,
      trim: true,
    },
    imagekitMp3Url: {
      type: String,
      default: null,
      trim: true,
    },
    imagekitPath: {
      type: String,
      default: null,
      trim: true,
    },
    migrationStatus: {
      type: String,
      enum: ["pending", "in_progress", "completed", "failed", "retry_required", "not_applicable"],
      default: "not_applicable",
      index: true,
    },
    migratedAt: {
      type: Date,
      default: null,
    },
  },
  { _id: false },
)

const callSchema = new mongoose.Schema(
  {
    tenantId: {
      type: String,
      required: [true, "Tenant ID is required"],
      index: true,
      trim: true,
    },
    leadId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Lead",
      default: null,
      index: true,
    },
    isUnlinked: {
      type: Boolean,
      default: false,
      index: true,
    },
    agentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Agent ID is required"],
      index: true,
    },
    agentName: {
      type: String,
      default: "",
    },
    deviceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Device",
      default: null,
    },
    clientCallId: {
      type: String,
      default: null,
      index: true,
      sparse: true,
      trim: true,
    },
    direction: {
      type: String,
      enum: ["inbound", "outbound", "INCOMING", "OUTGOING", "MISSED", "REJECTED"],
      default: "outbound",
    },
    callDirection: {
      type: String,
      enum: ["OUTGOING", "INCOMING", "MISSED", "REJECTED", "inbound", "outbound"],
      default: "OUTGOING",
    },
    number: {
      type: String,
      default: "",
      trim: true,
    },
    phoneNumber: {
      type: String,
      default: "",
      trim: true,
    },
    phoneNormalized: {
      type: String,
      trim: true,
      index: true,
    },
    startedAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    startTimeMs: {
      type: Number,
      default: () => Date.now(),
      index: true,
    },
    duration: {
      type: Number,
      default: 0,
      min: 0,
      description: "Duration in seconds",
    },
    durationSeconds: {
      type: Number,
      default: 0,
      min: 0,
    },
    status: {
      type: String,
      default: "completed",
    },
    disposition: {
      type: String,
      default: "connected",
      trim: true,
    },
    callOutcome: {
      type: String,
      default: "Connected",
      trim: true,
    },
    notes: {
      type: String,
      default: "",
      maxlength: [3000, "Notes cannot exceed 3000 characters"],
      trim: true,
    },
    nextFollowUpAt: {
      type: Number,
      default: null,
    },
    simId: {
      type: String,
      default: null,
      trim: true,
    },
    source: {
      type: String,
      enum: ["android_sync", "manual", "exotel", "twilio", "mobile"],
      default: "manual",
    },
    hasRecording: {
      type: Boolean,
      default: false,
    },
    recording: {
      type: recordingSubSchema,
      default: () => ({}),
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform: (_doc, ret) => {
        ret.id = ret._id
        delete ret._id
        delete ret.__v
        return ret
      },
    },
  },
)

function syncCallFields(doc) {
  // Sync phone number
  if (doc.phoneNumber && (!doc.number || doc.number === "")) {
    doc.number = doc.phoneNumber
  } else if (doc.number && (!doc.phoneNumber || doc.phoneNumber === "")) {
    doc.phoneNumber = doc.number
  }

  // Normalize phone number
  const rawNum = doc.number || doc.phoneNumber
  if (rawNum && (!doc.phoneNormalized || (typeof doc.isModified === "function" && (doc.isModified("number") || doc.isModified("phoneNumber"))))) {
    try {
      doc.phoneNormalized = normalizePhoneE164(rawNum, "+91")
    } catch (_) {
      doc.phoneNormalized = rawNum
    }
  }

  // Sync timestamp
  if (doc.startTimeMs && !doc.startedAt) {
    doc.startedAt = new Date(doc.startTimeMs)
  } else if (doc.startedAt && !doc.startTimeMs) {
    doc.startTimeMs = doc.startedAt.getTime()
  }

  // Sync duration
  if (doc.durationSeconds && (!doc.duration || doc.duration === 0)) {
    doc.duration = doc.durationSeconds
  } else if (doc.duration && (!doc.durationSeconds || doc.durationSeconds === 0)) {
    doc.durationSeconds = doc.duration
  }

  // Sync direction (mirrors inbound <-> INCOMING, outbound <-> OUTGOING)
  if (doc.callDirection) {
    const isIncoming = doc.callDirection.toLowerCase() === "incoming" || doc.callDirection.toLowerCase() === "inbound"
    doc.direction = isIncoming ? "inbound" : "outbound"
    doc.callDirection = isIncoming ? "INCOMING" : "OUTGOING"
  } else if (doc.direction) {
    const isIncoming = doc.direction.toLowerCase() === "inbound" || doc.direction.toLowerCase() === "incoming"
    doc.callDirection = isIncoming ? "INCOMING" : "OUTGOING"
    doc.direction = isIncoming ? "inbound" : "outbound"
  }

  // Sync outcome / disposition
  if (doc.callOutcome && doc.callOutcome !== "Connected") {
    doc.disposition = doc.callOutcome
  } else if (doc.disposition && doc.disposition !== "connected") {
    doc.callOutcome = doc.disposition
  } else if (doc.callOutcome && (!doc.disposition || doc.disposition === "")) {
    doc.disposition = doc.callOutcome
  } else if (doc.disposition && (!doc.callOutcome || doc.callOutcome === "")) {
    doc.callOutcome = doc.disposition
  }

  // Sync recording flag & status
  if (doc.hasRecording && doc.recording && doc.recording.status === "pending") {
    doc.recording.status = "ready"
  }
  if (doc.recording && (doc.recording.status === "stored" || doc.recording.status === "ready")) {
    doc.hasRecording = true
  }
}

callSchema.pre("validate", function () {
  syncCallFields(this)
})

callSchema.pre("save", function () {
  syncCallFields(this)
})

// Required Roadmap & Mobile Indexes
callSchema.index({ tenantId: 1, startTimeMs: -1 })
callSchema.index({ leadId: 1, startTimeMs: -1 })
callSchema.index({ agentId: 1, startTimeMs: -1 })
callSchema.index({ tenantId: 1, leadId: 1, startedAt: -1 })
callSchema.index({ tenantId: 1, agentId: 1, startedAt: -1 })
callSchema.index({ tenantId: 1, "recording.status": 1 })
callSchema.index({ tenantId: 1, phoneNormalized: 1, startedAt: -1 })

// Enforce ambient multi-tenant isolation
callSchema.plugin(tenantIsolationPlugin, { tenantField: "tenantId" })

const Call = mongoose.models.Call || mongoose.model("Call", callSchema)

module.exports = Call
