const mongoose = require("mongoose")
const tenantIsolationPlugin = require("../plugins/tenantIsolationPlugin")

/**
 * AILeadPriority Model - Phase 4: Lead Prioritization & Action Hub
 * 
 * Generates transparent, explainable lead prioritization signals based on:
 * - Real call outcomes & customer intent from Phase 3 analyses
 * - Product/service interest & recurring customer objections
 * - Pending vs overdue follow-up commitment trajectory
 * - Actual CRM status (Closed-Won, Closed-Lost, In-Pipeline)
 * 
 * Strict Grounding Rule:
 * AI recommendations are advisory and do NOT automatically mutate lead status,
 * pipeline stage, or assignment. Users must explicitly accept or dismiss recommendations.
 */
const priorityFactorSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    impact: {
      type: String,
      enum: ["POSITIVE", "NEUTRAL", "NEGATIVE"],
      default: "POSITIVE",
    },
    evidenceQuote: {
      type: String,
      default: "",
      trim: true,
    },
    callId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Call",
      default: null,
    },
  },
  { _id: false }
)

const aiLeadPrioritySchema = new mongoose.Schema(
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
      required: [true, "Lead ID is required"],
      index: true,
    },
    priorityCategory: {
      type: String,
      enum: [
        "HIGH_INTENT",
        "MEDIUM_INTENT",
        "LOW_INTENT",
        "NEEDS_FOLLOWUP",
        "AT_RISK",
        "INSUFFICIENT_DATA",
      ],
      required: true,
      default: "INSUFFICIENT_DATA",
      index: true,
    },
    score: {
      type: Number,
      min: 0,
      max: 100,
      default: 50,
    },
    reason: {
      type: String,
      required: true,
      trim: true,
    },
    factors: [priorityFactorSchema],
    recommendedAction: {
      type: String,
      required: true,
      trim: true,
    },
    status: {
      type: String,
      enum: ["ACTIVE", "ACCEPTED", "DISMISSED"],
      default: "ACTIVE",
      index: true,
    },
    userAction: {
      actionTaken: {
        type: String,
        default: null,
        trim: true,
      },
      actionedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        default: null,
      },
      actionedAt: {
        type: Date,
        default: null,
      },
      notes: {
        type: String,
        default: "",
        trim: true,
      },
    },
    lastEvaluatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
)

aiLeadPrioritySchema.index({ tenantId: 1, leadId: 1 }, { unique: true })
aiLeadPrioritySchema.index({ tenantId: 1, priorityCategory: 1, score: -1 })
aiLeadPrioritySchema.index({ tenantId: 1, status: 1 })

aiLeadPrioritySchema.plugin(tenantIsolationPlugin)

module.exports = mongoose.models.AILeadPriority || mongoose.model("AILeadPriority", aiLeadPrioritySchema)
