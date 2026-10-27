const mongoose = require("mongoose")
const tenantIsolationPlugin = require("../plugins/tenantIsolationPlugin")
const { sanitizeAuditDetails } = require("../utils/auditSanitizer")

/**
 * AuditLog Model - Phase 8: Audit Log
 * 
 * Centralized, append-only security and operational audit trail.
 * Strictly isolated per tenant and immutable against tampering,
 * modification, or deletion through standard application APIs.
 */

const actorSubSchema = new mongoose.Schema(
  {
    id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    name: {
      type: String,
      required: [true, "Actor name is required"],
      trim: true,
      default: "System",
    },
    email: {
      type: String,
      required: [true, "Actor email is required"],
      trim: true,
      lowercase: true,
      default: "system@leads365.internal",
    },
    role: {
      type: String,
      trim: true,
      default: "system",
    },
  },
  { _id: false },
)

const auditLogSchema = new mongoose.Schema(
  {
    tenantId: {
      type: String,
      required: [true, "Tenant ID is required for audit logs"],
      trim: true,
      index: true,
    },
    actor: {
      type: actorSubSchema,
      required: [true, "Actor information is required"],
    },
    action: {
      type: String,
      required: [true, "Audit action identifier is required"],
      trim: true,
      index: true,
    },
    entity: {
      type: String,
      required: [true, "Entity type is required"],
      trim: true,
      index: true,
    },
    entityId: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    summary: {
      type: String,
      required: [true, "Audit summary description is required"],
      trim: true,
      maxlength: [1000, "Summary cannot exceed 1000 characters"],
    },
    details: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    ip: {
      type: String,
      trim: true,
      default: "unknown",
    },
    userAgent: {
      type: String,
      trim: true,
      default: "unknown",
    },
    timestamp: {
      type: Date,
      default: Date.now,
      index: true,
      immutable: true,
    },
  },
  {
    timestamps: false, // We use immutable `timestamp` only
    versionKey: false,
  },
)

// Compound query indexes for high-performance scoped audit investigations
auditLogSchema.index({ tenantId: 1, timestamp: -1 })
auditLogSchema.index({ tenantId: 1, entity: 1, timestamp: -1 })
auditLogSchema.index({ tenantId: 1, action: 1, timestamp: -1 })
auditLogSchema.index({ tenantId: 1, "actor.id": 1, timestamp: -1 })

// Pre-save validation: sanitize details and enforce append-only invariant
auditLogSchema.pre("save", function (next) {
  if (!this.isNew) {
    const error = new Error("Audit log entries are immutable and cannot be modified.")
    error.statusCode = 400
    return next(error)
  }

  // Ensure details payload is safely sanitized
  if (this.details) {
    this.details = sanitizeAuditDetails(this.details)
  }

  next()
})

// Immutability Guards: Block any update or delete operations on audit collection
const blockMutation = function (next) {
  const error = new Error("Audit log entries are strictly immutable and cannot be updated or deleted through the API.")
  error.statusCode = 403
  next(error)
}

auditLogSchema.pre("updateOne", blockMutation)
auditLogSchema.pre("updateMany", blockMutation)
auditLogSchema.pre("findOneAndUpdate", blockMutation)
auditLogSchema.pre("replaceOne", blockMutation)
auditLogSchema.pre("findOneAndReplace", blockMutation)
auditLogSchema.pre("deleteOne", blockMutation)
auditLogSchema.pre("deleteOne", { document: true, query: false }, blockMutation)
auditLogSchema.pre("deleteMany", blockMutation)
auditLogSchema.pre("findOneAndDelete", blockMutation)
auditLogSchema.pre("findOneAndRemove", blockMutation)

// Apply tenant isolation plugin
auditLogSchema.plugin(tenantIsolationPlugin)

const AuditLog = mongoose.model("AuditLog", auditLogSchema)

module.exports = AuditLog
module.exports.AuditLog = AuditLog
