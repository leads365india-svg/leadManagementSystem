const mongoose = require("mongoose")
const tenantIsolationPlugin = require("../plugins/tenantIsolationPlugin")
const { normalizePhoneE164 } = require("../utils/phoneNormalizer")

/**
 * Attribution Sub-schema - Phase 6: Lead Model v2
 * Captures marketing attribution touches (first-touch write-once, last-touch updated)
 */
const attributionSubSchema = new mongoose.Schema(
  {
    source: { type: String, default: "", trim: true },
    medium: { type: String, default: "", trim: true },
    campaign: { type: String, default: "", trim: true },
    term: { type: String, default: "", trim: true },
    content: { type: String, default: "", trim: true },
    gclid: { type: String, default: "", trim: true },
    fbclid: { type: String, default: "", trim: true },
    adId: { type: String, default: "", trim: true },
    adSetId: { type: String, default: "", trim: true },
    campaignId: { type: String, default: "", trim: true },
    landingPage: { type: String, default: "", trim: true },
    referrer: { type: String, default: "", trim: true },
    timestamp: { type: Date, default: Date.now },
  },
  { _id: false },
)

/**
 * Assignment History Sub-schema - Phase 7: Lead Ownership & Assignment
 * Tracks accountable ownership trajectory (from, to, by, at, reason)
 */
const assignmentHistorySubSchema = new mongoose.Schema(
  {
    fromOwnerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    fromOwnerName: {
      type: String,
      default: "Unassigned",
      trim: true,
    },
    toOwnerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    toOwnerName: {
      type: String,
      default: "Unassigned",
      trim: true,
    },
    teamId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Team",
      default: null,
    },
    assignedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    assignedByName: {
      type: String,
      default: "System",
      trim: true,
    },
    assignedAt: {
      type: Date,
      default: Date.now,
    },
    reason: {
      type: String,
      default: "Manual assignment",
      trim: true,
    },
  },
  { _id: false },
)

const leadSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Name is required"],
      trim: true,
      minlength: [2, "Name must be at least 2 characters long"],
      maxlength: [100, "Name cannot exceed 100 characters"],
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      default: "",
    },
    phone: {
      type: String,
      trim: true,
      default: "",
    },
    // Normalized E.164 phone representation (e.g. +919876543210) for dialer & telephony deduplication
    phoneNormalized: {
      type: String,
      trim: true,
      default: "",
      index: true,
    },
    alternatePhone: {
      type: String,
      trim: true,
      default: "",
    },
    company: {
      type: String,
      trim: true,
      default: "",
    },
    city: {
      type: String,
      trim: true,
      default: "",
    },
    status: {
      type: String,
      enum: ["New", "Engaged", "Proposal Sent", "Closed-Won", "Closed-Lost"],
      default: "New",
      required: [true, "Status is required"],
    },
    tenantId: {
      type: String,
      required: [true, "Tenant ID is required"],
      index: true,
    },
    source: {
      type: String,
      default: "Website",
      trim: true,
    },
    sourceId: {
      type: String,
      default: "",
      trim: true,
    },
    assignedTo: {
      type: String,
      default: "Unassigned",
      trim: true,
    },
    assignedStaffId: {
      type: String,
      default: "unassigned",
    },
    // Primary ownership field referencing User (replaces assignedStaffId in v2 while preserving backward-compatibility)
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    teamId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Team",
      default: null,
      index: true,
    },
    tags: {
      type: [String],
      default: [],
    },
    // Multi-touch attribution
    attribution: {
      firstTouch: {
        type: attributionSubSchema,
        default: () => ({}),
      },
      lastTouch: {
        type: attributionSubSchema,
        default: () => ({}),
      },
    },
    // Accountable ownership assignment history - Phase 7
    assignmentHistory: {
      type: [assignmentHistorySubSchema],
      default: [],
    },
    lastContactedAt: {
      type: Date,
      default: null,
    },
    deletedAt: {
      type: Date,
      default: null,
      index: true,
    },
    message: {
      type: String,
      default: "",
      maxlength: [2000, "Message cannot exceed 2000 characters"],
    },
    formId: {
      type: String,
      default: "",
      trim: true,
    },
    landingPage: {
      type: String,
      default: "",
      trim: true,
    },
    isEmailVerified: {
      type: Boolean,
      default: false,
    },
    verificationStatus: {
      type: String,
      enum: ["unverified", "pending_confirmation", "verified", "trusted"],
      default: "unverified",
    },
    isTest: {
      type: Boolean,
      default: false,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform: (doc, ret) => {
        ret.id = ret._id
        delete ret._id
        delete ret.__v
        return ret
      },
    },
  },
)

// Synchronize legacy and v2 fields prior to persistence
leadSchema.pre("save", function (next) {
  // Normalize phone to E.164 if phone is present and phoneNormalized is empty
  if (this.phone && !this.phoneNormalized) {
    this.phoneNormalized = normalizePhoneE164(this.phone)
  }

  // Synchronize company between top-level and metadata
  if (this.company) {
    if (!this.metadata) this.metadata = {}
    this.metadata.company = this.company
  } else if (this.metadata?.company) {
    this.company = this.metadata.company
  }

  // Synchronize ownerId and legacy assignedStaffId
  if (
    this.assignedStaffId &&
    this.assignedStaffId !== "unassigned" &&
    mongoose.Types.ObjectId.isValid(this.assignedStaffId) &&
    !this.ownerId
  ) {
    this.ownerId = new mongoose.Types.ObjectId(this.assignedStaffId)
  } else if (this.ownerId) {
    this.assignedStaffId = this.ownerId.toString()
  } else if (!this.ownerId && (!this.assignedStaffId || this.assignedStaffId === "unassigned")) {
    this.assignedStaffId = "unassigned"
    if (!this.assignedTo) this.assignedTo = "Unassigned"
  }

  next()
})

// Query performance and tenant-scoped lookups
leadSchema.index({ tenantId: 1, createdAt: -1 })
leadSchema.index({ tenantId: 1, email: 1 })
leadSchema.index({ tenantId: 1, phone: 1 })
leadSchema.index({ status: 1 })
leadSchema.index({ createdAt: -1 })
leadSchema.index({ name: "text", email: "text" })
leadSchema.index({ tenantId: 1, "metadata.idempotencyKey": 1 }, { unique: true, partialFilterExpression: { "metadata.idempotencyKey": { $type: "string" } } })
leadSchema.index({ tenantId: 1, "metadata.verificationTokenHash": 1 }, { sparse: true })

// Phase 6 Required Compound Indexes
leadSchema.index({ tenantId: 1, phoneNormalized: 1 })
leadSchema.index({ tenantId: 1, ownerId: 1, status: 1 })
leadSchema.index({ tenantId: 1, sourceId: 1, createdAt: -1 })

leadSchema.plugin(tenantIsolationPlugin)

module.exports = mongoose.model("Lead", leadSchema)
