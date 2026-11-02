const mongoose = require("mongoose")
const tenantIsolationPlugin = require("../plugins/tenantIsolationPlugin")

/**
 * LeadConcurrencyLock Model - Phase 2: Concurrent Duplicate Lead Protection
 *
 * Provides distributed, tenant-partitioned identity lock across multi-instance nodes:
 * - Keyed by atomic _id: `${tenantId}:${identityType}:${identityHash}`
 * - Enforces mutual exclusion during concurrent submissions with different idempotency keys
 * - Protects 'reject' and 'update' policies from race conditions
 * - Skipped entirely when duplicate policy is 'allow' to preserve intentional duplicates
 * - Built-in lock lease timeout (15 seconds) prevents deadlock on worker crash
 */

const leadConcurrencyLockSchema = new mongoose.Schema(
  {
    _id: {
      type: String, // `${tenantId}:${identityType}:${identityHash}`
      required: true,
    },
    tenantId: {
      type: String,
      required: true,
      index: true,
      trim: true,
    },
    identityType: {
      type: String,
      enum: ["email", "phone"],
      required: true,
    },
    identityHash: {
      type: String,
      required: true,
    },
    lockedAt: {
      type: Date,
      default: Date.now,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
    ownerToken: {
      type: String,
      default: null,
      index: true,
    },
  },
  {
    collection: "lead_concurrency_locks",
  }
)

leadConcurrencyLockSchema.plugin(tenantIsolationPlugin, { tenantField: "tenantId" })

const LeadConcurrencyLock =
  mongoose.models.LeadConcurrencyLock ||
  mongoose.model("LeadConcurrencyLock", leadConcurrencyLockSchema)

module.exports = {
  LeadConcurrencyLock,
}
