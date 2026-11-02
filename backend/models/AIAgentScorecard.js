const mongoose = require("mongoose")
const tenantIsolationPlugin = require("../plugins/tenantIsolationPlugin")

/**
 * AIAgentScorecard Model - Phase 4: Sales Performance & Coaching
 * 
 * Aggregates evidence-backed performance dimensions for sales agents:
 * - Requirement discovery
 * - Product knowledge & catalog communication
 * - Objection handling effectiveness
 * - Communication clarity
 * - Next-step & follow-up discipline
 * - Customer engagement
 * - Real CRM conversion rate (closed-won leads)
 * 
 * Enforces strict sample-size rules: if sampleSize < 3, marks sampleCoverage
 * as 'INSUFFICIENT_SAMPLE' to prevent arbitrary or ungrounded ratings.
 */
const aiAgentScorecardSchema = new mongoose.Schema(
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
    period: {
      type: String,
      enum: ["daily", "weekly", "monthly", "all_time"],
      default: "monthly",
      index: true,
    },
    periodStart: {
      type: Date,
      default: null,
    },
    periodEnd: {
      type: Date,
      default: null,
    },
    sampleSize: {
      type: Number,
      default: 0,
      min: 0,
    },
    sampleCoverage: {
      type: String,
      enum: ["SUFFICIENT", "INSUFFICIENT_SAMPLE"],
      default: "INSUFFICIENT_SAMPLE",
    },
    metrics: {
      requirementDiscoveryScore: {
        type: Number,
        min: 0,
        max: 100,
        default: null,
      },
      productKnowledgeScore: {
        type: Number,
        min: 0,
        max: 100,
        default: null,
      },
      objectionHandlingScore: {
        type: Number,
        min: 0,
        max: 100,
        default: null,
      },
      communicationClarityScore: {
        type: Number,
        min: 0,
        max: 100,
        default: null,
      },
      nextStepDisciplineScore: {
        type: Number,
        min: 0,
        max: 100,
        default: null,
      },
      customerEngagementScore: {
        type: Number,
        min: 0,
        max: 100,
        default: null,
      },
      overallScore: {
        type: Number,
        min: 0,
        max: 100,
        default: null,
      },
      conversionRate: {
        type: Number,
        min: 0,
        max: 100,
        default: null,
      },
    },
    observedStrengths: [
      {
        type: String,
        trim: true,
      },
    ],
    improvementAreas: [
      {
        type: String,
        trim: true,
      },
    ],
    recommendedTrainingTopics: [
      {
        type: String,
        trim: true,
      },
    ],
    lastCalculatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
)

// Compound indexes for tenant-isolated agent queries and period lookups
aiAgentScorecardSchema.index({ tenantId: 1, agentId: 1, period: 1 }, { unique: true })
aiAgentScorecardSchema.index({ tenantId: 1, "metrics.overallScore": -1 })

aiAgentScorecardSchema.plugin(tenantIsolationPlugin)

module.exports = mongoose.models.AIAgentScorecard || mongoose.model("AIAgentScorecard", aiAgentScorecardSchema)
