const mongoose = require("mongoose")
const tenantIsolationPlugin = require("../plugins/tenantIsolationPlugin")
const { normalizePhoneE164 } = require("../utils/phoneNormalizer")

/**
 * Call Model - Roadmap Phase 14: Call, Device & Recording Data Model
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
    agentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Agent ID is required"],
      index: true,
    },
    deviceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Device",
      default: null,
    },
    clientCallId: {
      type: String,
      default: null,
      trim: true,
    },
    direction: {
      type: String,
      enum: ["inbound", "outbound"],
      default: "outbound",
      required: true,
    },
    number: {
      type: String,
      required: [true, "Phone number is required"],
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
    duration: {
      type: Number,
      default: 0,
      min: 0,
      description: "Duration in seconds",
    },
    status: {
      type: String,
      enum: ["completed", "missed", "rejected", "busy", "failed"],
      default: "completed",
    },
    disposition: {
      type: String,
      default: "connected",
      trim: true,
    },
    notes: {
      type: String,
      default: "",
      maxlength: [2000, "Notes cannot exceed 2000 characters"],
      trim: true,
    },
    source: {
      type: String,
      enum: ["android_sync", "manual", "exotel", "twilio"],
      default: "manual",
    },
    recording: {
      type: recordingSubSchema,
      default: () => ({}),
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

// Pre-save hook: auto-normalize phone number if missing or updated
callSchema.pre("save", function (next) {
  if (this.number && (!this.phoneNormalized || this.isModified("number"))) {
    this.phoneNormalized = normalizePhoneE164(this.number, "+91")
  }
  next()
})

// Required Roadmap Indexes
callSchema.index({ tenantId: 1, leadId: 1, startedAt: -1 })
callSchema.index({ tenantId: 1, agentId: 1, startedAt: -1 })
callSchema.index({ tenantId: 1, "recording.status": 1 })
callSchema.index({ tenantId: 1, phoneNormalized: 1, startedAt: -1 })

// Enforce ambient multi-tenant isolation
callSchema.plugin(tenantIsolationPlugin, { tenantField: "tenantId" })

const Call = mongoose.models.Call || mongoose.model("Call", callSchema)

module.exports = Call
