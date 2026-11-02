const mongoose = require("mongoose")
const tenantIsolationPlugin = require("../plugins/tenantIsolationPlugin")

const KNOWLEDGE_SOURCE_TYPES = [
  "pdf",
  "docx",
  "doc",
  "xlsx",
  "xls",
  "csv",
  "website",
  "manual",
]

const PROCESSING_STATUSES = [
  "PENDING",
  "PROCESSING",
  "COMPLETED",
  "FAILED",
]

const aiKnowledgeSourceSchema = new mongoose.Schema(
  {
    tenantId: {
      type: String,
      required: [true, "Tenant ID is required"],
      trim: true,
      index: true,
    },
    title: {
      type: String,
      required: [true, "Source title is required"],
      trim: true,
      minlength: [1, "Title must be at least 1 character"],
      maxlength: [200, "Title cannot exceed 200 characters"],
      index: true,
    },
    sourceType: {
      type: String,
      enum: KNOWLEDGE_SOURCE_TYPES,
      required: [true, "Source type is required"],
      index: true,
    },
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "BusinessProduct",
      default: null,
      index: true,
    },
    productName: {
      type: String,
      trim: true,
      default: "",
    },
    status: {
      type: String,
      enum: PROCESSING_STATUSES,
      default: "PENDING",
      index: true,
    },
    // File details if uploaded document
    fileDetails: {
      originalFileName: { type: String, default: "" },
      sanitizedFileName: { type: String, default: "" },
      fileSize: { type: Number, default: 0 },
      mimeType: { type: String, default: "" },
      storageProvider: { type: String, enum: ["imagekit", "local", "memory", "none"], default: "none" },
      fileId: { type: String, default: "" },
      fileUrl: { type: String, default: "" },
      storagePath: { type: String, default: "" },
    },
    // Website details if website URL
    websiteDetails: {
      url: { type: String, default: "" },
      domain: { type: String, default: "" },
      resolvedIp: { type: String, default: "" },
      httpStatus: { type: Number, default: null },
      fetchedAt: { type: Date, default: null },
    },
    // Manual details if entered manually
    manualDetails: {
      content: { type: String, default: "" },
      category: { type: String, default: "" },
      tags: [{ type: String, trim: true }],
    },
    // Extracted content
    extractedText: {
      type: String,
      default: "",
      maxlength: [500000, "Extracted text cannot exceed 500,000 characters"],
    },
    textLength: {
      type: Number,
      default: 0,
    },
    wordCount: {
      type: Number,
      default: 0,
    },
    metadata: {
      pageCount: { type: Number, default: null },
      sheetNames: [{ type: String }],
      rowCount: { type: Number, default: null },
      warnings: [{ type: String }],
      extractionDurationMs: { type: Number, default: 0 },
    },
    errorMessage: {
      type: String,
      default: "",
    },
    retryCount: {
      type: Number,
      default: 0,
    },
    lastExtractedAt: {
      type: Date,
      default: null,
    },
    uploadedBy: {
      userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      name: { type: String, default: "" },
      email: { type: String, default: "" },
    },
    isArchived: {
      type: Boolean,
      default: false,
      index: true,
    },
  },
  {
    timestamps: true,
  }
)

// Index for tenant queries and filtering
aiKnowledgeSourceSchema.index({ tenantId: 1, status: 1, sourceType: 1 })
aiKnowledgeSourceSchema.index({ tenantId: 1, productId: 1 })

// Apply multi-tenant isolation plugin
aiKnowledgeSourceSchema.plugin(tenantIsolationPlugin)

const AIKnowledgeSource = mongoose.model("AIKnowledgeSource", aiKnowledgeSourceSchema)

module.exports = {
  AIKnowledgeSource,
  KNOWLEDGE_SOURCE_TYPES,
  PROCESSING_STATUSES,
}
