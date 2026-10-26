const mongoose = require("mongoose")

/**
 * DeadLetterJob Model - Phase 9: Background Jobs Infrastructure
 * 
 * Stores permanently failed jobs that have exhausted all retries.
 * Allows administrators to inspect errors, payload context, and trigger re-queueing.
 */

const deadLetterJobSchema = new mongoose.Schema(
  {
    originalJobId: {
      type: String,
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    tenantId: {
      type: String,
      required: true,
      default: "__system__",
      trim: true,
      index: true,
    },
    idempotencyKey: {
      type: String,
      trim: true,
    },
    payload: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    totalAttempts: {
      type: Number,
      required: true,
    },
    failedAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    failedReason: {
      type: String,
      required: true,
    },
    stack: {
      type: String,
      default: null,
    },
    history: [
      {
        attempt: Number,
        startedAt: Date,
        completedAt: Date,
        durationMs: Number,
        error: String,
        status: String,
      },
    ],
    requeuedAt: {
      type: Date,
      default: null,
    },
    requeuedBy: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
  },
)

deadLetterJobSchema.index({ tenantId: 1, failedAt: -1 })
deadLetterJobSchema.index({ name: 1, failedAt: -1 })

const DeadLetterJob = mongoose.model("DeadLetterJob", deadLetterJobSchema)

module.exports = DeadLetterJob
