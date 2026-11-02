const mongoose = require("mongoose")
const tenantIsolationPlugin = require("../plugins/tenantIsolationPlugin")

/**
 * AICoachingReview Model - Phase 4: Manager Coaching & Review Workflow
 * 
 * Captures formal manager-agent 1-on-1 coaching notes, acknowledged strengths,
 * agreed improvement commitments, and resolution of action items.
 * 
 * Strict Privacy & RBAC:
 * Manager notes are strictly isolated per tenant and access is restricted to
 * authorized managers/admins and the specific subject agent (read-only).
 */
const aiCoachingReviewSchema = new mongoose.Schema(
  {
    tenantId: {
      type: String,
      required: [true, "Tenant ID is required"],
      index: true,
      trim: true,
    },
    agentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Agent ID is required"],
      index: true,
    },
    managerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Manager ID is required"],
      index: true,
    },
    callId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Call",
      default: null,
      index: true,
    },
    scorecardId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AIAgentScorecard",
      default: null,
    },
    status: {
      type: String,
      enum: ["DRAFT", "DISCUSSED", "ACTION_COMPLETED"],
      default: "DRAFT",
      index: true,
    },
    managerNotes: {
      type: String,
      required: [true, "Manager coaching notes are required"],
      trim: true,
      maxlength: [5000, "Notes cannot exceed 5000 characters"],
    },
    strengthsAcknowledged: [
      {
        type: String,
        trim: true,
      },
    ],
    improvementCommitments: [
      {
        type: String,
        trim: true,
      },
    ],
    agreedActionItems: [
      {
        type: String,
        trim: true,
      },
    ],
    discussedAt: {
      type: Date,
      default: null,
    },
    completedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
)

aiCoachingReviewSchema.index({ tenantId: 1, agentId: 1, createdAt: -1 })
aiCoachingReviewSchema.index({ tenantId: 1, managerId: 1, createdAt: -1 })

aiCoachingReviewSchema.plugin(tenantIsolationPlugin)

module.exports = mongoose.models.AICoachingReview || mongoose.model("AICoachingReview", aiCoachingReviewSchema)
