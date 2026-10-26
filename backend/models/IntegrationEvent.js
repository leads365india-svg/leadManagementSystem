const mongoose = require("mongoose")
const tenantIsolationPlugin = require("../plugins/tenantIsolationPlugin")
const { sanitizeAuditDetails } = require("../utils/auditSanitizer")

/**
 * IntegrationEvent Model - Roadmap Phase 11: Integration Event Ledger
 * 
 * An append-only ledger of incoming webhook payloads and results:
 * - Redacts sensitive tokens/passwords/API keys
 * - Enforces payload size limit (max 64KB)
 * - Tracks processing status: received, queued, processed, failed, replayed
 * - Provides replay capabilities while preserving original submission timestamps
 */

const MAX_PAYLOAD_BYTES = 64 * 1024 // 64 KB limit

const ALLOWED_EVENT_STATUSES = [
  "received",
  "queued",
  "processed",
  "failed",
  "replayed",
]

/**
 * Deep sanitization helper that scrubs secrets, auth headers, tokens, and passwords
 */
function deepSanitizePayload(data, depth = 0) {
  if (!data || depth > 8) return data
  if (typeof data !== "object") return data

  if (Array.isArray(data)) {
    return data.map((item) => deepSanitizePayload(item, depth + 1))
  }

  const sanitized = {}
  const SENSITIVE_KEY_REGEX = /pass(word)?|token|secret|auth|bearer|key|credential|private|cert/i

  for (const [k, v] of Object.entries(data)) {
    if (SENSITIVE_KEY_REGEX.test(k)) {
      if (typeof v === "string" && v.length > 6) {
        sanitized[k] = `[REDACTED_${k.toUpperCase()}]`
      } else {
        sanitized[k] = "[REDACTED]"
      }
    } else if (typeof v === "object" && v !== null) {
      sanitized[k] = deepSanitizePayload(v, depth + 1)
    } else {
      sanitized[k] = v
    }
  }

  return sanitized
}

const integrationEventSchema = new mongoose.Schema(
  {
    tenantId: {
      type: String,
      required: [true, "Tenant ID is required for integration events"],
      index: true,
      trim: true,
    },
    integrationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Integration",
      index: true,
      default: null,
    },
    integrationType: {
      type: String,
      default: "website",
      trim: true,
      index: true,
    },
    idempotencyKey: {
      type: String,
      index: true,
      sparse: true,
      trim: true,
      default: null,
    },
    headers: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
    rawPayload: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
    normalizedPayload: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
    source: {
      type: String,
      default: "Website",
      trim: true,
      index: true,
    },
    status: {
      type: String,
      enum: ALLOWED_EVENT_STATUSES,
      default: "received",
      index: true,
    },
    httpStatus: {
      type: Number,
      default: 200,
    },
    result: {
      leadId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Lead",
        default: null,
      },
      action: {
        type: String,
        default: "",
      },
      message: {
        type: String,
        default: "",
      },
    },
    errorMessage: {
      type: String,
      default: "",
      trim: true,
    },
    errorStack: {
      type: String,
      default: "",
    },
    replayCount: {
      type: Number,
      default: 0,
    },
    lastReplayedAt: {
      type: Date,
      default: null,
    },
    replayedBy: {
      id: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      name: { type: String, default: "" },
      role: { type: String, default: "" },
    },
    payloadSizeBytes: {
      type: Number,
      default: 0,
    },
    createdAt: {
      type: Date,
      default: Date.now,
      immutable: true, // Original submission timestamp is immutable
      index: true,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: true },
    toJSON: {
      transform: (_doc, ret) => {
        ret.id = ret._id
        delete ret._id
        delete ret.__v
        return ret
      },
    },
  },
)

// Compound indexes
integrationEventSchema.index({ tenantId: 1, createdAt: -1 })
integrationEventSchema.index({ tenantId: 1, status: 1, createdAt: -1 })
integrationEventSchema.index({ tenantId: 1, integrationId: 1, createdAt: -1 })
integrationEventSchema.index({ tenantId: 1, idempotencyKey: 1 }, { sparse: true })

// Pre-save hook for sanitization, size checking, and redaction
integrationEventSchema.pre("save", function (next) {
  // 1. Sanitize rawPayload
  if (this.rawPayload && typeof this.rawPayload === "object") {
    // Check payload size
    try {
      const serialized = JSON.stringify(this.rawPayload)
      this.payloadSizeBytes = Buffer.byteLength(serialized, "utf8")
      if (this.payloadSizeBytes > MAX_PAYLOAD_BYTES) {
        // Truncate or reject oversized payloads
        this.rawPayload = {
          _truncated: true,
          originalSizeBytes: this.payloadSizeBytes,
          warning: "Payload exceeded 64KB limit and was truncated for security.",
          snippet: serialized.slice(0, 1024),
        }
      } else {
        this.rawPayload = deepSanitizePayload(this.rawPayload)
      }
    } catch (_) {}
  }

  // 2. Sanitize headers (scrub authorization, cookie, x-api-key)
  if (this.headers && typeof this.headers === "object") {
    const cleanHeaders = {}
    for (const [key, val] of Object.entries(this.headers)) {
      const lKey = key.toLowerCase()
      if (lKey === "authorization" || lKey === "x-api-key" || lKey === "cookie") {
        cleanHeaders[key] = "[REDACTED]"
      } else {
        cleanHeaders[key] = val
      }
    }
    this.headers = cleanHeaders
  }

  // 3. Sanitize normalizedPayload
  if (this.normalizedPayload && typeof this.normalizedPayload === "object") {
    this.normalizedPayload = sanitizeAuditDetails(this.normalizedPayload)
  }

  next()
})

// Enforce ambient multi-tenant isolation
integrationEventSchema.plugin(tenantIsolationPlugin, { tenantField: "tenantId" })

const IntegrationEvent =
  mongoose.models.IntegrationEvent || mongoose.model("IntegrationEvent", integrationEventSchema)

module.exports = {
  IntegrationEvent,
  ALLOWED_EVENT_STATUSES,
  MAX_PAYLOAD_BYTES,
  deepSanitizePayload,
}
