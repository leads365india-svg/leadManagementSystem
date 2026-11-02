const mongoose = require("mongoose")
const tenantIsolationPlugin = require("../plugins/tenantIsolationPlugin")

/**
 * AIManagerRecommendation Model - Phase 4: Manager Alert & Recommendation Center
 * 
 * Tracks high-priority actionable recommendations for sales managers:
 * - High-intent leads needing immediate touchpoints
 * - Explicit customer callback requests
 * - Repeated objections requiring management escalation or scripting updates
 * - Unresolved customer requirements
 * - At-risk leads with overdue follow-ups
 * - Approved topic coverage gaps
 * - Agent coaching opportunities
 * 
 * Enforces idempotency keys to prevent duplicate alert spam for the same underlying event.
 */
const aiManagerRecommendationSchema = new mongoose.Schema(
  {
    tenantId: {
      type: String,
      required: [true, "Tenant ID is required"],
      index: true,
      trim: true,
    },
    recommendationType: {
      type: String,
      enum: [
        "HIGH_INTENT_FOLLOWUP",
        "CALLBACK_REQUESTED",
        "REPEATED_OBJECTION",
        "UNRESOLVED_REQUIREMENT",
        "AT_RISK_OVERDUE",
        "TOPIC_COVERAGE_GAP",
        "AGENT_COACHING_REVIEW",
      ],
      required: true,
      index: true,
    },
    priority: {
      type: String,
      enum: ["URGENT", "HIGH", "MEDIUM", "LOW"],
      default: "MEDIUM",
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      required: true,
      trim: true,
    },
    suggestedAction: {
      type: String,
      required: true,
      trim: true,
    },
    leadId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Lead",
      default: null,
      index: true,
    },
    callId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Call",
      default: null,
      index: true,
    },
    agentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    topicId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AIKeywordTopic",
      default: null,
    },
    evidence: {
      quote: { type: String, default: "", trim: true },
      timestamp: { type: Number, default: null },
      context: { type: String, default: "", trim: true },
    },
    status: {
      type: String,
      enum: ["NEW", "VIEWED", "ACCEPTED", "DISMISSED", "RESOLVED"],
      default: "NEW",
      index: true,
    },
    idempotencyKey: {
      type: String,
      required: true,
      trim: true,
    },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    reviewedAt: {
      type: Date,
      default: null,
    },
    managerNotes: {
      type: String,
      default: "",
      trim: true,
    },
  },
  {
    timestamps: true,
  }
)

aiManagerRecommendationSchema.index({ tenantId: 1, idempotencyKey: 1 }, { unique: true })
aiManagerRecommendationSchema.index({ tenantId: 1, status: 1, priority: 1, createdAt: -1 })
aiManagerRecommendationSchema.index({ tenantId: 1, agentId: 1, createdAt: -1 })

aiManagerRecommendationSchema.plugin(tenantIsolationPlugin)

module.exports = mongoose.models.AIManagerRecommendation || mongoose.model("AIManagerRecommendation", aiManagerRecommendationSchema)
