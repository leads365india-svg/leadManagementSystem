const mongoose = require("mongoose")
const tenantIsolationPlugin = require("../plugins/tenantIsolationPlugin")

/**
 * AICallAnalysis Model - Phase 3: AI Call Intelligence
 * 
 * Stores structured business intelligence extracted from recorded sales calls.
 * Includes:
 * - Executive summary and customer intent
 * - Customer needs, objections, product interest, and competitor mentions
 * - Conversation sentiment and call outcome classification
 * - Semantic matched approved topics (ONLY status === 'APPROVED')
 * - Grounded quotes and timestamps for all key moments
 * - Versioned reports to preserve historical analysis upon re-processing
 */

const keyMomentSchema = new mongoose.Schema(
  {
    timestamp: {
      type: Number,
      default: 0,
      min: 0,
    },
    description: {
      type: String,
      required: true,
      trim: true,
    },
    quote: {
      type: String,
      default: "",
      trim: true,
    },
  },
  { _id: false }
)

const matchedTopicSchema = new mongoose.Schema(
  {
    topicId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AIKeywordTopic",
      required: true,
    },
    topicName: {
      type: String,
      required: true,
      trim: true,
    },
    category: {
      type: String,
      default: "Sales & Inquiries",
      trim: true,
    },
    confidenceScore: {
      type: Number,
      default: 0.85,
      min: 0.0,
      max: 1.0,
    },
    matchedKeywords: [
      {
        type: String,
        trim: true,
      },
    ],
    evidenceQuote: {
      type: String,
      default: "",
      trim: true,
    },
    timestamp: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  { _id: false }
)

const aiCallAnalysisSchema = new mongoose.Schema(
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
    transcriptId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AITranscript",
      required: [true, "Transcript ID is required"],
      index: true,
    },
    analysisVersion: {
      type: Number,
      default: 1,
      min: 1,
    },
    status: {
      type: String,
      enum: ["PENDING", "PROCESSING", "COMPLETED", "FAILED"],
      default: "PENDING",
      index: true,
    },
    summary: {
      type: String,
      default: "",
      trim: true,
    },
    customerIntent: {
      type: String,
      default: "",
      trim: true,
    },
    customerNeeds: [
      {
        type: String,
        trim: true,
      },
    ],
    productInterests: [
      {
        type: String,
        trim: true,
      },
    ],
    objections: [
      {
        type: String,
        trim: true,
      },
    ],
    competitorMentions: [
      {
        type: String,
        trim: true,
      },
    ],
    sentiment: {
      type: String,
      enum: ["POSITIVE", "NEUTRAL", "NEGATIVE", "MIXED"],
      default: "NEUTRAL",
      index: true,
    },
    sentimentScore: {
      type: Number,
      default: 0.5,
      min: 0.0,
      max: 1.0,
    },
    callOutcome: {
      type: String,
      enum: [
        "INTERESTED",
        "NOT_INTERESTED",
        "FOLLOW_UP_REQUIRED",
        "CALL_BACK_LATER",
        "DEAL_CLOSED",
        "ESCALATED",
        "WRONG_NUMBER",
        "UNRESOLVED",
      ],
      default: "FOLLOW_UP_REQUIRED",
      index: true,
    },
    keyMoments: [keyMomentSchema],
    nextSteps: [
      {
        type: String,
        trim: true,
      },
    ],
    followUpRecommendations: [
      {
        type: String,
        trim: true,
      },
    ],
    topicMatches: [matchedTopicSchema],
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
    usage: {
      inputTokens: { type: Number, default: null },
      outputTokens: { type: Number, default: null },
      audioDurationSeconds: { type: Number, default: 0 },
    },
    errorCode: {
      type: String,
      default: null,
    },
    safeErrorMessage: {
      type: String,
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

// Compound Indexes for fast querying, filtering, and dashboard aggregation
aiCallAnalysisSchema.index({ tenantId: 1, callId: 1, analysisVersion: -1 })
aiCallAnalysisSchema.index({ tenantId: 1, status: 1, createdAt: -1 })
aiCallAnalysisSchema.index({ tenantId: 1, callOutcome: 1 })
aiCallAnalysisSchema.index({ tenantId: 1, sentiment: 1 })
aiCallAnalysisSchema.index({ tenantId: 1, createdAt: -1 })
aiCallAnalysisSchema.index({ "topicMatches.topicId": 1 })

// Text index for fast search across summary, intent, and customer needs
aiCallAnalysisSchema.index({ summary: "text", customerIntent: "text" })

// Apply strict tenant isolation plugin
aiCallAnalysisSchema.plugin(tenantIsolationPlugin)

const AICallAnalysis = mongoose.model("AICallAnalysis", aiCallAnalysisSchema)

module.exports = AICallAnalysis
module.exports.AICallAnalysis = AICallAnalysis
