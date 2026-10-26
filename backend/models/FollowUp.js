const mongoose = require("mongoose")

const followUpSchema = new mongoose.Schema(
  {
    leadId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Lead",
      required: [true, "Lead is required for follow-up"],
      index: true,
    },
    tenantId: {
      type: String,
      required: [true, "Tenant ID is required"],
      index: true,
    },
    title: {
      type: String,
      required: [true, "Follow-up title or subject is required"],
      trim: true,
      maxlength: [150, "Title cannot exceed 150 characters"],
      default: "Client Touchpoint",
    },
    type: {
      type: String,
      enum: ["call", "email", "meeting", "task", "other"],
      default: "call",
      required: [true, "Follow-up type is required"],
      index: true,
    },
    scheduledAt: {
      type: Date,
      required: [true, "Scheduled date and time is required"],
      index: true,
    },
    status: {
      type: String,
      enum: ["pending", "completed", "cancelled"],
      default: "pending",
      required: true,
      index: true,
    },
    priority: {
      type: String,
      enum: ["low", "medium", "high"],
      default: "medium",
      index: true,
    },
    notes: {
      type: String,
      trim: true,
      default: "",
      maxlength: [3000, "Notes cannot exceed 3000 characters"],
    },
    assignedTo: {
      type: String,
      trim: true,
      default: "Unassigned",
    },
    assignedStaffId: {
      type: String,
      default: "unassigned",
    },
    completedAt: {
      type: Date,
      default: null,
    },
    completedBy: {
      type: String,
      default: null,
    },
    completionNotes: {
      type: String,
      trim: true,
      default: "",
      maxlength: [2000, "Completion notes cannot exceed 2000 characters"],
    },
    createdBy: {
      type: String,
      default: "User",
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

// Compound indexes for performant tenant-scoped timeline queries
followUpSchema.index({ tenantId: 1, scheduledAt: 1 })
followUpSchema.index({ tenantId: 1, status: 1, scheduledAt: 1 })
followUpSchema.index({ tenantId: 1, leadId: 1 })

module.exports = mongoose.model("FollowUp", followUpSchema)
