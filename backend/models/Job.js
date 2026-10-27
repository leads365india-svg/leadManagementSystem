const mongoose = require("mongoose")

/**
 * Job Model - Phase 9: Background Jobs Infrastructure
 * 
 * Persistent queue document supporting:
 * - Atomic job claiming with worker lock timeouts
 * - Retries with exponential backoff
 * - Per-tenant job tagging
 * - Idempotency key deduplication
 * - Survives worker process crashes and restarts
 */

const jobSchema = new mongoose.Schema(
  {
    jobId: {
      type: String,
      required: true,
      unique: true,
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
      sparse: true,
    },
    payload: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    status: {
      type: String,
      enum: ["pending", "processing", "completed", "failed", "dead_letter", "cancelled"],
      default: "pending",
      index: true,
    },
    priority: {
      type: Number,
      default: 0,
      index: true,
    },
    attempts: {
      type: Number,
      default: 0,
    },
    maxAttempts: {
      type: Number,
      default: 3,
    },
    backoff: {
      type: {
        type: String,
        enum: ["exponential", "fixed"],
        default: "exponential",
      },
      delayMs: {
        type: Number,
        default: 1000,
      },
    },
    nextRunAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    lockedAt: {
      type: Date,
      default: null,
      index: true,
    },
    lockedBy: {
      type: String,
      default: null,
    },
    lockTimeoutMs: {
      type: Number,
      default: 60000, // 60 seconds lock timeout
    },
    result: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    failedReason: {
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
  },
  {
    timestamps: true,
  },
)

// Compound query index for high-throughput atomic queue polling
jobSchema.index({ status: 1, nextRunAt: 1, priority: -1, _id: 1 })
jobSchema.index({ tenantId: 1, status: 1, createdAt: -1 })
jobSchema.index(
  { tenantId: 1, idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: "string" } } },
)

const Job = mongoose.model("Job", jobSchema)

module.exports = Job
