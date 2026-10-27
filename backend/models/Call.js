const mongoose = require("mongoose")

const callSchema = new mongoose.Schema(
  {
    clientCallId: {
      type: String,
      required: [true, "clientCallId is required"],
      unique: true,
      index: true,
      trim: true,
    },
    leadId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Lead",
      required: false,
      default: null,
      index: true,
    },
    isUnlinked: {
      type: Boolean,
      default: false,
      index: true,
    },
    tenantId: {
      type: String,
      required: [true, "tenantId is required"],
      index: true,
    },
    agentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "agentId is required"],
      index: true,
    },
    agentName: {
      type: String,
      default: "",
    },
    phoneNumber: {
      type: String,
      required: [true, "phoneNumber is required"],
      trim: true,
    },
    callDirection: {
      type: String,
      enum: ["OUTGOING", "INCOMING", "MISSED", "REJECTED"],
      default: "OUTGOING",
      required: true,
    },
    startTimeMs: {
      type: Number,
      required: [true, "startTimeMs is required"],
      index: true,
    },
    durationSeconds: {
      type: Number,
      default: 0,
      min: 0,
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
    hasRecording: {
      type: Boolean,
      default: false,
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
  }
)

callSchema.index({ tenantId: 1, startTimeMs: -1 })
callSchema.index({ leadId: 1, startTimeMs: -1 })
callSchema.index({ agentId: 1, startTimeMs: -1 })

module.exports = mongoose.model("Call", callSchema)
