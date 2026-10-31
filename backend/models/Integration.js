const mongoose = require("mongoose")
const tenantIsolationPlugin = require("../plugins/tenantIsolationPlugin")
const { encrypt, decrypt } = require("../utils/cryptoUtils")

/**
 * Integration Model - Roadmap Phase 11: Integration Core & Source Registry
 * 
 * Central multi-tenant connector model supporting:
 * - Types: website, google_ads, meta, zapier, indiamart, wordpress, wix, generic
 * - Encrypted credentials (AES-256-GCM)
 * - Safe constant-time API key hashing & masking
 * - Per-integration field mappings & ingestion rules
 * - Ingestion stats and health monitoring
 */

const ALLOWED_INTEGRATION_TYPES = [
  "website",
  "wordpress",
  "html",
  "php",
  "react",
  "nextjs",
  "webhook",
  "generic",
  "google_ads",
  "meta",
  "zapier",
  "indiamart",
  "wix",
]

const fieldMappingSchema = new mongoose.Schema(
  {
    sourceField: {
      type: String,
      required: true,
      trim: true,
    },
    targetField: {
      type: String,
      required: true,
      trim: true,
    },
    defaultValue: {
      type: String,
      default: "",
    },
    transform: {
      type: String,
      enum: ["none", "lowercase", "uppercase", "trim", "phone_e164"],
      default: "none",
    },
  },
  { _id: false },
)

const integrationSchema = new mongoose.Schema(
  {
    tenantId: {
      type: String,
      required: [true, "Tenant ID is required for integrations"],
      index: true,
      trim: true,
    },
    name: {
      type: String,
      required: [true, "Integration name is required"],
      trim: true,
      maxlength: 120,
    },
    type: {
      type: String,
      required: [true, "Integration type is required"],
      enum: {
        values: ALLOWED_INTEGRATION_TYPES,
        message: "Invalid integration type: `{VALUE}`",
      },
      index: true,
    },
    status: {
      type: String,
      enum: ["active", "inactive", "error"],
      default: "active",
      index: true,
    },
    apiKeyHash: {
      type: String,
      default: null,
    },
    apiKeyMasked: {
      type: String,
      default: "",
    },
    apiKeyLastRotatedAt: {
      type: Date,
      default: Date.now,
    },
    // Phase 22: Public Site Key for browser form/snippet intake
    siteKey: {
      type: String,
      index: true,
      default: null,
    },
    // Encrypted credentials payload (AES-256-GCM)
    credentials: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    fieldMapping: {
      type: [fieldMappingSchema],
      default: [],
    },
    assignedRuleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AssignmentRule",
      default: null,
    },
    assignedStaffId: {
      type: String,
      default: "unassigned",
    },
    assignedStaffName: {
      type: String,
      default: "Unassigned",
    },
    settings: {
      websiteDomain: {
        type: String,
        default: "",
        trim: true,
      },
      allowedOrigins: {
        type: [String],
        default: [],
      },
      leadSource: {
        type: String,
        default: "",
        trim: true,
      },
      defaultStatus: {
        type: String,
        default: "New",
        trim: true,
      },
      acceptedForms: {
        type: [String],
        default: [],
      },
      blockedDomains: {
        type: [String],
        default: [
          "mailinator.com",
          "tempmail.com",
          "guerrillamail.com",
          "10minutemail.com",
          "throwawaymail.com",
          "yopmail.com",
        ],
      },
      duplicateHandling: {
        type: String,
        enum: ["reject", "update", "allow"],
        default: "reject",
      },
      emailVerification: {
        requireVerifiedEmail: { type: Boolean, default: false },
        holdUntilConfirmed: { type: Boolean, default: false },
        strictVerification: { type: Boolean, default: false },
        allowPhoneOnly: { type: Boolean, default: true },
      },
      rateLimitPerMinute: {
        type: Number,
        default: 60,
      },
      customConfig: {
        type: mongoose.Schema.Types.Mixed,
        default: () => ({}),
      },
    },
    stats: {
      totalReceived: { type: Number, default: 0 },
      totalSuccess: { type: Number, default: 0 },
      totalErrors: { type: Number, default: 0 },
      lastReceivedAt: { type: Date, default: null },
      lastSuccessAt: { type: Date, default: null },
      lastErrorAt: { type: Date, default: null },
      lastErrorMessage: { type: String, default: "" },
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform: (_doc, ret) => {
        ret.id = ret._id
        delete ret._id
        delete ret.__v
        // Never expose sensitive fields over management API
        delete ret.apiKeyHash
        delete ret.credentials
        return ret
      },
    },
  },
)

// Compound indexes
integrationSchema.index({ tenantId: 1, type: 1 })
integrationSchema.index({ tenantId: 1, name: 1 })
integrationSchema.index({ apiKeyHash: 1 }, { sparse: true })

/**
 * Encrypt and store credentials
 */
integrationSchema.methods.setCredentials = function (credentialsObj) {
  if (!credentialsObj) {
    this.credentials = null
    return
  }
  const encrypted = encrypt(credentialsObj)
  this.credentials = encrypted
}

/**
 * Decrypt and retrieve credentials safely
 */
integrationSchema.methods.getDecryptedCredentials = function () {
  if (!this.credentials) return null
  return decrypt(this.credentials)
}

// Enforce ambient multi-tenant isolation
integrationSchema.plugin(tenantIsolationPlugin, { tenantField: "tenantId" })

const Integration = mongoose.models.Integration || mongoose.model("Integration", integrationSchema)

module.exports = {
  Integration,
  ALLOWED_INTEGRATION_TYPES,
}
