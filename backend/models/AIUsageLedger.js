const mongoose = require("mongoose")
const tenantIsolationPlugin = require("../plugins/tenantIsolationPlugin")

/**
 * AIUsageLedger Model - Phase 3: AI Call Intelligence
 * 
 * Tracks AI resource consumption (transcription audio minutes, LLM token counts,
 * execution duration) per tenant and call.
 * 
 * Features:
 * - Idempotency key deduplication (prevents double counting on retry/re-runs)
 * - Safe null storage when provider does not return token counts (no fabrication)
 * - Strict tenant isolation
 * - Optimized for tenant dashboard usage aggregation
 */

const aiUsageLedgerSchema = new mongoose.Schema(
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
      default: null,
      index: true,
    },
    processingType: {
      type: String,
      enum: ["TRANSCRIPTION", "ANALYSIS", "TOPIC_MATCHING"],
      required: true,
      index: true,
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
    audioDurationSeconds: {
      type: Number,
      default: 0,
      min: 0,
    },
    inputTokens: {
      type: Number,
      default: null,
    },
    outputTokens: {
      type: Number,
      default: null,
    },
    durationMs: {
      type: Number,
      default: 0,
      min: 0,
    },
    status: {
      type: String,
      enum: ["SUCCESS", "FAILED"],
      required: true,
    },
    idempotencyKey: {
      type: String,
      trim: true,
      unique: true,
      sparse: true,
    },
    timestamp: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  {
    timestamps: true,
  }
)

// Compound Indexes for fast tenant-scoped usage summaries
aiUsageLedgerSchema.index({ tenantId: 1, timestamp: -1 })
aiUsageLedgerSchema.index({ tenantId: 1, processingType: 1 })
aiUsageLedgerSchema.index({ tenantId: 1, status: 1 })

// Apply strict tenant isolation plugin
aiUsageLedgerSchema.plugin(tenantIsolationPlugin)

const AIUsageLedger = mongoose.model("AIUsageLedger", aiUsageLedgerSchema)

module.exports = {
  AIUsageLedger,
}
