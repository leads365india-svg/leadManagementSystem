const mongoose = require("mongoose")
const tenantIsolationPlugin = require("../plugins/tenantIsolationPlugin")

const TOPIC_STATUSES = [
  "DRAFT",
  "PENDING_APPROVAL",
  "APPROVED",
  "REJECTED",
  "ARCHIVED",
]

const DEFAULT_CATEGORIES = [
  "Sales & Inquiries",
  "Product Specifications",
  "Pricing & Commercials",
  "Delivery & Logistics",
  "Warranty & Support",
  "Consultation & Services",
  "General / Other",
]

const sourceReferenceSchema = new mongoose.Schema(
  {
    sourceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AIKnowledgeSource",
      default: null,
    },
    title: {
      type: String,
      trim: true,
      default: "",
    },
    sourceType: {
      type: String,
      trim: true,
      default: "",
    },
    snippet: {
      type: String,
      trim: true,
      maxlength: [1000, "Source snippet cannot exceed 1000 characters"],
      default: "",
    },
  },
  { _id: false }
)

const aiKeywordTopicSchema = new mongoose.Schema(
  {
    tenantId: {
      type: String,
      required: [true, "Tenant ID is required"],
      trim: true,
      index: true,
    },
    name: {
      type: String,
      required: [true, "Topic name is required"],
      trim: true,
      minlength: [2, "Topic name must be at least 2 characters"],
      maxlength: [200, "Topic name cannot exceed 200 characters"],
      index: true,
    },
    category: {
      type: String,
      trim: true,
      maxlength: [100, "Category cannot exceed 100 characters"],
      default: "Sales & Inquiries",
      index: true,
    },
    status: {
      type: String,
      enum: TOPIC_STATUSES,
      default: "PENDING_APPROVAL",
      required: true,
      index: true,
    },
    confidenceScore: {
      type: Number,
      min: [0, "Confidence score cannot be less than 0"],
      max: [1, "Confidence score cannot exceed 1"],
      default: 0.85,
    },
    primaryKeywords: {
      type: [{ type: String, trim: true, maxlength: 100 }],
      default: [],
      validate: {
        validator: function (v) {
          return Array.isArray(v)
        },
        message: "Primary keywords must be an array",
      },
    },
    synonyms: {
      type: [{ type: String, trim: true, maxlength: 100 }],
      default: [],
    },
    customerQuestions: {
      type: [{ type: String, trim: true, maxlength: 500 }],
      default: [],
    },
    productTerminology: {
      type: [{ type: String, trim: true, maxlength: 100 }],
      default: [],
    },
    discussionPoints: {
      type: [{ type: String, trim: true, maxlength: 500 }],
      default: [],
    },
    relatedProductIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "BusinessProduct",
      },
    ],
    sourceReferences: {
      type: [sourceReferenceSchema],
      default: [],
    },
    rejectionReason: {
      type: String,
      trim: true,
      maxlength: [500, "Rejection reason cannot exceed 500 characters"],
      default: "",
    },
    version: {
      type: Number,
      default: 1,
      min: 1,
    },
    generatedAt: {
      type: Date,
      default: Date.now,
    },
    approvedAt: {
      type: Date,
      default: null,
    },
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    archivedAt: {
      type: Date,
      default: null,
    },
    archivedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  {
    timestamps: true,
  }
)

// Compound Indexes for fast tenant-scoped filtering and lookup
aiKeywordTopicSchema.index({ tenantId: 1, status: 1, createdAt: -1 })
aiKeywordTopicSchema.index({ tenantId: 1, category: 1 })
aiKeywordTopicSchema.index({ tenantId: 1, name: 1 })

// Text index on name and primaryKeywords for keyword search
aiKeywordTopicSchema.index({ name: "text", primaryKeywords: "text", category: "text" })

/**
 * Phase 3 Call Analysis Contract:
 * Strictly retrieves only APPROVED discussion topics for the given tenant.
 * Topics with status PENDING_APPROVAL, DRAFT, REJECTED, or ARCHIVED are excluded.
 *
 * @param {string} tenantId - Tenant ID partition
 * @param {Object} [projection] - Optional fields to select
 * @returns {Promise<Array>} List of approved topics
 */
aiKeywordTopicSchema.statics.getApprovedTopicsForTenant = async function (tenantId, projection = null) {
  if (!tenantId || typeof tenantId !== "string") {
    throw new Error("A valid tenantId is required to query approved discussion topics.")
  }
  return this.find({ tenantId: tenantId.trim(), status: "APPROVED" }, projection)
    .populate("relatedProductIds", "name type category price")
    .lean()
}

// Apply strict tenant isolation plugin
aiKeywordTopicSchema.plugin(tenantIsolationPlugin)

const AIKeywordTopic = mongoose.model("AIKeywordTopic", aiKeywordTopicSchema)

module.exports = AIKeywordTopic
module.exports.AIKeywordTopic = AIKeywordTopic
module.exports.TOPIC_STATUSES = TOPIC_STATUSES
module.exports.DEFAULT_CATEGORIES = DEFAULT_CATEGORIES

