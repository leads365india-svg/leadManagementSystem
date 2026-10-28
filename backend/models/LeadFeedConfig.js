const mongoose = require("mongoose")
const tenantIsolationPlugin = require("../plugins/tenantIsolationPlugin")

const leadFeedConfigSchema = new mongoose.Schema(
  {
    tenantId: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },
    accountId: {
      type: String,
      index: true,
      trim: true,
    },
    websiteSource: {
      enabled: {
        type: Boolean,
        default: true,
      },
      apiKeyHash: {
        type: String,
        index: true,
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
      // Phase 22: Public Site Key & Allowed Origins
      siteKey: {
        type: String,
        index: true,
        default: null,
      },
      allowedOrigins: {
        type: [String],
        default: [],
      },
      assignedStaffId: {
        type: String,
        default: "unassigned",
      },
      assignedStaffName: {
        type: String,
        default: "Unassigned",
      },
      // B. Accepted Forms (empty array = all forms accepted)
      acceptedForms: {
        type: [String],
        default: [],
      },
      // C. Email Verification Settings
      emailVerification: {
        requireVerifiedEmail: {
          type: Boolean,
          default: false,
        },
        holdUntilConfirmed: {
          type: Boolean,
          default: false,
        },
        strictVerification: {
          type: Boolean,
          default: false,
        },
        allowPhoneOnly: {
          type: Boolean,
          default: true,
        },
      },
      // D. Blocked Email Domains (stored lowercase)
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
      // E. Duplicate Handling Policy
      duplicateHandling: {
        type: String,
        enum: ["reject", "update", "allow"],
        default: "reject",
      },
      // F. Activity & Performance Metrics
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
    // Stubs for future extensions
    metaSource: {
      enabled: { type: Boolean, default: false },
      status: { type: String, default: "not_configured" },
    },
    googleSource: {
      enabled: { type: Boolean, default: false },
      status: { type: String, default: "not_configured" },
      googleKeyHash: { type: String, index: true, default: null },
      googleKeyMasked: { type: String, default: "" },
      googleKeyLastRotatedAt: { type: Date, default: null },
      assignedStaffId: { type: String, default: "unassigned" },
      assignedStaffName: { type: String, default: "Unassigned" },
      duplicateHandling: {
        type: String,
        enum: ["reject", "update", "allow"],
        default: "update",
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
    wordPressSource: {
      enabled: { type: Boolean, default: false },
      status: { type: String, default: "not_configured" },
    },
    zapierSource: {
      enabled: { type: Boolean, default: false },
      status: { type: String, default: "not_configured" },
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform: (_doc, ret) => {
        ret.id = ret._id
        delete ret._id
        delete ret.__v
        // Never expose apiKeyHash or googleKeyHash in serialized JSON output
        delete ret.websiteSource?.apiKeyHash
        delete ret.googleSource?.googleKeyHash
        return ret
      },
    },
  },
)

leadFeedConfigSchema.plugin(tenantIsolationPlugin)

module.exports = mongoose.model("LeadFeedConfig", leadFeedConfigSchema)
